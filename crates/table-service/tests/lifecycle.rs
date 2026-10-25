#![cfg(target_os = "linux")]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use serde_json::json;
use support::*;
#[tokio::test]
async fn stale_revisions_conflicts_retry_and_refresh_failure_preserve_publication() {
    let h = Harness::new(Default::default());
    let source = h.upload(b"x\n2\n3\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (s, active) = h.command(&opened, apply(3), None).await;
    assert_eq!(s, 200, "{active}");
    assert_eq!(wire(&active)["response"]["kind"], "viewReady");
    let (_, retry) = h.command(&opened, apply(3), None).await;
    assert_eq!(retry, active);
    assert_eq!(h.command(&active, apply(2), None).await.0, 409);
    let mut conflict = apply(3);
    conflict["requestId"] = json!("conflicting");
    assert_eq!(h.command(&active, conflict, None).await.0, 409);
    h.call("DELETE", &format!("/sources/{source}"), None, true)
        .await;
    let mut refresh = apply(4);
    refresh["revision"]["input"] = json!(2);
    assert_eq!(
        h.command(&active, refresh, Some(json!({"inputRevision":2})))
            .await
            .0,
        404
    );
    let (s, rows) = h
        .command(
            &active,
            request(
                "rows",
                3,
                json!({"request":{"groupPath":[],"offset":0,"limit":10}}),
            ),
            None,
        )
        .await;
    assert_eq!(s, 200);
    assert_eq!(wire(&rows)["response"]["rows"].as_array().unwrap().len(), 2);
    assert_eq!(
        h.call(
            "DELETE",
            &format!("/sessions/{}", active["sessionId"].as_str().unwrap()),
            None,
            true
        )
        .await
        .0,
        200
    );
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
    assert_eq!(h.command(&active, apply(5), None).await.0, 410);
}
use std::sync::{Arc, Condvar, Mutex};
use table_service::{sessions::ComputeObserver, ServiceLimits};
struct Barrier {
    entered: tokio::sync::Notify,
    release: (Mutex<bool>, Condvar),
}
impl Barrier {
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
impl ComputeObserver for Barrier {
    fn before_apply(&self, q: &pivot_core::session::CoreRequest) {
        if q.revision.model == 2 {
            self.entered.notify_one();
            let mut released = self.release.0.lock().unwrap();
            while !*released {
                released = self.release.1.wait(released).unwrap();
            }
        }
    }
}
#[tokio::test]
async fn slow_apply_cannot_overwrite_newer_apply_and_cancel_preserves_old_result() {
    let barrier = Barrier::new();
    let h = Arc::new(Harness::with_observer(
        Default::default(),
        Some(barrier.clone()),
    ));
    let source = h.upload(b"x\n2\n3\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&opened, apply(1), None).await;
    let slow = {
        let h = h.clone();
        let active = active.clone();
        tokio::spawn(async move { h.command(&active, apply(2), None).await })
    };
    barrier.entered.notified().await;
    let (s, new) = h.command(&active, apply(3), None).await;
    assert_eq!(s, 200, "{new}");
    barrier.release();
    assert_eq!(slow.await.unwrap().0, 409);
    assert_eq!(
        h.command(&new, request("totals", 3, json!({})), None)
            .await
            .0,
        200
    );
    let barrier = Barrier::new();
    let h = Arc::new(Harness::with_observer(
        Default::default(),
        Some(barrier.clone()),
    ));
    let source = h.upload(b"x\n2\n3\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&opened, apply(1), None).await;
    let slow = {
        let h = h.clone();
        let active = active.clone();
        tokio::spawn(async move { h.command(&active, apply(2), None).await })
    };
    barrier.entered.notified().await;
    let c = h
        .call(
            "POST",
            &format!("/sessions/{}/cancel", active["sessionId"].as_str().unwrap()),
            Some(json!({"targetRequestId":"applyModel-2"})),
            true,
        )
        .await;
    assert_eq!(c.0, 200);
    barrier.release();
    assert_eq!(slow.await.unwrap().0, 409);
    assert_eq!(
        h.command(&active, request("totals", 1, json!({})), None)
            .await
            .0,
        200
    );
}
#[tokio::test]
async fn expiry_is_distinct_from_empty_rows_and_cleanup_releases_inputs() {
    let h = Harness::new(ServiceLimits {
        max_session_seconds: 1,
        ..Default::default()
    });
    let source = h.upload(b"x\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&opened, apply(1), None).await;
    let (_, rows) = h
        .command(
            &active,
            request(
                "rows",
                1,
                json!({"request":{"groupPath":[],"offset":0,"limit":1}}),
            ),
            None,
        )
        .await;
    assert_eq!(wire(&rows)["response"]["rows"], json!([]));
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    assert_eq!(
        h.command(&active, request("totals", 1, json!({})), None)
            .await
            .0,
        410
    );
    h.manager.cleanup();
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
}
struct AfterBarrier(Arc<Barrier>);
impl ComputeObserver for AfterBarrier {
    fn after_apply(&self, q: &pivot_core::session::CoreRequest) {
        self.0.before_apply(q);
    }
}
#[tokio::test]
async fn cancellation_after_real_calculation_never_publishes_and_timeout_releases_candidate() {
    for timeout in [false, true] {
        let gate = Barrier::new();
        let limits = ServiceLimits {
            max_job_seconds: if timeout { 1 } else { 60 },
            ..Default::default()
        };
        let h = Arc::new(Harness::with_observer(
            limits,
            Some(Arc::new(AfterBarrier(gate.clone()))),
        ));
        let source = h.upload(b"x\n2\n3\n").await;
        let open = h.open(&source, "en-US", 1).await;
        let (_, active) = h.command(&open, apply(1), None).await;
        let slow = {
            let h = h.clone();
            let active = active.clone();
            tokio::spawn(async move { h.command(&active, apply(2), None).await })
        };
        gate.entered.notified().await;
        if timeout {
            assert_eq!(slow.await.unwrap().0, 413);
            gate.release();
        } else {
            assert_eq!(
                h.call(
                    "POST",
                    &format!("/sessions/{}/cancel", active["sessionId"].as_str().unwrap()),
                    Some(json!({"targetRequestId":"applyModel-2"})),
                    true
                )
                .await
                .0,
                200
            );
            gate.release();
            assert_eq!(slow.await.unwrap().0, 409);
        }
        for _ in 0..100 {
            if h.manager.usage()["admittedJobs"] == 0 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(h.manager.usage()["retainedSlots"], 2);
        let (s, v) = h
            .command(&active, request("totals", 1, json!({})), None)
            .await;
        assert_eq!(s, 200, "{v}");
        assert_eq!(wire(&v)["response"]["kind"], "totals");
    }
}
#[tokio::test]
async fn principal_queue_and_retained_budget_refuse_without_losing_current_result() {
    let gate = Barrier::new();
    let h = Arc::new(Harness::with_observer(
        ServiceLimits {
            max_concurrent_jobs_per_principal: 1,
            ..Default::default()
        },
        Some(gate.clone()),
    ));
    let source = h.upload(b"x\n2\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&open, apply(1), None).await;
    let slow = {
        let h = h.clone();
        let active = active.clone();
        tokio::spawn(async move { h.command(&active, apply(2), None).await })
    };
    gate.entered.notified().await;
    assert_eq!(
        h.command(&active, request("totals", 1, json!({})), None)
            .await
            .0,
        413
    );
    assert_eq!(
        h.call(
            "POST",
            &format!("/sessions/{}/cancel", active["sessionId"].as_str().unwrap()),
            Some(json!({})),
            true
        )
        .await
        .0,
        200
    );
    gate.release();
    assert_eq!(slow.await.unwrap().0, 409);
    let h = Harness::configured(
        Default::default(),
        None,
        table_service::sessions::RuntimeConfig {
            max_retained_slots_per_principal: 2,
            ..Default::default()
        },
    );
    let source = h.upload(b"x\n2\n").await;
    let open = h.open(&source, "en-US", 1).await;
    assert_eq!(h.command(&open, apply(1), None).await.0, 413);
    assert_eq!(h.manager.usage()["retainedSlots"], 2);
}
#[tokio::test]
async fn dispose_remains_available_when_compute_admission_is_full() {
    let gate = Barrier::new();
    let h = Arc::new(Harness::with_observer(
        ServiceLimits {
            max_concurrent_jobs_per_principal: 1,
            ..Default::default()
        },
        Some(gate.clone()),
    ));
    let source = h.upload(b"x\n2\n").await;
    let open = h.open(&source, "en-US", 1).await;
    let (_, active) = h.command(&open, apply(1), None).await;
    let pending = {
        let h = h.clone();
        let active = active.clone();
        tokio::spawn(async move { h.command(&active, apply(2), None).await })
    };
    gate.entered.notified().await;
    let (s, _) = h
        .call(
            "DELETE",
            &format!("/sessions/{}", active["sessionId"].as_str().unwrap()),
            None,
            true,
        )
        .await;
    gate.release();
    let _ = pending.await;
    assert_eq!(s, 200);
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
}

#[tokio::test]
async fn cancelling_queued_request_preserves_previous_publication() {
    let gate = Barrier::new();
    let h = Arc::new(Harness::configured(
        Default::default(),
        Some(gate.clone()),
        table_service::sessions::RuntimeConfig {
            compute_workers: 1,
            ..Default::default()
        },
    ));
    let source = h.upload(b"x\n2\n").await;
    let a = h.open(&source, "en-US", 1).await;
    let b = h.open(&source, "en-US", 1).await;
    let (_, a) = h.command(&a, apply(1), None).await;
    let (_, b) = h.command(&b, apply(1), None).await;
    let occupied = {
        let h = h.clone();
        tokio::spawn(async move { h.command(&a, apply(2), None).await })
    };
    gate.entered.notified().await;
    let queued = {
        let h = h.clone();
        let b = b.clone();
        tokio::spawn(async move { h.command(&b, apply(3), None).await })
    };
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while h.manager.usage()["admittedJobs"] != 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let (status, _) = h
        .call(
            "POST",
            &format!("/sessions/{}/cancel", b["sessionId"].as_str().unwrap()),
            Some(json!({"targetRequestId":"applyModel-3"})),
            true,
        )
        .await;
    gate.release();
    assert_eq!(status, 200);
    assert_eq!(occupied.await.unwrap().0, 200);
    assert_eq!(
        queued.await.unwrap().0,
        409,
        "a cancelled queued apply must never publish"
    );
    assert_eq!(
        h.command(&b, request("totals", 1, json!({})), None).await.0,
        200
    );
}

#[test]
fn explicit_http_control_fences_before_blocking_executor_can_run() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .max_blocking_threads(1)
        .build()
        .unwrap();
    runtime.block_on(async {
        for (dispose, core_command) in [(false, false), (true, false), (false, true), (true, true)]
        {
            let gate = Barrier::new();
            let h = Arc::new(Harness::with_observer(
                Default::default(),
                Some(Arc::new(AfterBarrier(gate.clone()))),
            ));
            let source = h.upload(b"x\n2\n").await;
            let open = h.open(&source, "en-US", 1).await;
            let (_, active) = h.command(&open, apply(1), None).await;
            let pending = {
                let h = h.clone();
                let active = active.clone();
                tokio::spawn(async move { h.command(&active, apply(2), None).await })
            };
            gate.entered.notified().await;
            let path = format!(
                "/sessions/{}{}",
                active["sessionId"].as_str().unwrap(),
                if dispose { "" } else { "/cancel" }
            );
            let mut control = Box::pin(async {
                if core_command {
                    h.command(
                        &active,
                        request(
                            if dispose { "dispose" } else { "cancel" },
                            1,
                            if dispose {
                                json!({})
                            } else {
                                json!({"targetRequestId":"applyModel-2"})
                            },
                        ),
                        None,
                    )
                    .await
                } else {
                    h.call(
                        if dispose { "DELETE" } else { "POST" },
                        &path,
                        if dispose {
                            None
                        } else {
                            Some(json!({"targetRequestId":"applyModel-2"}))
                        },
                        true,
                    )
                    .await
                }
            });
            // Poll the actual HTTP handler through its first blocking await while
            // the sole blocking thread is held after real native calculation.
            let first_poll = futures_util::poll!(&mut control);
            gate.release();
            let response = match first_poll {
                std::task::Poll::Ready(r) => r,
                std::task::Poll::Pending => control.await,
            };
            let calculated = pending.await.unwrap();
            assert_eq!(response.0, 200, "{response:?}");
            assert_ne!(
                calculated.0, 200,
                "control must fence before deferred cleanup: {calculated:?}"
            );
            assert_eq!(
                h.command(&active, request("totals", 1, json!({})), None)
                    .await
                    .0,
                if dispose { 410 } else { 200 }
            );
        }
    });
}

#[tokio::test]
async fn encoded_inputs_reserve_bytes_without_a_second_phantom_worker() {
    let limits = ServiceLimits {
        max_parse_bytes: 8 * 1024 * 1024,
        max_upload_bytes: 2 * 1024 * 1024,
        max_cache_bytes: 64 * 1024 * 1024,
        ..Default::default()
    };
    let input_reservation = limits.max_parse_bytes + 64 * 1024;
    let native_reservation = 512 * 1024 * 1024
        + (limits.max_parse_bytes + 4096) * 3
        + limits.max_cache_bytes
        + 2 * 1024 * 1024;
    let h = Harness::new(limits);
    let baseline = h.manager.usage()["reservedMemoryBytes"].as_u64().unwrap();
    let source = h.upload(b"x,y\n1,a\n2,b\n").await;
    let opened = h.open(&source, "en-US", 1).await;
    assert_eq!(
        h.manager.usage()["reservedMemoryBytes"].as_u64().unwrap() - baseline,
        input_reservation + native_reservation
    );
    let (status, parent) = h.command(&opened, apply(1), None).await;
    assert_eq!(status, 200, "{parent}");
    let (status, child) = h.call("POST", &format!("/sessions/{}/derive", parent["sessionId"].as_str().unwrap()), Some(json!({"parent":{"sessionId":parent["sessionId"],"sourceSnapshotId":parent["sourceSnapshotId"],"resultId":parent["resultId"]},"revision":{"widgetId":"widget","input":1,"model":1,"output":1},"requestId":"accounted-derive","protocolVersion":1,"widgetId":"child","inputRevision":1,"locale":"en-US"})), true).await;
    assert_eq!(status, 200, "{child}");
    assert_eq!(
        h.manager.usage()["reservedMemoryBytes"].as_u64().unwrap() - baseline,
        2 * (input_reservation + native_reservation)
    );
    assert_eq!(h.manager.usage()["retainedSlots"], 4);
    for session in [&parent, &child] {
        assert_eq!(
            h.call(
                "DELETE",
                &format!("/sessions/{}", session["sessionId"].as_str().unwrap()),
                None,
                true
            )
            .await
            .0,
            200
        );
    }
    assert_eq!(h.manager.usage()["reservedMemoryBytes"], baseline);
    assert_eq!(h.manager.usage()["retainedSlots"], 0);
}
