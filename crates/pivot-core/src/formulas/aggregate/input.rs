// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
impl Evaluator<'_> {
    pub(super) fn input(
        &mut self,
        ast: &FormulaAst,
        op: Aggregation,
        at: &CalculationScope,
        id: &str,
        meta: &mut FormulaMetadata,
    ) -> CellResult {
        merge(
            meta,
            &FormulaMetadata {
                scopes: vec![at.clone()],
                value_kind: matches!(op, Aggregation::Count | Aggregation::UniqueCount)
                    .then_some(ValueKind::Number),
                ..Default::default()
            },
        );
        let q = self.errors(at);
        if !q.is_empty() {
            return self.fail("blocked-dependency", &q[0].message, id, at, &q, &[]);
        }
        let mut seen = BTreeSet::new();
        let rows: Vec<_> = self
            .pool
            .rows_in(&at.source_record_ids)
            .into_iter()
            .filter(|r| seen.insert(r.id.clone()))
            .collect();
        if !rows.is_empty()
            && matches!(op, Aggregation::First | Aggregation::Last)
            && at.temporal_context.date_field_id.is_none()
        {
            return self.fail(
                "missing-input",
                "Bind one report date explicitly for chronological aggregation.",
                id,
                at,
                &[],
                &[],
            );
        }
        let mut values = vec![];
        let mut failures = vec![];
        let empty_cells = BTreeMap::new();
        for row in &rows {
            let row_scope = CalculationScope {
                source_record_ids: BTreeSet::from([row.id.clone()]),
                ..Default::default()
            };
            let cells = self.pool.formula_cells.get(&row.id).unwrap_or(&empty_cells);
            let result = evaluate_expression(ast, row, cells, id, &mut |node| {
                let FormulaAst::Reference { target, id: field } = node else {
                    return None;
                };
                let mut inputs = vec![field.clone()];
                if *target == ReferenceTarget::Formula {
                    let mut idx = 0;
                    while idx < inputs.len() {
                        let current = inputs[idx].clone();
                        for input in self
                            .pool
                            .source_dependencies
                            .get(&row.id)
                            .and_then(|m| m.get(&current))
                            .into_iter()
                            .flatten()
                        {
                            if !inputs.contains(input) {
                                inputs.push(input.clone());
                            }
                        }
                        idx += 1;
                    }
                }
                for input in inputs {
                    if let Some(c) = self.pool.columns.iter().find(|c| c.id == input) {
                        if !meta.source_columns.iter().any(|c| c.id == input) {
                            meta.source_columns.push(c.clone());
                        }
                    }
                }
                if *target != ReferenceTarget::Field {
                    return None;
                }
                if let Some(e) = row.cell_errors.as_ref().and_then(|e| e.get(field)) {
                    let mut dependencies = vec![field.clone()];
                    for dependency in e.dependency_ids.iter().flatten() {
                        if !dependencies.contains(dependency) {
                            dependencies.push(dependency.clone());
                        }
                    }
                    return Some(self.fail(
                        "blocked-dependency",
                        &e.message,
                        id,
                        &CalculationScope {
                            source_record_ids: BTreeSet::from([row.id.clone()]),
                            ..Default::default()
                        },
                        &[],
                        &dependencies,
                    ));
                }
                let c = self.model.columns.iter().find(|c| &c.id == field)?;
                if matches!(
                    c.aggregation,
                    Some(Aggregation::Count | Aggregation::UniqueCount)
                ) {
                    if let Some(WireValue::String(s)) = row.values.get(field) {
                        let n = s.parse::<f64>().unwrap_or(f64::INFINITY);
                        return Some(if s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()) {
                            self.fail(
                                "invalid-type",
                                "Incoming count must be an integer.",
                                id,
                                &row_scope,
                                &[],
                                std::slice::from_ref(field),
                            )
                        } else if n > 9007199254740991. {
                            self.fail(
                                "nonfinite",
                                "Incoming count exceeds the exact integer range.",
                                id,
                                &row_scope,
                                &[],
                                std::slice::from_ref(field),
                            )
                        } else {
                            CellResult::Value(WireValue::F64(WireNumber::Finite(n)))
                        });
                    }
                }
                None
            });
            match result {
                CellResult::Error(e) => failures.push(e),
                CellResult::Value(v) => {
                    let mut r = BTreeMap::from([("value".into(), v)]);
                    if let Some(date) = &at.temporal_context.date_field_id {
                        r.insert(
                            "date".into(),
                            row.values.get(date).cloned().unwrap_or(WireValue::Missing),
                        );
                    }
                    values.push(r);
                }
            }
            if matches!(op, Aggregation::First | Aggregation::Last) {
                if let Some(date) = &at.temporal_context.date_field_id {
                    if let Some(e) = self.pool.errors.get(&row.id).and_then(|m| m.get(date)) {
                        failures.push(e.clone());
                    }
                }
            }
        }
        if !failures.is_empty() {
            return self.fail(
                "blocked-dependency",
                &failures[0].message,
                id,
                at,
                &failures,
                &[],
            );
        }
        let v = match crate::pivot::aggregate(
            op,
            &values,
            "value",
            at.temporal_context.date_field_id.as_ref().map(|_| "date"),
            self.order,
        ) {
            Ok(v) => v,
            Err(d) => {
                self.failure = Some(d.clone());
                return self.fail(&d.code, &d.message, id, at, &[], &[]);
            }
        };
        if matches!(op, Aggregation::Count | Aggregation::UniqueCount) {
            let n = if let WireValue::String(s) = v {
                s.parse::<f64>().unwrap_or(f64::INFINITY)
            } else {
                f64::INFINITY
            };
            if n > 9007199254740991. {
                self.fail(
                    "nonfinite",
                    "Count exceeds the exact integer range.",
                    id,
                    at,
                    &[],
                    &[],
                )
            } else {
                CellResult::Value(WireValue::F64(WireNumber::Finite(n)))
            }
        } else if matches!(v, WireValue::F64(_))
            && crate::validation::arithmetic_number(&v).is_err()
        {
            self.fail(
                "nonfinite",
                "Aggregate result must be finite.",
                id,
                at,
                &[],
                &[],
            )
        } else {
            CellResult::Value(v)
        }
    }
}
