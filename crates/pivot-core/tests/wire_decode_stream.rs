// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::contract::{WireNumber, WireValue};
use serde::{Deserialize, Serialize};
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
};
thread_local! { static COUNT: Cell<Option<usize>> = const { Cell::new(None) }; }
struct Allocator;
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        COUNT.with(|count| {
            if let Some(n) = count.get() {
                count.set(Some(n + 1));
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
// Frozen pre-optimization representation, recursively retaining the old decoder.
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "tag", deny_unknown_fields)]
enum Legacy {
    #[serde(rename = "missing")]
    Missing {},
    #[serde(rename = "null")]
    Null {},
    #[serde(rename = "bool")]
    Bool { value: bool },
    #[serde(rename = "string")]
    String { value: String },
    #[serde(rename = "f64")]
    F64 { value: WireNumber },
    #[serde(rename = "bigint-string")]
    BigIntString { value: String },
    #[serde(rename = "array")]
    Array { value: Vec<Legacy> },
    #[serde(rename = "record")]
    Record { value: Vec<(String, Legacy)> },
}
fn allocations<T>(f: impl FnOnce() -> T) -> (T, usize) {
    COUNT.with(|n| n.set(Some(0)));
    let result = f();
    let count = COUNT.with(|n| n.replace(None).unwrap());
    (result, count)
}
#[test]
fn tag_first_numeric_cells_avoid_buffer_allocations() {
    let raw = format!(
        "[{}]",
        vec![r#"{"tag":"f64","value":1.25}"#; 1000].join(",")
    );
    let (_, old) = allocations(|| serde_json::from_str::<Vec<Legacy>>(&raw).unwrap());
    let (values, new) = allocations(|| serde_json::from_str::<Vec<WireValue>>(&raw).unwrap());
    assert_eq!(values.len(), 1000);
    println!("1000 tag-first numbers: old={old}, new={new} allocations");
    assert!(new + 900 < old, "old={old}, new={new}");
}
#[test]
fn streaming_decode_matches_frozen_contract_in_both_field_orders() {
    let mut cases: Vec<String> = vec![
        "null",
        "[]",
        "1",
        "{}",
        r#"{"tag":"wat"}"#,
        r#"{"tag":"null","value":null}"#,
        r#"{"value":null,"tag":"null"}"#,
        r#"{"tag":"null","tag":"null"}"#,
        r#"{"tag":"bool","value":true,"value":false}"#,
        r#"{"value":true,"value":false,"tag":"bool"}"#,
        r#"{"extra":1,"tag":"null"}"#,
        r#"{"tag":"f64","value":1,"tag":"bool"}"#,
        r#"{"value":1,"tag":"f64","tag":"bool"}"#,
        r#"{"tag":"string","value":"\ud800"}"#,
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    for tag in [
        "missing",
        "null",
        "bool",
        "string",
        "f64",
        "bigint-string",
        "array",
        "record",
        "wat",
    ] {
        cases.push(format!(r#"{{"tag":"{tag}"}}"#));
        for value in [
            "null",
            "true",
            "1",
            "-0",
            "1e-300",
            r#""NaN""#,
            r#""-0""#,
            r#""9007199254740993""#,
            r#""é\u0000😀""#,
            "[]",
            r#"[{"tag":"null"}]"#,
            r#"[["x",{"tag":"f64","value":-0}]]"#,
            r#"{}"#,
        ] {
            for raw in [
                format!(r#"{{"tag":"{tag}","value":{value}}}"#),
                format!(r#"{{"value":{value},"tag":"{tag}"}}"#),
            ] {
                cases.push(raw.clone());
                cases.push(format!(r#"{{"tag":"array","value":[{raw}]}}"#));
                cases.push(format!(r#"{{"tag":"record","value":[["x",{raw}]]}}"#));
                cases.push(raw.trim_end_matches('}').to_owned() + r#", "extra":null}"#);
            }
        }
    }
    for tag in [
        "0",
        "1",
        "true",
        "null",
        "[]",
        r#"{"f64":null}"#,
        r#""f64""#,
    ] {
        cases.push(format!(r#"{{"tag":{tag},"value":1}}"#));
        cases.push(format!(r#"{{"value":1,"tag":{tag}}}"#));
    }
    for raw in [
        r#"["f64",1.25]"#,
        r#"["string","x"]"#,
        r#"["missing"]"#,
        r#"["null"]"#,
        r#"["bool",true]"#,
        r#"["array",[]]"#,
        r#"["record",[]]"#,
        r#"["f64"]"#,
        r#"["null",null]"#,
    ] {
        cases.push(raw.to_owned());
        cases.push(format!(r#"{{"tag":"array","value":[{raw}]}}"#));
    }
    for raw in cases {
        let old = serde_json::from_str::<Legacy>(&raw);
        let new = serde_json::from_str::<WireValue>(&raw);
        assert_eq!(old.is_ok(), new.is_ok(), "{raw}: old={old:?}, new={new:?}");
        if let (Ok(old), Ok(new)) = (old, new) {
            assert_eq!(
                serde_json::to_string(&old).unwrap(),
                serde_json::to_string(&new).unwrap(),
                "{raw}"
            );
            let value = serde_json::from_str::<serde_json::Value>(&raw).unwrap();
            let direct = serde_json::from_value::<WireValue>(value).unwrap();
            assert_eq!(
                serde_json::to_string(&new).unwrap(),
                serde_json::to_string(&direct).unwrap(),
                "from_value: {raw}"
            );
        }
    }
}
