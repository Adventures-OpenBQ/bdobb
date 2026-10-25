// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
pub(super) fn scope_key(s: &CalculationScope) -> String {
    let mut categories: Vec<_> = s.category_constraints.iter().collect();
    categories.sort();
    let mut slices: Vec<_> = s
        .context_slices
        .iter()
        .flatten()
        .map(|c| {
            let mut categories: Vec<_> = c.categories.iter().collect();
            categories.sort();
            format!("{:?}/{:?}", categories, c.company_ids)
        })
        .collect();
    slices.sort();
    format!(
        "{:?}/{:?}/{:?}/{:?}/{:?}/{:?}",
        s.source_record_ids, categories, slices, s.page, s.temporal_context, s.field_constraints
    )
}
pub(super) fn merge(t: &mut FormulaMetadata, s: &FormulaMetadata) {
    for c in &s.source_columns {
        if !t.source_columns.iter().any(|v| v.id == c.id) {
            t.source_columns.push(c.clone());
        }
    }
    for scope in &s.scopes {
        if !t.scopes.iter().any(|s| scope_key(s) == scope_key(scope)) {
            t.scopes.push(scope.clone());
        }
    }
    t.statement_record_ids
        .extend(s.statement_record_ids.iter().cloned());
    if s.value_kind.is_some() {
        t.value_kind = s.value_kind;
    }
}
pub(super) fn fail(
    code: &str,
    message: &str,
    id: &str,
    at: &CalculationScope,
    causes: &[ModelError],
    dependencies: &[String],
) -> CellResult {
    let mut records = vec![];
    let mut deps = dependencies.to_vec();
    for c in causes {
        for r in &c.record_ids {
            if !records.contains(r) {
                records.push(r.clone());
            }
        }
        for d in &c.dependency_ids {
            if !deps.contains(d) {
                deps.push(d.clone());
            }
        }
    }
    if causes.is_empty() {
        records = at.source_record_ids.iter().cloned().collect();
    }
    CellResult::Error(ModelError {
        record_ids_present: true,
        dependency_ids_present: !causes.is_empty() || !dependencies.is_empty(),
        code: code.into(),
        message: message.into(),
        definition_id: id.into(),
        record_ids: records,
        dependency_ids: deps,
    })
}
