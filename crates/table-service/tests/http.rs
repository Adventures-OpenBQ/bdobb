#![cfg(target_os = "linux")]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use serde_json::json;
use support::*;
#[tokio::test]
async fn negotiates_authenticated_sessions_and_computes_real_rows() {
    let h = Harness::new(Default::default());
    assert_eq!(h.call("GET", "/healthz", None, false).await.0, 401);
    assert_eq!(
        h.call("GET", "/capabilities", None, true).await.1["remoteAcquisition"],
        true
    );
    let source = h.upload(b"x,y\n2,a\n3,b\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let applied = h.command(&opened, apply(1), None).await;
    assert_eq!(applied.0, 200, "{:?}", applied.1);
    assert_eq!(wire(&applied.1)["response"]["kind"], "viewReady");
    let rows = h
        .command(
            &applied.1,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":0,"limit":10}}),
            ),
            None,
        )
        .await;
    assert_eq!(
        wire(&rows.1)["response"]["rows"][0]["values"]["x"]["value"],
        2.0
    );
    assert_eq!(h.open_raw(&source, "zz-INVALID", 1).await.0, 400);
    assert_eq!(h.open_raw(&source, "en-US", 99).await.0, 400);
    let bad = h.call("POST", "/sessions", Some(json!({})), true).await;
    assert_eq!(bad.0, 400);
    assert_eq!(bad.1["error"]["code"], "invalid_input");
}
#[tokio::test]
async fn auth_duplicate_mixed_and_forged_headers_refuse_and_gateway_ownership_is_checked() {
    use axum::{body::Body, http::Request};
    let h = Harness::new(Default::default());
    for headers in [
        vec![
            ("authorization", format!("Bearer {TOKEN}")),
            ("authorization", format!("Bearer {TOKEN}")),
        ],
        vec![
            ("authorization", format!("Bearer {TOKEN}")),
            ("x-table-principal", "alice".into()),
        ],
        vec![("x-table-principal", "alice".into())],
        vec![
            ("authorization", format!("Bearer {TOKEN}")),
            (
                "x-table-gateway-token",
                "gggggggggggggggggggggggggggggggg".into(),
            ),
        ],
    ] {
        let mut r = Request::builder().uri("/capabilities");
        for (k, v) in headers {
            r = r.header(k, v);
        }
        assert_eq!(h.send(r.body(Body::empty()).unwrap()).await.0, 401);
    }
    let source = h.upload(b"x\n2\n").await;
    let open = h.open(&source, "en-US", 1).await;
    for path in [
        format!("/sources/{source}"),
        format!("/sessions/{}", open["sessionId"].as_str().unwrap()),
    ] {
        let r = Request::builder()
            .method("DELETE")
            .uri(path)
            .header("x-table-gateway-token", "gggggggggggggggggggggggggggggggg")
            .header("x-table-principal", "bob")
            .body(Body::empty())
            .unwrap();
        assert!(matches!(h.send(r).await.0, 404 | 410));
    }
}
#[tokio::test]
async fn invalid_json_bounded_upload_and_managed_registration_refuse() {
    let h = Harness::new(table_service::ServiceLimits {
        max_upload_bytes: 4,
        ..Default::default()
    });
    assert_eq!(h.raw("POST", "/sessions", "{".into(), true).await.0, 400);
    use axum::{body::Body, http::Request};
    let r = Request::builder()
        .method("POST")
        .uri("/sources/uploads")
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("x-upload-filename", "x.csv")
        .header("idempotency-key", "key")
        .body(Body::from("12345"))
        .unwrap();
    assert_eq!(h.send(r).await.0, 413);
    let h = Harness::new(Default::default());
    let source = h.upload(b"x\n2\n").await;
    let open = h.open(&source, "en-US", 1).await;
    assert_eq!(
        h.command(
            &open,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":0,"limit":1001}})
            ),
            None
        )
        .await
        .0,
        413
    );
    assert_eq!(
        h.command(
            &open,
            request(
                "importFile",
                1,
                json!({"name":"x.csv","bytes":[],"inputRevision":1})
            ),
            None
        )
        .await
        .0,
        400
    );
}
#[tokio::test]
async fn dispatches_full_provider_operation_surface_without_replacing_selection_result() {
    let h = Harness::new(Default::default());
    let source = h.upload(b"x,y\n2,a\n3,b\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, schema) = h
        .command(&open, request("inputSchema", 1, json!({})), None)
        .await;
    assert_eq!(wire(&schema)["response"]["kind"], "inputSchema");
    let (_, active) = h.command(&open, apply(1), None).await;
    for (kind, fields, expected) in [
        (
            "previewDefinition",
            json!({"definition":definition()}),
            "previewDefinition",
        ),
        (
            "bindFormula",
            json!({"definition":definition(),"draft":{"id":"f","name":"f","scope":"source","expression":"1+2"},"bindings":[]}),
            "error",
        ),
        (
            "selection",
            json!({"action":{"kind":"all"},"visibleIds":[]}),
            "selection",
        ),
        (
            "identityWitness",
            json!({"path":[definition(),definition()],"ids":["absent"]}),
            "identityWitness",
        ),
        (
            "inspect",
            json!({"collection":"definitions","offset":0,"limit":10}),
            "inspect",
        ),
        ("totals", json!({}), "totals"),
        ("chartData", json!({"fields":["x"]}), "chartData"),
        ("facets", json!({"categoryId":"x"}), "facets"),
        (
            "memberDomain",
            json!({"definition":definition(),"categoryId":"x","categoryRecipe":"x","offset":0,"limit":10}),
            "error",
        ),
    ] {
        let (s, v) = h.command(&active, request(kind, 1, fields), None).await;
        assert_eq!(s, 200, "{kind}: {v}");
        assert_eq!(wire(&v)["response"]["kind"], expected, "{kind}: {v}");
        assert_eq!(v["resultId"], active["resultId"]);
    }
}
#[tokio::test]
async fn analytical_authoring_member_domains_facets_witness_and_structural_negative_zero() {
    let h = Harness::new(Default::default());
    let source = h.upload(b"x,y\n2,a\n3,b\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let mut applied = apply(1);
    let d = analytical_definition();
    applied["definition"] = d.clone();
    let (s, active) = h.command(&opened, applied, None).await;
    assert_eq!(s, 200, "{active}");
    assert_eq!(wire(&active)["response"]["kind"], "viewReady", "{active}");
    let bind = request(
        "bindFormula",
        1,
        json!({"definition":d,"draft":{"id":"f","name":"f","scope":"source","expression":"1+2"},"bindings":[]}),
    );
    let (_, bound) = h.command(&active, bind, None).await;
    assert_eq!(wire(&bound)["response"]["kind"], "bindFormula", "{bound}");
    assert!(wire(&bound)["response"]["ast"].is_object());
    let validated =
        pivot_core::validation::validate_definition(&serde_json::from_value(d.clone()).unwrap())
            .unwrap();
    let columns: Vec<pivot_core::contract::DatasetColumn> =
        serde_json::from_value(json!([{"id":"x","label":"x"},{"id":"y","label":"y"}])).unwrap();
    let compiled = pivot_core::formulas::compile(&validated, &columns);
    let recipe = pivot_core::scopes::category_authoring_recipe(
        &compiled,
        "cat",
        &pivot_native::NativeOrder::new("en-US").unwrap(),
    )
    .unwrap()
    .unwrap();
    let(_,domain)=h.command(&active,request("memberDomain",1,json!({"definition":d,"categoryId":"cat","categoryRecipe":recipe,"offset":0,"limit":10})),None).await;
    assert_eq!(
        wire(&domain)["response"]["kind"],
        "memberDomain",
        "{domain}"
    );
    assert_eq!(wire(&domain)["response"]["total"], 2);
    let (_, facets) = h
        .command(
            &active,
            request("facets", 1, json!({"categoryId":"cat"})),
            None,
        )
        .await;
    assert_eq!(wire(&facets)["response"]["kind"], "facets", "{facets}");
    let mut negative = d.clone();
    negative["definition"]["analytical"]["enabled"] = json!(false);
    negative["definition"]["analytical"]["formulas"] = json!([{"id":"negative","name":"Negative","scope":"source","expression":"-0","ast":{"kind":"literal","value":-0.0}}]);
    negative["analyticalRecipeSource"] =
        serde_json::to_value(tagged(&negative["definition"]["analytical"])).unwrap();
    let mut command = apply(2);
    command["definition"] = negative;
    let raw = json!({"protocolVersion":1,"sessionId":1,"request":command})
        .to_string()
        .replace("\"value\":-0.0", "\"value\":-0");
    assert!(raw.contains("\"value\":-0"));
    let(s,negative)=h.call("POST",&format!("/sessions/{}/commands",active["sessionId"].as_str().unwrap()),Some(json!({"sessionId":active["sessionId"],"sourceSnapshotId":active["sourceSnapshotId"],"resultId":active["resultId"],"wire":raw})),true).await;
    assert_eq!(s, 200, "{negative}");
    assert_eq!(
        wire(&negative)["response"]["kind"],
        "viewReady",
        "{negative}"
    );
    let (_, rows) = h
        .command(
            &negative,
            request(
                "rows",
                2,
                json!({"request":{"groupPath":[],"offset":0,"limit":10}}),
            ),
            None,
        )
        .await;
    assert_eq!(
        wire(&rows)["response"]["rows"][0]["values"]["negative"]["value"],
        "-0",
        "{rows}"
    );
}
#[tokio::test]
async fn slow_body_deadline_and_http_capacity_are_bounded() {
    use axum::{
        body::{Body, Bytes},
        http::Request,
    };
    use std::sync::Arc;
    let h = Arc::new(Harness::configured(
        Default::default(),
        None,
        table_service::sessions::RuntimeConfig {
            body_seconds: 1,
            max_http_requests: 1,
            ..Default::default()
        },
    ));
    let entered = Arc::new(tokio::sync::Notify::new());
    let signal = entered.clone();
    let body = Body::from_stream(futures_util::stream::once(async move {
        signal.notify_one();
        std::future::pending::<Result<Bytes, std::io::Error>>().await
    }));
    let r = Request::builder()
        .method("POST")
        .uri("/sources/uploads")
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("idempotency-key", "slow")
        .header("x-upload-filename", "slow.csv")
        .body(body)
        .unwrap();
    let pending = {
        let h = h.clone();
        tokio::spawn(async move { h.send(r).await })
    };
    entered.notified().await;
    assert_eq!(h.call("GET", "/healthz", None, true).await.0, 413);
    let (s, e) = pending.await.unwrap();
    assert_eq!(s, 413);
    assert!(e["error"]["message"].as_str().unwrap().contains("deadline"));
    assert_eq!(h.call("GET", "/healthz", None, true).await.0, 200);
    assert_eq!(h.manager.usage()["admittedJobs"], 0);
}
#[tokio::test]
async fn unsafe_revisions_wrong_core_handle_and_outer_identity_are_rejected() {
    let h = Harness::new(Default::default());
    let source = h.upload(b"x\n2\n").await;
    let open = h.open(&source, "en-US", 1).await;
    assert_eq!(
        h.command(&open, apply(9_007_199_254_740_992), None).await.0,
        400
    );
    let path = format!("/sessions/{}/commands", open["sessionId"].as_str().unwrap());
    let wrong = json!({"sessionId":open["sessionId"],"sourceSnapshotId":open["sourceSnapshotId"],"wire":json!({"protocolVersion":1,"sessionId":2,"request":apply(1)}).to_string()});
    assert_eq!(h.call("POST", &path, Some(wrong), true).await.0, 400);
    let mut foreign = open.clone();
    foreign["sourceSnapshotId"] = json!("wrong");
    assert_eq!(
        h.command(&foreign, request("dispose", 1, json!({})), None)
            .await
            .0,
        409
    );
    assert_eq!(h.command(&open, apply(1), None).await.0, 200);
}
#[tokio::test]
async fn backend_discovery_registration_and_lifecycle_commands_use_safe_contract() {
    let h = Harness::new(Default::default());
    let (s, discovery) = h.call("GET", "/sources/backends", None, true).await;
    assert_eq!(s, 200);
    assert_eq!(discovery["backends"][0]["backendId"], "demo");
    assert_eq!(
        discovery["backends"][0]["widgets"][0]["parameters"],
        json!(["symbol"])
    );
    assert!(!discovery.to_string().contains("http"));
    assert_eq!(
        h.call("GET", "/widgets.json", None, true).await.1["managed_table"]["type"],
        "table_ssrm"
    );
    let binding = json!({"idempotencyKey":"backend","binding":{"backendId":"demo","widgetId":"quotes","params":{"symbol":"AAPL"}}});
    let (s, source) = h
        .call("POST", "/sources/backends", Some(binding.clone()), true)
        .await;
    assert_eq!(s, 200, "{source}");
    assert_eq!(
        h.call("POST", "/sources/backends", Some(binding), true)
            .await
            .1,
        source
    );
    assert_eq!(
        h.call(
            "DELETE",
            &format!("/sources/{}", source["sourceId"].as_str().unwrap()),
            None,
            true
        )
        .await
        .0,
        200
    );
    let source = h.upload(b"x\n2\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&opened, apply(1), None).await;
    let (_, cancelled) = h
        .command(
            &active,
            request("cancel", 1, json!({"targetRequestId":"none"})),
            None,
        )
        .await;
    assert_eq!(wire(&cancelled)["response"]["kind"], "cancelled");
    let (_, disposed) = h
        .command(&active, request("dispose", 1, json!({})), None)
        .await;
    assert_eq!(wire(&disposed)["response"]["kind"], "disposed");
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
}
#[tokio::test]
async fn memory_and_session_quotas_preserve_sources_and_results() {
    let h = Harness::configured(
        Default::default(),
        None,
        table_service::sessions::RuntimeConfig {
            principal_memory_budget_bytes: 1,
            ..Default::default()
        },
    );
    assert_eq!(h.call("POST","/sources/backends",Some(json!({"idempotencyKey":"b","binding":{"backendId":"demo","widgetId":"quotes","params":{}}})),true).await.0,413);
    let h = Harness::new(table_service::ServiceLimits {
        max_sessions_per_principal: 1,
        ..Default::default()
    });
    let source = h.upload(b"x\n2\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    assert_eq!(h.open_raw(&source, "en-US", 1).await.0, 413);
    let (s, v) = h.command(&opened, apply(1), None).await;
    assert_eq!(s, 200, "{v}");
}

#[tokio::test]
async fn row_block_heap_budget_is_distinct_from_encoded_batch_budget() {
    let h = Harness::new(table_service::ServiceLimits {
        max_parse_bytes: 8 * 1024 * 1024,
        max_cache_bytes: 64 * 1024 * 1024,
        max_export_batch_bytes: 1024 * 1024,
        max_row_block_rows: 100,
        ..Default::default()
    });
    let csv = format!("a,b,c,d,e,f,g,h\n{}", "1,2,3,4,5,6,7,8\n".repeat(200));
    let source = h.upload(csv.as_bytes()).await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&opened, apply(1), None).await;
    let (status, block) = h
        .command(
            &active,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":100,"limit":100}}),
            ),
            None,
        )
        .await;
    assert_eq!(status, 200, "{block}");
    assert_eq!(wire(&block)["response"]["kind"], "rows", "{block}");
    assert_eq!(
        wire(&block)["response"]["rows"].as_array().unwrap().len(),
        100
    );
    assert!(block["wire"].as_str().unwrap().len() < 1024 * 1024);
}

#[tokio::test]
async fn upload_filename_decodes_uri_component_once_before_metadata_validation() {
    use axum::{body::Body, http::Request};
    use table_service::{Principal, StoredSource};
    let h = Harness::new(Default::default());
    for (i, (encoded, expected)) in [
        (
            format!("{}.csv", "%E6%95%B0".repeat(60)),
            format!("{}.csv", "数".repeat(60)),
        ),
        ("sales%20%252F%20%2B.csv".into(), "sales %2F +.csv".into()),
    ]
    .into_iter()
    .enumerate()
    {
        let req = Request::builder()
            .method("POST")
            .uri("/sources/uploads")
            .header("authorization", format!("Bearer {TOKEN}"))
            .header("idempotency-key", format!("unicode-{i}"))
            .header("x-upload-filename", encoded)
            .header("content-type", "text/csv")
            .body(Body::from("x\n2\n"))
            .unwrap();
        let (status, response) = h.send(req).await;
        assert_eq!(status, 200, "{response}");
        let id = response["sourceId"].as_str().unwrap();
        let StoredSource::Upload { metadata, .. } = h
            .catalog
            .acquire(&Principal("alice".into()), id)
            .unwrap()
            .source
        else {
            panic!("expected upload");
        };
        assert_eq!(metadata.filename, expected);
        assert_eq!(h.open_raw(id, "en-US", 1).await.0, 200);
    }
    for (i, encoded) in [
        "bad%.csv",
        "bad%2.csv",
        "bad%GG.csv",
        "%FF.csv",
        "path%2Ffile.csv",
        "path%5Cfile.csv",
        "%00.csv",
        "%0A.csv",
    ]
    .into_iter()
    .enumerate()
    {
        let req = Request::builder()
            .method("POST")
            .uri("/sources/uploads")
            .header("authorization", format!("Bearer {TOKEN}"))
            .header("idempotency-key", format!("invalid-{i}"))
            .header("x-upload-filename", encoded)
            .body(Body::from("x\n2\n"))
            .unwrap();
        let (status, response) = h.send(req).await;
        assert_eq!(status, 400, "{encoded}: {response}");
        assert_eq!(response["error"]["code"], "invalid_input");
    }
}

// Held request bodies exercise the actual authenticated adapter, without taking
// permits directly or installing production scheduling hooks.
async fn held_http(
    h: &std::sync::Arc<Harness>,
    path: &str,
) -> tokio::task::JoinHandle<(u16, serde_json::Value)> {
    use axum::{
        body::{Body, Bytes},
        http::Request,
    };
    let entered = std::sync::Arc::new(tokio::sync::Notify::new());
    let signal = entered.clone();
    let body = Body::from_stream(futures_util::stream::once(async move {
        signal.notify_one();
        std::future::pending::<Result<Bytes, std::io::Error>>().await
    }));
    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .body(body)
        .unwrap();
    let h = h.clone();
    let pending = tokio::spawn(async move { h.send(req).await });
    tokio::time::timeout(std::time::Duration::from_secs(3), entered.notified())
        .await
        .expect("request body must be admitted");
    pending
}

#[tokio::test]
async fn saturated_http_preserves_bounded_control_admission_and_ownership() {
    use axum::{body::Body, http::Request};
    use std::sync::Arc;
    let h = Arc::new(Harness::configured(
        Default::default(),
        None,
        table_service::sessions::RuntimeConfig {
            max_http_requests: 1,
            body_seconds: 10,
            ..Default::default()
        },
    ));
    let source = h.upload(b"x\n1\n2\n3\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (status, active) = h.command(&opened, apply(1), None).await;
    assert_eq!(status, 200, "{active}");
    let id = active["sessionId"].as_str().unwrap();
    let export_request = json!({"sessionId":active["sessionId"],"sourceSnapshotId":active["sourceSnapshotId"],"resultId":active["resultId"],"wire":json!({"protocolVersion":1,"sessionId":1,"request":request("presented",1,json!({"transferId":"control-export","ignoreSelection":true}))}).to_string()});
    let (status, export) = h
        .call(
            "POST",
            &format!("/sessions/{id}/exports"),
            Some(export_request),
            true,
        )
        .await;
    assert_eq!(status, 200, "{export}");
    let export_path = format!("/exports/{}", export["exportId"].as_str().unwrap());
    let ordinary = held_http(&h, "/sessions").await;
    assert_eq!(h.call("GET", "/healthz", None, true).await.0, 413);
    for (method, path) in [
        ("POST", format!("/sessions/{id}/cancel")),
        ("DELETE", format!("/sessions/{id}")),
        ("DELETE", export_path.clone()),
    ] {
        assert_eq!(h.call(method, &path, Some(json!({})), false).await.0, 401);
        let req = Request::builder()
            .method(method)
            .uri(&path)
            .header("x-table-gateway-token", "gggggggggggggggggggggggggggggggg")
            .header("x-table-principal", "bob")
            .body(Body::from("{}"))
            .unwrap();
        assert!(
            matches!(h.send(req).await.0, 404 | 410),
            "wrong owner: {path}"
        );
    }
    assert_eq!(h.call("DELETE", &export_path, None, true).await.0, 200);
    assert_eq!(
        h.call(
            "POST",
            &format!("/sessions/{id}/cancel"),
            Some(json!({})),
            true
        )
        .await
        .0,
        200
    );
    assert_eq!(
        h.call("DELETE", &format!("/sessions/{id}"), None, true)
            .await
            .0,
        200
    );
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
    for (method, path) in [
        ("DELETE", "/sources/s"),
        ("POST", "/sessions/s/commands"),
        ("POST", "/sessions/s/derive"),
        ("POST", "/sessions/s/exports"),
        ("POST", "/sessions/s/cancel/"),
        ("POST", "/sessions/s/cancel?x=1"),
        ("POST", "/sessions/s%2fother/cancel"),
        ("POST", "//sessions/s/cancel"),
        ("POST", "/sessions/s"),
        ("DELETE", "/sessions/s/cancel"),
        ("DELETE", "/exports/e/"),
    ] {
        assert_eq!(
            h.call(method, path, Some(json!({})), true).await.0,
            413,
            "{method} {path} must not borrow control capacity"
        );
    }
    let a = held_http(&h, "/sessions/a/cancel").await;
    let b = held_http(&h, "/sessions/b/cancel").await;
    assert_eq!(h.call("DELETE", "/exports/e", None, true).await.0, 413);
    assert_eq!(h.call("GET", "/healthz", None, true).await.0, 413);
    a.abort();
    assert!(a.await.unwrap_err().is_cancelled());
    // The available control slot reaches the real handler (missing session).
    assert_eq!(
        h.call("POST", "/sessions/missing/cancel", Some(json!({})), true)
            .await
            .0,
        410
    );
    let c = held_http(&h, "/sessions/c/cancel").await;
    b.abort();
    c.abort();
    ordinary.abort();
    assert!(b.await.unwrap_err().is_cancelled());
    assert!(c.await.unwrap_err().is_cancelled());
    assert!(ordinary.await.unwrap_err().is_cancelled());
    assert_eq!(h.call("GET", "/healthz", None, true).await.0, 200);
    assert_eq!(h.manager.usage()["admittedJobs"], 0);
}

#[tokio::test]
async fn control_body_error_and_deadline_return_both_permits() {
    use std::sync::Arc;
    let h = Arc::new(Harness::configured(
        Default::default(),
        None,
        table_service::sessions::RuntimeConfig {
            body_seconds: 1,
            ..Default::default()
        },
    ));
    for _ in 0..3 {
        assert_eq!(
            h.raw("POST", "/sessions/a/cancel", "{".into(), true)
                .await
                .0,
            400
        );
    }
    for _ in 0..2 {
        let a = held_http(&h, "/sessions/a/cancel").await;
        let b = held_http(&h, "/sessions/b/cancel").await;
        assert_eq!(h.call("DELETE", "/exports/e", None, true).await.0, 413);
        // Control saturation cannot take the ordinary lane either.
        assert_eq!(h.call("GET", "/healthz", None, true).await.0, 200);
        for pending in [a, b] {
            let (status, error) = pending.await.unwrap();
            assert_eq!(status, 413);
            assert!(error["error"]["message"]
                .as_str()
                .unwrap()
                .contains("deadline"));
        }
    }
}
