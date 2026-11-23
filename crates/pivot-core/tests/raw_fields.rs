// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{contract::*, session::*, validation::validate_definition};
use serde_json::json;
use support::{plain, Host};
fn number(n: f64) -> WireValue {
    WireValue::F64(WireNumber::Finite(n))
}
fn tagged(v: &serde_json::Value) -> WireValue {
    match v {
        serde_json::Value::Number(n) => number(n.as_f64().unwrap()),
        serde_json::Value::String(s) => WireValue::String(s.clone()),
        serde_json::Value::Object(o) => {
            WireValue::Record(o.iter().map(|(k, v)| (k.clone(), tagged(v))).collect())
        }
        _ => panic!("fixture uses only numbers, strings and own records"),
    }
}
fn input() -> SourceDataset {
    let raw: serde_json::Value=serde_json::from_str(r#"[{"category":1,"hasOwnProperty":100,"__proto__":102,"":101,"day":"2026-11-20","hover":{"value":100,"description":"synthetic own cell"},"m1":100,"m2":200},{"category":2,"hasOwnProperty":20,"__proto__":22,"":21,"day":"2026-11-19","hover":{"value":20,"description":"synthetic own cell"},"m1":20,"m2":40},{"category":3,"hasOwnProperty":300,"__proto__":302,"":301,"day":"2026-11-21","hover":{"value":300,"description":"synthetic own cell"},"m1":300,"m2":600}]"#).unwrap();
    let mut d:SourceDataset=serde_json::from_value(json!({"rows":[],"columns":[],"resultRevision":1,"outputRevision":1,"provenance":{"sourceWidgetId":"source"},"completeness":{"kind":"complete","warnings":[]},"freshness":{"availability":"available","stale":false}})).unwrap();
    d.columns = [
        "category",
        "hasOwnProperty",
        "__proto__",
        "",
        "day",
        "hover",
        "m1",
        "m2",
    ]
    .into_iter()
    .map(|id| DatasetColumn {
        id: id.into(),
        label: id.into(),
        ..Default::default()
    })
    .collect();
    d.rows = raw
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(i, r)| DatasetRow {
            id: format!("r{i}"),
            values: r
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), tagged(v)))
                .collect(),
            group_path: None,
            cell_errors: None,
            cell_formats: None,
        })
        .collect();
    d
}
fn definition(table: TableState) -> ValidatedDefinition {
    validate_definition(&WireDefinition {
        protocol_version: 1,
        locale: "en-US".into(),
        definition: TableDefinition {
            table,
            search: String::new(),
            analytical: None,
        },
        analytical_recipe_source: None,
    })
    .unwrap()
}
fn call(s: &mut Session, operation: Operation) -> Response {
    s.dispatch(
        CoreRequest {
            request_id: "q".into(),
            revision: Revision {
                widget_id: "table".into(),
                input: 1,
                model: 1,
                output: 1,
            },
            operation,
        },
        &Host,
    )
    .result
}
fn apply(s: &mut Session, d: ValidatedDefinition) -> Response {
    call(
        s,
        Operation::ApplyModel {
            definition: d,
            selection: SelectionSpec::None,
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: RuntimeParams::new(),
        },
    )
}
#[test]
fn empty_raw_key_survives_sort_filter_layout_and_linked_subset_chart() {
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    let raw = input();
    assert_eq!((raw.rows.len(), raw.columns.len()), (3, 8));
    s.register(raw, 1).unwrap();
    let d = definition(TableState {
        sorting: Some(vec![Sort {
            id: "".into(),
            desc: false,
        }]),
        column_filters: Some(vec![SourceFilter {
            id: "".into(),
            value: WireValue::Record(vec![("min".into(), number(50.0))]),
        }]),
        column_order: Some(vec!["".into(), "category".into()]),
        hidden: Some(vec!["hover".into(), "day".into(), "m1".into(), "m2".into()]),
        ..Default::default()
    });
    let ready = apply(&mut s, d);
    assert!(matches!(ready, Response::ViewReady(_)), "{ready:?}");
    let Response::ChartData(chart) = call(
        &mut s,
        Operation::ChartData {
            fields: vec!["".into(), "hasOwnProperty".into(), "__proto__".into()],
        },
    ) else {
        panic!("empty raw chart selector must be accepted")
    };
    assert_eq!(
        chart
            .rows
            .iter()
            .map(|r| plain(&r.values[""]))
            .collect::<Vec<_>>(),
        vec![json!(101), json!(301)]
    );
    assert_eq!(plain(&chart.rows[0].values["__proto__"]), json!(102));
    let Response::Subset(batch) = call(
        &mut s,
        Operation::Presented {
            transfer_id: "linked".into(),
            ignore_selection: false,
        },
    ) else {
        panic!("presented subset required")
    };
    assert_eq!(
        batch
            .columns
            .as_ref()
            .unwrap()
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        vec!["", "category", "hasOwnProperty", "__proto__"]
    );
    assert_eq!(batch.rows.len(), 2);
    let mut linked = input();
    linked.rows = batch.rows;
    linked.columns = batch.columns.unwrap();
    let mut child = Session::new("en-US".into(), ResourceLimits::default());
    child.register(linked, 1).unwrap();
    assert!(matches!(
        apply(
            &mut child,
            definition(TableState {
                column_filters: Some(vec![SourceFilter {
                    id: "".into(),
                    value: WireValue::Record(vec![("min".into(), number(200.0))])
                }]),
                ..Default::default()
            })
        ),
        Response::ViewReady(_)
    ));
    let Response::ChartData(result) = call(
        &mut child,
        Operation::ChartData {
            fields: vec!["".into()],
        },
    ) else {
        panic!("linked empty field chart required")
    };
    assert_eq!(result.rows.len(), 1);
    assert_eq!(plain(&result.rows[0].values[""]), json!(301));
}
#[test]
fn legacy_implicit_empty_source_has_raw_metadata_without_empty_measure_identity() {
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input(), 1).unwrap();
    let ready = apply(
        &mut s,
        definition(TableState {
            pivot: Some(PivotConfig {
                enabled: true,
                grouping: vec!["category".into()],
                aggregation_fns: Some(std::collections::BTreeMap::from([(
                    "".into(),
                    Aggregation::Sum,
                )])),
                ..Default::default()
            }),
            ..Default::default()
        }),
    );
    assert!(matches!(ready, Response::ViewReady(_)), "{ready:?}");
    let Response::ChartData(chart) = call(
        &mut s,
        Operation::ChartData {
            fields: vec!["".into()],
        },
    ) else {
        panic!("implicit empty-source measure output required")
    };
    let c = &chart.columns[0];
    assert_eq!(c.source_binding_id.as_deref(), Some(""));
    assert_eq!(c.source_field_id.as_deref(), Some(""));
    assert_eq!(c.measure_id, None);
    assert_eq!(plain(&chart.rows[0].values[""]), json!(101));
}
#[test]
fn legacy_empty_group_field_and_explicit_nonempty_measure_bind_exact_raw_key() {
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input(), 1).unwrap();
    let ready = apply(
        &mut s,
        definition(TableState {
            pivot: Some(PivotConfig {
                enabled: true,
                grouping: vec!["".into()],
                measures: Some(vec![Measure {
                    id: "m".into(),
                    source_field_id: "".into(),
                    aggregation: Some(Aggregation::Sum),
                    custom_label: None,
                }]),
                ..Default::default()
            }),
            ..Default::default()
        }),
    );
    assert!(matches!(ready, Response::ViewReady(_)), "{ready:?}");
    let Response::ChartData(chart) = call(
        &mut s,
        Operation::ChartData {
            fields: vec!["m".into()],
        },
    ) else {
        panic!("explicit nonempty measure over empty source required")
    };
    assert_eq!(chart.columns[0].measure_id.as_deref(), Some("m"));
    assert_eq!(chart.columns[0].source_binding_id.as_deref(), Some(""));
    assert_eq!(chart.rows.len(), 3);
}
#[test]
fn empty_opaque_identities_wrong_types_and_resource_limits_still_refuse() {
    let mut raw = input();
    raw.columns.retain(|c| !c.id.is_empty());
    for r in &mut raw.rows {
        r.values.remove("");
    }
    for source_widget in [false, true] {
        let mut bad = raw.clone();
        if source_widget {
            bad.provenance.source_widget_id.clear()
        } else {
            bad.rows[0].id.clear()
        };
        assert!(Session::new("en-US".into(), ResourceLimits::default())
            .register(bad, 1)
            .is_err());
    }
    for empty_widget in [false, true] {
        let mut s = Session::new("en-US".into(), ResourceLimits::default());
        let q = CoreRequest {
            request_id: if empty_widget {
                "q".into()
            } else {
                String::new()
            },
            revision: Revision {
                widget_id: if empty_widget {
                    String::new()
                } else {
                    "w".into()
                },
                input: 1,
                model: 1,
                output: 1,
            },
            operation: Operation::RegisterInput {
                input_revision: 1,
                input: raw.clone(),
            },
        };
        assert!(matches!(s.dispatch(q, &Host).result, Response::Error(_)));
    }
    let mut d = WireDefinition {
        protocol_version: 1,
        locale: "en-US".into(),
        definition: TableDefinition {
            table: TableState {
                pivot: Some(PivotConfig {
                    enabled: true,
                    measures: Some(vec![Measure {
                        id: "".into(),
                        source_field_id: "category".into(),
                        aggregation: None,
                        custom_label: None,
                    }]),
                    ..Default::default()
                }),
                ..Default::default()
            },
            search: String::new(),
            analytical: None,
        },
        analytical_recipe_source: None,
    };
    assert!(validate_definition(&d).is_err());
    d.definition.table.pivot = None;
    d.locale.clear();
    assert!(validate_definition(&d).is_err());
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(raw.clone(), 1).unwrap();
    assert!(matches!(
        apply(&mut s, definition(TableState::default())),
        Response::ViewReady(_)
    ));
    // Empty is accepted only as a declared raw field, never as a missing binding or opaque ID.
    for operation in [
        Operation::ChartData {
            fields: vec!["".into()],
        },
        Operation::Presented {
            transfer_id: "".into(),
            ignore_selection: false,
        },
        Operation::Selection {
            action: SelectionAction::Toggle { row_id: "".into() },
            visible_ids: vec![],
        },
    ] {
        assert!(matches!(call(&mut s, operation), Response::Error(_)));
    }
    let mut encoded = serde_json::to_value(&raw).unwrap();
    encoded["columns"][0]["id"] = json!(null);
    assert!(serde_json::from_value::<SourceDataset>(encoded).is_err());
    assert!(Session::new(
        "en-US".into(),
        ResourceLimits {
            max_rows: Some(1),
            ..Default::default()
        }
    )
    .register(raw, 1)
    .is_err());
}

#[test]
fn analytical_definition_identities_and_authoring_contract_are_not_relaxed() {
    let model = json!({"schemaVersion":1,"enabled":true,"params":{"promotePage":false,"filters":[]},"categories":[{"id":"c","name":"Category","sourceFieldId":"category","transform":"native"}],"measures":[{"id":"m","sourceFieldId":"category"}],"formulas":[{"id":"f","name":"Formula","scope":"source","expression":"1","ast":{"kind":"literal","value":1}}],"layout":{"rows":[],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":false,"groups":false}});
    for target in ["categories", "measures", "formulas"] {
        let mut changed = model.clone();
        changed[target][0]["id"] = json!("");
        let raw:WireDefinition=serde_json::from_value(json!({"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":"","analytical":changed}})).unwrap();
        assert!(
            validate_definition(&raw).is_err(),
            "opaque {target} identity must remain nonempty"
        );
    }
    let mut changed = model.clone();
    changed["formulas"][0]["ast"] = json!({"kind":"reference","target":"field","id":""});
    let raw:WireDefinition=serde_json::from_value(json!({"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":"","analytical":changed}})).unwrap();
    assert!(
        validate_definition(&raw).is_err(),
        "this ordinary-table repair does not expand empty-field formula authoring"
    );
}
