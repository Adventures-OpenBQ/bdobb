#![cfg(target_os = "linux")]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use support::*;
use table_service::{CatalogConfig, ServiceLimits};
const EXEC: &str = "22222222-2222-4222-8222-222222222222";
fn page(last: bool) -> Value {
    let schema = json!([{"name":"Revenue","type":"int64","nullable":false},{"name":"Group","type":"string","nullable":false}]);
    let rows = if last {
        vec![json!({"Revenue":1001,"Group":"all"})]
    } else {
        (0..1000)
            .map(|n| json!({"Revenue":n,"Group":"all"}))
            .collect()
    };
    json!({"rows":rows,"schema":schema,"total_count":1001,"count_quality":"exact","complete":true,"truncated":false,"next_cursor":if last{None}else{Some("next")},"codec":"arrow-json-v1","receipt":{"execution_id":EXEC,"query_id":"11111111-1111-4111-8111-111111111111","query_revision":2,"parameters":{},"context":{"mode":"current_corrected"},"input_manifest":{"manifest_id":"11111111-1111-4111-8111-111111111111","pins":[],"projection_versions":{}},"environment_digest":"fixture","transform_versions":{},"schema":schema,"completeness":"complete","result_hash":"a".repeat(64),"order_contract":"materialized_sequence","frozen_at":"2026-11-03T00:00:00Z","codec":"arrow-json-v1","runtime_artifact":null}})
}
#[tokio::test]
async fn retained_execution_import_filters_outside_page_one_and_exports_exactly() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let hits = Arc::new(AtomicUsize::new(0));
    let seen = hits.clone();
    let fixture = std::thread::spawn(move || {
        let until = Instant::now() + Duration::from_secs(15);
        while Instant::now() < until && seen.load(Ordering::SeqCst) < 2 {
            let Ok((mut socket, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 4096];
            while !bytes.windows(4).any(|v| v == b"\r\n\r\n") {
                let n = socket.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
            }
            let request = String::from_utf8(bytes).unwrap();
            assert!(request
                .to_lowercase()
                .contains("authorization: bearer fixture-alice"));
            assert!(request.starts_with(&format!("GET /temporal/v1/executions/{EXEC}/pages")));
            let body = page(request.contains("cursor=next")).to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
            seen.fetch_add(1, Ordering::SeqCst);
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("backends.json");
    std::fs::write(&config_path,json!({"maxBytes":1000000,"maxRows":2000,"maxColumns":10,"timeoutMs":5000,"backends":{"tdb":{"widgets":{"temporal_execution":{"url":format!("http://127.0.0.1:{port}/temporal/v1"),"parameters":["execution_id","expected_hash"],"response":{"kind":"temporalExecution","principalHeaders":{"alice":{"Authorization":"Bearer fixture-alice"}}}}}}}}).to_string()).unwrap();
    let catalog = CatalogConfig {
        limits: Default::default(),
        backend_widgets: [(
            "tdb".into(),
            [(
                "temporal_execution".into(),
                ["execution_id".into(), "expected_hash".into()].into(),
            )]
            .into(),
        )]
        .into(),
    };
    let h = Harness::configured_source(
        ServiceLimits::default(),
        None,
        Default::default(),
        None,
        Some((config_path, catalog)),
    );
    let (status,registered)=h.call("POST","/sources/backends",Some(json!({"idempotencyKey":"retained","binding":{"backendId":"tdb","widgetId":"temporal_execution","params":{"execution_id":EXEC,"expected_hash":"a".repeat(64)}}})),true).await;
    assert_eq!(status, 200, "{registered}");
    let opened = h
        .open(registered["sourceId"].as_str().unwrap(), "en-US", 1)
        .await;
    assert_eq!(opened["sourceReceiptWire"]["tag"], "record");
    let mut model = apply(1);
    model["definition"]["definition"]["table"]["columnFilters"] = json!([{"id":"Revenue","value":{"tag":"record","value":[["min",{"tag":"f64","value":1001}],["max",{"tag":"f64","value":1001}]]}}]);
    let (s, active) = h.command(&opened, model, None).await;
    assert_eq!(s, 200, "{active}");
    assert_eq!(
        wire(&active)["response"]["topLevelCount"],
        json!({"kind":"exact","value":1})
    );
    let (s, rows) = h
        .command(
            &active,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":0,"limit":10}}),
            ),
            None,
        )
        .await;
    assert_eq!(s, 200, "{rows}");
    assert_eq!(
        wire(&rows)["response"]["rows"][0]["values"]["Revenue"]["value"],
        1001.0
    );
    let (s, export) = h
        .command(
            &active,
            request(
                "presented",
                1,
                json!({"transferId":"retained-export","ignoreSelection":false}),
            ),
            None,
        )
        .await;
    assert_eq!(s, 200, "{export}");
    assert_eq!(
        wire(&export)["response"]["rows"].as_array().unwrap().len(),
        1
    );
    assert_eq!(wire(&export)["response"]["final"], true);
    let mut sorted = apply(2);
    sorted["definition"]["definition"]["table"]["sorting"] = json!([{"id":"Revenue","desc":true}]);
    let (s, sorted) = h.command(&active, sorted, None).await;
    assert_eq!(s, 200, "{sorted}");
    let (s, rows) = h
        .command(
            &sorted,
            request(
                "rows",
                2,
                json!({"request":{"groupPath":[],"offset":0,"limit":2}}),
            ),
            None,
        )
        .await;
    assert_eq!(s, 200, "{rows}");
    assert_eq!(
        wire(&rows)["response"]["rows"][0]["values"]["Revenue"]["value"],
        1001.0
    );
    let mut pivot = apply(3);
    pivot["definition"]["definition"]["table"]["pivot"] = json!({"enabled":true,"grouping":["Group"],"split":[],"measures":[{"id":"sum","sourceFieldId":"Revenue","aggregation":"sum"}]});
    let (s, pivot) = h.command(&sorted, pivot, None).await;
    assert_eq!(s, 200, "{pivot}");
    let (s, groups) = h
        .command(
            &pivot,
            request(
                "rows",
                3,
                json!({"request":{"groupPath":[],"offset":0,"limit":5}}),
            ),
            None,
        )
        .await;
    assert_eq!(s, 200, "{groups}");
    let total = wire(&groups);
    assert!(
        total["response"]["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["values"]
                .as_object()
                .unwrap()
                .values()
                .any(|v| v["value"].as_f64() == Some(500501.0))),
        "{groups}"
    );
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    fixture.join().unwrap();
}
