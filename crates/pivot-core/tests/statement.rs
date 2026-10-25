// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{analytical::*, contract::*};
use support::*;
#[test]
fn frozen_statement_declared_derived_missing_and_policy_cells() {
    for name in [
        "statement-income-wide",
        "statement-income-long",
        "statement-balance",
        "statement-cashflow",
        "statement-missing",
        "statement-duplicate-keyless",
        "statement-mixed-units",
        "statement-invalid-number",
        "statement-annual-quarter-overlap",
        "statement-explicit-prior-period",
        "statement-upstream-error",
        "statement-hidden-dependency",
        "statement-scoped-formats",
        "statement-fiscal-warning",
        "statement-hidden-field",
    ] {
        let (root, input, definition, runtime) = fixture(name);
        let calculation =
            calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host);
        let expected_error = get(get(&root, "result"), "error");
        if !matches!(expected_error, WireValue::Missing) {
            let error = calculation
                .err()
                .unwrap_or_else(|| panic!("{name}: expected refusal"));
            assert_eq!(
                error.message,
                text(get(expected_error, "message")),
                "{name}"
            );
            continue;
        }
        let view = calculation.unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert_descriptors(&view, &root, name);
        let expected = arr(get(get(get(&root, "result"), "chart"), "rows"));
        assert_eq!(view.eligible_rows.len(), expected.len(), "{name}");
        for (actual, expected) in view.eligible_rows.iter().zip(expected) {
            assert_eq!(actual.id, text(get(expected, "id")), "{name}");
            assert_values(&actual.values, get(expected, "values"), name);
            let errs = actual
                .cell_errors
                .as_ref()
                .map(|v| {
                    v.iter()
                        .map(|(k, v)| (k.clone(), (v.code.clone(), v.message.clone())))
                        .collect::<std::collections::BTreeMap<_, _>>()
                })
                .unwrap_or_default();
            let expected_errs = if let WireValue::Record(v) = get(expected, "cellErrors") {
                v.iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            (
                                text(get(v, "code")).to_string(),
                                text(get(v, "message")).to_string(),
                            ),
                        )
                    })
                    .collect()
            } else {
                std::collections::BTreeMap::new()
            };
            assert_eq!(errs, expected_errs, "{name}");
        }
    }
}

#[test]
fn frozen_statement_columns_scoped_formats_and_completeness() {
    for name in [
        "statement-income-wide",
        "statement-income-long",
        "statement-scoped-formats",
        "statement-fiscal-warning",
    ] {
        let (root, input, definition, runtime) = fixture(name);
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
        assert_descriptors(&view, &root, name);
    }
}
#[test]
fn stock_and_flow_recalculate_over_multiple_authoritative_periods() {
    for (name, want) in [("statement-balance", 60.), ("statement-cashflow", 160.)] {
        let (_, input, d, runtime) = fixture(name);
        let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
        let policy = &view.compiled.execution.as_ref().unwrap().policy;
        let records = &view.pool.rows;
        let constraints = policy
            .dependent_category_ids
            .iter()
            .map(|id| {
                (
                    id.clone(),
                    view.pool.members[&records[0].id][id]
                        .as_ref()
                        .unwrap()
                        .key
                        .clone(),
                )
            })
            .collect();
        let scope = scope_for(&view.pool, records, &constraints, &view.compiled);
        let totals = calculate_totals(&view.pool, &scope, &view.compiled, &Host).unwrap();
        assert_eq!(
            totals.values[&policy.measure_id],
            WireValue::F64(WireNumber::Finite(want)),
            "{name}"
        );
    }
}
#[test]
fn optional_lines_blank_and_required_lines_fail_without_facts() {
    let (_, input, d, runtime) = fixture("statement-income-wide");
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    let p = &view.compiled.execution.as_ref().unwrap().policy;
    let fiscal = view.compiled.fiscal_context.as_ref().unwrap();
    let blank = pivot_core::statement::evaluate_statement_line(
        pivot_core::statement::LinePolicy::Flow,
        &[],
        p,
        fiscal,
        &[],
        false,
    );
    assert_eq!(
        blank,
        pivot_core::formulas::CellResult::Value(WireValue::Null)
    );
    let required = pivot_core::statement::evaluate_statement_line(
        pivot_core::statement::LinePolicy::Flow,
        &[],
        p,
        fiscal,
        &[],
        true,
    );
    let pivot_core::formulas::CellResult::Error(e) = required else {
        panic!("required missing fact")
    };
    assert_eq!(e.code, "missing-input");
    assert_eq!(e.message, "The required line has no facts.");
}
#[test]
fn line_policy_matches_actual_typescript_for_coverage_endpoints_and_context() {
    use pivot_core::{formulas::CellResult, statement::*};
    use serde_json::json;
    let (_, input, d, runtime) = fixture("statement-cashflow");
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    let policy = &view.compiled.execution.as_ref().unwrap().policy;
    let fiscal = view.compiled.fiscal_context.as_ref().unwrap();
    let base = view.pool.rows.clone();
    let period_category = &view
        .compiled
        .categories
        .iter()
        .find(|c| c.transform == Transform::FY)
        .unwrap()
        .id;
    let requested = pivot_core::scopes::collect_fiscal_evidence(
        &view.pool,
        &base.iter().map(|r| r.id.clone()).collect(),
        period_category,
    )
    .periods;
    let path =
        std::env::temp_dir().join(format!("task6-policy-reference-{}.cjs", std::process::id()));
    let output = std::process::Command::new("../../node_modules/.bin/esbuild")
        .arg("../../src/lib/statementModel/linePolicy.ts")
        .args(["--bundle", "--platform=node", "--format=cjs"])
        .arg(format!("--outfile={}", path.display()))
        .output()
        .unwrap();
    assert!(output.status.success());
    for scenario in [
        "flow",
        "stock",
        "single",
        "formula",
        "no-request",
        "no-facts-required",
        "no-facts-optional",
        "all-null-optional",
        "partial-null-optional",
        "text",
        "infinite",
        "missing-company",
        "mixed-company",
        "mixed-unit",
        "duplicate",
        "flow-gap",
        "stock-missing-latest",
        "calendar-evidence",
        "upstream-error",
    ] {
        let mut records = base.clone();
        let mut p = policy.clone();
        let mut periods = requested.clone();
        let mut required = true;
        let mut line_policy = LinePolicy::Flow;
        match scenario {
            "stock" => line_policy = LinePolicy::Stock,
            "single" => line_policy = LinePolicy::Single,
            "formula" => line_policy = LinePolicy::Formula,
            "no-request" => periods.clear(),
            "no-facts-required" => records.clear(),
            "no-facts-optional" => {
                records.clear();
                required = false;
            }
            "all-null-optional" => {
                required = false;
                for r in &mut records {
                    r.values.insert(p.value_field_id.clone(), WireValue::Null);
                }
            }
            "partial-null-optional" => {
                required = false;
                records[0]
                    .values
                    .insert(p.value_field_id.clone(), WireValue::Null);
            }
            "text" => {
                records[0]
                    .values
                    .insert(p.value_field_id.clone(), WireValue::String("10".into()));
            }
            "infinite" => {
                records[0].values.insert(
                    p.value_field_id.clone(),
                    WireValue::F64(WireNumber::Special(SpecialNumber::PositiveInfinity)),
                );
            }
            "missing-company" => {
                records[0].values.remove(&p.company_field_id);
            }
            "mixed-company" => {
                records[0].values.insert(
                    p.company_field_id.clone(),
                    WireValue::String("OTHER".into()),
                );
            }
            "mixed-unit" => {
                p.unit_field_id = Some("unit".into());
                for (i, r) in records.iter_mut().enumerate() {
                    r.values.insert(
                        "unit".into(),
                        WireValue::String(if i == 0 { "USD" } else { "EUR" }.into()),
                    );
                }
            }
            "duplicate" => {
                records.push(records[0].clone());
            }
            "flow-gap" => {
                records[1]
                    .values
                    .insert("start".into(), WireValue::String("2026-02-01".into()));
            }
            "stock-missing-latest" => {
                line_policy = LinePolicy::Stock;
                records.pop();
            }
            "calendar-evidence" => {
                for q in &mut periods {
                    q.precision = "calendar".into();
                }
            }
            "upstream-error" => {
                records[0].cell_errors = Some(std::collections::BTreeMap::from([(
                    p.value_field_id.clone(),
                    serde_json::from_value(
                        json!({"code":"invalid-type","message":"Upstream failure"}),
                    )
                    .unwrap(),
                )]));
            }
            _ => {}
        }
        let raw_records = records
            .iter()
            .map(|r| {
                let mut row = untag(serde_json::to_value(r).unwrap());
                if scenario == "infinite" {
                    row["values"][&p.value_field_id] = json!("__INFINITY__");
                }
                row
            })
            .collect::<Vec<_>>();
        let raw_periods=periods.iter().map(|p|{let mut raw=json!({"kind":p.period.kind,"year":p.period.year,"companyKey":p.company_key,"start":p.start,"end":p.end,"precision":p.precision});if let Some(q)=p.period.quarter {raw["quarter"]=json!(q);}raw}).collect::<Vec<_>>();
        let context = json!({"periodKind":p.period_kind,"companyFieldId":p.company_field_id,"currencyFieldId":p.currency_field_id,"unitFieldId":p.unit_field_id,"fiscal":p.fiscal,"fiscalContext":{},"requestedPeriods":raw_periods,"required":required});
        let policy_name = serde_json::to_value(line_policy).unwrap();
        let script = r#"const [policy,rows,value,context]=JSON.parse(process.argv[1]);for(const r of rows)if(r.values[value]==='__INFINITY__')r.values[value]=Infinity; const result=require(process.argv[2]).evaluateStatementLine(policy,rows,value,context);console.log(JSON.stringify(result.ok?{ok:true,value:result.value}:{ok:false,code:result.error.code,message:result.error.message}));"#;
        let output = std::process::Command::new("node")
            .arg("-e")
            .arg(script)
            .arg(
                serde_json::to_string(&json!([
                    policy_name,
                    raw_records,
                    p.value_field_id,
                    context
                ]))
                .unwrap(),
            )
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let expected: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let native = evaluate_statement_line(line_policy, &records, &p, fiscal, &periods, required);
        let actual = match native {
            CellResult::Value(v) => json!({"ok":true,"value":plain(&v)}),
            CellResult::Error(e) => json!({"ok":false,"code":e.code,"message":e.message}),
        };
        assert_eq!(actual, expected, "{scenario}");
    }
    std::fs::remove_file(path).unwrap();
}
#[test]
fn schema_dispatch_cannot_decode_invalid_statement_as_table() {
    let (_, _, d, _) = fixture("statement-income-wide");
    let mut raw = serde_json::to_value(d.definition.analytical.unwrap()).unwrap();
    raw["schemaVersion"] = serde_json::json!(9);
    let unknown = serde_json::from_value::<AnalyticalDefinition>(raw.clone()).unwrap_err();
    assert!(unknown.to_string().contains("unsupported-schema"));
    raw["schemaVersion"] = serde_json::json!(2);
    raw["kind"] = serde_json::json!("table");
    let wrong_kind: AnalyticalDefinition = serde_json::from_value(raw).unwrap();
    let AnalyticalDefinition::Statement(intent) = wrong_kind else {
        panic!("schema2 cannot fall back to table")
    };
    assert!(pivot_core::statement::validate_intent(&intent).is_err());
}
#[test]
fn stock_negative_zero_remains_a_valid_explicit_wire_value() {
    let (_, input, d, runtime) = fixture("statement-balance");
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    let p = &view.compiled.execution.as_ref().unwrap().policy;
    let mut records = view.pool.rows.clone();
    records.last_mut().unwrap().values.insert(
        p.value_field_id.clone(),
        WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero)),
    );
    let category = view
        .compiled
        .categories
        .iter()
        .find(|c| c.transform == Transform::FY)
        .unwrap();
    let periods = pivot_core::scopes::collect_fiscal_evidence(
        &view.pool,
        &records.iter().map(|r| r.id.clone()).collect(),
        &category.id,
    )
    .periods;
    let value = pivot_core::statement::evaluate_statement_line(
        pivot_core::statement::LinePolicy::Stock,
        &records,
        p,
        view.compiled.fiscal_context.as_ref().unwrap(),
        &periods,
        true,
    );
    let pivot_core::formulas::CellResult::Value(value) = value else {
        panic!("stock value")
    };
    assert!(pivot_core::validation::validate_wire_value(&value).is_ok());
    assert_eq!(
        value,
        WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero))
    );
}
#[test]
fn statement_presentation_follows_overrides_and_matches_typescript() {
    let (root, input, d, runtime) = fixture("statement-income-wide");
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    let expected = get(
        get(get(get(&root, "result"), "chart"), "provenance"),
        "metadata",
    );
    let actual = WireValue::Record(
        view.provenance
            .metadata
            .clone()
            .unwrap()
            .into_iter()
            .collect(),
    );
    assert_eq!(plain(&actual), plain(expected));
    let Some(AnalyticalDefinition::Statement(mut intent)) = d.definition.analytical else {
        panic!("statement intent")
    };
    let p = "statement/income/1.0.0/";
    let id = |s: &str| format!("{p}{s}");
    intent.overrides.section_order = Some(vec![id("section/Profit")]);
    intent.overrides.line_order.insert(
        id("section/Income"),
        vec![id("line/interest_income"), id("line/revenue")],
    );
    intent
        .overrides
        .labels
        .insert(id("section/Income"), "Top line".into());
    intent
        .overrides
        .labels
        .insert(id("line/revenue"), "Sales".into());
    let compiled = view.compiled.definition.definition.analytical.as_ref();
    let layout = &compiled
        .and_then(AnalyticalDefinition::table)
        .unwrap()
        .layout;
    let presented = plain(&pivot_core::statement::statement_presentation(&intent, layout).unwrap());
    let sections = presented["sections"].as_array().unwrap();
    let section_ids: Vec<_> = sections.iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(
        section_ids,
        [
            id("section/Profit"),
            id("section/Income"),
            id("section/Expenses")
        ]
    );
    assert_eq!(sections[1]["label"], "Top line");
    assert_eq!(sections[0]["label"], "Profit");
    let lines = sections[1]["lines"].as_array().unwrap();
    assert_eq!(lines[0]["id"], id("line/interest_income"));
    assert_eq!(lines[1]["id"], id("line/revenue"));
    assert_eq!(lines[1]["label"], "Sales");
    assert_eq!(lines[2]["id"], id("line/operating_revenue"));
    assert_eq!(lines.len(), 11);
    intent
        .overrides
        .labels
        .insert(id("line/revenue"), String::new());
    assert_eq!(
        pivot_core::statement::statement_presentation(&intent, layout)
            .unwrap_err()
            .message,
        "Invalid or unsupported Statement presentation metadata"
    );
    // The intent validator refuses what presentation would: 1..=4096 UTF-16 units.
    let bound = |label: String| {
        let mut i = intent.clone();
        // Presentation accepts partial orders; validation does not.
        i.overrides.section_order = None;
        i.overrides.line_order.clear();
        i.overrides.labels.insert(id("line/revenue"), label);
        pivot_core::statement::validate_intent(&i).map_err(|d| d.path)
    };
    assert_eq!(bound("€".repeat(4096)), Ok(()));
    assert_eq!(
        bound("😀".repeat(2049)),
        Err(Some("overrides.labels".into()))
    );
}
