// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::{fiscal::*, formulas::*};
pub fn evaluate_statement_line(
    policy: LinePolicy,
    records: &[DatasetRow],
    context: &StatementPolicy,
    fiscal: &FiscalContext,
    requested: &[ResolvedFiscalPeriod],
    required: bool,
) -> CellResult {
    let fail = |code: &str, message: &str| {
        CellResult::Error(error(
            code,
            message,
            "",
            records.iter().map(|r| r.id.clone()).collect(),
        ))
    };
    let blank = CellResult::Value(WireValue::Null);
    if policy == LinePolicy::Formula {
        return fail(
            "scope",
            "Formula policies require the bound aggregate evaluator.",
        );
    }
    if records.is_empty() {
        return if !required {
            blank
        } else {
            fail("missing-input", "The required line has no facts.")
        };
    }
    for f in [
        Some(&context.company_field_id),
        context.currency_field_id.as_ref(),
        context.unit_field_id.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        if records.iter().any(|r| {
            matches!(
                r.values.get(f),
                None | Some(WireValue::Null | WireValue::Missing)
            )
        }) {
            return fail(
                "missing-input",
                &format!("Required context {f} is missing."),
            );
        }
        let first = &records[0].values[f];
        if records.iter().any(|r| r.values.get(f) != Some(first)) {
            return fail(
                "scope",
                &format!("Mixed {f} contexts cannot be aggregated."),
            );
        }
    }
    let mut checked = fiscal_fields(&context.fiscal);
    checked.extend([
        context.value_field_id.clone(),
        context.company_field_id.clone(),
    ]);
    checked.extend(context.currency_field_id.clone());
    checked.extend(context.unit_field_id.clone());
    for r in records {
        for f in &checked {
            if let Some(e) = r.cell_errors.as_ref().and_then(|e| e.get(f)) {
                return fail("blocked-dependency", &e.message);
            }
        }
    }
    if !required&&records.iter().all(|r|matches!(r.values.get(&context.value_field_id),None|Some(WireValue::Missing|WireValue::Null))||matches!(r.values.get(&context.value_field_id),Some(WireValue::String(s))if s.is_empty())){return blank;}
    let mut facts = vec![];
    for r in records {
        let Some(v @ WireValue::F64(_)) = r.values.get(&context.value_field_id) else {
            return fail("missing-input", "Line value is missing or nonnumeric.");
        };
        let Ok(v) = crate::validation::arithmetic_number(v) else {
            return fail("nonfinite", "Line value must be finite.");
        };
        let resolved = resolve_fiscal_period(r, &context.fiscal, fiscal);
        let period = if context.period_kind == PeriodKind::FY {
            resolved.year
        } else {
            resolved.quarter
        };
        let period = match period {
            Ok(p) => p,
            Err(e) => return CellResult::Error(e),
        };
        if period.precision != "authoritative" {
            return fail(
                "fiscal-context",
                "Authoritative fiscal bounds are required for Statement facts.",
            );
        }
        facts.push((v, period));
    }
    let mut coordinates = std::collections::BTreeSet::new();
    for (_, p) in &facts {
        let q = quarter_recipe_json(&p.period).unwrap_or_default();
        if !coordinates.insert((p.period.year, q)) {
            return fail(
                "scope",
                "Duplicate facts for the same company, line and fiscal period.",
            );
        }
    }
    facts.sort_by(|a, b| a.1.end.cmp(&b.1.end));
    if policy == LinePolicy::Single && facts.len() != 1 {
        return fail(
            "scope",
            "Single-observation policy requires exactly one fact.",
        );
    }
    for pair in facts.windows(2) {
        let a = &pair[0].1;
        let b = &pair[1].1;
        if b.start <= a.end {
            return fail("scope", "Authoritative fact periods overlap.");
        }
        if policy == LinePolicy::Flow && date_day(&b.start) - date_day(&a.end) != 1 {
            return fail("scope", "Flow periods have incomplete coverage.");
        }
    }
    if requested.is_empty() {
        return fail(
            "fiscal-context",
            "The requested fiscal scope is unavailable; bind authoritative request periods.",
        );
    }
    let mut expected = requested.to_vec();
    expected.sort_by(|a, b| a.end.cmp(&b.end));
    if expected
        .iter()
        .any(|p| p.period.kind != context.period_kind || p.precision != "authoritative")
    {
        return fail(
            "fiscal-context",
            "The requested fiscal scope lacks authoritative bounds.",
        );
    }
    if expected
        .iter()
        .any(|p| p.company_key != expected[0].company_key)
        || expected[0].company_key != facts[0].1.company_key
    {
        return fail("scope", "Requested fiscal scope crosses company contexts.");
    }
    let same = |a: &ResolvedFiscalPeriod, b: &ResolvedFiscalPeriod| {
        a.company_key == b.company_key
            && a.period.kind == b.period.kind
            && a.period.year == b.period.year
            && quarter_recipe_json(&a.period).ok() == quarter_recipe_json(&b.period).ok()
            && a.start == b.start
            && a.end == b.end
    };
    if policy == LinePolicy::Stock {
        if !same(&facts.last().unwrap().1, expected.last().unwrap()) {
            return fail(
                "missing-input",
                "Stock has no fact at the requested latest fiscal endpoint.",
            );
        }
    } else if facts.len() != expected.len()
        || expected
            .iter()
            .any(|p| !facts.iter().any(|(_, f)| same(f, p)))
    {
        return fail(
            "missing-input",
            "Flow or single-observation facts do not cover the requested fiscal scope.",
        );
    }
    let value = if policy == LinePolicy::Flow {
        facts.iter().fold(0., |sum, (v, _)| sum + v)
    } else {
        facts.last().unwrap().0
    };
    if value.is_finite() {
        CellResult::Value(crate::pivot::scalar_number(value))
    } else {
        fail("nonfinite", "Policy result must be finite.")
    }
}
