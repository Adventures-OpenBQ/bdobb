// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

use super::*;
use crate::analytical::{tag_json, CalculatedView};
use serde_json::json;
use std::collections::BTreeSet;

pub(crate) const PROOF_KEY: &str = "incomeChartProof";

pub(crate) fn clear_proof(provenance: &mut Provenance) {
    if let Some(metadata) = &mut provenance.metadata {
        metadata.remove(PROOF_KEY);
    }
}
const PREFIX: &str = "statement/income/1.0.0/";
const REPORTED: [&str; 7] = [
    "revenue",
    "cost_of_revenue",
    "gross_profit",
    "operating_income",
    "income_before_tax",
    "net_income",
    "income_tax_expense",
];

fn acquired_origin<'a>(input: &'a SourceDataset, id: &str) -> Option<&'a str> {
    let column = input.columns.iter().find(|c| c.id == id)?;
    if column.analytical.is_some()
        || column.measure_id.is_some()
        || column.aggregation.is_some()
        || column
            .split_path
            .as_ref()
            .is_some_and(|path| !path.is_empty())
    {
        return None;
    }
    Some(column.source_field_id.as_deref().unwrap_or(&column.id))
}

fn canonical_gross_profit(intent: &StatementIntent) -> bool {
    // This is the installed income/1.0.0 formula from statementModel/catalog.ts.
    let id = format!("{PREFIX}formula/calculated_gross_profit");
    let member = |name| {
        json!({
            "kind": "member",
            "value": { "kind": "reference", "target": "measure", "id": format!("{PREFIX}measure/value") },
            "selectors": [{ "categoryId": format!("{PREFIX}category/item"), "memberKey": format!("{PREFIX}line/{name}") }]
        })
    };
    let expected = json!({
        "id": id, "name": "Calculated gross profit", "scope": "aggregate",
        "expression": "Value[Item=revenue] - Value[Item=cost_of_revenue]",
        "ast": { "kind": "binary", "operator": "-", "left": member("revenue"), "right": member("cost_of_revenue") }
    });
    let matches = |f: &Formula| serde_json::to_value(f).is_ok_and(|value| value == expected);
    intent.template.lines.iter().any(|line| {
        line.id == format!("{PREFIX}line/calculated_gross_profit")
            && line.policy == LinePolicy::Formula
            && line.unit.as_deref() == Some("currency")
            && line.formula.as_ref().is_some_and(matches)
    }) && intent
        .overrides
        .formulas
        .iter()
        .filter(|f| f.id == id)
        .all(matches)
}

fn text(value: Option<&WireValue>) -> Option<&str> {
    match value? {
        WireValue::String(value) => Some(value),
        _ => None,
    }
}
fn cell<'a>(row: &'a DatasetRow, field: &str) -> Option<&'a str> {
    if row
        .cell_errors
        .as_ref()
        .is_some_and(|errors| errors.contains_key(field))
    {
        return None;
    }
    text(row.values.get(field))
}

/// Mirrors the TypeScript compiler proof. Only origins and date coordinates leave the engine.
pub(crate) fn income_chart_proof(
    input: &SourceDataset,
    intent: &StatementIntent,
    view: &CalculatedView,
) -> Option<WireValue> {
    let bindings = &intent.bindings;
    let date_field = bindings.fiscal.date_field_id.as_deref()?;
    let period_kind = match intent.period_kind {
        PeriodKind::FY => "FY",
        PeriodKind::FQ => "FQ",
    };
    let Some(WireValue::Record(evidence)) =
        input.provenance.metadata.as_ref()?.get("financialEvidence")
    else {
        return None;
    };
    let fact = |name| {
        text(
            evidence
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value),
        )
    };
    if intent.template.id != "income"
        || intent.template.version != "1.0.0"
        || bindings.shape != StatementShape::Wide
        || acquired_origin(input, date_field) != Some("period_ending")
        || acquired_origin(input, &bindings.company_field_id).is_none()
        || bindings.company_field_id != bindings.fiscal.company_field_id
        || input.provenance.input_may_contain_aggregates == Some(true)
        || fact("kind") != Some("income")
        || fact("period_kind") != Some(period_kind)
    {
        return None;
    }
    let issuer = fact("qualified_symbol")?;
    let Some((_, WireValue::Array(periods))) = evidence.iter().find(|(key, _)| key == "periods")
    else {
        return None;
    };
    let known_dates: BTreeSet<_> = periods
        .iter()
        .filter_map(|value| {
            let WireValue::Record(fields) = value else {
                return None;
            };
            text(
                fields
                    .iter()
                    .find(|(key, _)| key == "period_end")
                    .map(|(_, value)| value),
            )
        })
        .collect();
    let mut dates = BTreeSet::new();
    for row in &input.rows {
        let date = cell(row, date_field)?;
        if cell(row, &bindings.company_field_id) != Some(issuer)
            || cell(row, &bindings.period_kind_field_id) != Some(period_kind)
            || !known_dates.contains(date)
            || !dates.insert(date)
        {
            return None;
        }
    }
    let reported: Vec<_> = REPORTED
        .into_iter()
        .filter(|field| {
            let id = format!("{PREFIX}line/{field}");
            intent.template.lines.iter().any(|line| {
                line.id == id
                    && line.policy == LinePolicy::Flow
                    && line.unit.as_deref() == Some("currency")
                    && line.formula.is_none()
            }) && bindings.mappings.iter().any(|mapping| {
                mapping.line_id == id
                    && acquired_origin(input, &mapping.source_field_id) == Some(field)
            })
        })
        .collect();
    let period_id = format!("{PREFIX}category/period");
    let value_id = format!("{PREFIX}measure/value");
    let mut actual_ends = BTreeMap::new();
    for row in &view.pool.universe.evaluated.rows {
        let Some(Ok(member)) = view
            .pool
            .universe
            .members
            .get(&row.id)
            .and_then(|members| members.get(&period_id))
        else {
            continue;
        };
        let Some(date) = cell(row, date_field).filter(|date| dates.contains(date)) else {
            continue;
        };
        actual_ends
            .entry(member.key.as_str())
            .and_modify(|end| {
                if *end != Some(date) {
                    *end = None;
                }
            })
            .or_insert(Some(date));
    }
    let periods: Vec<_> = view
        .columns
        .iter()
        .filter_map(|column| {
            let [member] = column.split_path.as_deref()? else {
                return None;
            };
            if column.measure_id.as_deref() != Some(&value_id)
                || member.category_id.as_deref() != Some(&period_id)
            {
                return None;
            }
            let end = actual_ends.get(member.member_key.as_deref()?)?.as_ref()?;
            Some(json!({ "columnId": column.id, "periodEnd": end }))
        })
        .collect();
    Some(tag_json(&json!({
        "version": 1, "issuer": issuer, "periodKind": period_kind,
        "reportedFields": reported, "calculatedGrossProfit": canonical_gross_profit(intent), "periods": periods,
    })))
}
