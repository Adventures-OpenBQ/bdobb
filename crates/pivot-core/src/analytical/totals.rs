// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
#[derive(Clone, Debug)]
pub struct CalculatedTotals {
    pub scope: CalculationScope,
    pub formulas: FormulaValues,
}
pub fn temporal_context(m: &CompiledModel) -> TemporalContext {
    let dates: BTreeSet<_> = m
        .categories
        .iter()
        .filter(|c| c.transform != Transform::Native || c.legacy_bucket.is_some())
        .map(|c| c.source_field_id.clone())
        .collect();
    let companies: BTreeSet<_> = m
        .categories
        .iter()
        .filter_map(|c| {
            c.fiscal_binding
                .as_ref()
                .map(|b| b.company_field_id.clone())
        })
        .collect();
    TemporalContext {
        date_field_id: (dates.len() == 1).then(|| dates.into_iter().next().unwrap()),
        company_field_id: (companies.len() == 1).then(|| companies.into_iter().next().unwrap()),
        company_ids: None,
    }
}
pub fn scope_for(
    pool: &EligiblePool,
    rows: &[DatasetRow],
    constraints: &CategoryConstraints,
    m: &CompiledModel,
) -> CalculationScope {
    let mut temporal = temporal_context(m);
    if let Some(company) = &temporal.company_field_id {
        let mut values = vec![];
        for r in rows {
            let v = r.values.get(company).cloned().unwrap_or(WireValue::Missing);
            if !values.contains(&v) {
                values.push(v);
            }
        }
        temporal.company_ids = Some(values);
    }
    let a = model(m);
    let mut ids = a.layout.rows.clone();
    ids.extend(a.layout.columns.clone());
    ids.extend(a.result_filters.iter().map(|f| f.category_id.clone()));
    let mut slices = vec![];
    let mut seen = BTreeSet::new();
    for r in rows {
        for mut categories in partitions(std::slice::from_ref(r), pool, &ids) {
            if m.execution.is_some() {
                categories.extend(constraints.iter().map(|(k, v)| (k.clone(), v.clone())));
            }
            let company = temporal
                .company_field_id
                .as_ref()
                .map(|f| vec![r.values.get(f).cloned().unwrap_or(WireValue::Missing)]);
            let signature = format!("{:?}/{:?}", categories, company);
            if seen.insert(signature) {
                slices.push(ContextSlice {
                    categories,
                    company_ids: company,
                });
            }
        }
    }
    CalculationScope {
        source_record_ids: rows.iter().map(|r| r.id.clone()).collect(),
        category_constraints: constraints.clone(),
        context_slices: Some(slices),
        page: pool.page.clone(),
        temporal_context: temporal,
        declared_members: m
            .execution
            .as_ref()
            .map(|e| e.scope_members.clone())
            .unwrap_or_default(),
        ..Default::default()
    }
}
fn complete_scope(
    pool: &EligiblePool,
    scope: &CalculationScope,
    m: &CompiledModel,
) -> CalculationScope {
    let mut scope = scope.clone();
    if let Some(e) = &m.execution {
        for field in [
            Some(&e.policy.company_field_id),
            e.policy.currency_field_id.as_ref(),
            e.policy.unit_field_id.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            let mut values = vec![];
            for row in pool.rows_in(&scope.source_record_ids) {
                let v = row.values.get(field).cloned().unwrap_or(WireValue::Missing);
                if !values.contains(&v) {
                    values.push(v);
                }
            }
            scope.field_constraints.insert(field.clone(), values);
        }
        let category = m
            .categories
            .iter()
            .find(|c| {
                matches!(
                    (c.transform, e.policy.period_kind),
                    (Transform::FY, PeriodKind::FY) | (Transform::FQ, PeriodKind::FQ)
                )
            })
            .map(|c| c.id.clone())
            .unwrap_or_default();
        let evidence = collect_fiscal_evidence(pool, &scope.source_record_ids, &category);
        scope.requested_fiscal_scope = Some(RequestedFiscalScope {
            category_id: category,
            dependent_category_ids: e.policy.dependent_category_ids.clone(),
            periods: evidence.periods,
            errors: evidence.errors,
        });
        scope.declared_members = e.scope_members.clone();
    }
    scope
}
#[allow(clippy::result_large_err)]
pub fn calculate_totals(
    pool: &EligiblePool,
    scope: &CalculationScope,
    m: &CompiledModel,
    order: &dyn ValueOrder,
) -> Result<ScopedValues, Diagnostic> {
    ScopeResults::default()
        .calculate(pool, scope, m, order)
        .and_then(|v| project_totals(v, Scope::Filtered))
}
#[allow(clippy::result_large_err)]
pub(crate) fn project_totals(
    t: &CalculatedTotals,
    scope: Scope,
) -> Result<ScopedValues, Diagnostic> {
    let mut values = ValueRecord::new();
    let mut errors = BTreeMap::new();
    for (id, c) in t.formulas.measure_cells.iter().chain(&t.formulas.cells) {
        super::projection_columns::put_cell(id, c, &mut values, &mut errors)?;
    }
    Ok(ScopedValues {
        scope,
        values,
        empty: Some(t.formulas.empty),
        cell_errors: (!errors.is_empty()).then_some(errors),
        members: None,
    })
}

/// Only one calculate_view preparation owns these results. Pool/model/order are
/// immutable throughout; full typed scope equality includes original record IDs,
/// ordered context constraints, fiscal evidence, and declared Statement members.
#[derive(Default)]
pub(super) struct ScopeResults {
    values: Vec<CalculatedTotals>,
    /// Hash of record IDs and category constraints -> candidate indexes;
    /// exact_eq still decides, so this only narrows the search.
    index: std::collections::HashMap<u64, Vec<usize>>,
}
impl ScopeResults {
    #[allow(clippy::result_large_err)]
    pub(super) fn calculate<'a>(
        &'a mut self,
        pool: &EligiblePool,
        scope: &CalculationScope,
        model: &CompiledModel,
        order: &dyn ValueOrder,
    ) -> Result<&'a CalculatedTotals, Diagnostic> {
        let scope = complete_scope(pool, scope, model);
        let hash = {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            scope.source_record_ids.hash(&mut h);
            scope
                .category_constraints
                .iter()
                .for_each(|c| c.hash(&mut h));
            h.finish()
        };
        let candidates = self.index.entry(hash).or_default();
        let position = candidates
            .iter()
            .copied()
            .find(|&i| self.values[i].scope.exact_eq(&scope));
        let index = if let Some(index) = position {
            index
        } else {
            let formulas = evaluate_aggregate(&scope, pool, model, order)?;
            self.values.push(CalculatedTotals { scope, formulas });
            candidates.push(self.values.len() - 1);
            self.values.len() - 1
        };
        Ok(&self.values[index])
    }
}
