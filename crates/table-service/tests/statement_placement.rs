// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(target_os = "linux")]
mod support;
use pivot_core::contract::{DatasetRow, WireNumber, WireValue};
use serde_json::{json, Value};
use support::*;
#[tokio::test]
async fn managed_statement_move_preserves_rows_formula_values_and_authentication() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../deploy/table-service/statement-placement.fixture.json"
    ))
    .unwrap();
    let h = Harness::new(table_service::ServiceLimits {
        max_row_block_rows: 100,
        ..Default::default()
    });
    let source = h.upload(fixture["csv"].as_str().unwrap().as_bytes()).await;
    let mut session = h.open(&source, "en-US", 1).await;
    let mut intent = fixture["intent"].clone();
    let home = intent["template"]["sections"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let destination = intent["template"]["sections"][1]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let line = intent["template"]["lines"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["label"] == "revenue")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let formula = intent["template"]["lines"]
        .as_array()
        .unwrap()
        .iter()
        .find(|line| line["label"] == "Calculated gross profit")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    for model in 1..=3 {
        if model >= 2 {
            intent["overrides"]["lineSection"] = json!({(line.clone()): destination.clone()});
        }
        if model == 3 {
            intent["overrides"]["hiddenIds"] = json!([home]);
        }
        let mut q = apply(model);
        q["definition"]["definition"]["analytical"] = intent.clone();
        q["definition"]["analyticalRecipeSource"] = serde_json::to_value(tagged(&intent)).unwrap();
        let (status, active) = h.command(&session, q, None).await;
        assert_eq!(status, 200, "model={model}: {active}");
        assert_eq!(wire(&active)["response"]["kind"], "viewReady", "{active}");
        let (status, batch) = h
            .command(
                &active,
                request(
                    "presented",
                    model,
                    json!({"transferId":format!("statement-{model}"),"ignoreSelection":true}),
                ),
                None,
            )
            .await;
        assert_eq!(status, 200, "{batch}");
        let rows: Vec<DatasetRow> =
            serde_json::from_value(wire(&batch)["response"]["rows"].clone()).unwrap();
        let find = |id: &str| {
            rows.iter()
                .find(|row| {
                    row.group_path
                        .as_ref()
                        .is_some_and(|p| p.len() == 2 && p[1].value == WireValue::String(id.into()))
                })
                .unwrap()
        };
        assert!(find(&formula)
            .values
            .values()
            .any(|value| *value == WireValue::F64(WireNumber::Finite(40.0))));
        if model >= 2 {
            assert_eq!(
                find(&line).group_path.as_ref().unwrap()[0].value,
                WireValue::String(destination.clone())
            );
        }
        let (status, _) = h
            .call(
                "POST",
                &format!(
                    "/sessions/{}/commands",
                    active["sessionId"].as_str().unwrap()
                ),
                Some(json!({"wire":"{}"})),
                false,
            )
            .await;
        assert_eq!(status, 401);
        session = active;
    }
}
