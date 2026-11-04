// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Avoid duplicating the full response Value tree for the transport wrapper.
use pivot_core::session::*;
use serde_json::{json, Value};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
struct Peak;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Peak {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let live = LIVE.fetch_add(layout.size(), Relaxed) + layout.size();
        PEAK.fetch_max(live, Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }
}
#[global_allocator]
static ALLOCATOR: Peak = Peak;
fn response() -> CoreResponse {
    let rows = (0..500).map(|i| json!({"id":format!("row-{i}"),"values":(0..10).map(|j|(format!("field-{j}"),json!({"tag":"f64","value":i as f64*0.25+j as f64}))).collect::<serde_json::Map<_,_>>()})).collect::<Vec<_>>();
    CoreResponse {
        request_id: "export".into(),
        revision: serde_json::from_value(
            json!({"widgetId":"source","input":1,"model":2,"output":3}),
        )
        .unwrap(),
        completeness: serde_json::from_value(json!({"kind":"complete","warnings":[]})).unwrap(),
        diagnostics: vec![],
        model_warnings: None,
        model_warning_count: None,
        result: Response::Subset(
            serde_json::from_value(
                json!({"transferId":"transfer","sequence":1,"final":false,"rows":rows}),
            )
            .unwrap(),
        ),
    }
}
// Frozen pre-optimization encoding for this response variant.
fn original(response: CoreResponse) -> String {
    let payload = match response.result {
        Response::Subset(batch) => json!(batch),
        _ => panic!("subset"),
    };
    let mut envelope = json!({"kind":"subset","requestId":response.request_id,"revision":response.revision,"completeness":response.completeness,"diagnostics":response.diagnostics});
    if let Value::Object(payload) = payload {
        envelope.as_object_mut().unwrap().extend(payload);
    }
    serde_json::to_string(
        &json!({"protocolVersion":pivot_core::PROTOCOL_VERSION,"sessionId":17,"response":envelope}),
    )
    .unwrap()
}
// Frozen envelope-only optimization, immediately before direct subset streaming.
fn envelope_only(response: CoreResponse) -> String {
    let payload = match response.result {
        Response::Subset(batch) => json!(batch),
        _ => panic!("subset"),
    };
    let mut envelope = json!({"kind":"subset","requestId":response.request_id,"revision":response.revision,"completeness":response.completeness,"diagnostics":response.diagnostics});
    if let Value::Object(payload) = payload {
        envelope.as_object_mut().unwrap().extend(payload);
    }
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Envelope<'a> {
        protocol_version: u32,
        response: &'a Value,
        session_id: u32,
    }
    serde_json::to_string(&Envelope {
        protocol_version: pivot_core::PROTOCOL_VERSION,
        response: &envelope,
        session_id: 17,
    })
    .unwrap()
}
fn measure(f: impl FnOnce(CoreResponse) -> String) -> (String, usize) {
    let response = response();
    let base = LIVE.load(Relaxed);
    PEAK.store(base, Relaxed);
    let wire = f(response);
    let peak = PEAK.load(Relaxed).saturating_sub(base);
    (wire, peak)
}
#[test]
fn subset_encoding_avoids_a_second_full_value_tree() {
    let (expected, old_peak) = measure(original);
    let (intermediate, envelope_peak) = measure(envelope_only);
    let (actual, new_peak) = measure(|v| pivot_wire::encode_response(17, v).unwrap());
    assert_eq!(actual, expected);
    assert_eq!(actual, intermediate);
    println!("envelope-only peak={envelope_peak} bytes");
    assert!(new_peak*4<envelope_peak*3, "direct subset peak {new_peak}, envelope-only {envelope_peak}; expected at least25% less transient allocation");
    println!("transient peak: original={old_peak} bytes, current={new_peak} bytes");
    assert!(
        new_peak * 4 < old_peak * 3,
        "new peak {new_peak}, original {old_peak}; expected at least 25% less transient allocation"
    );
}
