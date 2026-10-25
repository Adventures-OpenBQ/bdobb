// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use serde_json::{json, Value};
fn definition(raw: &WireValue) -> ValidatedDefinition {
    let analytical = get(raw, "analytical");
    let mut value = plain(raw);
    if let WireValue::Array(filters) = get(get(raw, "table"), "columnFilters") {
        value["table"]["columnFilters"] = json!(filters
            .iter()
            .map(|f| json!({"id":text(get(f,"id")),"value":get(f,"value")}))
            .collect::<Vec<_>>());
    }
    ValidatedDefinition {
        locale: "en-US".into(),
        definition: serde_json::from_value(value).unwrap(),
        analytical_recipe_source: (!matches!(analytical, WireValue::Missing))
            .then(|| analytical.clone()),
    }
}
fn inspect(raw: &WireValue) -> InspectionRequest {
    InspectionRequest {
        collection: match text(get(raw, "collection")) {
            "definitions" => InspectionCollection::Definitions,
            "warnings" => InspectionCollection::Warnings,
            "periodBounds" => InspectionCollection::PeriodBounds,
            "groupDomain" => InspectionCollection::GroupDomain,
            _ => panic!("collection"),
        },
        offset: plain(get(raw, "offset")).as_u64().unwrap(),
        limit: plain(get(raw, "limit")).as_u64().unwrap() as u32,
        definition_id: (!matches!(get(raw, "definitionId"), WireValue::Missing))
            .then(|| text(get(raw, "definitionId")).into()),
        param_key: (!matches!(get(raw, "paramKey"), WireValue::Missing))
            .then(|| text(get(raw, "paramKey")).into()),
        category_id: (!matches!(get(raw, "categoryId"), WireValue::Missing))
            .then(|| text(get(raw, "categoryId")).into()),
        category_recipe: (!matches!(get(raw, "categoryRecipe"), WireValue::Missing))
            .then(|| text(get(raw, "categoryRecipe")).into()),
        group_evidence: (!matches!(get(raw, "groupEvidence"), WireValue::Missing)).then(|| {
            (
                text(get(get(raw, "groupEvidence"), "groupId")).into(),
                text(get(get(raw, "groupEvidence"), "transportValue")).into(),
            )
        }),
    }
}
fn compare(actual: Value, expected: Value, context: &str) {
    fn visit(a: &Value, e: &Value, path: &str) {
        match (a, e) {
            (Value::Number(a), Value::Number(e))
                if ["mean", "avg", "margin", "ratio"]
                    .iter()
                    .any(|id| path.to_lowercase().contains(id)) =>
            {
                let a = a.as_f64().unwrap();
                let e = e.as_f64().unwrap();
                assert!(
                    (a - e).abs() <= 1e-12_f64.max(1e-12 * a.abs().max(e.abs())),
                    "{path}: {a} != {e}"
                )
            }
            (Value::Object(a), Value::Object(e)) => {
                assert_eq!(
                    a.keys().collect::<Vec<_>>(),
                    e.keys().collect::<Vec<_>>(),
                    "{path} keys"
                );
                for (k, e) in e {
                    visit(&a[k], e, &format!("{path}.{k}"))
                }
            }
            (Value::Array(a), Value::Array(e)) => {
                assert_eq!(a.len(), e.len(), "{path} lengths");
                for (i, (a, e)) in a.iter().zip(e).enumerate() {
                    visit(a, e, &format!("{path}[{i}]"))
                }
            }
            _ => assert_eq!(a, e, "{path}"),
        }
    }
    visit(&actual, &expected, context)
}
fn rows(actual: &[DatasetRow], expected: &WireValue, context: &str) {
    let expected = arr(expected);
    assert_eq!(actual.len(), expected.len(), "{context} len");
    for (a, e) in actual.iter().zip(expected) {
        assert_eq!(a.id, text(get(e, "id")), "{context} id");
        assert_values(&a.values, get(e, "values"), context);
        assert_eq!(
            untag(serde_json::to_value(&a.group_path).unwrap()),
            plain(get(e, "groupPath")),
            "{context} path"
        );
        assert_eq!(
            serde_json::to_value(&a.cell_errors).unwrap(),
            plain(get(e, "cellErrors")),
            "{context} errors"
        );
        assert_eq!(
            serde_json::to_value(&a.cell_formats).unwrap(),
            plain(get(e, "cellFormats")),
            "{context} formats"
        );
    }
}
fn ready(a: &ViewReady, e: &WireValue, name: &str) {
    compare(
        untag(serde_json::to_value(&a.columns).unwrap()),
        plain(get(e, "columns")),
        &format!("{name} columns"),
    );
    assert!(
        matches!(a.top_level_count,ResultCount::Exact{value}if Some(value)==plain(get(e,"topLevelCount")).as_u64()),
        "{name} count"
    );
    assert_eq!(
        serde_json::to_value(&a.selection).unwrap(),
        plain(get(e, "selection")),
        "{name} selection"
    );
    compare(
        untag(serde_json::to_value(&a.chart_columns).unwrap()),
        plain(get(e, "chartColumns")),
        &format!("{name} chartColumns"),
    );
    assert_eq!(
        serde_json::to_value(&a.selection_namespace).unwrap(),
        plain(get(e, "selectionNamespace")),
        "{name} namespace"
    );
    let inspection = get(e, "inspection");
    assert_eq!(
        serde_json::to_value(&a.inspection.input_periodicity).unwrap(),
        plain(get(inspection, "inputPeriodicity")),
        "{name} periodicity"
    );
    assert_eq!(
        serde_json::to_value(&a.inspection.aggregations).unwrap(),
        plain(get(inspection, "aggregations")),
        "{name} aggregations"
    );
    if !matches!(get(inspection, "paramMatches"), WireValue::Missing) {
        assert_eq!(
            serde_json::to_value(&a.inspection.param_matches).unwrap(),
            plain(get(inspection, "paramMatches")),
            "{name} paramMatches"
        );
    }
    compare(
        untag(serde_json::to_value(&a.inspection.input_columns).unwrap()),
        plain(get(inspection, "inputColumns")),
        &format!("{name} inputColumns"),
    );
    assert_eq!(
        serde_json::to_value(&a.inspection.definition).unwrap(),
        serde_json::to_value(definition(get(inspection, "definition")).definition).unwrap(),
        "{name} saved authority"
    );
    assert_eq!(
        serde_json::to_value(&a.inspection.counts).unwrap(),
        plain(get(inspection, "counts")),
        "{name} counts"
    );
}
fn decode_provenance(raw: &WireValue) -> Provenance {
    let mut p = plain(raw);
    for key in ["metadata", "receipt", "parameters"] {
        if let WireValue::Record(r) = get(raw, key) {
            p[key] = serde_json::to_value(r.iter().cloned().collect::<ValueRecord>()).unwrap();
        }
    }
    serde_json::from_value(p).unwrap()
}
fn run(name: &str) {
    let (root, input, mut d, mut runtime) = fixture(name);
    let result = get(&root, "result");
    let mut selection: SelectionSpec =
        serde_json::from_value(plain(get(get(&root, "case"), "selection"))).unwrap();
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    s.set_batch_rows(2).unwrap();
    let mut model = 1;
    let apply_current = |s: &mut Session,
                         d: &ValidatedDefinition,
                         runtime: &RuntimeParams,
                         selection: &SelectionSpec,
                         model: u64| {
        call(
            s,
            model,
            Operation::ApplyModel {
                definition: d.clone(),
                selection: selection.clone(),
                runtime_params: runtime.clone(),
                reconcile_missing: false,
                previous_selection_namespace: None,
                proven_absent_ids: vec![],
            },
        )
    };
    let initial = apply_current(&mut s, &d, &runtime, &selection, model);
    if !matches!(get(result, "error"), WireValue::Missing) {
        let Response::Error(error) = initial else {
            panic!("{name} expected refusal")
        };
        assert_eq!(
            error.message,
            text(get(get(result, "error"), "message")),
            "{name} refusal"
        );
        return;
    }
    let Response::ViewReady(mut last_ready) = initial else {
        panic!("{name} initial {:?}", initial)
    };
    for (op, expected) in arr(get(get(&root, "case"), "operations"))
        .iter()
        .zip(arr(get(result, "operations")))
    {
        let expected = get(expected, "value");
        match text(get(op, "kind")) {
            "memberDomain" => {
                let Response::MemberDomain(a) = call(
                    &mut s,
                    model,
                    Operation::MemberDomain {
                        definition: definition(get(op, "definition")),
                        category_id: text(get(op, "categoryId")).into(),
                        category_recipe: text(get(op, "categoryRecipe")).into(),
                        offset: plain(get(op, "offset")).as_u64().unwrap(),
                        limit: plain(get(op, "limit")).as_u64().unwrap() as u32,
                        search: None,
                    },
                ) else {
                    panic!("{name} member")
                };
                let mut expected = plain(expected);
                for key in ["kind", "revision", "completeness", "diagnostics"] {
                    expected.as_object_mut().unwrap().remove(key);
                }
                compare(
                    untag(serde_json::to_value(a).unwrap()),
                    expected,
                    &format!("{name} member"),
                );
            }
            "columnProfile" => {
                let fields = match get(op, "fields") {
                    WireValue::Array(ids) => Some(ids.iter().map(|id| text(id).to_string()).collect()),
                    _ => None,
                };
                let Response::ColumnProfile(a) = call(
                    &mut s,
                    model,
                    Operation::ColumnProfile {
                        definition: definition(get(op, "definition")),
                        scope: serde_json::from_value(plain(get(op, "scope"))).unwrap(),
                        offset: plain(get(op, "offset")).as_u64().unwrap(),
                        limit: plain(get(op, "limit")).as_u64().unwrap() as u32,
                        fields,
                    },
                ) else {
                    panic!("{name} column profile")
                };
                let mut expected = plain(expected);
                for key in ["kind", "revision", "completeness", "diagnostics"] {
                    expected.as_object_mut().unwrap().remove(key);
                }
                compare(
                    untag(serde_json::to_value(a).unwrap()),
                    expected,
                    &format!("{name} column profile"),
                );
            }
            "bindFormula" => {
                let raw = get(op, "draft");
                let bindings = arr(get(op, "bindings"))
                    .iter()
                    .map(|b| pivot_core::formulas::ScopedBinding {
                        scope: serde_json::from_value(plain(get(b, "scope"))).unwrap(),
                        name: text(get(b, "name")).into(),
                        reference: serde_json::from_value(plain(get(b, "reference"))).unwrap(),
                    })
                    .collect();
                let Response::BindFormula(a) = call(
                    &mut s,
                    model,
                    Operation::BindFormula {
                        definition: definition(get(op, "definition")),
                        draft: pivot_core::formulas::FormulaDraft {
                            id: text(get(raw, "id")).into(),
                            name: text(get(raw, "name")).into(),
                            scope: serde_json::from_value(plain(get(raw, "scope"))).unwrap(),
                            expression: text(get(raw, "expression")).into(),
                            format: None,
                        },
                        bindings,
                    },
                ) else {
                    panic!("{name} binding")
                };
                let mut expected = plain(expected);
                for key in ["kind", "revision", "completeness", "diagnostics"] {
                    expected.as_object_mut().unwrap().remove(key);
                }
                compare(
                    untag(serde_json::to_value(a).unwrap()),
                    expected,
                    &format!("{name} bind"),
                );
            }
            "apply" => {
                if !matches!(get(op, "definition"), WireValue::Missing) {
                    d = definition(get(op, "definition"));
                }
                if !matches!(get(op, "runtimeParams"), WireValue::Missing) {
                    runtime = serde_json::from_value(plain(get(op, "runtimeParams"))).unwrap();
                }
                model += 1;
                let Response::ViewReady(a) = apply_current(&mut s, &d, &runtime, &selection, model)
                else {
                    panic!("apply")
                };
                ready(&a, expected, name);
                last_ready = a;
            }
            "inspect" => {
                let Response::Inspect(a) = call(
                    &mut s,
                    model,
                    Operation::Inspect(inspect(get(op, "request"))),
                ) else {
                    panic!("{name} inspect")
                };
                let mut expected = plain(expected);
                for key in ["kind", "revision", "completeness", "diagnostics"] {
                    expected.as_object_mut().unwrap().remove(key);
                }
                let mut actual = untag(serde_json::to_value(a).unwrap());
                if let Some(e) = actual.get_mut("groupEvidence") {
                    let arr = e.as_array().unwrap();
                    *e = json!({"groupId":arr[0],"transportValue":arr[1]});
                }
                compare(actual, expected, &format!("{name} inspection trace"));
            }
            "preview" => {
                let Response::PreviewDefinition(a) = call(
                    &mut s,
                    model,
                    Operation::PreviewDefinition(definition(get(op, "definition"))),
                ) else {
                    panic!("preview")
                };
                rows(&a.rows, get(expected, "rows"), "preview");
            }
            "selection" => {
                let ids = arr(get(op, "visibleIds"))
                    .iter()
                    .map(|id| text(id).to_string())
                    .collect();
                let action = serde_json::from_value(plain(get(op, "action"))).unwrap();
                let Response::Selection(a) = call(
                    &mut s,
                    model,
                    Operation::Selection {
                        action,
                        visible_ids: ids,
                    },
                ) else {
                    panic!("selection")
                };
                let mut expected = plain(expected);
                for key in ["kind", "revision", "completeness", "diagnostics"] {
                    expected.as_object_mut().unwrap().remove(key);
                }
                compare(
                    serde_json::to_value(&a).unwrap(),
                    expected,
                    &format!("{name} selection trace"),
                );
                selection = a.selection;
                model += 1;
                let Response::ViewReady(a) = apply_current(&mut s, &d, &runtime, &selection, model)
                else {
                    panic!("selection publish")
                };
                last_ready = a;
            }
            "linked" => {
                let Response::Subset(batch) = call(
                    &mut s,
                    model,
                    Operation::Presented {
                        transfer_id: "linkedtrace".into(),
                        ignore_selection: false,
                    },
                ) else {
                    panic!("linked")
                };
                let mut child = Session::new("en-US".into(), ResourceLimits::default());
                let (_, input, _, _) = fixture(name);
                let dataset = SourceDataset {
                    columns: batch.columns.unwrap(),
                    rows: batch.rows,
                    result_revision: model,
                    output_revision: model,
                    provenance: batch.provenance.unwrap(),
                    freshness: batch.freshness.unwrap(),
                    diagnostics: Some(vec![]),
                    model_warnings: None,
                    model_warning_count: None,
                    completeness: input.completeness,
                };
                child.register(dataset, 1).unwrap();
                let Response::ViewReady(a) = apply(
                    &mut child,
                    definition(get(op, "definition")),
                    RuntimeParams::new(),
                    model,
                ) else {
                    panic!("linked apply")
                };
                ready(&a, get(expected, "ready"), "linked");
                let fields = a.columns.iter().map(|c| c.id.clone()).collect();
                let Response::ChartData(chart) =
                    call(&mut child, model, Operation::ChartData { fields })
                else {
                    panic!("linked chart")
                };
                rows(
                    &chart.rows,
                    get(get(expected, "chart"), "rows"),
                    "linked chart",
                );
            }
            "identityWitness" => {
                // Direct baseline helper permits one path; transport deliberately requires two.
                let path = arr(get(op, "path"))
                    .iter()
                    .map(definition)
                    .collect::<Vec<_>>();
                let ids = arr(get(op, "ids"))
                    .iter()
                    .map(|v| text(v).to_string())
                    .collect::<Vec<_>>();
                let (_, input, _, _) = fixture(name);
                let a = pivot_core::witness::identity_witness(
                    &input,
                    &d.definition,
                    &last_ready.columns,
                    &path,
                    &ids,
                    &Host,
                )
                .unwrap();
                assert_eq!(
                    serde_json::to_value(a).unwrap(),
                    plain(get(expected, "identities")),
                    "witness"
                );
            }
            _ => panic!("op"),
        }
    }
    ready(&last_ready, get(result, "ready"), name);
    for delivery in arr(get(result, "deliveries")) {
        for b in arr(get(delivery, "blocks")) {
            let req = RowRequest {
                group_path: arr(get(b, "groupPath"))
                    .iter()
                    .map(|id| text(id).into())
                    .collect(),
                offset: plain(get(b, "offset")).as_u64().unwrap(),
                limit: plain(get(delivery, "size")).as_u64().unwrap() as u32,
            };
            let envelope = s.dispatch(
                CoreRequest {
                    request_id: "q".into(),
                    revision: revision(model),
                    operation: Operation::Rows(req),
                },
                &Host,
            );
            assert_eq!(
                serde_json::to_value(&envelope.completeness).unwrap(),
                plain(get(b, "completeness")),
                "{name} completeness"
            );
            assert_eq!(
                serde_json::to_value(&envelope.diagnostics).unwrap(),
                plain(get(b, "diagnostics")),
                "{name} diagnostics"
            );
            assert_eq!(
                serde_json::to_value(&envelope.model_warnings).unwrap(),
                plain(get(b, "modelWarnings")),
                "{name} warnings"
            );
            assert_eq!(
                serde_json::to_value(envelope.model_warning_count).unwrap(),
                plain(get(b, "modelWarningCount")),
                "{name} warning count"
            );
            let Response::Rows(a) = envelope.result else {
                panic!("{name} rows")
            };
            rows(&a.rows, get(b, "rows"), name);
            compare(json!(a.groups.iter().map(|g|json!({"rowId":g.row_id,"path":g.path,"childCount":match g.child_count{ResultCount::Exact{value}=>value,_=>panic!("nonexact child count")}})).collect::<Vec<_>>()),plain(get(b,"groups")),&format!("{name} group summaries"));
            assert!(
                matches!(a.sibling_count,ResultCount::Exact{value}if Some(value)==plain(get(b,"siblingCount")).as_u64())
            );
            assert_eq!(
                serde_json::to_value(a.selection).unwrap(),
                plain(get(b, "selection")),
                "{name} row selection"
            );
        }
    }
    let Response::Totals(totals) = call(&mut s, model, Operation::Totals) else {
        panic!("totals")
    };
    assert_values(
        &totals.values,
        get(get(result, "totals"), "values"),
        &format!("{name} totals"),
    );
    assert_eq!(
        serde_json::to_value(totals.cell_errors).unwrap(),
        plain(get(get(result, "totals"), "cellErrors")),
        "{name} total errors"
    );
    for f in arr(get(result, "facets")) {
        let id = text(get(f, "categoryId"));
        let Response::Facets { values, .. } = call(
            &mut s,
            model,
            Operation::Facets {
                category_id: id.into(),
            },
        ) else {
            panic!("{name} facet {id}")
        };
        assert_values(
            &values.values,
            get(f, "values"),
            &format!("{name} facet {id}"),
        );
        compare(
            untag(serde_json::to_value(values.members).unwrap()),
            plain(get(f, "members")),
            &format!("{name} members"),
        );
    }
    for e in arr(get(result, "inspection")) {
        let Response::Inspect(a) = call(&mut s, model, Operation::Inspect(inspect(e))) else {
            panic!("{name} inspect")
        };
        compare(
            serde_json::to_value(a.rows).unwrap(),
            plain(get(e, "rows")),
            &format!("{name} inspect rows"),
        );
        assert_eq!(a.total, plain(get(e, "total")).as_u64().unwrap());
    }
    let Response::ChartData(chart) = call(
        &mut s,
        model,
        Operation::ChartData {
            fields: last_ready.columns.iter().map(|c| c.id.clone()).collect(),
        },
    ) else {
        panic!("chart")
    };
    rows(
        &chart.rows,
        get(get(result, "chart"), "rows"),
        &format!("{name} chart"),
    );
    assert_eq!(
        serde_json::to_value(&chart.provenance).unwrap(),
        serde_json::to_value(decode_provenance(get(get(result, "chart"), "provenance"))).unwrap(),
        "{name} provenance"
    );
    assert_eq!(
        serde_json::to_value(&chart.freshness).unwrap(),
        plain(get(get(result, "chart"), "freshness")),
        "{name} freshness"
    );
    for (key, ignore) in [("linked", false), ("export", true)] {
        let Response::Subset(mut batch) = call(
            &mut s,
            model,
            Operation::Presented {
                transfer_id: key.into(),
                ignore_selection: ignore,
            },
        ) else {
            panic!("subset")
        };
        let expected_subset = get(result, key);
        compare(
            untag(serde_json::to_value(&batch.columns).unwrap()),
            plain(get(expected_subset, "columns")),
            &format!("{name} subset columns"),
        );
        assert_eq!(
            serde_json::to_value(&batch.provenance).unwrap(),
            serde_json::to_value(Some(decode_provenance(get(expected_subset, "provenance"))))
                .unwrap(),
            "{name} subset provenance"
        );
        assert_eq!(
            serde_json::to_value(&batch.freshness).unwrap(),
            plain(get(expected_subset, "freshness")),
            "{name} subset freshness"
        );
        let expected_batches = arr(get(expected_subset, "batches"));
        let mut all = vec![];
        loop {
            let expected_batch = &expected_batches[batch.sequence as usize];
            rows(
                &batch.rows,
                get(expected_batch, "rows"),
                &format!("{name} batch {}", batch.sequence),
            );
            assert_eq!(
                batch.final_batch,
                plain(get(expected_batch, "final")).as_bool().unwrap()
            );
            all.extend(batch.rows);
            if batch.final_batch {
                break;
            }
            let Response::Subset(next) = call(
                &mut s,
                model,
                Operation::NextSubset {
                    transfer_id: key.into(),
                    sequence: batch.sequence + 1,
                },
            ) else {
                panic!("next")
            };
            batch = next;
        }
        rows(
            &all,
            get(get(result, key), "rows"),
            &format!("{name} {key}"),
        );
    }
}
#[test]
fn all_frozen_native_session_consumers() {
    let files = std::fs::read_dir("../../src/test/fixtures/rust-pivot").unwrap();
    let mut failures = vec![];
    let mut count = 0;
    for file in files {
        let file = file.unwrap();
        if file.path().extension().is_none_or(|e| e != "json") {
            continue;
        }
        let name = file
            .path()
            .file_stem()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        count += 1;
        if std::panic::catch_unwind(|| run(&name)).is_err() {
            failures.push(name)
        }
    }
    assert_eq!(count, 42);
    assert!(failures.is_empty(), "failed fixtures {failures:?}");
}
