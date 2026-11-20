// Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{contract::*, session::*};
use support::*;
#[test]
fn uploaded_2005_rows_refuse_small_cache_and_fit_sized_profile() {
    let (_, mut input, _, _) = fixture("ratio-source-scope");
    input.columns=serde_json::from_value(serde_json::json!([
  {"id":"group","label":"group","dtype":"text"},{"id":"category","label":"category","dtype":"text"},
  {"id":"amount","label":"amount","dtype":"number"},{"id":"sequence","label":"sequence","dtype":"number"}])).unwrap();
    let template = input.rows[0].clone();
    input.rows = (0..2005)
        .map(|i| DatasetRow {
            id: format!("uploaded-fixture-row-{i}"),
            values: [
                (
                    "group".into(),
                    WireValue::String(format!("Group {}", i % 5)),
                ),
                (
                    "category".into(),
                    WireValue::String(format!("Category {}", i % 20)),
                ),
                (
                    "amount".into(),
                    WireValue::F64(WireNumber::Finite((i + 1) as f64)),
                ),
                (
                    "sequence".into(),
                    WireValue::F64(WireNumber::Finite(i as f64)),
                ),
            ]
            .into_iter()
            .collect(),
            ..template.clone()
        })
        .collect();
    let raw: WireDefinition = serde_json::from_str(include_str!(
        "../../../src/test/fixtures/managed-2005-model.json"
    ))
    .unwrap();
    let d = pivot_core::validation::validate_definition(&raw).unwrap();
    for budget in [Some(64 * 1024 * 1024), Some(256 * 1024 * 1024)] {
        let mut s = Session::new(
            "en-US".into(),
            ResourceLimits {
                cache_bytes: budget,
                ..Default::default()
            },
        );
        s.register(input.clone(), 1).unwrap();
        let response = s
            .dispatch(
                CoreRequest {
                    request_id: "managed-budget".into(),
                    revision: Revision {
                        widget_id: "fixture".into(),
                        input: 1,
                        model: 1,
                        output: 1,
                    },
                    operation: Operation::ApplyModel {
                        definition: d.clone(),
                        selection: SelectionSpec::None,
                        reconcile_missing: false,
                        previous_selection_namespace: None,
                        proven_absent_ids: vec![],
                        runtime_params: RuntimeParams::new(),
                    },
                },
                &Host,
            )
            .result;
        println!(
            "budget={budget:?}; usage={}",
            serde_json::to_string(&s.resource_usage()).unwrap()
        );
        if budget == Some(64 * 1024 * 1024) {
            let Response::Error(d) = response else {
                panic!("small profile must refuse")
            };
            assert_eq!(d.code, "RESOURCE_LIMIT");
            assert_eq!(s.resource_usage().output_rows, 0);
        } else {
            assert!(
                matches!(response, Response::ViewReady(_)),
                "sized profile must admit: {response:?}"
            );
            assert_eq!(s.resource_usage().input_rows, 2005);
            assert!(s.resource_usage().retained_estimated_bytes < 256 * 1024 * 1024);
        }
    }
}
