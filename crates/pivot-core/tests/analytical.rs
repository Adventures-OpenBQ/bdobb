// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{analytical::*, contract::*};
use support::*;
#[test]
fn frozen_analytical_cells_and_recalculated_totals() {
    for name in [
        "ratio-source-scope",
        "analytical-all-operators",
        "analytical-source-split",
        "scoped-result-filters",
        "member-missing",
        "excluded-budget",
        "source-filter-excludes-budget",
        "member-no-counterpart",
        "runtime-page-viewer",
        "pivot-off-source-safe",
        "empty-analytical",
        "company-fiscal-quarter",
        "mixed-fiscal-calendars",
        "missing-input",
        "authoring-refusal",
    ] {
        let (root, input, definition, runtime) = fixture(name);
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
        assert_descriptors(&view, &root, name);
        assert_values(
            &view.totals.values,
            get(get(get(&root, "result"), "totals"), "values"),
            name,
        );
        assert_eq!(
            serde_json::to_value(&view.totals.cell_errors).unwrap(),
            plain(get(get(get(&root, "result"), "totals"), "cellErrors")),
            "{name} totalErrors"
        );
        let expected = arr(get(get(get(&root, "result"), "chart"), "rows"));
        assert_eq!(view.eligible_rows.len(), expected.len(), "{name}");
        for (actual, expected) in view.eligible_rows.iter().zip(expected) {
            assert_eq!(actual.id, text(get(expected, "id")), "{name}");
            let displayed = actual
                .values
                .iter()
                .filter(|(id, _)| view.columns.iter().any(|c| &c.id == *id))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            assert_values(&displayed, get(expected, "values"), name);
        }
    }
}

#[test]
fn frozen_analytical_columns_formats_completeness() {
    for name in [
        "analytical-all-operators",
        "analytical-source-split",
        "pivot-off-source-safe",
        "mixed-fiscal-calendars",
        "company-fiscal-quarter",
    ] {
        let (root, input, definition, runtime) = fixture(name);
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
        assert_descriptors(&view, &root, name);
    }
}
#[test]
fn configured_measure_with_unavailable_source_is_a_binding_error() {
    let (_, input, mut d, runtime) = fixture("ratio-source-scope");
    let a = d
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    a.formulas.clear();
    a.measures = vec![Measure {
        id: "broken".into(),
        source_field_id: "absent".into(),
        aggregation: Some(Aggregation::Sum),
        custom_label: None,
    }];
    a.layout.values = vec!["broken".into()];
    refresh_recipe(&mut d);
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    assert_eq!(
        view.totals.cell_errors.as_ref().unwrap()["broken"].code,
        "missing-reference"
    );
    assert_eq!(
        view.totals.cell_errors.as_ref().unwrap()["broken"].message,
        "Missing reference: absent."
    );
}
#[test]
fn count_producer_strings_normalize_only_with_operator_metadata() {
    let (_, mut input, mut d, runtime) = fixture("ratio-source-scope");
    input
        .columns
        .iter_mut()
        .find(|c| c.id == "x")
        .unwrap()
        .aggregation = Some(Aggregation::Count);
    input.rows[0]
        .values
        .insert("x".into(), WireValue::String("2".into()));
    input.rows[1]
        .values
        .insert("x".into(), WireValue::String("3".into()));
    let a = d
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    a.formulas=vec![serde_json::from_value(serde_json::json!({"id":"sumCounts","name":"Counts","scope":"aggregate","expression":"","ast":{"kind":"call","function":"sum","args":[{"kind":"reference","target":"field","id":"x"}]}})).unwrap()];
    a.layout.values = vec!["sumCounts".into()];
    refresh_recipe(&mut d);
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    assert_eq!(
        view.totals.values["sumCounts"],
        WireValue::F64(WireNumber::Finite(5.))
    );
    input
        .columns
        .iter_mut()
        .find(|c| c.id == "x")
        .unwrap()
        .aggregation = None;
    let raw = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    assert_eq!(raw.totals.values["sumCounts"], WireValue::Missing);
}
#[test]
fn aggregate_provenance_traces_only_visited_source_dependencies_in_order() {
    let (_, mut input, mut d, runtime) = fixture("ratio-source-scope");
    for row in &mut input.rows {
        row.values.insert("condition".into(), WireValue::Bool(true));
    }
    input.columns.push(
        serde_json::from_value(serde_json::json!({"id":"condition","label":"Condition"})).unwrap(),
    );
    let a = d
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    a.formulas=serde_json::from_value(serde_json::json!([
 {"id":"chosen","name":"Chosen","scope":"source","expression":"","ast":{"kind":"call","function":"IF","args":[{"kind":"reference","target":"field","id":"condition"},{"kind":"reference","target":"field","id":"x"},{"kind":"reference","target":"field","id":"y"}]}},
 {"id":"chosenTotal","name":"Total","scope":"aggregate","expression":"","ast":{"kind":"call","function":"sum","args":[{"kind":"reference","target":"formula","id":"chosen"}]}}
 ])).unwrap();
    a.layout.values = vec!["chosenTotal".into()];
    refresh_recipe(&mut d);
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    let meta = &view.calculated_totals.formulas.metadata["chosenTotal"];
    assert_eq!(
        meta.source_columns
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        vec!["chosen", "condition", "x"]
    );
    assert_eq!(meta.scopes.len(), 1);
    assert_eq!(
        view.totals.values["chosenTotal"],
        WireValue::F64(WireNumber::Finite(6.))
    );
}

#[test]
fn frozen_runtime_group_apply_filters_native_calculation_before_selection() {
    let (root, input, d, _) = fixture("runtime-authoring-linked");
    let apply = arr(get(get(&root, "case"), "operations"))
        .iter()
        .find(|op| text(get(op, "kind")) == "apply")
        .unwrap();
    let runtime = serde_json::from_value(plain(get(apply, "runtimeParams"))).unwrap();
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    assert_eq!(
        view.record_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["r0", "r1"]
    );
    for expected in arr(get(get(get(&root, "result"), "chart"), "rows")) {
        let actual = view
            .eligible_rows
            .iter()
            .find(|r| r.id == text(get(expected, "id")))
            .unwrap();
        let displayed = actual
            .values
            .iter()
            .filter(|(id, _)| view.columns.iter().any(|c| &c.id == *id))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        assert_values(
            &displayed,
            get(expected, "values"),
            "runtime-authoring-linked",
        );
    }
}
#[test]
fn incoming_invalid_count_error_names_only_affected_record() {
    let (_, mut input, mut d, runtime) = fixture("ratio-source-scope");
    input
        .columns
        .iter_mut()
        .find(|c| c.id == "x")
        .unwrap()
        .aggregation = Some(Aggregation::Count);
    input.rows[0]
        .values
        .insert("x".into(), WireValue::String("not count".into()));
    input.rows[1]
        .values
        .insert("x".into(), WireValue::String("3".into()));
    let a = d
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    a.formulas=vec![serde_json::from_value(serde_json::json!({"id":"sumCounts","name":"Counts","scope":"aggregate","expression":"","ast":{"kind":"call","function":"sum","args":[{"kind":"reference","target":"field","id":"x"}]}})).unwrap()];
    a.layout.values = vec!["sumCounts".into()];
    refresh_recipe(&mut d);
    let view = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host).unwrap();
    let error = &view.totals.cell_errors.as_ref().unwrap()["sumCounts"];
    assert_eq!(error.affected_record_count, Some(1));
    assert_eq!(error.record_preview, Some(vec!["a".into()]));
}
#[test]
fn forged_ordered_recipe_evidence_refuses_the_view() {
    let (_, input, mut d, runtime) = fixture("ratio-source-scope");
    let WireValue::Record(raw) = d.analytical_recipe_source.as_mut().unwrap() else {
        panic!("record")
    };
    let (_, version) = raw.iter_mut().find(|(k, _)| k == "schemaVersion").unwrap();
    *version = WireValue::F64(WireNumber::Finite(17.));
    let error = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host)
        .expect_err("recipe refusal");
    assert_eq!(error.code, "INVALID_REQUEST");
}
#[test]
fn manually_constructed_unknown_saved_version_refuses_calculation() {
    let (_, input, mut d, runtime) = fixture("ratio-source-scope");
    d.definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .schema_version = 77;
    let error = calculate_view(&input, &d, &SelectionSpec::None, &runtime, &Host)
        .expect_err("unsupported schema");
    assert_eq!(error.code, "unsupported-schema");
}

fn sum_input_fixture() -> (SourceDataset, ValidatedDefinition, RuntimeParams) {
    let (_, mut input, mut definition, runtime) = fixture("ratio-source-scope");
    input.rows[0].id = "z".into();
    input.rows[1].id = "a".into();
    for row in &mut input.rows {
        row.values
            .insert("region".into(), WireValue::String("A".into()));
    }
    let a = definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    a.formulas = vec![serde_json::from_value(serde_json::json!({"id":"sumX","name":"Sum X","scope":"aggregate","expression":"","ast":{"kind":"call","function":"sum","args":[{"kind":"reference","target":"field","id":"x"}]}})).unwrap()];
    a.layout.values = vec!["sumX".into()];
    refresh_recipe(&mut definition);
    (input, definition, runtime)
}

#[test]
fn result_filter_error_preserves_source_order_in_compact_preview() {
    let (mut input, mut definition, runtime) = sum_input_fixture();
    let seed = input.rows[0].clone();
    input.rows = ["z", "a", "y", "b", "x", "c", "w"]
        .into_iter()
        .map(|id| {
            let mut row = seed.clone();
            row.id = id.into();
            row.values.insert("x".into(), WireValue::Null);
            row
        })
        .collect();
    let a = definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    a.result_filters=vec![serde_json::from_value(serde_json::json!({"id":"qualify","categoryId":"regionCategory","target":{"kind":"formula","id":"sumX"},"predicate":"gt","value":1})).unwrap()];
    refresh_recipe(&mut definition);
    let view = calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
    let error = view
        .errors
        .iter()
        .find(|e| e.definition_id == "qualify")
        .unwrap();
    assert_eq!(error.code, "invalid-type");
    assert_eq!(
        error.message,
        "Result predicate requires compatible scalar values."
    );
    assert_eq!(error.record_ids, vec!["z", "a", "y", "b", "x", "c", "w"]);
    let compact = compact_cell_error(error).unwrap();
    assert_eq!(compact.affected_record_count, Some(7));
    assert_eq!(
        compact.record_preview,
        Some(vec![
            "z".into(),
            "a".into(),
            "y".into(),
            "b".into(),
            "x".into()
        ])
    );
    assert_eq!(compact.dependency_ids, None);
}

#[test]
fn aggregate_total_and_group_errors_preserve_upstream_dependencies() {
    let (mut input, definition, runtime) = sum_input_fixture();
    input.rows[0].cell_errors=Some(std::collections::BTreeMap::from([("x".into(),serde_json::from_value(serde_json::json!({"code":"invalid-type","message":"Upstream bad","dependencyIds":["upstream","x","upstream","later"]})).unwrap())]));
    let view = calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
    let total = &view.totals.cell_errors.as_ref().unwrap()["sumX"];
    let grouped = &view.eligible_rows[0].cell_errors.as_ref().unwrap()["sumX"];
    for error in [total, grouped] {
        assert_eq!(error.code, "blocked-dependency");
        assert_eq!(error.message, "Upstream bad");
        assert_eq!(
            error.dependency_ids,
            Some(vec!["x".into(), "upstream".into(), "later".into()])
        );
        assert_eq!(error.affected_record_count, Some(1));
        assert_eq!(error.record_preview, Some(vec!["z".into()]));
    }
}

#[test]
fn aggregate_error_dependencies_follow_only_the_visited_if_branch() {
    let (mut input, mut definition, runtime) = sum_input_fixture();
    input.rows[0].cell_errors=Some(std::collections::BTreeMap::from([
        ("x".into(),serde_json::from_value(serde_json::json!({"code":"invalid-type","message":"Bad x","dependencyIds":["from-x"]})).unwrap()),
        ("y".into(),serde_json::from_value(serde_json::json!({"code":"invalid-type","message":"Bad y","dependencyIds":["from-y"]})).unwrap()),
    ]));
    for selected in [true, false] {
        let a = definition
            .definition
            .analytical
            .as_mut()
            .unwrap()
            .table_mut()
            .unwrap();
        a.formulas[0].ast=serde_json::from_value(serde_json::json!({"kind":"call","function":"sum","args":[{"kind":"call","function":"IF","args":[{"kind":"literal","value":selected},{"kind":"reference","target":"field","id":"x"},{"kind":"reference","target":"field","id":"y"}]}]})).unwrap();
        refresh_recipe(&mut definition);
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
        let field = if selected { "x" } else { "y" };
        let upstream = if selected { "from-x" } else { "from-y" };
        for error in [
            &view.totals.cell_errors.as_ref().unwrap()["sumX"],
            &view.eligible_rows[0].cell_errors.as_ref().unwrap()["sumX"],
        ] {
            assert_eq!(
                error.dependency_ids,
                Some(vec![field.into(), upstream.into()])
            );
        }
        assert_eq!(
            view.calculated_totals.formulas.metadata["sumX"]
                .source_columns
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>(),
            vec![field]
        );
    }
}

#[test]
fn aggregate_upstream_missing_and_empty_dependency_lists_preserve_field_evidence() {
    for dependencies in [None, Some(vec![])] {
        let (mut input, definition, runtime) = sum_input_fixture();
        input.rows[0].cell_errors = Some(std::collections::BTreeMap::from([(
            "x".into(),
            CellError {
                code: "invalid-type".into(),
                message: "Upstream bad".into(),
                definition_id: None,
                dependency_ids: dependencies.clone(),
                affected_record_count: None,
                record_preview: None,
            },
        )]));
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
        for error in [
            &view.totals.cell_errors.as_ref().unwrap()["sumX"],
            &view.eligible_rows[0].cell_errors.as_ref().unwrap()["sumX"],
        ] {
            assert_eq!(error.dependency_ids, Some(vec!["x".into()]));
            assert_eq!(error.record_preview, Some(vec!["z".into()]));
        }
        assert_eq!(
            view.pool.rows[0].cell_errors.as_ref().unwrap()["x"].dependency_ids,
            dependencies
        );
    }
}

#[test]
fn diagnostic_compaction_counts_utf16_units() {
    let error = pivot_core::formulas::ModelError {
        record_ids_present: false,
        dependency_ids_present: false,
        code: "upstream".into(),
        message: "😀".repeat(600),
        definition_id: "source".into(),
        record_ids: vec![],
        dependency_ids: vec![],
    };
    assert_eq!(
        compact_cell_error(&error).unwrap().message,
        "😀".repeat(500)
    );
}

#[test]
fn aggregate_columns_evaluate_each_exact_scope_once() {
    use pivot_core::ordering::{Comparison, ValueOrder};
    use std::{cell::Cell, cmp::Ordering};
    struct Count(Cell<usize>);
    impl ValueOrder for Count {
        fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
            if matches!((a, b), (WireValue::F64(_), WireValue::F64(_))) {
                self.0.set(self.0.get() + 1);
            }
            Host.compare(a, b)
        }
        fn compare_raw(&self, a: &WireValue, b: &WireValue) -> Result<Comparison, Diagnostic> {
            Host.compare_raw(a, b)
        }
        fn compare_recipe(&self, a: &str, b: &str) -> Result<Ordering, Diagnostic> {
            Host.compare_recipe(a, b)
        }
    }
    for split in [false, true] {
        for count in [1, 5, 20] {
            let (_, mut input, mut d, params) = fixture("ratio-source-scope");
            let mut more = input.rows.clone();
            for row in &mut more {
                row.id.push_str("-2");
            }
            input.rows.extend(more);
            let m = d
                .definition
                .analytical
                .as_mut()
                .unwrap()
                .table_mut()
                .unwrap();
            let f = m.formulas[0].clone();
            m.formulas = (0..count)
                .map(|i| {
                    let mut f = f.clone();
                    f.id = format!("min{i}");
                    f.name = f.id.clone();
                    f.ast = FormulaAst::Call {
                        function: FormulaFunction::Min,
                        args: vec![FormulaAst::Reference {
                            target: ReferenceTarget::Field,
                            id: "x".into(),
                        }],
                    };
                    f
                })
                .collect();
            m.layout.values = m.formulas.iter().map(|f| f.id.clone()).collect();
            if split {
                m.layout.columns = m.layout.rows.clone();
                m.layout.rows.clear();
                d.definition.table.column_order = Some(
                    (0..count)
                        .flat_map(|i| {
                            [
                                format!("[\"string\",\"A\"]\u{1f}min{i}"),
                                format!("[\"string\",\"B\"]\u{1f}min{i}"),
                            ]
                        })
                        .collect(),
                );
            }
            refresh_recipe(&mut d);
            let order = Count(Cell::new(0));
            let v = calculate_view(&input, &d, &SelectionSpec::None, &params, &order).unwrap();
            if !split {
                assert_eq!(v.eligible_rows.len(), 2);
            }
            assert_eq!(v.totals.values.len(), if split { 2 * count } else { count });
            // Overall minimum: 3 comparisons. Each two-row group: 1. F formulas.
            assert_eq!(order.0.get(), 5 * count, "F={count}, split={split}");
        }
    }
}

#[test]
fn diagnostic_cut_inside_surrogate_pair_refuses() {
    assert!(utf16_prefix(&format!("a{}", "😀".repeat(600)), 1000).is_err());
    assert_eq!(
        utf16_prefix(&format!("{}😀", "a".repeat(1000)), 1000).unwrap(),
        "a".repeat(1000)
    );
}
#[test]
fn grouped_projection_scales_linearly_with_groups() {
    // Review R1: every group scanned every pool row (scope errors, scope rows,
    // descriptors, facets, record order), so N groups cost O(N²).
    let (_, input, definition, runtime) = fixture("ratio-source-scope");
    assert_linear("grouped projection", 250, |n| {
        let mut input = input.clone();
        distinct_regions(&mut input.rows, n);
        let t = std::time::Instant::now();
        let view = calculate_view(
            &input,
            &definition,
            &SelectionSpec::None,
            &runtime,
            &PlainOrder,
        )
        .unwrap();
        let elapsed = t.elapsed();
        assert_eq!(view.groups.len(), n);
        elapsed
    });
}
