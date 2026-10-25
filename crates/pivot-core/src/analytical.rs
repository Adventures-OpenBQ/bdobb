// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Calculation-owned state; this full view is deliberately not a wire response.
use crate::{contract::*, formulas::aggregate::*, formulas::*, ordering::ValueOrder, scopes::*};
use std::collections::{BTreeMap, BTreeSet, HashMap};
mod hierarchy;
mod projection;
mod projection_columns;
mod qualification;
mod totals;
use qualification::*;
pub use totals::{calculate_totals, scope_for, temporal_context, CalculatedTotals};
#[derive(Clone, Debug)]
pub struct LogicalGroup {
    pub id: String,
    pub path: Vec<String>,
    pub rows: Vec<DatasetRow>,
    pub children: Vec<LogicalGroup>,
}
#[derive(Clone, Debug)]
pub struct CalculatedView {
    pub diagnostics: Vec<Diagnostic>,
    pub top_level_count: ResultCount,
    pub model_warnings: Option<Vec<ModelWarning>>,
    pub model_warning_count: Option<u64>,
    pub compiled: CompiledModel,
    pub pool: EligiblePool,
    pub record_ids: BTreeSet<String>,
    pub groups: Vec<LogicalGroup>,
    pub rows: Vec<DatasetRow>,
    pub columns: Vec<DatasetColumn>,
    pub totals: ScopedValues,
    pub calculated_totals: CalculatedTotals,
    pub eligible_rows: Vec<DatasetRow>,
    pub errors: Vec<ModelError>,
    pub warnings: Vec<crate::fiscal::ScopeWarning>,
    pub complete: bool,
    pub provenance: Provenance,
    pub completeness: Completeness,
    pub freshness: Freshness,
    pub selection: SelectionSpec,
    pub selection_namespace: Option<String>,
}
pub(crate) fn model(m: &CompiledModel) -> &TableModel {
    m.definition
        .definition
        .analytical
        .as_ref()
        .and_then(AnalyticalDefinition::table)
        .expect("compiled table model")
}
pub(crate) fn diagnostic(code: &str, message: &str) -> Diagnostic {
    crate::statement::problem(code, "analytical", message)
}
#[allow(clippy::result_large_err)]
pub fn calculate_view(
    input: &SourceDataset,
    definition: &ValidatedDefinition,
    selection: &SelectionSpec,
    params: &RuntimeParams,
    order: &dyn ValueOrder,
) -> Result<CalculatedView, Diagnostic> {
    if definition
        .definition
        .analytical
        .as_ref()
        .is_some_and(|a| match a {
            AnalyticalDefinition::Table(m) => m.schema_version != 1,
            AnalyticalDefinition::Statement(m) => m.schema_version != 2,
        })
    {
        return Err(diagnostic(
            "unsupported-schema",
            "Unsupported analytical saved schema",
        ));
    }
    let fiscal = crate::fiscal::parse_fiscal_context(
        input
            .provenance
            .metadata
            .as_ref()
            .and_then(|m| m.get("fiscalContext"))
            .unwrap_or(&WireValue::Missing),
    )
    .map_err(|errors| diagnostic(&errors[0].code, &errors[0].message))?;
    let mut source = input.clone();
    let mut effective = definition.clone();
    let mut execution = None;
    let mut presentation = None;
    if let Some(AnalyticalDefinition::Statement(intent)) = &definition.definition.analytical {
        crate::validation::validate_analytical_recipe_source(
            definition
                .analytical_recipe_source
                .as_ref()
                .ok_or_else(|| {
                    diagnostic(
                        "INVALID_REQUEST",
                        "Ordered recipe source requires an analytical model.",
                    )
                })?,
            definition.definition.analytical.as_ref().unwrap(),
        )?;
        let mut compiled = crate::statement::compile_statement(intent, &source.columns)?;
        if source.rows.iter().any(|r| {
            r.values.get(&intent.bindings.period_kind_field_id)
                != Some(&WireValue::String(format!("{:?}", intent.period_kind)))
        }) {
            return Err(crate::statement::problem("invalid-structure","periodKind",&format!("Source facts must all have the selected {:?} period kind; FY/FQ overlap is not permitted.",intent.period_kind)));
        }
        if let Some(spec) = &compiled.unpivot {
            for row in &mut source.rows {
                for mapping in &spec.mappings {
                    if row
                        .cell_errors
                        .as_ref()
                        .is_some_and(|e| e.contains_key(&mapping.source_field_id))
                    {
                        row.values
                            .insert(mapping.source_field_id.clone(), WireValue::Null);
                    }
                }
            }
            let (long, descriptors) = crate::statement::unpivot_dataset(&source, spec)?;
            source = long;
            compiled.execution.source_columns_by_row_id = descriptors;
        }
        let item_field = compiled.model.categories[1].source_field_id.clone();
        for row in &mut source.rows {
            let line = row.values.get(&item_field).and_then(|v| {
                if let WireValue::String(s) = v {
                    Some(s)
                } else {
                    None
                }
            });
            let section=line.and_then(|id|compiled.section_by_line.get(id)).cloned().ok_or_else(||crate::statement::problem("missing-reference","bindings.longFields.itemFieldId","Source line item is not declared in the template; repair the item binding."))?;
            row.values
                .insert(compiled.section_field.clone(), WireValue::String(section));
        }
        source.columns.push(
            serde_json::from_value(
                serde_json::json!({"id":compiled.section_field,"label":"Section"}),
            )
            .unwrap(),
        );
        // Applied only after calculation succeeds, matching calculateAnalyticalView.
        presentation = Some(crate::statement::statement_presentation(
            intent,
            &compiled.model.layout,
        ));
        effective.definition.analytical =
            Some(AnalyticalDefinition::Table(Box::new(compiled.model)));
        effective.analytical_recipe_source = Some(tag_json(
            &serde_json::to_value(effective.definition.analytical.as_ref().unwrap()).unwrap(),
        ));
        execution = Some(compiled.execution);
    }
    let mut compiled = compile_with_fiscal(&effective, &source.columns, fiscal);
    compiled.execution = execution;
    if let Some(e) = &compiled.execution {
        if let Some(d) = compiled.graph.diagnostics.first() {
            return Err(diagnostic("missing-reference", &d.message));
        }
        let _ = e;
    }
    if effective.definition.analytical.is_none() {
        return Err(diagnostic(
            "missing-reference",
            "Analytical model is unavailable.",
        ));
    }
    let evaluated = evaluate_source(&source.rows, &compiled);
    let pool = eligible_pool(&evaluated, &compiled, params, order);
    // The pool is final from here on; per-scope lookups use its row index.
    pool.index_rows();
    if let Some(d) = pool
        .runtime_diagnostics
        .iter()
        .find(|d| matches!(d.severity, Severity::Error))
    {
        return Err(d.clone());
    }
    for recipe in pool.authoring_recipes.values() {
        recipe.as_ref().map_err(Clone::clone)?;
    }
    for c in &pool.categories {
        c.recipe.as_ref().map_err(Clone::clone)?;
    }
    let authored = model(&compiled);
    let mut active = authored.clone();
    if !active.enabled {
        active.layout.rows.clear();
        active.layout.columns.clear();
        active.layout.page = None;
        active.result_filters.clear();
        active.subtotals = Subtotals {
            groups: false,
            grand_total: false,
        };
    }
    let page = active_page(&pool, pool.page.as_ref());
    let temporal = temporal_context(&compiled);
    let mut errors = page.errors.clone();
    let source_scope = CalculationScope {
        page: pool.page.clone(),
        temporal_context: temporal,
        ..Default::default()
    };
    let source_errors = scope_errors(&pool, &source_scope);
    errors.extend(source_errors.clone());
    let mut scope_results = totals::ScopeResults::default();
    let mut original = vec![];
    let page_rows = ScopedRows::new(&page.rows, &pool);
    for category in active
        .result_filters
        .iter()
        .map(|f| f.category_id.clone())
        .collect::<BTreeSet<_>>()
    {
        let axis = if active.layout.rows.contains(&category) {
            &active.layout.rows
        } else if active.layout.columns.contains(&category) {
            &active.layout.columns
        } else {
            std::slice::from_ref(&category)
        };
        let ids = &axis[..=axis.iter().position(|s| s == &category).unwrap()];
        for constraints in partitions(&page.rows, &pool, ids) {
            let rows = page_rows.select(&pool, &constraints);
            let value = scope_results.calculate(
                &pool,
                &scope_for(&pool, &rows, &constraints, &compiled),
                &compiled,
                order,
            )?;
            original.push(group(category.clone(), &pool, value));
        }
        if let Some(e) = &compiled.execution {
            for output in &e.output_members {
                if output.require_observed
                    || !output.selectors.iter().any(|s| s.category_id == category)
                {
                    continue;
                }
                let constraints = output
                    .selectors
                    .iter()
                    .map(|s| (s.category_id.clone(), s.member_key.clone()))
                    .collect();
                if !page_rows.select(&pool, &constraints).is_empty() {
                    continue;
                }
                let value = scope_results.calculate(
                    &pool,
                    &scope_for(&pool, &page.rows, &constraints, &compiled),
                    &compiled,
                    order,
                )?;
                original.push(group(category.clone(), &pool, value));
            }
        }
    }
    let required: BTreeSet<_> = active
        .layout
        .rows
        .iter()
        .chain(&active.layout.columns)
        .chain(active.result_filters.iter().map(|f| &f.category_id))
        .cloned()
        .collect();
    let mut required_errors = vec![];
    let valid = required
        .iter()
        .all(|id| pool.categories.iter().any(|c| &c.id == id));
    for id in &required {
        if !pool.categories.iter().any(|c| &c.id == id) {
            errors.push(ModelError {
                record_ids_present: false,
                dependency_ids_present: false,
                code: "missing-reference".into(),
                message: format!("Required category {id} is unavailable."),
                definition_id: id.clone(),
                record_ids: vec![],
                dependency_ids: vec![],
            });
        }
        for row in &page.rows {
            if let Some(Err(e)) = pool.members.get(&row.id).and_then(|m| m.get(id)) {
                required_errors.push(e.clone());
            }
        }
    }
    errors.extend(required_errors.clone());
    let qualification = if active.result_filters.is_empty() || page.rows.is_empty() {
        Qualification {
            record_ids: page.rows.iter().map(|r| r.id.clone()).collect(),
            complete: true,
            errors: vec![],
        }
    } else {
        qualify_groups(&original, &active.result_filters)
    };
    errors.extend(qualification.errors.clone());
    let surviving: Vec<_> = page
        .rows
        .iter()
        .filter(|r| {
            valid
                && qualification.record_ids.contains(&r.id)
                && required.iter().all(|id| {
                    pool.members
                        .get(&r.id)
                        .and_then(|m| m.get(id))
                        .is_some_and(Result::is_ok)
                })
        })
        .cloned()
        .collect();
    let record_ids = surviving.iter().map(|r| r.id.clone()).collect();
    let scope = scope_for(&pool, &surviving, &CategoryConstraints::new(), &compiled);
    let calculated_totals =
        if active.enabled && (compiled.execution.is_none() || active.subtotals.grand_total) {
            scope_results
                .calculate(&pool, &scope, &compiled, order)?
                .clone()
        } else {
            CalculatedTotals {
                scope,
                formulas: FormulaValues {
                    empty: true,
                    ..Default::default()
                },
            }
        };
    let totals = totals::project_totals(&calculated_totals, Scope::Filtered)?;
    let mut view = CalculatedView {
        diagnostics: vec![],
        top_level_count: ResultCount::Unknown,
        model_warnings: input.model_warnings.clone(),
        model_warning_count: input.model_warning_count,
        columns: evaluated.columns.clone(),
        compiled,
        pool,
        record_ids,
        groups: vec![],
        rows: vec![],
        totals,
        calculated_totals,
        eligible_rows: vec![],
        errors,
        warnings: vec![],
        complete: source_errors.is_empty()
            && required_errors.is_empty()
            && page.errors.is_empty()
            && qualification.complete
            && valid,
        provenance: input.provenance.clone(),
        completeness: input.completeness.clone(),
        freshness: input.freshness.clone(),
        selection: selection.clone(),
        selection_namespace: None,
    };
    if let Some(presentation) = presentation {
        view.provenance
            .metadata
            .get_or_insert_with(Default::default)
            .insert("statementPresentation".into(), presentation?);
    }
    view.warnings = view.pool.warnings.clone();
    projection::project(
        &mut view,
        &active,
        &surviving,
        &page.rows,
        order,
        &mut scope_results,
    )?;
    for warning in &view.warnings {
        utf16_prefix(&warning.message, 1000)?;
    }
    view.complete &= scope_errors(&view.pool, &view.calculated_totals.scope).is_empty()
        && !view.errors.iter().any(|e| {
            matches!(
                e.code.as_str(),
                "missing-reference" | "invalid-date" | "fiscal-context"
            )
        });
    if view.compiled.execution.is_some() {
        view.complete &= view.errors.is_empty();
    }
    if view.calculated_totals.formulas.empty {
        view.totals.values.clear();
        view.totals.cell_errors = None;
    }
    view.completeness
        .warnings
        .extend(view.warnings.iter().map(|w| w.message.clone()));
    if !view.complete {
        view.completeness.warnings.push(
            "Calculation is incomplete because required constraints could not be evaluated.".into(),
        );
        if matches!(view.completeness.kind, CompletenessKind::Complete) {
            view.completeness.kind = CompletenessKind::Partial;
        }
    }
    view.top_level_count = ResultCount::Exact {
        value: if view.groups.is_empty() {
            view.rows.len()
        } else {
            view.groups.len()
        } as u64,
    };
    let mut kinds = Vec::new();
    let mut seen = BTreeSet::new();
    for (code, message, severity) in view
        .errors
        .iter()
        .map(|e| (&e.code, &e.message, Severity::Error))
        .chain(
            view.warnings
                .iter()
                .map(|w| (&w.code, &w.message, Severity::Warning)),
        )
    {
        if seen.insert((code.clone(), message.clone())) {
            let mut d = diagnostic(code, message);
            d.path = None;
            d.severity = severity;
            kinds.push(d);
        }
    }
    let count = kinds.len();
    view.diagnostics = view
        .pool
        .runtime_diagnostics
        .iter()
        .cloned()
        .chain(input.diagnostics.iter().flatten().cloned())
        .chain(kinds)
        .take(100)
        .collect();
    if count > 100 {
        let mut d = diagnostic(
            "ADDITIONAL_ERRORS",
            &format!(
                "{} additional diagnostic kinds are retained in the calculation.",
                count - 100
            ),
        );
        d.path = None;
        d.severity = Severity::Warning;
        view.diagnostics.push(d);
    }
    Ok(view)
}
pub(crate) fn scope_rows(
    rows: &[DatasetRow],
    pool: &EligiblePool,
    constraints: &CategoryConstraints,
) -> Vec<DatasetRow> {
    rows.iter()
        .filter(|r| in_scope(r, pool, constraints))
        .cloned()
        .collect()
}
fn in_scope(r: &DatasetRow, pool: &EligiblePool, constraints: &CategoryConstraints) -> bool {
    constraints.iter().all(|(id, key)| {
        pool.members
            .get(&r.id)
            .and_then(|m| m.get(id))
            .is_some_and(|m| m.as_ref().is_ok_and(|m| &m.key == key))
    })
}
/// `scope_rows` over one fixed slice, answered from a member index built once:
/// each lookup visits only the narrowest constraint's rows, in slice order.
pub(crate) struct ScopedRows<'a> {
    rows: &'a [DatasetRow],
    by_member: HashMap<String, HashMap<String, Vec<usize>>>,
}
impl<'a> ScopedRows<'a> {
    pub(crate) fn new(rows: &'a [DatasetRow], pool: &EligiblePool) -> Self {
        let mut by_member: HashMap<String, HashMap<String, Vec<usize>>> = HashMap::new();
        for (i, r) in rows.iter().enumerate() {
            for (id, m) in pool.members.get(&r.id).into_iter().flatten() {
                if let Ok(m) = m {
                    by_member
                        .entry(id.clone())
                        .or_default()
                        .entry(m.key.clone())
                        .or_default()
                        .push(i);
                }
            }
        }
        Self { rows, by_member }
    }
    /// Exactly `scope_rows(self.rows, pool, constraints)`.
    pub(crate) fn select(
        &self,
        pool: &EligiblePool,
        constraints: &CategoryConstraints,
    ) -> Vec<DatasetRow> {
        let narrowest = constraints
            .iter()
            .map(|(id, key)| {
                self.by_member
                    .get(id)
                    .and_then(|m| m.get(key))
                    .map_or(&[][..], Vec::as_slice)
            })
            .min_by_key(|at| at.len());
        let Some(at) = narrowest else {
            return self.rows.to_vec();
        };
        at.iter()
            .map(|&i| &self.rows[i])
            .filter(|r| in_scope(r, pool, constraints))
            .cloned()
            .collect()
    }
}
pub(crate) fn partitions(
    rows: &[DatasetRow],
    pool: &EligiblePool,
    ids: &[String],
) -> Vec<CategoryConstraints> {
    let mut result = vec![];
    let mut seen = BTreeSet::new();
    for r in rows {
        let pairs: Option<Vec<_>> = ids
            .iter()
            .map(|id| {
                pool.members
                    .get(&r.id)
                    .and_then(|m| m.get(id))
                    .and_then(|m| m.as_ref().ok())
                    .map(|m| (id.clone(), m.key.clone()))
            })
            .collect();
        if let Some(pairs) = pairs {
            if seen.insert(pairs.clone()) {
                result.push(pairs.into_iter().collect());
            }
        }
    }
    result
}
pub(crate) fn tag_json(v: &serde_json::Value) -> WireValue {
    match v {
        serde_json::Value::Null => WireValue::Null,
        serde_json::Value::Bool(b) => WireValue::Bool(*b),
        serde_json::Value::Number(n) => WireValue::F64(WireNumber::Finite(n.as_f64().unwrap())),
        serde_json::Value::String(s) => WireValue::String(s.clone()),
        serde_json::Value::Array(a) => WireValue::Array(a.iter().map(tag_json).collect()),
        serde_json::Value::Object(o) => {
            WireValue::Record(o.iter().map(|(k, v)| (k.clone(), tag_json(v))).collect())
        }
    }
}
#[allow(clippy::result_large_err)]
pub fn compact_cell_error(e: &ModelError) -> Result<CellError, Diagnostic> {
    Ok(CellError {
        code: e.code.clone(),
        message: utf16_prefix(&e.message, 1000)?.to_owned(),
        definition_id: (!e.definition_id.is_empty()).then(|| e.definition_id.clone()),
        dependency_ids: (e.dependency_ids_present || !e.dependency_ids.is_empty())
            .then(|| e.dependency_ids.iter().take(20).cloned().collect()),
        affected_record_count: e.record_ids_present.then_some(e.record_ids.len() as u64),
        record_preview: e
            .record_ids_present
            .then(|| e.record_ids.iter().take(5).cloned().collect()),
    })
}

/// Match JavaScript slice(0, limit) on the accepted Unicode-scalar domain.
/// A cut inside a surrogate pair is an explicit compatibility refusal.
#[allow(clippy::result_large_err)]
pub fn utf16_prefix(value: &str, limit: usize) -> Result<&str, Diagnostic> {
    let mut units = 0;
    for (offset, c) in value.char_indices() {
        if units == limit {
            return Ok(&value[..offset]);
        }
        units += c.len_utf16();
        if units > limit {
            return Err(diagnostic(
                "INVALID_REQUEST",
                "Unicode scalar boundary would be split by diagnostic truncation",
            ));
        }
    }
    Ok(value)
}
