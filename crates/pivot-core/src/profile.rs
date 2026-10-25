#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! describe_table's column profile: exact per-field facts over rows the card may see.
//! The caller hands over the rows (the authoring pool's, or a model-less table's
//! qualified source rows); nothing here reads anything else.
use crate::{
    contract::*,
    ordering::{missing, number, ValueOrder},
    session::{ColumnProfile, ColumnProfileResult, ProfileScope},
};
use std::collections::BTreeSet;
const DISTINCT_CAP: usize = 1000;
const SAMPLES: usize = 5;
const CLIP: usize = 40;
/// Column ids are unbounded; this keeps one page's ids small whatever the columns are called.
const ID_BYTES: usize = 65536;
/// First row per id, as the observed member facets count them.
fn unique(rows: &[DatasetRow]) -> Vec<&DatasetRow> {
    let mut seen = BTreeSet::new();
    rows.iter().filter(|r| seen.insert(r.id.as_str())).collect()
}
fn clip(v: &WireValue) -> WireValue {
    match v {
        WireValue::String(s) => WireValue::String(s.chars().take(CLIP).collect()),
        v => v.clone(),
    }
}
fn sampleable(v: &WireValue) -> bool {
    matches!(v, WireValue::String(_) | WireValue::Bool(_)) || number(v).is_some_and(f64::is_finite)
}
#[allow(clippy::too_many_arguments)]
pub fn column_profile(
    columns: &[DatasetColumn],
    universe: &[DatasetRow],
    filtered: &[DatasetRow],
    scope: ProfileScope,
    offset: u64,
    limit: u32,
    fields: Option<&[String]>,
    order: &dyn ValueOrder,
) -> Result<ColumnProfileResult, Diagnostic> {
    let invalid = |message: &str| crate::session::problem("INVALID_REQUEST", message);
    if !(1..=100).contains(&limit) || fields.is_some_and(|f| f.len() > 100) {
        return Err(invalid("Column profile page must be 1–100 fields"));
    }
    let list: Vec<&DatasetColumn> = match fields {
        None => columns.iter().collect(),
        Some(ids) => {
            let mut seen = BTreeSet::new();
            ids.iter()
                .map(|id| {
                    if !seen.insert(id) {
                        return Err(invalid("Duplicate column profile field"));
                    }
                    columns
                        .iter()
                        .find(|c| &c.id == id)
                        .ok_or_else(|| invalid("Unknown column profile field"))
                })
                .collect::<Result<_, _>>()?
        }
    };
    let (input, eligible) = (unique(universe), unique(filtered));
    let rows = match scope {
        ProfileScope::Input => &input,
        ProfileScope::Filtered => &eligible,
    };
    let start = offset.min(list.len() as u64) as usize;
    let (mut out, mut id_bytes) = (vec![], 0);
    for c in list.iter().skip(start).take(limit as usize) {
        if !out.is_empty() && id_bytes + c.id.len() > ID_BYTES {
            break;
        }
        id_bytes += c.id.len();
        out.push(profile(c, rows, universe, order)?);
    }
    let next = (start + out.len()) as u64;
    let input_scope = scope == ProfileScope::Input;
    Ok(ColumnProfileResult {
        scope,
        offset,
        limit,
        total: list.len() as u64,
        rows_profiled: rows.len() as u64,
        next_offset: (next < list.len() as u64).then_some(next),
        filters_active: input_scope.then_some(eligible.len() != input.len()),
        filtered_rows: input_scope.then_some(eligible.len() as u64),
        fields: out,
    })
}
fn profile(
    c: &DatasetColumn,
    rows: &[&DatasetRow],
    universe: &[DatasetRow],
    order: &dyn ValueOrder,
) -> Result<ColumnProfile, Diagnostic> {
    // One type for both scopes: inferred over every row the card receives.
    let kind = crate::scopes::inferred_filter_kind(c, universe);
    let ranged = matches!(kind, "number" | "date");
    let (mut count, mut errors) = (0u64, 0u64);
    let (mut keys, mut samples) = (BTreeSet::new(), vec![]);
    let (mut min, mut max): (Option<&WireValue>, Option<&WireValue>) = (None, None);
    for r in rows {
        if r.cell_errors
            .as_ref()
            .is_some_and(|e| e.contains_key(&c.id))
        {
            errors += 1;
        }
        let v = crate::fiscal::read(r, Some(&c.id));
        if missing(v) {
            continue;
        }
        count += 1;
        if keys.len() <= DISTINCT_CAP
            && keys.insert(crate::pivot::pivot_value_key(v))
            && samples.len() < SAMPLES
            && sampleable(v)
        {
            samples.push(clip(v));
        }
        let in_range = match kind {
            "number" => number(v).is_some_and(f64::is_finite),
            "date" => matches!(v, WireValue::String(s) if crate::scopes::iso_date(s)),
            _ => false,
        };
        if in_range {
            // ponytail: two engine comparisons per row; on Wasm a text compare crosses the
            // JS ordering bridge (cached). Compare distinct values only if big date columns lag.
            if min.map_or(Ok(true), |m| {
                order.compare_raw(v, m).map(|o| o.sort_order().is_lt())
            })? {
                min = Some(v);
            }
            if max.map_or(Ok(true), |m| {
                order.compare_raw(v, m).map(|o| o.sort_order().is_gt())
            })? {
                max = Some(v);
            }
        }
    }
    let extreme = |v: Option<&WireValue>| ranged.then(|| v.map_or(WireValue::Null, clip));
    Ok(ColumnProfile {
        id: c.id.clone(),
        kind: kind.into(),
        count,
        missing: rows.len() as u64 - count,
        distinct: keys.len().min(DISTINCT_CAP) as u64,
        distinct_capped: keys.len() > DISTINCT_CAP,
        min: extreme(min),
        max: extreme(max),
        samples,
        periodicity: (kind == "date").then(|| {
            format!(
                "{:?}",
                crate::pivot::periodicity(rows.iter().map(|r| crate::fiscal::read(r, Some(&c.id))))
            )
            .to_lowercase()
        }),
        cell_errors: errors,
    })
}
