// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(target_os = "linux")]
#[path = "../../pivot-core/tests/support/mod.rs"]
mod support;
use pivot_core::{contract::*, session::*};
use pivot_native::NativeSession;
use pivot_native_worker::{WorkerConfig, WorkerSession};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use support::*;
fn spawn(memory: u64, frame: usize) -> WorkerSession {
    WorkerSession::spawn(
        WorkerConfig::new(
            PathBuf::from(env!("CARGO_BIN_EXE_pivot-native-worker")),
            memory,
            frame,
            Duration::from_secs(10),
        )
        .unwrap(),
        "en-US",
        ResourceLimits {
            max_state_bytes: Some(1),
            max_rows: Some(1_000_000),
            max_batch_bytes: Some(1024 * 1024),
            max_cached_block_bytes: Some(2 * 1024 * 1024),
            max_concurrent_transfers: Some(2),
            ..Default::default()
        },
    )
    .unwrap()
}
fn wire(mut operation: Value) -> String {
    operation["requestId"] = json!("q");
    operation["revision"] = json!({"widgetId":"test","input":1,"model":1,"output":1});
    json!({"protocolVersion":pivot_core::PROTOCOL_VERSION,"sessionId":1,"request":operation})
        .to_string()
}
fn definition(d: &ValidatedDefinition) -> Value {
    serde_json::to_value(WireDefinition {
        protocol_version: pivot_core::PROTOCOL_VERSION,
        locale: d.locale.clone(),
        definition: d.definition.clone(),
        analytical_recipe_source: d.analytical_recipe_source.clone(),
    })
    .unwrap()
}
fn compare(worker: &mut WorkerSession, native: &mut NativeSession, operation: Value) -> Value {
    let request = wire(operation);
    let expected = pivot_wire::encode_response(
        1,
        native.dispatch(pivot_wire::decode_request(&request).unwrap()),
    )
    .unwrap();
    let actual = worker.dispatch_wire(&request).unwrap();
    assert_eq!(actual, expected);
    serde_json::from_str(&actual).unwrap()
}
#[test]
fn real_contained_statement_member_and_witness_match_native() {
    for name in [
        "statement-income-wide",
        "statement-balance",
        "statement-hidden-dependency",
        "member-missing",
        "member-no-counterpart",
        "identity-witness",
        "typed-blanks",
    ] {
        let (_, input, d, runtime) = fixture(name);
        let mut worker = spawn(512 * 1024 * 1024, 8 * 1024 * 1024);
        let mut native = NativeSession::new(
            "en-US",
            ResourceLimits {
                max_rows: Some(1_000_000),
                max_batch_bytes: Some(1024 * 1024),
                max_cached_block_bytes: Some(2 * 1024 * 1024),
                max_concurrent_transfers: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        let registered = compare(
            &mut worker,
            &mut native,
            json!({"kind":"registerInput","input":input,"inputRevision":1}),
        );
        assert_eq!(
            registered["response"]["kind"], "registered",
            "{name}: {registered}"
        );
        let ready = compare(
            &mut worker,
            &mut native,
            json!({"kind":"applyModel","definition":definition(&d),"selection":{"kind":"none"},"reconcileMissing":false,"provenAbsentIds":[],"runtimeParams":runtime.into_iter().collect::<Vec<_>>()}),
        );
        assert_eq!(ready["response"]["kind"], "viewReady", "{name}: {ready}");
        let rows = compare(
            &mut worker,
            &mut native,
            json!({"kind":"rows","request":{"groupPath":[],"offset":0,"limit":100}}),
        );
        assert_eq!(rows["response"]["kind"], "rows", "{name}: {rows}");
        let totals = compare(&mut worker, &mut native, json!({"kind":"totals"}));
        assert_eq!(totals["response"]["kind"], "totals", "{name}: {totals}");
        if name == "identity-witness" {
            let mut target = d.clone();
            target.definition.table.column_filters = None;
            let witness = compare(
                &mut worker,
                &mut native,
                json!({"kind":"identityWitness","path":[definition(&d),definition(&target)],"ids":["r0","r2","absent"]}),
            );
            assert_eq!(witness["response"]["kind"], "identityWitness", "{witness}");
            assert_eq!(
                witness["response"]["identities"],
                json!([{"id":"r0","state":"present"},{"id":"r2","state":"present"},{"id":"absent","state":"absent"}])
            );
        }
        assert!(worker.resource_usage().unwrap().input_rows > 0);
    }
}
#[test]
fn real_worker_rejects_wrong_handle_and_invalid_json() {
    for input in [
        "not-json",
        r#"{"protocolVersion":1,"sessionId":2,"request":{"kind":"inputSchema","requestId":"q","revision":{"widgetId":"x","input":1,"model":1,"output":1}}}"#,
    ] {
        let mut worker = spawn(128 * 1024 * 1024, 1024 * 1024);
        let control = worker.control();
        assert!(worker.dispatch_wire(input).is_err());
        assert!(control.is_terminated());
    }
}
#[test]
fn real_memory_exhausting_request_dies_without_harming_other_worker() {
    let (_, mut input, _, _) = fixture("raw");
    let row = input.rows[0].clone();
    input.rows = vec![row; 150_000];
    for (index, row) in input.rows.iter_mut().enumerate() {
        row.id = format!("pressure-{index}");
    }
    let request = wire(json!({"kind":"registerInput","input":input,"inputRevision":1}));
    assert!(request.len() < 64 * 1024 * 1024);
    let mut exhausted = spawn(96 * 1024 * 1024, 64 * 1024 * 1024);
    let mut healthy = spawn(128 * 1024 * 1024, 1024 * 1024);
    let control = exhausted.control();
    let started = std::time::Instant::now();
    let error = exhausted.dispatch_wire(&request).unwrap_err();
    eprintln!(
        "real memory pressure: budget=96MiB frame={} bytes terminal={error:?} elapsed={:?}",
        request.len(),
        started.elapsed()
    );
    assert!(control.is_terminated());
    assert_eq!(healthy.resource_usage().unwrap().input_rows, 0);
}
#[test]
fn exact_wire_and_structural_negative_zero_survive_real_child() {
    let (_, mut input, d, _) = fixture("raw");
    let field = input.columns[0].id.clone();
    input.rows[0].values.insert(
        field.clone(),
        WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero)),
    );
    let mut worker = spawn(128 * 1024 * 1024, 1024 * 1024);
    let mut native = NativeSession::new("en-US", ResourceLimits::default()).unwrap();
    compare(
        &mut worker,
        &mut native,
        json!({"kind":"registerInput","input":input,"inputRevision":1}),
    );
    compare(
        &mut worker,
        &mut native,
        json!({"kind":"applyModel","definition":definition(&d),"selection":{"kind":"none"},"reconcileMissing":false,"provenAbsentIds":[],"runtimeParams":[]}),
    );
    let response = compare(
        &mut worker,
        &mut native,
        json!({"kind":"chartData","fields":[field]}),
    );
    assert_eq!(response["response"]["kind"], "chartData", "{response}");
    assert_eq!(
        response["response"]["rows"][0]["values"][&field],
        json!({"tag":"f64","value":"-0"})
    );
}
#[test]
fn supplied_core_row_limit_is_preserved() {
    let config = WorkerConfig::new(
        PathBuf::from(env!("CARGO_BIN_EXE_pivot-native-worker")),
        128 * 1024 * 1024,
        1024 * 1024,
        Duration::from_secs(3),
    )
    .unwrap();
    let mut worker = WorkerSession::spawn(
        config,
        "en-US",
        ResourceLimits {
            max_rows: Some(0),
            ..Default::default()
        },
    )
    .unwrap();
    let (_, input, _, _) = fixture("raw");
    let response: Value = serde_json::from_str(
        &worker
            .dispatch_wire(&wire(
                json!({"kind":"registerInput","input":input,"inputRevision":1}),
            ))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(response["response"]["kind"], "error");
    assert_eq!(worker.resource_usage().unwrap().input_rows, 0);
}

#[test]
fn real_startup_budget_includes_icu_and_loader() {
    for mb in [1, 16, 32, 64, 96, 128] {
        let config = WorkerConfig::new(
            PathBuf::from(env!("CARGO_BIN_EXE_pivot-native-worker")),
            mb * 1024 * 1024,
            1024 * 1024,
            Duration::from_secs(3),
        )
        .unwrap();
        let result = WorkerSession::spawn(config, "en-US", ResourceLimits::default());
        eprintln!(
            "startup budget {mb}MiB: {}",
            if result.is_ok() {
                "ready"
            } else {
                "refused/exited"
            }
        );
        if mb == 1 {
            assert!(result.is_err());
        }
        if mb == 128 {
            assert!(result.is_ok());
        }
    }
}

#[test]
fn configured_batch_rows_bounds_every_presented_transfer_batch() {
    let config = WorkerConfig::new(
        PathBuf::from(env!("CARGO_BIN_EXE_pivot-native-worker")),
        128 * 1024 * 1024,
        1024 * 1024,
        Duration::from_secs(3),
    )
    .unwrap()
    .with_batch_rows(2)
    .unwrap();
    let mut worker = WorkerSession::spawn(config, "en-US", ResourceLimits::default()).unwrap();
    let mut native = NativeSession::new("en-US", ResourceLimits::default()).unwrap();
    native.set_batch_rows(2).unwrap();
    let (_, mut input, d, runtime) = fixture("raw");
    input.rows = vec![input.rows[0].clone(); 5];
    for (i, row) in input.rows.iter_mut().enumerate() {
        row.id = format!("batch-{i}");
    }
    let registered = compare(
        &mut worker,
        &mut native,
        json!({"kind":"registerInput","input":input,"inputRevision":1}),
    );
    assert_eq!(registered["response"]["kind"], "registered");
    let ready = compare(
        &mut worker,
        &mut native,
        json!({"kind":"applyModel","definition":definition(&d),"selection":{"kind":"none"},"reconcileMissing":false,"provenAbsentIds":[],"runtimeParams":runtime.into_iter().collect::<Vec<_>>()}),
    );
    assert_eq!(ready["response"]["kind"], "viewReady");
    let mut ids = Vec::new();
    for (sequence, expected_rows) in [2, 2, 1].into_iter().enumerate() {
        let operation = if sequence == 0 {
            json!({"kind":"presented","transferId":"bounded","ignoreSelection":false})
        } else {
            json!({"kind":"nextSubset","transferId":"bounded","sequence":sequence})
        };
        let response = compare(&mut worker, &mut native, operation);
        let batch = &response["response"];
        assert_eq!(batch["kind"], "subset");
        assert_eq!(batch["transferId"], "bounded");
        assert_eq!(batch["sequence"], sequence);
        assert_eq!(batch["final"], sequence == 2);
        let rows = batch["rows"].as_array().unwrap();
        assert_eq!(rows.len(), expected_rows);
        ids.extend(
            rows.iter()
                .map(|row| row["id"].as_str().unwrap().to_owned()),
        );
    }
    ids.sort();
    assert_eq!(ids, ["batch-0", "batch-1", "batch-2", "batch-3", "batch-4"]);
    assert_eq!(worker.resource_usage().unwrap().active_transfers, 0);
}
