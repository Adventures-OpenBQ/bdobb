#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#[wasm_bindgen::prelude::wasm_bindgen(typescript_custom_section)]
const HOST_TYPES: &str =
    "export type RustHostOptions = { wire: string; order(request: string): string };";
use pivot_core::{
    contract::*,
    ordering::{Comparison, ValueOrder},
    session::{ResourceLimits, Session},
};
use serde::{de::DeserializeOwned, Deserialize};
use std::{cell::RefCell, cmp::Ordering, collections::BTreeMap};
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "RustHostOptions")]
    pub type HostOptions;
    #[wasm_bindgen(method, getter, structural)]
    fn wire(this: &HostOptions) -> String;
    #[wasm_bindgen(method, structural, catch)]
    fn order(this: &HostOptions, request: &str) -> Result<String, JsValue>;
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Options {
    protocol_version: u32,
    locale: String,
    limits: Option<ResourceLimits>,
    batch_rows: Option<u32>,
}
struct State {
    session: Session,
    host: HostOptions,
}
thread_local! {static SESSIONS:RefCell<(u32,BTreeMap<u32,State>)>=const {RefCell::new((0,BTreeMap::new()))};}
#[wasm_bindgen]
pub fn protocol_version() -> u32 {
    pivot_core::PROTOCOL_VERSION
}
#[wasm_bindgen]
pub fn open_session(host: HostOptions) -> Result<u32, JsValue> {
    let opts: Options =
        serde_json::from_str(&host.wire()).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if opts.protocol_version != protocol_version() || opts.locale.is_empty() {
        return Err(JsValue::from_str("Unsupported session protocol or locale"));
    }
    let limits = opts.limits.unwrap_or_default();
    let mut session = Session::new(opts.locale, limits);
    if let Some(rows) = opts.batch_rows {
        session
            .set_batch_rows(rows)
            .map_err(|d| JsValue::from_str(&d.message))?;
    }
    SESSIONS.with(|map| {
        let mut map = map.borrow_mut();
        if map.1.len() >= 32 {
            return Err(JsValue::from_str("Too many Rust sessions"));
        }
        map.0 = map
            .0
            .checked_add(1)
            .ok_or_else(|| JsValue::from_str("Rust session identity exhausted"))?;
        let id = map.0;
        map.1.insert(id, State { session, host });
        Ok(id)
    })
}
#[wasm_bindgen]
pub fn dispatch(handle: u32, request: &str) -> Result<String, JsValue> {
    let request: pivot_wire::Request =
        serde_json::from_str(request).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if request.protocol_version != protocol_version() || request.session_id != handle {
        return Err(JsValue::from_str("Rust request protocol/session mismatch"));
    }
    let core = request
        .into_core_request()
        .map_err(|e| JsValue::from_str(&e))?;
    SESSIONS.with(|map| {
        let mut map = map.borrow_mut();
        let state = map
            .1
            .get_mut(&handle)
            .ok_or_else(|| JsValue::from_str("Unknown Rust session"))?;
        let response = state.session.dispatch(core, &HostOrder(&state.host));
        pivot_wire::encode_response(handle, response).map_err(|e| JsValue::from_str(&e))
    })
}
#[wasm_bindgen]
pub fn resource_usage(handle: u32) -> Result<String, JsValue> {
    SESSIONS.with(|map| {
        let map = map.borrow();
        let state = map
            .1
            .get(&handle)
            .ok_or_else(|| JsValue::from_str("Unknown Rust session"))?;
        serde_json::to_string(&state.session.resource_usage())
            .map_err(|e| JsValue::from_str(&e.to_string()))
    })
}
#[wasm_bindgen]
pub fn close_session(handle: u32) {
    SESSIONS.with(|map| {
        map.borrow_mut().1.remove(&handle);
    });
}
struct HostOrder<'a>(&'a HostOptions);
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HostResult<T> {
    ok: Option<T>,
    error: Option<Diagnostic>,
}
fn host_error(message: &str) -> Diagnostic {
    pivot_core::validation::diagnostic("HOST_ORDER_FAILURE", "ordering", message)
}
impl HostOrder<'_> {
    fn call<T: DeserializeOwned>(&self, request: serde_json::Value) -> Result<T, Diagnostic> {
        let text = self
            .0
            .order(&request.to_string())
            .map_err(|_| host_error("Host ordering callback threw"))?;
        let result: HostResult<T> = serde_json::from_str(&text)
            .map_err(|_| host_error("Malformed host ordering result"))?;
        match (result.ok, result.error) {
            (Some(ok), None) => Ok(ok),
            (None, Some(error)) => Err(error),
            _ => Err(host_error("Invalid host ordering result")),
        }
    }
    fn sign(n: i32) -> Result<Ordering, Diagnostic> {
        match n {
            -1 => Ok(Ordering::Less),
            0 => Ok(Ordering::Equal),
            1 => Ok(Ordering::Greater),
            _ => Err(host_error("Invalid host comparison sign")),
        }
    }
}
impl ValueOrder for HostOrder<'_> {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
        Self::sign(self.call(serde_json::json!({"kind":"scalar","a":a,"b":b}))?)
    }
    fn compare_raw(&self, a: &WireValue, b: &WireValue) -> Result<Comparison, Diagnostic> {
        let result: serde_json::Value = self.call(serde_json::json!({"kind":"raw","a":a,"b":b}))?;
        if result.as_str() == Some("unordered") {
            return Ok(Comparison::Unordered);
        }
        let sign = result
            .as_i64()
            .and_then(|n| i32::try_from(n).ok())
            .ok_or_else(|| host_error("Invalid raw host comparison"))?;
        Ok(Comparison::Ordered(Self::sign(sign)?))
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<Ordering, Diagnostic> {
        Self::sign(self.call(serde_json::json!({"kind":"recipe","a":a,"b":b}))?)
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        self.call(serde_json::json!({"kind":"sort","values":values,"descending":descending}))
    }
}
#[cfg(test)]
mod tests {
    use super::Options;
    #[test]
    fn limits_are_optional_strict_camel_case() {
        let parse = |limits: &str| {
            serde_json::from_str::<Options>(&format!(
                r#"{{"protocolVersion":1,"locale":"en-US","limits":{limits}}}"#
            ))
            .map(|o| o.limits.map(|l| (l.max_rows, l.export_bytes)))
        };
        assert_eq!(parse("null").unwrap(), None);
        assert_eq!(parse("{}").unwrap(), Some((None, None)));
        assert_eq!(
            parse(r#"{"maxRows":5,"exportBytes":null}"#).unwrap(),
            Some((Some(5), None))
        );
        assert!(parse(r#"{"extra":1}"#).is_err());
        assert!(parse(r#"{"max_rows":1}"#).is_err());
        assert!(parse(r#"{"maxRows":-1}"#).is_err());
        assert!(parse(r#"{"maxRows":1.5}"#).is_err());
    }
}
