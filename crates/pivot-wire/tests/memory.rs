// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Decoding must not build a serde_json::Value tree (~17x the wire size) of the request.
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
#[test]
fn import_file_decode_peak_memory_is_bounded_by_wire_size() {
    let n = 1_000_000;
    let mut wire = String::from(
        r#"{"protocolVersion":1,"sessionId":1,"request":{"kind":"importFile","requestId":"q","revision":{"widgetId":"w","input":1,"model":1,"output":1},"name":"a.csv","inputRevision":1,"bytes":["#,
    );
    for i in 0..n {
        if i > 0 {
            wire.push(',');
        }
        wire.push('0');
    }
    wire.push_str("]}}");
    let base = LIVE.load(Relaxed);
    PEAK.store(base, Relaxed);
    let request = pivot_wire::decode_request(&wire).unwrap();
    let peak = PEAK.load(Relaxed) - base;
    drop(request);
    assert!(
        peak < 4 * wire.len(),
        "decode peak {peak} bytes for {} wire bytes",
        wire.len()
    );
}
