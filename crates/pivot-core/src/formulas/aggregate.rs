// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Aggregate expressions are re-evaluated at each retained source/member scope.
use super::*;
mod input;
mod metadata;
use crate::{ordering::ValueOrder, scopes::*};
use metadata::*;
use std::collections::BTreeSet;
#[derive(Clone, Debug, Default)]
pub struct FormulaMetadata {
    pub source_columns: Vec<Column>,
    pub scopes: Vec<CalculationScope>,
    pub value_kind: Option<ValueKind>,
    pub format: Option<String>,
    pub statement_record_ids: BTreeSet<String>,
}
#[derive(Clone, Debug, Default)]
pub struct FormulaValues {
    pub cells: BTreeMap<String, CellResult>,
    pub metadata: BTreeMap<String, FormulaMetadata>,
    pub measure_cells: BTreeMap<String, CellResult>,
    pub measure_metadata: BTreeMap<String, FormulaMetadata>,
    pub scope_errors: Vec<ModelError>,
    pub warnings: Vec<crate::fiscal::ScopeWarning>,
    pub empty: bool,
}
struct Evaluator<'a> {
    pool: &'a EligiblePool,
    model: &'a CompiledModel,
    order: &'a dyn ValueOrder,
    memo: BTreeMap<(String, String), (CellResult, FormulaMetadata)>,
    failure: Option<Diagnostic>,
    scope_errors: Vec<(CalculationScope, Vec<ModelError>)>,
}
impl Evaluator<'_> {
    fn errors(&mut self, scope: &CalculationScope) -> Vec<ModelError> {
        if let Some((_, errors)) = self
            .scope_errors
            .iter()
            .find(|(key, _)| key.exact_eq(scope))
        {
            return errors.clone();
        }
        let errors = scope_errors(self.pool, scope);
        self.scope_errors.push((scope.clone(), errors.clone()));
        errors
    }

    fn fail(
        &self,
        code: &str,
        message: &str,
        id: &str,
        at: &CalculationScope,
        causes: &[ModelError],
        dependencies: &[String],
    ) -> CellResult {
        let mut cell = fail(code, message, id, at, causes, dependencies);
        if causes.is_empty() {
            if let CellResult::Error(e) = &mut cell {
                e.record_ids = self.scope_ids(at);
            }
        }
        cell
    }
    fn scope_ids(&self, at: &CalculationScope) -> Vec<String> {
        let rows = self.pool.rows_in(&at.source_record_ids);
        rows.into_iter().map(|r| r.id.clone()).collect()
    }

    fn run(&mut self, id: &str, at: &CalculationScope) -> (CellResult, FormulaMetadata) {
        let key = (
            format!(
                "{}/{:?}/{:?}/{:?}",
                scope_key(at),
                at.field_constraints,
                at.requested_fiscal_scope,
                at.declared_members
            ),
            id.into(),
        );
        if let Some(v) = self.memo.get(&key) {
            return v.clone();
        }
        let entry = self.model.graph.entries.iter().find(|e| {
            e.value
                .as_ref()
                .is_some_and(|f| f.id == id && f.scope == FormulaScope::Aggregate)
        });
        let ds: Vec<_> = self
            .model
            .graph
            .diagnostics
            .iter()
            .filter(|d| d.definition_id.as_deref() == Some(id))
            .collect();
        let mut meta = FormulaMetadata {
            format: entry
                .and_then(|e| e.value.as_ref())
                .and_then(|f| f.format.clone()),
            ..Default::default()
        };
        let result = if entry.is_none()
            || !self.model.graph.order.iter().any(|s| s == id)
            || self.model.graph.blocked_ids.iter().any(|s| s == id)
            || !ds.is_empty()
        {
            let code = match ds.first().map(|d| d.code.as_str()) {
                Some("missing-aggregation") => "missing-aggregation",
                Some("cycle") => "cycle",
                Some("scope") => "scope",
                _ => "blocked-dependency",
            };
            self.fail(
                code,
                ds.first()
                    .map(|d| d.message.as_str())
                    .unwrap_or("Formula is not approved for aggregate evaluation."),
                id,
                at,
                &[],
                &ds.iter()
                    .flat_map(|d| d.dependency_ids.clone())
                    .collect::<Vec<_>>(),
            )
        } else {
            match entry {
                Some(entry) => self.expression(
                    &entry.value.as_ref().unwrap().ast.clone(),
                    at,
                    id,
                    &mut meta,
                ),
                None => unreachable!("entry approval checked above"),
            }
        };
        let result =
            if matches!(result, CellResult::Value(_)) && !meta.statement_record_ids.is_empty() {
                if let Some(e) = &self.model.execution {
                    let records: Vec<_> = self.pool.rows_in(&meta.statement_record_ids);
                    let mixed = [
                        Some(&e.policy.company_field_id),
                        e.policy.currency_field_id.as_ref(),
                        e.policy.unit_field_id.as_ref(),
                    ]
                    .into_iter()
                    .flatten()
                    .find(|f| {
                        records.iter().any(|r| {
                            r.values.get(*f) != records.first().and_then(|r| r.values.get(*f))
                        })
                    });
                    if let Some(f) = mixed {
                        self.fail(
                            "scope",
                            &format!(
                            "Mixed {f} contexts cannot be combined in a derived Statement value."
                        ),
                            id,
                            at,
                            &[],
                            &[],
                        )
                    } else {
                        result
                    }
                } else {
                    result
                }
            } else {
                result
            };
        self.memo.insert(key, (result.clone(), meta.clone()));
        (result, meta)
    }
    fn expression(
        &mut self,
        ast: &FormulaAst,
        at: &CalculationScope,
        id: &str,
        meta: &mut FormulaMetadata,
    ) -> CellResult {
        let mut scope = at.clone();
        scope.declared_members = self
            .model
            .execution
            .as_ref()
            .map(|e| e.scope_members.clone())
            .unwrap_or_default();
        let row = DatasetRow {
            id: String::new(),
            values: BTreeMap::new(),
            group_path: None,
            cell_errors: None,
            cell_formats: None,
        };
        let result = evaluate_expression(ast, &row, &BTreeMap::new(), id, &mut |ast| match ast {
            FormulaAst::Member { value, selectors } => {
                Some(match resolve_member(self.pool, &scope, selectors) {
                    Ok(s) => self.expression(value, &s, id, meta),
                    Err(e) => self.fail(&e[0].code, &e[0].message, id, at, &e, &[]),
                })
            }
            FormulaAst::Call { function, args } if *function != FormulaFunction::If => {
                Some(self.input(
                    &args[0],
                    function_aggregation(*function).unwrap(),
                    at,
                    id,
                    meta,
                ))
            }
            FormulaAst::Reference {
                target: ReferenceTarget::Formula,
                id: dependency,
            } => {
                let (cell, m) = self.run(dependency, at);
                merge(meta, &m);
                Some(match cell {
                    CellResult::Value(_) => cell,
                    CellResult::Error(e) => self.fail(
                        "blocked-dependency",
                        &e.message,
                        id,
                        at,
                        std::slice::from_ref(&e),
                        std::slice::from_ref(dependency),
                    ),
                })
            }
            FormulaAst::Reference {
                target: ReferenceTarget::Measure,
                id: measure,
            } => Some(self.measure(measure, at, id, meta)),
            FormulaAst::Reference { .. } => Some(self.fail(
                "scope",
                "Unqualified aggregate inputs require a configured measure.",
                id,
                at,
                &[],
                &[],
            )),
            _ => None,
        });
        match result {
            CellResult::Error(mut e) if e.record_ids == vec![String::new()] => {
                e.record_ids = self.scope_ids(at);
                CellResult::Error(e)
            }
            r => r,
        }
    }
    fn measure(
        &mut self,
        measure: &str,
        at: &CalculationScope,
        id: &str,
        meta: &mut FormulaMetadata,
    ) -> CellResult {
        let Some(m) = self
            .model
            .symbols
            .measures
            .iter()
            .find(|m| m.value.id == measure)
        else {
            return self.fail(
                "missing-reference",
                "Measure instance is unavailable.",
                id,
                at,
                &[],
                &[measure.into()],
            );
        };
        let Some(op) = m.value.aggregation else {
            return self.fail(
                "missing-aggregation",
                &format!("Choose an aggregation for {}.", m.name),
                id,
                at,
                &[],
                &[measure.into()],
            );
        };
        if let Some(e) = self
            .model
            .execution
            .as_ref()
            .filter(|e| e.policy.measure_id == measure)
        {
            let policy = &e.policy;
            let key = at
                .category_constraints
                .iter()
                .find(|(k, _)| *k == &policy.category_id)
                .map(|(_, v)| v);
            let Some((key, selected)) = key.and_then(|k| policy.members.get(k).map(|v| (k, v)))
            else {
                return self.fail(
                    "scope",
                    "Select one line member before evaluating its measure policy.",
                    id,
                    at,
                    &[],
                    &[],
                );
            };
            if *selected == crate::statement::LinePolicy::Formula {
                let (c, m) = self.run(&policy.formulas[key], at);
                merge(meta, &m);
                return c;
            }
            let q = self.errors(at);
            if !q.is_empty() {
                return self.fail("blocked-dependency", &q[0].message, id, at, &q, &[]);
            }
            let records: Vec<_> = self
                .pool
                .rows_in(&at.source_record_ids)
                .into_iter()
                .filter(|r| {
                    self.pool
                        .members
                        .get(&r.id)
                        .and_then(|m| m.get(&policy.category_id))
                        .is_some_and(|m| m.as_ref().is_ok_and(|m| &m.key == key))
                })
                .cloned()
                .collect();
            merge(
                meta,
                &FormulaMetadata {
                    source_columns: records
                        .iter()
                        .filter_map(|r| {
                            e.source_columns_by_row_id
                                .get(&r.id)
                                .or_else(|| {
                                    self.model
                                        .columns
                                        .iter()
                                        .find(|c| c.id == policy.value_field_id)
                                })
                                .cloned()
                        })
                        .collect(),
                    scopes: vec![at.clone()],
                    value_kind: Some(ValueKind::Number),
                    statement_record_ids: records.iter().map(|r| r.id.clone()).collect(),
                    format: None,
                },
            );
            if let Some(requested) = at
                .requested_fiscal_scope
                .as_ref()
                .filter(|s| !s.errors.is_empty())
            {
                return self.fail(
                    "fiscal-context",
                    &requested.errors[0].message,
                    id,
                    at,
                    &requested.errors,
                    &[],
                );
            }
            return crate::statement::evaluate_statement_line(
                *selected,
                &records,
                policy,
                self.model
                    .fiscal_context
                    .as_ref()
                    .unwrap_or(&crate::fiscal::FiscalContext::default()),
                at.requested_fiscal_scope
                    .as_ref()
                    .map(|s| s.periods.as_slice())
                    .unwrap_or(&[]),
                *policy.required.get(key).unwrap_or(&true),
            );
        }
        let target = if self
            .model
            .columns
            .iter()
            .any(|c| c.id == m.value.source_field_id)
        {
            ReferenceTarget::Field
        } else {
            ReferenceTarget::Formula
        };
        self.input(
            &FormulaAst::Reference {
                target,
                id: m.value.source_field_id.clone(),
            },
            op,
            at,
            id,
            meta,
        )
    }
}
#[allow(clippy::result_large_err)]
pub fn evaluate_aggregate(
    scope: &CalculationScope,
    pool: &EligiblePool,
    model: &CompiledModel,
    order: &dyn ValueOrder,
) -> Result<FormulaValues, Diagnostic> {
    let mut e = Evaluator {
        pool,
        model,
        order,
        memo: BTreeMap::new(),
        failure: None,
        scope_errors: vec![],
    };
    let mut result = FormulaValues {
        scope_errors: e.errors(scope),
        warnings: pool.warnings.clone(),
        empty: pool.rows_in(&scope.source_record_ids).is_empty(),
        ..Default::default()
    };
    let mut ids: Vec<_> = model
        .graph
        .order
        .iter()
        .filter(|id| {
            model
                .symbols
                .formulas
                .iter()
                .any(|f| &f.id == *id && f.scope == FormulaScope::Aggregate)
        })
        .cloned()
        .collect();
    for f in &model.symbols.formulas {
        if f.scope == FormulaScope::Aggregate && !ids.contains(&f.id) {
            ids.push(f.id.clone());
        }
    }
    for id in ids {
        let (cell, meta) = e.run(&id, scope);
        result.cells.insert(id.clone(), cell);
        result.metadata.insert(id, meta);
    }
    for m in &model.symbols.measures {
        let mut meta = FormulaMetadata::default();
        let bound = super::binding::bind_ast(
            &SyntaxAst::Reference {
                target: ReferenceTarget::Measure,
                id: m.value.id.clone(),
            },
            &model.symbols,
            FormulaScope::Aggregate,
        );
        // An unchosen aggregation is blank, not an error; formulas that reference it still fail.
        let cell = if bound
            .diagnostics
            .first()
            .is_some_and(|d| d.code == "missing-aggregation")
        {
            CellResult::Value(WireValue::Null)
        } else if let Some(d) = bound.diagnostics.first() {
            let code = if [
                "missing-reference",
                "ambiguous-reference",
                "missing-aggregation",
                "scope",
            ]
            .contains(&d.code.as_str())
            {
                d.code.as_str()
            } else {
                "blocked-dependency"
            };
            e.fail(code, &d.message, &m.value.id, scope, &[], &d.dependency_ids)
        } else {
            e.measure(&m.value.id, scope, &m.value.id, &mut meta)
        };
        result.measure_cells.insert(m.value.id.clone(), cell);
        result.measure_metadata.insert(m.value.id.clone(), meta);
    }
    if let Some(d) = e.failure {
        Err(d)
    } else {
        Ok(result)
    }
}
