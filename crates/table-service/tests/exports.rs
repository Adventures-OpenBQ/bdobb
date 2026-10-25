#![cfg(target_os = "linux")]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use serde_json::json;
use support::*;
use table_service::ServiceLimits;
#[tokio::test]
async fn export_pins_rows_and_schema_across_refresh_and_retries_last_batch() {
    let h = Harness::new(ServiceLimits {
        max_row_block_rows: 1,
        ..Default::default()
    });
    let source = h.upload(b"x,y\n2,a\n3,b\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&opened, apply(1), None).await;
    let presented = request(
        "presented",
        1,
        json!({"transferId":"transfer","ignoreSelection":false}),
    );
    let (s, first) = h.command(&active, presented.clone(), None).await;
    assert_eq!(s, 200, "{first}");
    assert_eq!(wire(&first)["response"]["columns"][0]["id"], "x");
    assert_eq!(
        wire(&first)["response"]["rows"][0]["values"]["x"]["value"],
        2.0
    );
    let (_, retry) = h.command(&active, presented, None).await;
    assert_eq!(first, retry);
    let mut refresh = apply(2);
    refresh["revision"]["input"] = json!(2);
    refresh["definition"]["definition"]["table"]["hidden"] = json!(["x"]);
    let (s, new) = h
        .command(&active, refresh, Some(json!({"inputRevision":2})))
        .await;
    assert_eq!(s, 200, "{new}");
    assert_ne!(new["sourceSnapshotId"], active["sourceSnapshotId"]);
    assert_eq!(
        wire(&new)["response"]["columns"].as_array().unwrap().len(),
        1
    );
    assert_eq!(wire(&new)["response"]["columns"][0]["id"], "y");
    let next = |seq| {
        let mut r = request(
            "nextSubset",
            1,
            json!({"transferId":"transfer","sequence":seq}),
        );
        r["requestId"] = json!("presented-1");
        r
    };
    assert_eq!(h.command(&active, next(2), None).await.0, 409);
    let (s, last) = h.command(&active, next(1), None).await;
    assert_eq!(s, 200, "{last}");
    assert_eq!(
        wire(&last)["response"]["rows"][0]["values"]["x"]["value"],
        3.0
    );
    assert_eq!(wire(&last)["response"]["final"], true);
    assert_eq!(h.command(&active, next(1), None).await.1, last);
}
#[tokio::test]
async fn dedicated_export_retries_fingerprint_selection_and_delete_releases_pin() {
    let h = Harness::new(ServiceLimits {
        max_row_block_rows: 1,
        ..Default::default()
    });
    let source = h.upload(b"x\n2\n3\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&open, apply(1), None).await;
    let envelope = |ignore| json!({"sessionId":active["sessionId"],"sourceSnapshotId":active["sourceSnapshotId"],"resultId":active["resultId"],"wire":json!({"protocolVersion":1,"sessionId":1,"request":request("presented",1,json!({"transferId":"export","ignoreSelection":ignore}))}).to_string()});
    let path = format!(
        "/sessions/{}/exports",
        active["sessionId"].as_str().unwrap()
    );
    let (s, e) = h.call("POST", &path, Some(envelope(false)), true).await;
    assert_eq!(s, 200, "{e}");
    assert_eq!(
        h.call("POST", &path, Some(envelope(false)), true).await.1,
        e
    );
    assert_eq!(
        h.call("POST", &path, Some(envelope(true)), true).await.0,
        409
    );
    let id = e["exportId"].as_str().unwrap();
    assert_eq!(
        h.call(
            "GET",
            &format!("/exports/{id}/batches?sequence=2"),
            None,
            true
        )
        .await
        .0,
        409
    );
    let (_, next) = h
        .call(
            "GET",
            &format!("/exports/{id}/batches?sequence=1"),
            None,
            true,
        )
        .await;
    assert_eq!(
        wire(&next)["response"]["rows"][0]["values"]["x"]["value"],
        3.0
    );
    assert_eq!(
        h.call(
            "GET",
            &format!("/exports/{id}/batches?sequence=1"),
            None,
            true
        )
        .await
        .1,
        next
    );
    let (_, new) = h.command(&active, apply(2), None).await;
    assert_eq!(h.manager.usage()["retainedSlots"], 4);
    assert_eq!(
        h.call("DELETE", &format!("/exports/{id}"), None, true)
            .await
            .0,
        200
    );
    assert_eq!(h.manager.usage()["retainedSlots"], 2);
    assert_eq!(
        h.call(
            "GET",
            &format!("/exports/{id}/batches?sequence=1"),
            None,
            true
        )
        .await
        .0,
        410
    );
    assert_eq!(
        h.command(&new, request("totals", 2, json!({})), None)
            .await
            .0,
        200
    );
}
#[tokio::test]
async fn export_keeps_original_explicit_selection_across_later_apply() {
    let h = Harness::new(Default::default());
    let source = h.upload(b"x\n2\n3\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, initial) = h.command(&open, apply(1), None).await;
    let (_, rows) = h
        .command(
            &initial,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":0,"limit":10}}),
            ),
            None,
        )
        .await;
    let id = wire(&rows)["response"]["rows"][0]["id"].clone();
    let mut selected = apply(2);
    selected["selection"] = json!({"kind":"explicit","ids":[id]});
    let (_, active) = h.command(&initial, selected, None).await;
    let q = request(
        "presented",
        2,
        json!({"transferId":"selected","ignoreSelection":false}),
    );
    let (_, batch) = h.command(&active, q.clone(), None).await;
    assert_eq!(
        wire(&batch)["response"]["rows"].as_array().unwrap().len(),
        1
    );
    assert_eq!(
        wire(&batch)["response"]["rows"][0]["values"]["x"]["value"],
        2.0
    );
    let (_, next) = h.command(&active, apply(3), None).await;
    assert_ne!(active["resultId"], next["resultId"]);
    assert_eq!(h.command(&active, q, None).await.1, batch);
}
#[tokio::test]
async fn failed_batch_and_explicit_delete_release_native_transfer_capacity() {
    let h = Harness::configured(
        ServiceLimits {
            max_row_block_rows: 1,
            max_export_batch_bytes: 4096,
            max_cache_bytes: 64 * 1024 * 1024,
            ..Default::default()
        },
        None,
        table_service::sessions::RuntimeConfig {
            max_exports_per_principal: 1,
            ..Default::default()
        },
    );
    let data = format!("x\nshort\n{}\n", "a".repeat(5000));
    let source = h.upload(data.as_bytes()).await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&open, apply(1), None).await;
    let present = |id: &str| {
        request(
            "presented",
            1,
            json!({"transferId":id,"ignoreSelection":false}),
        )
    };
    let (s, first) = h.command(&active, present("bad"), None).await;
    assert_eq!(s, 200, "{first}");
    let mut next = request("nextSubset", 1, json!({"transferId":"bad","sequence":1}));
    next["requestId"] = json!("presented-1");
    assert_eq!(h.command(&active, next, None).await.0, 413);
    let (s, recovered) = h.command(&active, present("after-failure"), None).await;
    assert_eq!(s, 200, "{recovered}");
    let (_, cancelled) = h
        .command(
            &active,
            request("cancel", 1, json!({"targetRequestId":"presented-1"})),
            None,
        )
        .await;
    assert_eq!(wire(&cancelled)["response"]["kind"], "cancelled");
    assert_eq!(h.manager.usage()["retainedSlots"], 2);
    let (s, again) = h.command(&active, present("after-delete"), None).await;
    assert_eq!(s, 200, "{again}");
}

#[tokio::test]
async fn expired_initial_export_retry_refuses_without_periodic_cleanup() {
    let h = Harness::new(ServiceLimits {
        max_session_seconds: 1,
        ..Default::default()
    });
    let source = h.upload(b"x\n2\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&open, apply(1), None).await;
    let envelope = json!({"sessionId":active["sessionId"],"sourceSnapshotId":active["sourceSnapshotId"],"resultId":active["resultId"],"wire":json!({"protocolVersion":1,"sessionId":1,"request":request("presented",1,json!({"transferId":"expiring","ignoreSelection":false}))}).to_string()});
    let path = format!(
        "/sessions/{}/exports",
        active["sessionId"].as_str().unwrap()
    );
    assert_eq!(
        h.call("POST", &path, Some(envelope.clone()), true).await.0,
        200
    );
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    assert_eq!(h.call("POST", &path, Some(envelope), true).await.0, 410);
}

use std::sync::{Arc, Condvar, Mutex};
use table_service::sessions::ComputeObserver;
struct ReadBarrier {
    entered: tokio::sync::Notify,
    released: (Mutex<bool>, Condvar),
}
impl ComputeObserver for ReadBarrier {
    fn after_read(&self, _: &pivot_core::session::CoreRequest) {
        self.entered.notify_one();
        let mut released = self.released.0.lock().unwrap();
        while !*released {
            released = self.released.1.wait(released).unwrap();
        }
    }
}
#[tokio::test]
async fn cancelled_or_timed_out_read_preserves_a_pinned_export_and_published_worker() {
    for mode in ["cancel", "timeout"] {
        let barrier = Arc::new(ReadBarrier {
            entered: tokio::sync::Notify::new(),
            released: (Mutex::new(false), Condvar::new()),
        });
        let h = Arc::new(Harness::with_observer(
            ServiceLimits {
                max_row_block_rows: 1,
                max_job_seconds: if mode == "timeout" { 1 } else { 60 },
                ..Default::default()
            },
            Some(barrier.clone()),
        ));
        let source = h.upload(b"x,y\n2,a\n3,b\n4,c\n").await;
        let open = h.open(&source, "en-US", 1).await;
        let (_, active) = h.command(&open, apply(1), None).await;
        let (status, first) = h
            .command(
                &active,
                request(
                    "presented",
                    1,
                    json!({"transferId":"pinned","ignoreSelection":false}),
                ),
                None,
            )
            .await;
        assert_eq!(status, 200, "{first}");
        let pending = {
            let h = h.clone();
            let active = active.clone();
            tokio::spawn(async move {
                h.command(
                    &active,
                    request("chartData", 1, json!({"fields":["x","y"]})),
                    None,
                )
                .await
            })
        };
        barrier.entered.notified().await;
        if mode == "cancel" {
            let (status, value) = h
                .call(
                    "POST",
                    &format!("/sessions/{}/cancel", active["sessionId"].as_str().unwrap()),
                    Some(json!({"targetRequestId":"chartData-1"})),
                    true,
                )
                .await;
            assert_eq!(status, 200, "{value}");
        } else {
            tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        }
        *barrier.released.0.lock().unwrap() = true;
        barrier.released.1.notify_all();
        let (status, value) = pending.await.unwrap();
        assert!(status == 409 || status == 413, "{mode}: {status} {value}");
        let mut next = request("nextSubset", 1, json!({"transferId":"pinned","sequence":1}));
        next["requestId"] = json!("presented-1");
        let (status, value) = h.command(&active, next, None).await;
        assert_eq!(
            status, 200,
            "{mode} must preserve the pinned export: {value}"
        );
        assert_eq!(
            wire(&value)["response"]["rows"][0]["values"]["x"]["value"],
            3.0
        );
        let (status, value) = h
            .command(&active, request("totals", 1, json!({})), None)
            .await;
        assert_eq!(status, 200, "{mode} must preserve published reads: {value}");
        h.manager.shutdown();
        assert_eq!(h.manager.usage()["retainedSlots"], 0);
    }
}
#[tokio::test]
async fn overlapping_read_and_export_batch_serialize_within_existing_job_admission() {
    let barrier = Arc::new(ReadBarrier {
        entered: tokio::sync::Notify::new(),
        released: (Mutex::new(false), Condvar::new()),
    });
    let h = Arc::new(Harness::with_observer(
        ServiceLimits {
            max_row_block_rows: 1,
            ..Default::default()
        },
        Some(barrier.clone()),
    ));
    let source = h.upload(b"x\n2\n3\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&open, apply(1), None).await;
    assert_eq!(
        h.command(
            &active,
            request(
                "presented",
                1,
                json!({"transferId":"pinned","ignoreSelection":false})
            ),
            None
        )
        .await
        .0,
        200
    );
    let read = {
        let h = h.clone();
        let active = active.clone();
        tokio::spawn(async move {
            h.command(
                &active,
                request("chartData", 1, json!({"fields":["x"]})),
                None,
            )
            .await
        })
    };
    barrier.entered.notified().await;
    let next = {
        let h = h.clone();
        let active = active.clone();
        tokio::spawn(async move {
            let mut next = request("nextSubset", 1, json!({"transferId":"pinned","sequence":1}));
            next["requestId"] = json!("presented-1");
            h.command(&active, next, None).await
        })
    };
    // The read holds the native worker. A bounded admitted batch must wait, not return a spurious revision conflict.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let finished_early = next.is_finished();
    *barrier.released.0.lock().unwrap() = true;
    barrier.released.1.notify_all();
    let (status, value) = read.await.unwrap();
    assert_eq!(status, 200, "{value}");
    let (status, value) = next.await.unwrap();
    assert_eq!(status, 200, "overlapping export: {value}");
    assert!(
        !finished_early,
        "export should wait behind the admitted read"
    );
    assert_eq!(
        wire(&value)["response"]["rows"][0]["values"]["x"]["value"],
        3.0
    );
    h.manager.shutdown();
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
}

// Export delete is a control route: it must not need compute admission, or a
// busy principal leaks the export's slot until session expiry.
struct ArmedBarrier {
    armed: std::sync::atomic::AtomicBool,
    entered: tokio::sync::Notify,
    released: (Mutex<bool>, Condvar),
}
impl ComputeObserver for ArmedBarrier {
    fn after_read(&self, _: &pivot_core::session::CoreRequest) {
        if !self.armed.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        self.entered.notify_one();
        let mut released = self.released.0.lock().unwrap();
        while !*released {
            released = self.released.1.wait(released).unwrap();
        }
    }
}
// Releases on drop, so a failed assertion fails instead of hanging runtime shutdown.
struct Release(Arc<ArmedBarrier>);
impl Drop for Release {
    fn drop(&mut self) {
        *self.0.released.0.lock().unwrap() = true;
        self.0.released.1.notify_all();
    }
}
#[tokio::test]
async fn export_delete_succeeds_while_principal_compute_admission_is_full() {
    let barrier = Arc::new(ArmedBarrier {
        armed: false.into(),
        entered: tokio::sync::Notify::new(),
        released: (Mutex::new(false), Condvar::new()),
    });
    let release = Release(barrier.clone());
    let h = Arc::new(Harness::with_observer(
        ServiceLimits {
            max_concurrent_jobs_per_principal: 1,
            ..Default::default()
        },
        Some(barrier.clone()),
    ));
    let source = h.upload(b"x\n1\n2\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&opened, apply(1), None).await;
    let id = active["sessionId"].as_str().unwrap().to_owned();
    let export_request = json!({"sessionId":active["sessionId"],"sourceSnapshotId":active["sourceSnapshotId"],"resultId":active["resultId"],"wire":json!({"protocolVersion":1,"sessionId":1,"request":request("presented",1,json!({"transferId":"busy-export","ignoreSelection":true}))}).to_string()});
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
    // Hold the slot with a read on another session: the barrier blocks while
    // holding that session's worker lock, which the export's close also takes.
    let other_open = h.open(&source, "en-US", 1).await;
    let (_, other) = h.command(&other_open, apply(1), None).await;
    barrier
        .armed
        .store(true, std::sync::atomic::Ordering::Release);
    let pending = {
        let h = h.clone();
        tokio::spawn(async move {
            h.command(&other, request("totals", 1, json!({})), None)
                .await
        })
    };
    barrier.entered.notified().await;
    // The principal's only compute slot is held.
    assert_eq!(
        h.command(&active, request("totals", 1, json!({})), None)
            .await
            .0,
        413
    );
    let (status, value) = h.call("DELETE", &export_path, None, true).await;
    assert_eq!(status, 200, "{value}");
    assert_eq!(h.call("DELETE", &export_path, None, true).await.0, 410);
    drop(release);
    assert_eq!(pending.await.unwrap().0, 200);
}
