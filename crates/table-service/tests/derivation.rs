#![cfg(target_os = "linux")]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use serde_json::{json, Value};
use support::*;
use table_service::ServiceLimits;
fn derive(parent: &Value) -> Value {
    json!({"parent":{"sessionId":parent["sessionId"],"sourceSnapshotId":parent["sourceSnapshotId"],"resultId":parent["resultId"]},"revision":{"widgetId":"widget","input":1,"model":1,"output":1},"requestId":"derive-child","protocolVersion":1,"widgetId":"child","inputRevision":7,"locale":"en-US"})
}
fn path(parent: &Value) -> String {
    format!("/sessions/{}/derive", parent["sessionId"].as_str().unwrap())
}
#[tokio::test]
async fn derives_complete_native_subset_and_child_survives_parent_disposal() {
    let h = Harness::new(ServiceLimits {
        max_row_block_rows: 2,
        ..Default::default()
    });
    let source = h.upload(b"x,y\n1,a\n2,b\n3,c\n4,d\n5,e\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, parent) = h.command(&opened, apply(1), None).await;
    let (status, child) = h
        .call("POST", &path(&parent), Some(derive(&parent)), true)
        .await;
    assert_eq!(status, 200, "{child}");
    assert!(
        child.get("wire").is_none()
            && child.get("rows").is_none()
            && child.get("sourceId").is_none()
    );
    assert_eq!(child["limits"]["max_row_block_rows"], 2);
    h.call(
        "DELETE",
        &format!("/sessions/{}", parent["sessionId"].as_str().unwrap()),
        None,
        true,
    )
    .await;
    h.call("DELETE", &format!("/sources/{source}"), None, true)
        .await;
    let mut q = apply(1);
    q["revision"] = json!({"widgetId":"child","input":7,"model":1,"output":1});
    let (status, active) = h.command(&child, q, None).await;
    assert_eq!(status, 200, "{active}");
    assert_eq!(wire(&active)["response"]["topLevelCount"]["value"], 5);
    let mut q = request(
        "presented",
        1,
        json!({"transferId":"child-subset","ignoreSelection":false}),
    );
    q["revision"] = json!({"widgetId":"child","input":7,"model":1,"output":1});
    let (_, batch) = h.command(&active, q, None).await;
    assert_eq!(
        wire(&batch)["response"]["provenance"]["lineage"][0],
        json!({"widgetId":"widget","resultRevision":1,"outputRevision":1})
    );
    let mut body = derive(&active);
    body["revision"] = json!({"widgetId":"child","input":7,"model":1,"output":1});
    body["widgetId"] = json!("grandchild");
    let (status, grandchild) = h.call("POST", &path(&active), Some(body), true).await;
    assert_eq!(status, 200, "{grandchild}");
    for session in [&child, &grandchild] {
        h.call(
            "DELETE",
            &format!("/sessions/{}", session["sessionId"].as_str().unwrap()),
            None,
            true,
        )
        .await;
    }
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
}
#[tokio::test]
async fn refuses_missing_auth_foreign_and_stale_parent_identity_without_leaks() {
    let h = Harness::new(Default::default());
    let source = h.upload(b"x\n1\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, parent) = h.command(&open, apply(1), None).await;
    let baseline = h.manager.usage();
    assert_eq!(
        h.call("POST", &path(&parent), Some(derive(&parent)), false)
            .await
            .0,
        401
    );
    let mut foreign = derive(&parent);
    foreign["parent"]["sessionId"] = json!("foreign");
    assert_eq!(
        h.call("POST", "/sessions/foreign/derive", Some(foreign), true)
            .await
            .0,
        410
    );
    let mut stale = derive(&parent);
    stale["parent"]["sourceSnapshotId"] = json!("old");
    assert_eq!(
        h.call("POST", &path(&parent), Some(stale), true).await.0,
        409
    );
    assert_eq!(h.manager.usage(), baseline);
}

#[tokio::test]
async fn all_matching_exclusion_and_empty_selection_preserve_native_scope_and_metadata() {
    let h = Harness::new(ServiceLimits {
        max_row_block_rows: 2,
        ..Default::default()
    });
    let source = h.upload(b"x,y\n1,a\n2,b\n3,c\n4,d\n5,e\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let mut q = apply(1);
    q["definition"] = analytical_definition();
    let (_, active) = h.command(&open, q.clone(), None).await;
    let (_, page) = h
        .command(
            &active,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":4,"limit":1}}),
            ),
            None,
        )
        .await;
    let excluded = wire(&page)["response"]["rows"][0]["id"].clone();
    assert!(excluded.is_string(), "{page}");
    q["revision"]["model"] = json!(2);
    q["revision"]["output"] = json!(2);
    q["selection"] = json!({"kind":"allMatching","excludedIds":[excluded]});
    let (_, selected) = h.command(&active, q, None).await;
    let mut body = derive(&selected);
    body["revision"]["model"] = json!(2);
    body["revision"]["output"] = json!(2);
    let (status, child) = h.call("POST", &path(&selected), Some(body), true).await;
    assert_eq!(status, 200, "{child}");
    let mut q = apply(1);
    q["revision"] = json!({"widgetId":"child","input":7,"model":1,"output":1});
    let (_, child_active) = h.command(&child, q, None).await;
    assert_eq!(wire(&child_active)["response"]["topLevelCount"]["value"], 4);
    let mut q = request(
        "presented",
        1,
        json!({"transferId":"child","ignoreSelection":false}),
    );
    q["revision"] = json!({"widgetId":"child","input":7,"model":1,"output":1});
    let (_, actual) = h.command(&child_active, q, None).await;
    let (_, expected) = h
        .command(
            &selected,
            request(
                "presented",
                2,
                json!({"transferId":"parent","ignoreSelection":false}),
            ),
            None,
        )
        .await;
    let mut actual = wire(&actual);
    let expected = wire(&expected);
    // Ordinary registerInput infers dtype for presented columns, just as the local linked path.
    for column in actual["response"]["columns"].as_array_mut().unwrap() {
        column.as_object_mut().unwrap().remove("dtype");
    }
    for key in ["columns", "completeness", "freshness", "diagnostics"] {
        assert_eq!(actual["response"][key], expected["response"][key], "{key}");
    }
    assert_eq!(
        actual["response"]["provenance"]["lineage"][0],
        json!({"widgetId":"widget","resultRevision":2,"outputRevision":2})
    );
    h.call(
        "DELETE",
        &format!("/sessions/{}", child["sessionId"].as_str().unwrap()),
        None,
        true,
    )
    .await;
    let mut ids = vec![];
    for offset in [0, 2, 4] {
        let (_, page) = h
            .command(
                &selected,
                request(
                    "rows",
                    2,
                    json!({"request":{"groupPath":[],"offset":offset,"limit":2}}),
                ),
                None,
            )
            .await;
        ids.extend(
            wire(&page)["response"]["rows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| r["id"].clone()),
        );
    }
    let mut q = apply(3);
    q["definition"] = analytical_definition();
    q["selection"] = json!({"kind":"allMatching","excludedIds":ids});
    let (_, empty) = h.command(&selected, q, None).await;
    let mut body = derive(&empty);
    body["revision"]["model"] = json!(3);
    body["revision"]["output"] = json!(3);
    let (status, child) = h.call("POST", &path(&empty), Some(body), true).await;
    assert_eq!(status, 200, "{child}");
    let mut q = apply(1);
    q["revision"] = json!({"widgetId":"child","input":7,"model":1,"output":1});
    let (_, active) = h.command(&child, q, None).await;
    assert_eq!(wire(&active)["response"]["topLevelCount"]["value"], 0);
    assert_eq!(
        wire(&active)["response"]["columns"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let mut q = apply(2);
    q["revision"] = json!({"widgetId":"child","input":8,"model":2,"output":2});
    assert_eq!(
        h.command(&active, q, Some(json!({"inputRevision":8})))
            .await
            .0,
        400
    );
}
#[tokio::test]
async fn oversized_batch_and_session_quota_release_reservations_and_cursors() {
    for quota in [false, true] {
        let h = Harness::new(ServiceLimits {
            max_sessions_per_principal: if quota { 1 } else { 8 },
            max_row_block_rows: 1,
            max_export_batch_bytes: 4096,
            ..Default::default()
        });
        let text = format!("x\nshort\n{}\n", "a".repeat(5000));
        let source = h.upload(text.as_bytes()).await;
        let open = h.open(&source, "en-US", 1).await;
        let (_, parent) = h.command(&open, apply(1), None).await;
        let baseline = h.manager.usage();
        for _ in 0..2 {
            let (status, value) = h
                .call("POST", &path(&parent), Some(derive(&parent)), true)
                .await;
            assert_eq!(status, 413, "{value}");
            assert_eq!(h.manager.usage(), baseline);
        }
        let (status, value) = h
            .command(
                &parent,
                request(
                    "presented",
                    1,
                    json!({"transferId":"after-refusal","ignoreSelection":false}),
                ),
                None,
            )
            .await;
        assert_eq!(status, 200, "{value}");
    }
}

use std::sync::{Arc, Condvar, Mutex};
use table_service::sessions::ComputeObserver;
struct DeriveBarrier {
    entered: tokio::sync::Notify,
    release: (Mutex<bool>, Condvar),
}
impl DeriveBarrier {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            entered: tokio::sync::Notify::new(),
            release: (Mutex::new(false), Condvar::new()),
        })
    }
    fn release(&self) {
        *self.release.0.lock().unwrap() = true;
        self.release.1.notify_all();
    }
}
impl ComputeObserver for DeriveBarrier {
    fn after_derived_batch(&self, _: &pivot_core::contract::Revision, sequence: u64) {
        if sequence != 0 {
            return;
        }
        self.entered.notify_one();
        let mut released = self.release.0.lock().unwrap();
        while !*released {
            released = self.release.1.wait(released).unwrap();
        }
    }
}
#[tokio::test]
async fn admitted_derivation_pins_before_parent_refresh_and_catalog_deletion() {
    let barrier = DeriveBarrier::new();
    let h = Arc::new(Harness::with_observer(
        ServiceLimits {
            max_row_block_rows: 1,
            ..Default::default()
        },
        Some(barrier.clone()),
    ));
    let source = h.upload(b"x,y\n1,a\n2,b\n3,c\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, parent) = h.command(&open, apply(1), None).await;
    let pending = {
        let h = h.clone();
        let parent = parent.clone();
        tokio::spawn(async move {
            h.call("POST", &path(&parent), Some(derive(&parent)), true)
                .await
        })
    };
    barrier.entered.notified().await;
    let mut refresh = apply(2);
    refresh["revision"]["input"] = json!(2);
    refresh["definition"]["definition"]["table"]["hidden"] = json!(["x"]);
    let (status, new) = h
        .command(&parent, refresh, Some(json!({"inputRevision":2})))
        .await;
    assert_eq!(status, 200, "{new}");
    h.call("DELETE", &format!("/sources/{source}"), None, true)
        .await;
    barrier.release();
    let (status, child) = pending.await.unwrap();
    assert_eq!(status, 200, "{child}");
    let mut q = apply(1);
    q["revision"] = json!({"widgetId":"child","input":7,"model":1,"output":1});
    q["definition"] = analytical_definition();
    let (status, child_active) = h.command(&child, q, None).await;
    assert_eq!(status, 200, "{child_active}");
    assert_eq!(wire(&child_active)["response"]["topLevelCount"]["value"], 3);
    assert!(
        wire(&child_active)["response"]["columns"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["id"].as_str().unwrap().contains("measure")),
        "{child_active}"
    );
    for session in [&new, &child] {
        h.call(
            "DELETE",
            &format!("/sessions/{}", session["sessionId"].as_str().unwrap()),
            None,
            true,
        )
        .await;
    }
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
}
#[tokio::test]
async fn cancelled_timed_out_disposed_and_expired_derivation_release_all_admission() {
    for mode in ["cancel", "timeout", "dispose", "expiry"] {
        let barrier = DeriveBarrier::new();
        let h = Arc::new(Harness::with_observer(
            ServiceLimits {
                max_row_block_rows: 1,
                max_job_seconds: if mode == "timeout" { 1 } else { 60 },
                max_session_seconds: if mode == "expiry" { 1 } else { 1800 },
                ..Default::default()
            },
            Some(barrier.clone()),
        ));
        let source = h.upload(b"x\n1\n2\n3\n").await;
        let open = h.open(&source, "en-US", 1).await;
        let (_, parent) = h.command(&open, apply(1), None).await;
        let before = h.manager.usage();
        let pending = {
            let h = h.clone();
            let parent = parent.clone();
            tokio::spawn(async move {
                h.call("POST", &path(&parent), Some(derive(&parent)), true)
                    .await
            })
        };
        barrier.entered.notified().await;
        if mode == "cancel" {
            h.call(
                "POST",
                &format!("/sessions/{}/cancel", parent["sessionId"].as_str().unwrap()),
                Some(json!({"targetRequestId":"derive-child"})),
                true,
            )
            .await;
        }
        if mode == "dispose" {
            h.call(
                "DELETE",
                &format!("/sessions/{}", parent["sessionId"].as_str().unwrap()),
                None,
                true,
            )
            .await;
        }
        if mode == "timeout" || mode == "expiry" {
            tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        }
        barrier.release();
        let (status, value) = pending.await.unwrap();
        assert!(
            status == 409 || status == 410 || status == 413,
            "{mode}: {status} {value}"
        );
        for _ in 0..200 {
            if h.manager.usage()["admittedJobs"] == 0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(h.manager.usage()["admittedJobs"], 0);
        if mode == "dispose" {
            assert_eq!(h.manager.usage()["retainedSlots"], 0);
        } else {
            assert_eq!(h.manager.usage(), before);
        }
        if mode == "cancel" || mode == "timeout" {
            let (status, value) = h
                .command(&parent, request("totals", 1, json!({})), None)
                .await;
            assert_eq!(
                status, 200,
                "{mode} must preserve the published parent: {value}"
            );
        }
        h.manager.shutdown();
        assert_eq!(h.manager.usage()["retainedSlots"], 0);
    }
}
#[tokio::test]
async fn accumulated_bytes_and_derived_columns_are_admitted_before_retention() {
    for columns in [false, true] {
        let limits = if columns {
            ServiceLimits {
                max_input_columns: 2,
                max_row_block_rows: 1,
                ..Default::default()
            }
        } else {
            ServiceLimits {
                max_parse_bytes: 4096,
                max_row_block_rows: 1,
                max_export_batch_bytes: 2048,
                ..Default::default()
            }
        };
        let h = Harness::new(limits);
        let csv = if columns {
            "x,y\n1,a\n2,b\n3,c\n4,d\n5,e\n".to_string()
        } else {
            format!(
                "x\n{}",
                (0..12).map(|i| format!("{i}\n")).collect::<String>()
            )
        };
        let source = h.upload(csv.as_bytes()).await;
        let open = h.open(&source, "en-US", 1).await;
        let mut q = apply(1);
        if columns {
            let mut d = analytical_definition();
            d["definition"]["analytical"]["layout"]["rows"] = json!([]);
            d["definition"]["analytical"]["layout"]["columns"] = json!(["cat"]);
            d["analyticalRecipeSource"] =
                serde_json::to_value(tagged(&d["definition"]["analytical"])).unwrap();
            q["definition"] = d;
        }
        let (status, parent) = h.command(&open, q, None).await;
        assert_eq!(status, 200, "{parent}");
        assert_eq!(wire(&parent)["response"]["kind"], "viewReady", "{parent}");
        let before = h.manager.usage();
        let (status, value) = h
            .call("POST", &path(&parent), Some(derive(&parent)), true)
            .await;
        assert_eq!(status, 413, "columns={columns}: {value}");
        assert_eq!(h.manager.usage(), before);
    }
}
#[tokio::test]
async fn actual_foreign_principal_cannot_pin_an_owned_parent() {
    use axum::{body::Body, http::Request};
    let h = Harness::new(Default::default());
    let source = h.upload(b"x\n1\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, parent) = h.command(&open, apply(1), None).await;
    let before = h.manager.usage();
    let req = Request::builder()
        .method("POST")
        .uri(path(&parent))
        .header("content-type", "application/json")
        .header("x-table-gateway-token", "gggggggggggggggggggggggggggggggg")
        .header("x-table-principal", "bob")
        .body(Body::from(derive(&parent).to_string()))
        .unwrap();
    assert_eq!(h.send(req).await.0, 410);
    assert_eq!(h.manager.usage(), before);
}

#[tokio::test]
async fn cancellation_during_outstanding_native_derivation_preserves_parent_and_admission() {
    use std::{
        os::{fd::AsRawFd, unix::fs::PermissionsExt},
        time::Duration,
    };
    // Record the last spawned real worker without changing its protocol or output.
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("worker.pid");
    let wrapper = dir.path().join("worker");
    let executable = std::env::var("TABLE_NATIVE_WORKER")
        .unwrap_or_else(|_| "/target/debug/pivot-native-worker".into());
    assert!(!executable.contains('\''));
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho $$ > '{}'\nexec '{}' \"$@\"\n",
            pid_file.display(),
            executable
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
    let h = Arc::new(Harness::configured_worker(
        ServiceLimits {
            max_row_block_rows: 1,
            ..Default::default()
        },
        None,
        table_service::sessions::RuntimeConfig {
            max_http_requests: 1,
            ..Default::default()
        },
        Some(wrapper),
    ));
    let source = h.upload(b"x\n1\n2\n3\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, parent) = h.command(&open, apply(1), None).await;
    let before = h.manager.usage();
    let pid: i32 = std::fs::read_to_string(pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    // The harness owns this live worker; resume on panic too, before dropping it.
    struct Resume(i32);
    impl Drop for Resume {
        fn drop(&mut self) {
            unsafe {
                libc::kill(self.0, libc::SIGCONT);
            }
        }
    }
    assert_eq!(unsafe { libc::kill(pid, libc::SIGSTOP) }, 0);
    let resume = Resume(pid);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = std::fs::read_to_string(format!("/proc/{pid}/status")).unwrap();
            if status
                .lines()
                .any(|line| line.starts_with("State:") && line.contains("T (stopped)"))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let input = std::fs::File::open(format!("/proc/{pid}/fd/0")).unwrap();
    let queued_bytes = || {
        let mut bytes: libc::c_int = 0;
        assert_eq!(
            unsafe { libc::ioctl(input.as_raw_fd(), libc::FIONREAD, &mut bytes) },
            0
        );
        bytes
    };
    assert_eq!(queued_bytes(), 0);
    let pending = {
        let h = h.clone();
        let parent = parent.clone();
        tokio::spawn(async move {
            h.call("POST", &path(&parent), Some(derive(&parent)), true)
                .await
        })
    };
    // Bytes queued to a stopped native worker prove dispatch_wire has entered
    // its transport, with no reply possible. This is not an after-RPC barrier.
    tokio::time::timeout(Duration::from_secs(5), async {
        while queued_bytes() <= 13 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!pending.is_finished());
    assert_eq!(h.call("GET", "/healthz", None, true).await.0, 413);
    assert_eq!(h.manager.usage()["admittedJobs"], 1);
    let cancel = tokio::time::timeout(
        Duration::from_secs(2),
        h.call(
            "POST",
            &format!("/sessions/{}/cancel", parent["sessionId"].as_str().unwrap()),
            Some(json!({"targetRequestId":"derive-child"})),
            true,
        ),
    )
    .await
    .expect("cancellation must not wait for the parent native lock");
    assert_eq!(cancel.0, 200, "{:?}", cancel.1);
    assert!(
        !pending.is_finished(),
        "RPC is still outstanding until the worker resumes"
    );
    drop(resume);
    let (status, value) = tokio::time::timeout(Duration::from_secs(5), pending)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status, 409, "{value}");
    assert!(
        value.get("sessionId").is_none(),
        "cancelled child must never publish"
    );
    assert_eq!(
        h.manager.usage(),
        before,
        "all child, cursor, job and memory admission reclaimed"
    );
    let (status, rows) = h
        .command(
            &parent,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":0,"limit":1}}),
            ),
            None,
        )
        .await;
    assert_eq!(status, 200, "{rows}");
    assert_eq!(
        wire(&rows)["response"]["rows"][0]["values"]["x"]["value"],
        1.0
    );
    // Reusing the same request and parent must fit the reclaimed admission.
    let (status, child) = h
        .call("POST", &path(&parent), Some(derive(&parent)), true)
        .await;
    assert_eq!(status, 200, "{child}");
    h.call(
        "DELETE",
        &format!("/sessions/{}", child["sessionId"].as_str().unwrap()),
        None,
        true,
    )
    .await;
    assert_eq!(h.manager.usage(), before);
}
