// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
pub(super) struct CalculatedGroup {
    pub category_id: String,
    pub source_record_ids: BTreeSet<String>,
    pub source_record_order: Vec<String>,
    pub cells: BTreeMap<String, CellResult>,
    pub measure_cells: BTreeMap<String, CellResult>,
}
pub(super) fn group(
    category_id: String,
    pool: &EligiblePool,
    t: &CalculatedTotals,
) -> CalculatedGroup {
    CalculatedGroup {
        category_id,
        source_record_order: ordered_source_ids(pool, &t.scope.source_record_ids),
        source_record_ids: t.scope.source_record_ids.clone(),
        cells: t.formulas.cells.clone(),
        measure_cells: t.formulas.measure_cells.clone(),
    }
}
pub(super) struct Qualification {
    pub record_ids: BTreeSet<String>,
    pub complete: bool,
    pub errors: Vec<ModelError>,
}
pub(super) fn qualify_groups(
    groups: &[CalculatedGroup],
    filters: &[ResultFilter],
) -> Qualification {
    let mut ids = groups
        .iter()
        .flat_map(|g| g.source_record_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    let mut errors = vec![];
    for f in filters {
        let mut qualified = BTreeSet::new();
        let candidates: Vec<_> = groups
            .iter()
            .filter(|g| g.category_id == f.category_id)
            .collect();
        if candidates.is_empty() {
            errors.push(ModelError {
                record_ids_present: false,
                ..crate::fiscal::error(
                    "missing-reference",
                    format!("Result filter category {} is unavailable.", f.category_id),
                    &f.id,
                    vec![],
                )
            });
        }
        for g in candidates {
            let cell = match &f.target {
                ResultTarget::Measure { id } => g.measure_cells.get(id),
                ResultTarget::Formula { id } => g.cells.get(id),
            };
            let value = match cell {
                Some(CellResult::Value(v)) => v,
                Some(CellResult::Error(e)) => {
                    let mut e = e.clone();
                    e.definition_id = f.id.clone();
                    errors.push(e);
                    continue;
                }
                None => {
                    errors.push(ModelError {
                        record_ids_present: false,
                        ..crate::fiscal::error(
                            "missing-reference",
                            "Result filter input is unavailable.",
                            &f.id,
                            vec![],
                        )
                    });
                    continue;
                }
            };
            let b = crate::formulas::literal(&f.value);
            let scalar = |v: &WireValue| {
                matches!(
                    v,
                    WireValue::Null | WireValue::String(_) | WireValue::Bool(_) | WireValue::F64(_)
                )
            };
            let cmp = match (value, &b) {
                (WireValue::String(a), WireValue::String(b)) => {
                    Some(a.encode_utf16().cmp(b.encode_utf16()))
                }
                (WireValue::F64(_), WireValue::F64(_)) => crate::ordering::number(value)
                    .unwrap()
                    .partial_cmp(&crate::ordering::number(&b).unwrap()),
                _ => None,
            };
            if !scalar(value)
                || matches!(value, WireValue::F64(_))
                    && crate::validation::arithmetic_number(value).is_err()
                || (!matches!(f.predicate, Predicate::Eq | Predicate::Ne) && cmp.is_none())
            {
                errors.push(crate::fiscal::error(
                    "invalid-type",
                    "Result predicate requires compatible scalar values.",
                    &f.id,
                    g.source_record_order.clone(),
                ));
                continue;
            }
            let equal = if let (Some(a), Some(b)) =
                (crate::ordering::number(value), crate::ordering::number(&b))
            {
                a == b
            } else {
                value == &b
            };
            let pass = match f.predicate {
                Predicate::Eq => equal,
                Predicate::Ne => !equal,
                Predicate::Gt => cmp.unwrap().is_gt(),
                Predicate::Gte => !cmp.unwrap().is_lt(),
                Predicate::Lt => cmp.unwrap().is_lt(),
                Predicate::Lte => !cmp.unwrap().is_gt(),
            };
            if pass {
                qualified.extend(g.source_record_ids.iter().cloned());
            }
        }
        ids.retain(|id| qualified.contains(id));
    }
    Qualification {
        record_ids: ids,
        complete: errors.is_empty(),
        errors,
    }
}

/// Identity membership and evidence order are distinct: retained source order is never a set sort.
pub(super) fn ordered_source_ids(pool: &EligiblePool, ids: &BTreeSet<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    pool.rows_in(ids)
        .into_iter()
        .filter(|row| seen.insert(row.id.clone()))
        .map(|row| row.id.clone())
        .collect()
}
