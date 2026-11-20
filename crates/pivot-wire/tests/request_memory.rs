// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{contract::WireValue, session::Operation};
use pivot_wire::decode_request;
use serde_json::json;
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
};
thread_local! { static TARGET: Cell<Option<(usize,usize)>> = const { Cell::new(None) }; }
struct Allocator;
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        TARGET.with(|target| {
            if let Some((size, n)) = target.get() {
                if layout.size() == size {
                    target.set(Some((size, n + 1)));
                }
            }
        });
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}
#[global_allocator]
static ALLOCATOR: Allocator = Allocator;
#[test]
fn input_field_is_not_copied_as_an_intermediate_raw_box() {
    let input = json!({"rows":[{"id":"row","values":{"payload":{"tag":"string","value":"x".repeat(100_000)}}}],"columns":[{"id":"payload","label":"Payload"}],"resultRevision":2,"outputRevision":4,"provenance":{"sourceWidgetId":"source"},"completeness":{"kind":"complete","warnings":[]},"freshness":{"availability":"available","stale":false}});
    let size = serde_json::to_string(&input).unwrap().len();
    let decoded = {
        let text=json!({"protocolVersion":1,"sessionId":17,"request":{"requestId":"q","revision":{"widgetId":"source","input":2,"model":3,"output":4},"kind":"registerInput","input":input,"inputRevision":2}}).to_string();
        TARGET.with(|target| target.set(Some((size, 0))));
        let result = decode_request(&text).unwrap();
        let copies = TARGET.with(|target| target.replace(None).unwrap().1);
        assert_eq!(copies, 0, "full input field raw copies");
        result
    }; // CoreRequest must own all decoded values after the envelope string dies.
    let Operation::RegisterInput { input, .. } = decoded.operation else {
        panic!("register input")
    };
    assert_eq!(
        input.rows[0].values["payload"],
        WireValue::String("x".repeat(100_000))
    );
}
