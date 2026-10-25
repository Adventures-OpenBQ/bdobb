// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{contract::*, fiscal::*, formulas::*, scopes::*};
use std::collections::BTreeSet;
struct Host;
impl pivot_core::ordering::ValueOrder for Host {
    fn compare(&self, _: &WireValue, _: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        panic!("no Pivot comparisons in scope tests")
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<std::cmp::Ordering, Diagnostic> {
        let args = serde_json::to_string(&(a, b)).unwrap();
        let out=std::process::Command::new("node").arg("-e").arg(r#"const [a,b]=JSON.parse(process.argv[1]); process.stdout.write(String(Math.sign(a.localeCompare(b,"en-US"))))"#).arg(args).output().unwrap();
        assert!(out.status.success());
        let sign: i32 = String::from_utf8(out.stdout).unwrap().parse().unwrap();
        Ok(sign.cmp(&0))
    }
}
fn s(v: &str) -> WireValue {
    WireValue::String(v.into())
}
fn row(id: &str, values: Vec<(&str, WireValue)>) -> DatasetRow {
    DatasetRow {
        id: id.into(),
        values: values.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        group_path: None,
        cell_errors: None,
        cell_formats: None,
    }
}
fn key(v: &str) -> String {
    pivot_core::pivot::pivot_value_key(&s(v))
}
fn binding() -> FiscalBinding {
    serde_json::from_str(r#"{"companyFieldId":"company","dateFieldId":"date"}"#).unwrap()
}
fn definition() -> ValidatedDefinition {
    serde_json::from_str::<WireDefinition>(r#"{"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":"","analytical":{"schemaVersion":1,"enabled":true,"params":{"promotePage":true,"filters":[{"id":"p","categoryId":"s","label":"Scenario","multiSelect":true}]},"categories":[{"id":"s","name":"Scenario","sourceFieldId":"scenario","transform":"native"},{"id":"r","name":"Region","sourceFieldId":"region","transform":"native"},{"id":"y","name":"Year","sourceFieldId":"date","transform":"Y"},{"id":"q","name":"Quarter","sourceFieldId":"date","transform":"Q"}],"measures":[],"formulas":[],"layout":{"rows":[],"columns":[],"values":[],"page":{"categoryId":"s","memberKeys":["[\"string\",\"Actual\"]"]}},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}}}}"#).map(|v|ValidatedDefinition{analytical_recipe_source:None,locale:v.locale,definition:v.definition}).unwrap()
}
fn fixture() -> (CompiledModel, EvaluatedRows) {
    let cols = ["scenario", "region", "date", "company", "revenue"]
        .map(|id| serde_json::from_value(serde_json::json!({"id":id,"label":id})).unwrap());
    let mut definition = definition();
    definition.analytical_recipe_source = Some(tag(&serde_json::to_value(
        definition
            .definition
            .analytical
            .as_ref()
            .unwrap()
            .table()
            .unwrap(),
    )
    .unwrap()));
    let model = compile(&definition, &cols);
    let rows = [
        ("a", "Actual", "West", "2026-01-01"),
        ("b", "Budget", "West", "2026-01-01"),
        ("east", "Budget", "East", "2026-01-01"),
        ("old", "Budget", "West", "2025-01-01"),
    ]
    .map(|(id, scenario, region, date)| {
        row(
            id,
            vec![
                ("scenario", s(scenario)),
                ("region", s(region)),
                ("date", s(date)),
                ("company", s("ACME")),
                ("revenue", WireValue::F64(WireNumber::Finite(10.))),
            ],
        )
    });
    let eval = evaluate_source(&rows, &model);
    (model, eval)
}
fn scope() -> CalculationScope {
    CalculationScope {
        source_record_ids: BTreeSet::from(["a".into()]),
        category_constraints: CategoryConstraints::from([
            ("r".into(), key("West")),
            ("y".into(), key("2026")),
            ("q".into(), key("2026-Q1")),
        ]),
        page: Some(MemberConstraint {
            category_id: "s".into(),
            member_keys: vec![key("Actual")],
        }),
        temporal_context: TemporalContext {
            date_field_id: Some("date".into()),
            company_field_id: Some("company".into()),
            company_ids: Some(vec![s("ACME")]),
        },
        ..Default::default()
    }
}
fn select(id: &str, v: &str) -> MemberSelector {
    MemberSelector {
        category_id: id.into(),
        member_key: key(v),
    }
}
#[test]
fn per_company_fiscal_and_no_december_default() {
    let ctx: FiscalContext=serde_json::from_str(r#"{"companies":{"SEP":{"yearEndMonth":9,"source":"file"},"DEC":{"yearEndMonth":12,"source":"provider"}}}"#).unwrap();
    let a = resolve_fiscal_period(
        &row("a", vec![("company", s("SEP")), ("date", s("2025-10-01"))]),
        &binding(),
        &ctx,
    );
    assert_eq!(a.year.unwrap().label, "FY2026");
    assert_eq!(a.quarter.unwrap().end, "2025-12-31");
    let b = resolve_fiscal_period(
        &row(
            "b",
            vec![("company", s("UNKNOWN")), ("date", s("2026-01-01"))],
        ),
        &binding(),
        &ctx,
    );
    assert_eq!(b.year.unwrap_err().code, "fiscal-context");
}
#[test]
fn authoritative_stub_and_independent_quarter() {
    let mut b = binding();
    b.period_kind = Some(PeriodKind::FY);
    b.fiscal_year_field_id = Some("FY".into());
    b.fiscal_quarter_field_id = Some("FQ".into());
    b.period_start_field_id = Some("start".into());
    b.period_end_field_id = Some("end".into());
    let r = row(
        "stub",
        vec![
            ("company", s("A")),
            ("date", s("2026-06-01")),
            ("FY", s("FY2026")),
            ("FQ", s("Q5")),
            ("start", s("2026-04-01")),
            ("end", s("2026-09-30")),
        ],
    );
    let p = resolve_fiscal_period(&r, &b, &FiscalContext::default());
    assert_eq!(p.year.unwrap().start, "2026-04-01");
    assert_eq!(p.quarter.unwrap_err().code, "fiscal-context");
}
#[test]
fn scopes_replace_page_retain_context_and_distinguish_errors() {
    let (model, input) = fixture();
    let pool = eligible_pool(&input, &model, &RuntimeParams::new(), &Host);
    let resolved = resolve_member(&pool, &scope(), &[select("s", "Budget")]).unwrap();
    assert_eq!(resolved.source_record_ids, BTreeSet::from(["b".into()]));
    assert_eq!(
        resolved.temporal_context.company_ids,
        scope().temporal_context.company_ids
    );
    assert_eq!(
        resolve_member(
            &pool,
            &scope(),
            &[select("s", "Budget"), select("y", "2025")]
        )
        .unwrap_err()[0]
            .code,
        "no-counterpart"
    );
    assert_eq!(
        resolve_member(&pool, &scope(), &[select("s", "Forecast")]).unwrap_err()[0].code,
        "missing-member"
    );
    let runtime = RuntimeParams::from([(
        "pivot:filter:s".into(),
        RuntimeParam::Viewer {
            member_keys: Some(vec![key("Actual")]),
        },
    )]);
    let excluded = eligible_pool(&input, &model, &runtime, &Host);
    assert_eq!(
        resolve_member(&excluded, &scope(), &[select("s", "Budget")]).unwrap_err()[0].code,
        "excluded-member"
    );
    assert_eq!(pool.rows[0].id, "a");
    assert_eq!(pool.categories[2].source_field_id, "date");
}
#[test]
fn empty_scope_and_page_do_not_expand() {
    let (m, i) = fixture();
    let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    let mut empty = scope();
    empty.source_record_ids.clear();
    assert!(resolve_member(&p, &empty, &[select("s", "Budget")])
        .unwrap()
        .source_record_ids
        .is_empty());
    assert!(active_page(
        &p,
        Some(&MemberConstraint {
            category_id: "gone".into(),
            member_keys: vec![]
        })
    )
    .rows
    .is_empty());
}
#[test]
fn runtime_filter_survives_pivot_disabled() {
    let (mut m, i) = fixture();
    m.definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .enabled = false;
    let runtime = RuntimeParams::from([(
        "pivot:filter:s".into(),
        RuntimeParam::Viewer {
            member_keys: Some(vec![key("Budget")]),
        },
    )]);
    let p = eligible_pool(&i, &m, &runtime, &Host);
    assert_eq!(
        p.rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec!["b", "east", "old"]
    );
    assert!(p.page.is_none());
    assert!(p.classification_complete);
}
#[test]
fn group_resolution_typed_collisions_literal_ambiguity_and_budget() {
    let domain = vec![
        ("1".into(), vec!["number1".into(), "string1".into()]),
        ("ACME, Inc".into(), vec!["literal".into()]),
        ("ACME".into(), vec!["a".into()]),
        (" Inc".into(), vec!["b".into()]),
    ];
    assert_eq!(
        resolve_group_transport("1", &domain, true, 100000).keys,
        vec!["number1", "string1"]
    );
    assert_eq!(
        resolve_group_transport("ACME, Inc", &domain, true, 100000)
            .reason
            .as_deref(),
        Some("ambiguous")
    );
    assert_eq!(
        resolve_group_transport("1,none", &domain, false, 100000)
            .reason
            .as_deref(),
        Some("partial")
    );
    assert_eq!(
        resolve_group_transport("1,none", &domain, true, 0)
            .reason
            .as_deref(),
        Some("budget")
    );
}
#[test]
fn domain_typed_paging_and_unsupported_omissions() {
    let (m, _) = fixture();
    let i = evaluate_source(
        &[
            row("big", vec![("scenario", s(&"x".repeat(17000)))]),
            row("bool", vec![("scenario", WireValue::Bool(true))]),
            row(
                "int",
                vec![("scenario", WireValue::BigIntString("1".into()))],
            ),
            row("comma", vec![("scenario", s("ACME, Inc"))]),
        ],
        &m,
    );
    let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    let recipe = category_authoring_recipe(&m, "s", &Host).unwrap().unwrap();
    let first = member_domain(&p, "s", &recipe, 0, 1, None).unwrap();
    assert!(first.rows.is_empty());
    assert_eq!(first.next_offset, Some(1));
    assert_eq!(first.omitted_count, 2);
    let second = member_domain(&p, "s", &recipe, 1, 1, None).unwrap();
    assert_eq!(second.rows[0].value, WireValue::Bool(true));
}
#[test]
fn authoritative_evidence_refuses_month_approximation() {
    let (m, i) = fixture();
    let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    let e = collect_fiscal_evidence(&p, &BTreeSet::from(["a".into()]), "y");
    assert_eq!(e.errors[0].code, "fiscal-context");
}

#[test]
fn recipe_comparison_uses_default_collation_separate_from_pivot() {
    assert_eq!(
        pivot_core::ordering::ValueOrder::compare_recipe(&Host, "item2", "item10").unwrap(),
        std::cmp::Ordering::Greater
    );
}

fn tag(v: &serde_json::Value) -> WireValue {
    match v {
        serde_json::Value::Object(r) => {
            WireValue::Record(r.iter().map(|(k, v)| (k.clone(), tag(v))).collect())
        }
        serde_json::Value::Array(a) => WireValue::Array(a.iter().map(tag).collect()),
        serde_json::Value::String(s) => WireValue::String(s.clone()),
        serde_json::Value::Number(n) => WireValue::F64(WireNumber::Finite(n.as_f64().unwrap())),
        serde_json::Value::Bool(v) => WireValue::Bool(*v),
        serde_json::Value::Null => WireValue::Null,
    }
}
#[test]
fn authoring_refuses_absent_ordered_recipe_source() {
    let m = compile(&definition(), &[]);
    assert!(category_authoring_recipe(&m, "s", &Host).is_err());
}
#[test]
fn recipe_source_semantics_cannot_be_forged() {
    let mut d:WireDefinition=serde_json::from_value(serde_json::json!({"protocolVersion":1,"locale":"en-US","definition":definition().definition})).unwrap();
    let mut raw =
        serde_json::to_value(d.definition.analytical.as_ref().unwrap().table().unwrap()).unwrap();
    raw["categories"][0]["sourceFieldId"] = "forged".into();
    d.analytical_recipe_source = Some(tag(&raw));
    assert!(pivot_core::validation::validate_definition(&d).is_err());
}
fn get<'a>(v: &'a WireValue, key: &str) -> &'a WireValue {
    if let WireValue::Record(r) = v {
        r.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
            .unwrap_or(&WireValue::Missing)
    } else {
        &WireValue::Missing
    }
}
fn arr(v: &WireValue) -> &[WireValue] {
    if let WireValue::Array(a) = v {
        a
    } else {
        panic!("expected array")
    }
}
fn text(v: &WireValue) -> &str {
    if let WireValue::String(s) = v {
        s
    } else {
        panic!("expected text")
    }
}
fn fixture_pool(name: &str, runtime: &RuntimeParams) -> (WireValue, CompiledModel, EligiblePool) {
    let root: WireValue = serde_json::from_str(
        &std::fs::read_to_string(format!("../../src/test/fixtures/rust-pivot/{name}.json"))
            .unwrap(),
    )
    .unwrap();
    let case = get(&root, "case");
    let raw = get(case, "definition");
    let analytical = get(raw, "analytical").clone();
    let mut table = TableState::default();
    if let WireValue::Array(filters) = get(get(raw, "table"), "columnFilters") {
        table.column_filters = Some(
            filters
                .iter()
                .map(|f| SourceFilter {
                    id: text(get(f, "id")).into(),
                    value: get(f, "value").clone(),
                })
                .collect(),
        )
    }
    let definition = ValidatedDefinition {
        locale: "en-US".into(),
        analytical_recipe_source: Some(analytical.clone()),
        definition: TableDefinition {
            table,
            search: text(get(raw, "search")).into(),
            analytical: Some(
                serde_json::from_str(
                    &pivot_core::validation::ordered_recipe_json(&analytical).unwrap(),
                )
                .unwrap(),
            ),
        },
    };
    let ds = get(case, "dataset");
    let columns = arr(get(ds, "columns"))
        .iter()
        .map(|c| DatasetColumn {
            id: text(get(c, "id")).into(),
            label: text(get(c, "label")).into(),
            dtype: if let WireValue::String(s) = get(c, "dtype") {
                Some(s.clone())
            } else {
                None
            },
            format: None,
            source_field_id: None,
            measure_id: None,
            source_binding_id: None,
            split_path: None,
            aggregation: None,
            metadata: None,
            analytical: None,
        })
        .collect::<Vec<_>>();
    let fiscal =
        parse_fiscal_context(get(get(get(ds, "provenance"), "metadata"), "fiscalContext")).unwrap();
    let compiled = compile_with_fiscal(&definition, &columns, fiscal);
    let rows = arr(get(ds, "rows"))
        .iter()
        .map(|r| {
            let WireValue::Record(v) = get(r, "values") else {
                panic!("row values")
            };
            row(
                text(get(r, "id")),
                v.iter().map(|(k, v)| (k.as_str(), v.clone())).collect(),
            )
        })
        .collect::<Vec<_>>();
    let input = evaluate_source(&rows, &compiled);
    let pool = eligible_pool(&input, &compiled, runtime, &Host);
    (root, compiled, pool)
}
#[test]
fn frozen_member_refusal_messages_and_context() {
    for name in [
        "member-missing",
        "excluded-budget",
        "source-filter-excludes-budget",
        "member-no-counterpart",
    ] {
        let (root, m, p) = fixture_pool(name, &RuntimeParams::new());
        let model = m
            .definition
            .definition
            .analytical
            .as_ref()
            .unwrap()
            .table()
            .unwrap();
        let budget = model.formulas.iter().find(|f| f.id == "budget").unwrap();
        let FormulaAst::Member { selectors, .. } = &budget.ast else {
            panic!("member")
        };
        let mut scope = CalculationScope {
            source_record_ids: p.rows.iter().map(|r| r.id.clone()).collect(),
            page: p.page.clone(),
            ..Default::default()
        };
        let expected = if name == "member-no-counterpart" {
            let chart = arr(get(get(get(&root, "result"), "chart"), "rows"));
            get(get(&chart[0], "cellErrors"), "budget")
        } else {
            get(
                get(get(get(&root, "result"), "totals"), "cellErrors"),
                "budget",
            )
        };
        if name == "member-no-counterpart" {
            let first = p.rows.iter().find(|r| r.id == "a").unwrap();
            for c in &model.layout.rows {
                scope.category_constraints.insert(
                    c.clone(),
                    p.members[&first.id][c].as_ref().unwrap().key.clone(),
                );
            }
        }
        let errors = resolve_member(&p, &scope, selectors).unwrap_err();
        assert_eq!(errors[0].code, text(get(expected, "code")), "{name}");
        assert_eq!(errors[0].message, text(get(expected, "message")), "{name}");
    }
}
#[test]
fn frozen_runtime_domain_and_matches() {
    let (root, m, p) = fixture_pool("runtime-authoring-linked", &RuntimeParams::new());
    let operations = arr(get(get(&root, "result"), "operations"));
    let expected = get(&operations[0], "value");
    let recipe = text(get(expected, "categoryRecipe"));
    assert_eq!(
        category_authoring_recipe(&m, "regionCategory", &Host)
            .unwrap()
            .unwrap(),
        recipe
    );
    let domain = member_domain(&p, "regionCategory", recipe, 0, 50, None).unwrap();
    for (actual, expected) in domain.rows.iter().zip(arr(get(expected, "rows"))) {
        assert_eq!(actual.key, text(get(expected, "key")));
        assert_eq!(actual.value, *get(expected, "value"));
        assert_eq!(actual.label, text(get(expected, "label")));
    }
    let runtime = RuntimeParams::from([(
        "pivot:filter:regionCategory".into(),
        RuntimeParam::Group {
            group_id: "region-group".into(),
            transport_value: "A,missing".into(),
        },
    )]);
    let (_, _, pool) = fixture_pool("runtime-authoring-linked", &runtime);
    let expected = &arr(get(
        get(get(&operations[2], "value"), "inspection"),
        "paramMatches",
    ))[0];
    let actual = &pool.param_matches[0];
    assert_eq!(
        actual.matched_keys,
        arr(get(expected, "matchedKeys"))
            .iter()
            .map(|v| text(v).to_owned())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        actual.unmatched,
        arr(get(expected, "unmatched"))
            .iter()
            .map(|v| text(v).to_owned())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        pool.rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec!["r0", "r1"]
    );
}
#[test]
fn frozen_fiscal_group_keys_and_alignment_warning() {
    for name in ["mixed-fiscal-calendars", "company-fiscal-quarter"] {
        let (root, _, p) = fixture_pool(name, &RuntimeParams::new());
        let expected = arr(get(get(get(&root, "result"), "chart"), "rows"));
        let observed: Vec<_> = p.observed_members["year"]
            .iter()
            .map(|m| m.member.key.as_str())
            .collect();
        let expected_keys: Vec<_> = expected
            .iter()
            .map(|r| text(get(&arr(get(r, "groupPath"))[0], "memberKey")))
            .collect();
        assert_eq!(
            observed.into_iter().collect::<BTreeSet<_>>(),
            expected_keys.into_iter().collect::<BTreeSet<_>>()
        );
        if name == "mixed-fiscal-calendars" {
            assert!(p
                .warnings
                .iter()
                .any(|w| w.code == "fiscal-alignment" && w.periods.len() == 2));
        }
    }
}

#[test]
fn runtime_order_is_js_object_entries_and_rejects_duplicates() {
    let raw = r#"{"z":{"source":"viewer","memberKeys":null},"10":{"source":"viewer","memberKeys":null},"2":{"source":"viewer","memberKeys":null},"a":{"source":"viewer","memberKeys":null}}"#;
    let p: RuntimeParams = serde_json::from_str(raw).unwrap();
    assert_eq!(
        p.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(),
        vec!["2", "10", "z", "a"]
    );
    assert!(serde_json::from_str::<RuntimeParams>(
        r#"{"z":{"source":"viewer","memberKeys":null},"z":{"source":"viewer","memberKeys":null}}"#
    )
    .is_err());
    assert!(serde_json::from_str::<RuntimeParams>(r#"{"z":{"source":"viewer"}}"#).is_err());
}
#[test]
fn category_failed_source_keeps_blocked_dependency() {
    let (mut m, mut i) = fixture();
    i.formula_cells.entry("a".into()).or_default().insert(
        "scenario".into(),
        CellResult::Error(ModelError {
            record_ids_present: true,
            dependency_ids_present: false,
            code: "division-by-zero".into(),
            message: "Division by zero".into(),
            definition_id: "scenario".into(),
            record_ids: vec!["a".into()],
            dependency_ids: vec!["z".into()],
        }),
    );
    m.categories[0].source_field_id = "scenario".into();
    let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    let e = p.members["a"]["s"].as_ref().unwrap_err();
    assert_eq!(e.code, "blocked-dependency");
    assert_eq!(e.dependency_ids, vec!["scenario", "z"]);
    assert!(!p.universe.evaluated.rows[0].values.contains_key("s"));
}
#[test]
fn runtime_validation_refuses_before_calculation() {
    let (m, i) = fixture();
    let params = RuntimeParams::from([(
        "pivot:filter:s".into(),
        RuntimeParam::Viewer {
            member_keys: Some(vec![key("Actual"); 1025]),
        },
    )]);
    let p = eligible_pool(&i, &m, &params, &Host);
    assert!(p.rows.is_empty());
    assert_eq!(p.runtime_diagnostics[0].code, "INVALID_REQUEST");
    assert!(!p.classification_complete);
}
#[test]
fn scope_diagnostics_keep_constraint_insertion_order() {
    let (m, i) = fixture();
    let mut p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    for id in ["z", "a"] {
        p.categories.push(p.categories[0].clone());
        p.categories.last_mut().unwrap().id = id.into();
        p.members.get_mut("a").unwrap().insert(
            id.into(),
            Err(ModelError {
                record_ids_present: true,
                dependency_ids_present: false,
                code: "invalid-date".into(),
                message: id.into(),
                definition_id: id.into(),
                record_ids: vec!["a".into()],
                dependency_ids: vec![],
            }),
        );
    }
    p.rows.retain(|r| r.id == "a");
    let mut scope = CalculationScope {
        source_record_ids: BTreeSet::from(["a".into()]),
        ..Default::default()
    };
    scope.category_constraints.insert("z".into(), "k".into());
    scope.category_constraints.insert("a".into(), "k".into());
    assert_eq!(
        scope_errors(&p, &scope)
            .iter()
            .map(|e| e.definition_id.as_str())
            .collect::<Vec<_>>(),
        vec!["z", "a"]
    );
}

#[test]
fn runtime_preview_budget_preserves_early_entries() {
    let (mut m, _) = fixture();
    let raw = m
        .definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    raw.categories = (0..64)
        .map(|i| Category {
            id: format!("c{:02}", 63 - i),
            name: "Category".into(),
            source_field_id: "scenario".into(),
            transform: Transform::Native,
            fiscal_binding: None,
            legacy_bucket: None,
        })
        .collect();
    raw.params.filters = raw
        .categories
        .iter()
        .map(|c| FilterParam {
            id: c.id.clone(),
            category_id: c.id.clone(),
            label: c.name.clone(),
            multi_select: true,
        })
        .collect();
    raw.layout.page = None;
    m.categories = raw.categories.clone();
    m.definition.analytical_recipe_source = Some(tag(&serde_json::to_value(raw).unwrap()));
    let value = "x".repeat(15000);
    let input = evaluate_source(&[row("r", vec![("scenario", s(&value))])], &m);
    let params: RuntimeParams = m
        .categories
        .iter()
        .map(|c| {
            (
                format!("pivot:filter:{}", c.id),
                RuntimeParam::Viewer {
                    member_keys: Some(vec![key(&value)]),
                },
            )
        })
        .collect();
    let p = eligible_pool(&input, &m, &params, &Host);
    assert_eq!(
        p.param_matches
            .iter()
            .filter(|p| !p.matched_keys.is_empty())
            .map(|p| p.key.as_str())
            .collect::<Vec<_>>(),
        (56..64)
            .rev()
            .map(|i| format!("pivot:filter:c{i:02}"))
            .collect::<Vec<_>>()
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    );
    assert!(p
        .param_matches
        .iter()
        .skip(8)
        .all(|p| p.truncated && p.matched_count == 1));
}
#[test]
fn recipe_preserves_raw_binding_property_order() {
    let (mut m, _) = fixture();
    let WireValue::Record(raw) = m.definition.analytical_recipe_source.as_mut().unwrap() else {
        panic!()
    };
    let WireValue::Array(categories) =
        &mut raw.iter_mut().find(|(k, _)| k == "categories").unwrap().1
    else {
        panic!()
    };
    let WireValue::Record(c) = &mut categories[0] else {
        panic!()
    };
    let binding = WireValue::Record(vec![
        ("dateFieldId".into(), s("scenario")),
        ("companyFieldId".into(), s("company")),
    ]);
    c.push(("fiscalBinding".into(), binding));
    m.categories[0].fiscal_binding = Some(FiscalBinding {
        date_field_id: Some("scenario".into()),
        ..binding_from_company()
    });
    m.definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .categories = m.categories.clone();
    let recipe = category_authoring_recipe(&m, "s", &Host).unwrap().unwrap();
    assert!(recipe.contains(r#"{"dateFieldId":"scenario","companyFieldId":"company"}"#));
}
fn binding_from_company() -> FiscalBinding {
    binding()
}
#[test]
fn fiscal_recipe_preserves_host_collation_ties() {
    let context:FiscalContext=serde_json::from_str(r#"{"companies":{"é":{"source":"first","yearEndMonth":12},"é":{"source":"second","yearEndMonth":12}}}"#).unwrap();
    let recipe = pivot_core::categories::fiscal_context_recipe(None, &context, &Host).unwrap();
    assert!(recipe.find("first").unwrap() < recipe.find("second").unwrap());
}
#[test]
fn fiscal_authority_period_error_boundaries() {
    let ctx:FiscalContext=serde_json::from_str(r#"{"companies":{"A":{"source":"provider","calendar":"week","yearEndMonth":12,"periods":[{"kind":"FY","year":2026,"start":"2026-01-01T00:00:00+12:00","end":"2026-12-31T23:00:00-05:00","source":"annual"}]}}}"#).unwrap();
    let result = resolve_fiscal_period(
        &row("r", vec![("company", s("A")), ("date", s("2026-06-01"))]),
        &binding(),
        &ctx,
    );
    assert_eq!(result.year.unwrap().start, "2026-01-01");
    assert_eq!(result.quarter.unwrap_err().code, "fiscal-context");
    for date in ["2025-02-29", "2026-04-31", "0000-01-01", "2026-01-01x"] {
        assert!(period_date(&s(date)).is_none())
    }
    assert_eq!(
        period_date(&s("2024-02-29T99:99")),
        Some("2024-02-29".into())
    );
}
#[test]
fn retained_slices_union_company_and_fields() {
    let (m, i) = fixture();
    let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    let mut scope = scope();
    scope.category_constraints = CategoryConstraints::new();
    scope.context_slices = Some(vec![
        ContextSlice {
            categories: CategoryConstraints::from([
                ("r".into(), key("West")),
                ("y".into(), key("2026")),
            ]),
            company_ids: Some(vec![s("ACME")]),
        },
        ContextSlice {
            categories: CategoryConstraints::from([
                ("r".into(), key("West")),
                ("y".into(), key("2025")),
            ]),
            company_ids: Some(vec![s("ACME")]),
        },
    ]);
    let result = resolve_member(&p, &scope, &[select("s", "Budget")]).unwrap();
    assert_eq!(
        result.source_record_ids,
        BTreeSet::from(["b".into(), "old".into()])
    );
    scope
        .field_constraints
        .insert("date".into(), vec![s("2026-01-01")]);
    assert_eq!(
        resolve_member(&p, &scope, &[select("s", "Budget")]).unwrap_err()[0].code,
        "no-counterpart"
    );
}
#[test]
fn runtime_group_unmatched_and_empty_authored_diagnostics() {
    let runtime = RuntimeParams::from([(
        "pivot:filter:regionCategory".into(),
        RuntimeParam::Group {
            group_id: "region-group".into(),
            transport_value: "A,missing".into(),
        },
    )]);
    let (root, _, p) = fixture_pool("runtime-authoring-linked", &runtime);
    let expected = &arr(get(
        get(&arr(get(get(&root, "result"), "operations"))[2], "value"),
        "diagnostics",
    ))[0];
    let diagnostic = p
        .runtime_diagnostics
        .iter()
        .find(|d| d.code == "PIVOT_PARAM_UNMATCHED")
        .expect("unmatched warning");
    assert_eq!(diagnostic.message, text(get(expected, "message")));
    assert_eq!(diagnostic.member_keys, Some(vec!["missing".into()]));
    let (m, i) = fixture();
    let p = eligible_pool(
        &i,
        &m,
        &RuntimeParams::from([(
            "pivot:filter:s".into(),
            RuntimeParam::Viewer {
                member_keys: Some(vec![]),
            },
        )]),
        &Host,
    );
    assert!(p
        .runtime_diagnostics
        .iter()
        .any(|d| d.code == "PIVOT_PARAM_EMPTY"));
}
#[test]
fn fiscal_metadata_rejects_unsupported_extra_graph_values() {
    let raw = tag(
        &serde_json::json!({"companies":{"A":{"source":"provider","periods":[{"kind":"FY","year":2026,"start":"2026-01-01","end":"2026-12-31","source":"annual"}]}}}),
    );
    let mut raw = raw;
    let WireValue::Record(root) = &mut raw else {
        panic!()
    };
    let WireValue::Record(companies) = &mut root[0].1 else {
        panic!()
    };
    let WireValue::Record(company) = &mut companies[0].1 else {
        panic!()
    };
    let WireValue::Array(periods) =
        &mut company.iter_mut().find(|(k, _)| k == "periods").unwrap().1
    else {
        panic!()
    };
    let WireValue::Record(period) = &mut periods[0] else {
        panic!()
    };
    period.push(("opaque".into(), WireValue::BigIntString("1".into())));
    assert!(parse_fiscal_context(&raw).is_err());
}
#[test]
fn ordered_recipe_json_uses_integer_own_key_order() {
    let raw = WireValue::Record(vec![
        ("z".into(), s("a")),
        ("10".into(), s("b")),
        ("2".into(), s("c")),
    ]);
    assert_eq!(
        pivot_core::validation::ordered_recipe_json(&raw).unwrap(),
        r#"{"2":"c","10":"b","z":"a"}"#
    );
}
#[test]
fn source_search_uses_baseline_raw_cell_while_category_uses_declared_display() {
    let (mut m, _) = fixture();
    m.definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .enabled = false;
    m.definition.definition.search = "visible".into();
    m.columns[0].metadata = Some(std::collections::BTreeMap::from([(
        "cellField".into(),
        s("value"),
    )]));
    let i = evaluate_source(
        &[row(
            "r",
            vec![(
                "scenario",
                WireValue::Record(vec![("value".into(), s("visible"))]),
            )],
        )],
        &m,
    );
    let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    assert!(p.rows.is_empty());
    assert_eq!(p.observed_members["s"][0].member.value, s("visible"));
}

#[test]
fn observed_authoring_symbols_retain_typed_members() {
    let (m, i) = fixture();
    let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    let symbols = observed_symbols(&m, &p);
    assert_eq!(
        symbols
            .categories
            .iter()
            .find(|c| c.value.id == "s")
            .unwrap()
            .members,
        vec![
            (key("Actual"), Literal::String("Actual".into())),
            (key("Budget"), Literal::String("Budget".into()))
        ]
    );
    assert!(m.symbols.categories.iter().all(|c| c.members.is_empty()));
}
#[test]
fn authoring_recipe_preserves_raw_reachable_ast_order() {
    let mut d = definition();
    let raw = d
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    raw.categories[0].source_field_id = "src".into();
    raw.formulas.push(serde_json::from_str(r#"{"id":"src","name":"Source","scope":"source","expression":"Scenario","ast":{"id":"scenario","target":"field","kind":"reference"}}"#).unwrap());
    let mut source = tag(&serde_json::to_value(&raw).unwrap());
    let WireValue::Record(fields) = &mut source else {
        panic!()
    };
    let WireValue::Array(formulas) =
        &mut fields.iter_mut().find(|(k, _)| k == "formulas").unwrap().1
    else {
        panic!()
    };
    let WireValue::Record(formula) = &mut formulas[0] else {
        panic!()
    };
    formula.iter_mut().find(|(k, _)| k == "ast").unwrap().1 = WireValue::Record(vec![
        ("id".into(), s("scenario")),
        ("target".into(), s("field")),
        ("kind".into(), s("reference")),
    ]);
    d.analytical_recipe_source = Some(source);
    let m = compile(&d, &[]);
    let recipe = category_authoring_recipe(&m, "s", &Host).unwrap().unwrap();
    assert!(recipe.contains(r#"[["src",{"id":"scenario","target":"field","kind":"reference"}]]"#));
}
#[test]
fn annual_quarter_evidence_survives_parser_recipe_and_overlap() {
    let raw = tag(
        &serde_json::json!({"companies":{"A":{"source":"provider","periods":[{"kind":"FY","year":2026,"quarter":"Q1","start":"2026-01-01","end":"2026-12-31","source":"annual"},{"kind":"FY","year":2026,"quarter":"Q2","start":"2026-01-01","end":"2026-12-31","source":"annual"}]}}}),
    );
    let context = parse_fiscal_context(&raw).unwrap();
    let result = resolve_fiscal_period(
        &row("r", vec![("company", s("A")), ("date", s("2026-06-01"))]),
        &binding(),
        &context,
    );
    let error = result.year.unwrap_err();
    assert_eq!(error.code, "fiscal-context");
    assert_eq!(
        error.message,
        "Authoritative fiscal periods overlap ambiguously."
    );
    let recipe = pivot_core::categories::fiscal_context_recipe(None, &context, &Host).unwrap();
    assert!(recipe.contains("\"Q1\""));
    assert!(recipe.contains("\"Q2\""));
}
#[test]
fn original_recipe_graph_counts_missing_and_array_length() {
    let model = definition()
        .definition
        .analytical
        .unwrap()
        .table()
        .unwrap()
        .clone();
    let mut source = tag(&serde_json::to_value(&model).unwrap());
    let WireValue::Record(entries) = &mut source else {
        panic!()
    };
    entries.extend((0..50000).map(|i| (format!("omitted{i}"), WireValue::Missing)));
    assert!(pivot_core::validation::validate_recipe_source(&source, &model).is_err());
    let nested = WireValue::Array(vec![WireValue::Array(vec![]); 25000]);
    assert!(pivot_core::validation::ordered_recipe_json(&nested).is_err());
}
#[test]
fn source_numeric_bounds_use_js_hex_and_singleton_array() {
    for bound in [
        s("0x10"),
        WireValue::Array(vec![WireValue::F64(WireNumber::Finite(16.))]),
    ] {
        let (mut m, _) = fixture();
        m.definition.definition.table.column_filters = Some(vec![SourceFilter {
            id: "revenue".into(),
            value: WireValue::Record(vec![("min".into(), bound)]),
        }]);
        let i = evaluate_source(
            &[
                row(
                    "ten",
                    vec![("revenue", WireValue::F64(WireNumber::Finite(10.)))],
                ),
                row(
                    "twenty",
                    vec![("revenue", WireValue::F64(WireNumber::Finite(20.)))],
                ),
            ],
            &m,
        );
        let p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
        assert_eq!(
            p.rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["twenty"]
        );
    }
}
#[test]
fn original_recipe_graph_exact_node_and_depth_boundaries() {
    let own = |n| {
        WireValue::Record(
            (0..n)
                .map(|i| (format!("p{i}"), WireValue::Missing))
                .collect(),
        )
    };
    assert_eq!(
        pivot_core::validation::ordered_recipe_json(&own(49999)).unwrap(),
        "{}"
    );
    assert!(pivot_core::validation::ordered_recipe_json(&own(50000)).is_err());
    assert!(
        pivot_core::validation::ordered_recipe_json(&WireValue::Array(vec![
            WireValue::Array(
                vec![]
            );
            24999
        ]))
        .is_ok()
    );
    assert!(
        pivot_core::validation::ordered_recipe_json(&WireValue::Array(vec![
            WireValue::Array(
                vec![]
            );
            25000
        ]))
        .is_err()
    );
    let chain = |n| {
        let mut value = WireValue::Array(vec![]);
        for _ in 1..n {
            value = WireValue::Array(vec![value]);
        }
        value
    };
    assert!(pivot_core::validation::ordered_recipe_json(&chain(256)).is_ok());
    assert!(pivot_core::validation::ordered_recipe_json(&chain(257)).is_err());
}
fn numeric_filter_baseline(
    cells: &[WireValue],
    bound: &WireValue,
    side: &str,
) -> (Vec<usize>, Option<String>) {
    static BUNDLE: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    let path = BUNDLE.get_or_init(|| {
        let path = std::env::temp_dir().join(format!(
            "pivot-numeric-filter-baseline-{}.cjs",
            std::process::id()
        ));
        let output = std::process::Command::new("../../node_modules/.bin/esbuild")
            .args([
                "../../src/lib/tableFiltering.ts",
                "--bundle",
                "--platform=node",
                "--format=cjs",
            ])
            .arg(format!("--outfile={}", path.display()))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        path
    });
    let script = r#"const {filterFnFor}=require(process.argv[1]);const decode=v=>{switch(v.tag){case'missing':return undefined;case'null':return null;case'bool':case'string':return v.value;case'f64':return typeof v.value==='number'?v.value:({'NaN':NaN,'Infinity':Infinity,'-Infinity':-Infinity,'-0':-0})[v.value];case'bigint-string':return BigInt(v.value);case'array':return v.value.map(decode);case'record':return Object.fromEntries(v.value.map(([k,v])=>[k,decode(v)]));}};const [cells,bound,side]=JSON.parse(process.argv[2]);try{const filter=filterFnFor('number');const ids=cells.map((v,i)=>[decode(v),i]).filter(([v])=>filter({getValue:()=>v},'value',{[side]:decode(bound)})).map(([,i])=>i);process.stdout.write(JSON.stringify([ids,null]));}catch(error){process.stdout.write(JSON.stringify([[],error.message]));}"#;
    let output = std::process::Command::new("node")
        .arg("-e")
        .arg(script)
        .arg(path)
        .arg(serde_json::to_string(&(cells, bound, side)).unwrap())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}
#[test]
fn numeric_source_filter_coercion_matches_actual_baseline() {
    let cells = [
        f64::NEG_INFINITY,
        -1e20,
        -9007199254740992.,
        -20.,
        -1.5,
        -0.,
        0.,
        f64::from_bits(1),
        0.5,
        10.,
        16.,
        20.,
        9007199254740992.,
        1e20,
        f64::MAX,
        f64::NAN,
        f64::INFINITY,
    ]
    .map(|n| {
        if n.is_nan() {
            WireValue::F64(WireNumber::Special(SpecialNumber::Nan))
        } else if n == f64::INFINITY {
            WireValue::F64(WireNumber::Special(SpecialNumber::PositiveInfinity))
        } else if n == f64::NEG_INFINITY {
            WireValue::F64(WireNumber::Special(SpecialNumber::NegativeInfinity))
        } else if n == 0. && n.is_sign_negative() {
            WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero))
        } else {
            WireValue::F64(WireNumber::Finite(n))
        }
    });
    let mut bounds = vec![
        WireValue::Null,
        WireValue::Missing,
        WireValue::Bool(true),
        WireValue::Bool(false),
        WireValue::Array(vec![]),
        WireValue::Array(vec![WireValue::F64(WireNumber::Finite(16.))]),
        WireValue::Array(vec![WireValue::Array(vec![s("16")])]),
        WireValue::Array(vec![WireValue::Null]),
        WireValue::Array(vec![WireValue::Missing]),
        WireValue::Array(vec![WireValue::Bool(true)]),
        WireValue::Array(vec![
            WireValue::F64(WireNumber::Finite(1.)),
            WireValue::F64(WireNumber::Finite(2.)),
        ]),
        WireValue::Record(vec![]),
        WireValue::Record(vec![(
            "valueOf".into(),
            WireValue::F64(WireNumber::Finite(16.)),
        )]),
        WireValue::Record(vec![("toString".into(), WireValue::Missing)]),
        WireValue::Array(vec![WireValue::Record(vec![(
            "toString".into(),
            WireValue::Null,
        )])]),
        WireValue::F64(WireNumber::Special(SpecialNumber::Nan)),
        WireValue::F64(WireNumber::Special(SpecialNumber::PositiveInfinity)),
        WireValue::F64(WireNumber::Special(SpecialNumber::NegativeInfinity)),
    ];
    bounds.extend(
        [
            "0x10",
            "0X10",
            "0b10000",
            "0B10000",
            "0o20",
            "0O20",
            " \u{feff}16\u{2029} ",
            "\u{85}16",
            "\u{feff}-0\u{feff}",
            "",
            "+Infinity",
            "-Infinity",
            "Infinity",
            "INFINITY",
            "inf",
            "0x",
            "+0x10",
            "-0b10",
            "0o8",
            ".5",
            "16.",
            "16e-0",
            "1e309",
            "1e-9999",
            "01",
            "0x20000000000001",
            "0x20000000000003",
            "9007199254740993",
        ]
        .map(s),
    );
    bounds.extend(
        [
            "0",
            "16",
            "-16",
            "9007199254740993",
            "-9007199254740993",
            "100000000000000000001",
        ]
        .map(|s| WireValue::BigIntString(s.into())),
    );
    bounds.push(WireValue::BigIntString("9".repeat(400)));
    bounds.push(WireValue::Array(vec![WireValue::BigIntString(
        "9007199254740993".into(),
    )]));
    for side in ["min", "max"] {
        for bound in &bounds {
            let (expected, error) = numeric_filter_baseline(&cells, bound, side);
            let (mut model, _) = fixture();
            model.definition.definition.table.column_filters = Some(vec![SourceFilter {
                id: "revenue".into(),
                value: WireValue::Record(vec![(side.into(), bound.clone())]),
            }]);
            let raw = WireDefinition {
                protocol_version: 1,
                locale: model.definition.locale.clone(),
                definition: model.definition.definition.clone(),
                analytical_recipe_source: model.definition.analytical_recipe_source.clone(),
            };
            assert!(pivot_core::validation::validate_definition(&raw).is_ok());
            let rows = cells
                .iter()
                .enumerate()
                .map(|(i, v)| row(&format!("r{i}"), vec![("revenue", v.clone())]))
                .collect::<Vec<_>>();
            let input = evaluate_source(&rows, &model);
            let pool = eligible_pool(&input, &model, &RuntimeParams::new(), &Host);
            if let Some(message) = error {
                assert!(pool.rows.is_empty(), "{side}/{bound:?}");
                assert!(!pool.classification_complete);
                assert!(
                    pool.runtime_diagnostics
                        .iter()
                        .any(|d| d.message == message),
                    "{side}/{bound:?}: {}",
                    message
                );
            } else {
                let actual = pool
                    .rows
                    .iter()
                    .map(|r| r.id[1..].parse::<usize>().unwrap())
                    .collect::<Vec<_>>();
                assert_eq!(actual, expected, "{side}/{bound:?}");
            }
        }
    }
}
fn annual_context(quarters: [WireValue; 2]) -> WireValue {
    WireValue::Record(vec![(
        "companies".into(),
        WireValue::Record(vec![(
            "A".into(),
            WireValue::Record(vec![
                ("source".into(), s("provider")),
                (
                    "periods".into(),
                    WireValue::Array(
                        quarters
                            .into_iter()
                            .map(|quarter| {
                                WireValue::Record(vec![
                                    ("kind".into(), s("FY")),
                                    ("year".into(), WireValue::F64(WireNumber::Finite(2026.))),
                                    ("quarter".into(), quarter),
                                    ("start".into(), s("2026-01-01")),
                                    ("end".into(), s("2026-12-31")),
                                    ("source".into(), s("annual")),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ]),
        )]),
    )])
}
#[test]
fn annual_quarter_scalars_use_strict_equality_and_explicit_compound_boundary() {
    let report = row("r", vec![("company", s("A")), ("date", s("2026-06-01"))]);
    for (a, b, equal) in [
        (WireValue::Missing, WireValue::Missing, true),
        (WireValue::Null, WireValue::Missing, false),
        (
            WireValue::Bool(false),
            WireValue::F64(WireNumber::Finite(0.)),
            false,
        ),
        (s("1"), WireValue::F64(WireNumber::Finite(1.)), false),
        (
            WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero)),
            WireValue::F64(WireNumber::Finite(0.)),
            true,
        ),
        (WireValue::Bool(true), WireValue::Bool(true), true),
    ] {
        let context = parse_fiscal_context(&annual_context([a, b])).unwrap();
        assert_eq!(
            resolve_fiscal_period(&report, &binding(), &context)
                .year
                .is_ok(),
            equal
        );
    }
    let issue = parse_fiscal_context(&annual_context([
        WireValue::Array(vec![]),
        WireValue::Record(vec![]),
    ]))
    .unwrap_err();
    assert_eq!(issue[0].code, "fiscal-context");
    assert!(issue[0].message.contains("object-reference identity"));
    let mut context = parse_fiscal_context(&annual_context([s("Q1"), s("Q1")])).unwrap();
    let companies = context.companies.take().unwrap();
    context.companies = Some(
        companies
            .iter()
            .map(|(k, c)| {
                let mut c = c.clone();
                for p in &mut c.periods {
                    p.quarter_evidence =
                        Some(WireValue::F64(WireNumber::Special(SpecialNumber::Nan)));
                }
                (k.clone(), c)
            })
            .collect(),
    );
    assert_eq!(
        resolve_fiscal_period(&report, &binding(), &context)
            .year
            .unwrap_err()
            .message,
        "Authoritative fiscal periods overlap ambiguously."
    );
}
#[test]
fn quarterly_metadata_still_requires_numeric_integer_one_through_four() {
    for quarter in [
        s("1"),
        WireValue::Bool(true),
        WireValue::Null,
        WireValue::F64(WireNumber::Finite(1.5)),
        WireValue::F64(WireNumber::Finite(5.)),
    ] {
        let mut raw = annual_context([quarter.clone(), quarter]);
        let WireValue::Record(root) = &mut raw else {
            panic!()
        };
        let WireValue::Record(companies) = &mut root[0].1 else {
            panic!()
        };
        let WireValue::Record(company) = &mut companies[0].1 else {
            panic!()
        };
        let WireValue::Array(periods) = &mut company[1].1 else {
            panic!()
        };
        for period in periods {
            let WireValue::Record(fields) = period else {
                panic!()
            };
            fields[0].1 = s("FQ");
        }
        assert!(parse_fiscal_context(&raw).is_err());
    }
}
#[test]
fn baseline_structured_clone_normalizes_null_prototype_bounds() {
    let script="const original=Object.create(null); const cloned=structuredClone(original);if(Object.getPrototypeOf(cloned)!==Object.prototype||!Number.isNaN(Number(cloned)))process.exit(1);cloned.toString=undefined;const retained=structuredClone(cloned);try{Number(retained);process.exit(2);}catch(error){if(!(error instanceof TypeError))process.exit(3);}";
    let output = std::process::Command::new("node")
        .arg("-e")
        .arg(script)
        .output()
        .unwrap();
    assert!(output.status.success());
}
fn assert_compound_fy_recipe_refuses(evidence: WireValue) {
    let context = FiscalContext {
        companies: Some(
            [(
                "A".into(),
                FiscalCompanyContext {
                    year_end_month: None,
                    calendar: None,
                    source: "provider".into(),
                    periods: vec![FiscalPeriod {
                        kind: PeriodKind::FY,
                        year: 2026,
                        quarter: None,
                        quarter_evidence: Some(evidence),
                        start: "2026-01-01".into(),
                        end: "2026-12-31".into(),
                        source: "annual".into(),
                    }],
                },
            )]
            .into_iter()
            .collect(),
        ),
        metadata: None,
        overrides: None,
    };
    let recipe = pivot_core::categories::fiscal_context_recipe(None, &context, &Host).unwrap_err();
    let resolution = resolve_fiscal_period(
        &row("r", vec![("company", s("A")), ("date", s("2026-06-01"))]),
        &binding(),
        &context,
    )
    .year
    .unwrap_err();
    assert_eq!(recipe.code, "fiscal-context");
    assert_eq!(recipe.code, resolution.code);
    assert_eq!(recipe.message, resolution.message);
    assert_eq!(recipe.message,"Compound FY quarter evidence requires object-reference identity, which this wire contract does not preserve.");
}
#[test]
fn compound_fy_recipe_array_refuses_direct_typed_context() {
    assert_compound_fy_recipe_refuses(WireValue::Array(vec![]));
}
#[test]
fn compound_fy_recipe_record_refuses_direct_typed_context() {
    assert_compound_fy_recipe_refuses(WireValue::Record(vec![]));
}

#[test]
fn indexed_scope_errors_keep_first_universe_row_and_absent_ids() {
    let (m, i) = fixture();
    let mut p = eligible_pool(&i, &m, &RuntimeParams::new(), &Host);
    let mut first = p.universe.evaluated.rows[0].clone();
    first.values.insert("company".into(), s("EXCLUDED"));
    p.universe.evaluated.rows.insert(0, first);
    p.qualification_errors = vec![ModelError {
        record_ids_present: true,
        dependency_ids_present: false,
        code: "test".into(),
        message: "ordered".into(),
        definition_id: "f".into(),
        record_ids: vec!["a".into(), "absent".into(), "b".into()],
        dependency_ids: vec![],
    }];
    let scope = CalculationScope {
        temporal_context: TemporalContext {
            company_field_id: Some("company".into()),
            company_ids: Some(vec![s("ACME")]),
            ..Default::default()
        },
        ..Default::default()
    };
    let errors = scope_errors(&p, &scope);
    assert_eq!(errors[0].record_ids, vec!["absent", "b"]);
}
#[test]
fn null_date_source_filter_throws_like_the_baseline() {
    // TS: `const { from, to } = value` throws on null once the cell is a string.
    let message = "Cannot destructure property 'from' of 'value' as it is null.";
    let (mut model, _) = fixture();
    model.definition.definition.table.column_filters = Some(vec![SourceFilter {
        id: "date".into(),
        value: WireValue::Null,
    }]);
    let raw = WireDefinition {
        protocol_version: 1,
        locale: model.definition.locale.clone(),
        definition: model.definition.definition.clone(),
        analytical_recipe_source: model.definition.analytical_recipe_source.clone(),
    };
    assert!(pivot_core::validation::validate_definition(&raw).is_ok());
    let rows = vec![row("r", vec![("date", s("2026-01-01"))])];
    let input = evaluate_source(&rows, &model);
    let pool = eligible_pool(&input, &model, &RuntimeParams::new(), &Host);
    assert!(pool.rows.is_empty());
    assert!(!pool.classification_complete);
    assert!(
        pool.runtime_diagnostics
            .iter()
            .any(|d| d.message == message),
        "{:?}",
        pool.runtime_diagnostics
    );
}
