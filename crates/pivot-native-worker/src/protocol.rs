// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::WorkerError;
use pivot_core::session::{CoreResponse, ResourceLimits, Response};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
pub(crate) const INIT: u8 = 0;
pub(crate) const WIRE: u8 = 1;
pub(crate) const USAGE: u8 = 2;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Init {
    pub version: u32,
    pub locale: String,
    #[serde(rename = "batchRows")]
    pub batch_rows: u32,
    // Exhaustive conversion below ensures newly added core fields require review.
    pub limits: [Option<usize>; 9],
}
impl Init {
    pub fn new(locale: &str, limits: ResourceLimits, batch_rows: u32) -> Self {
        let ResourceLimits {
            input_bytes,
            max_input_bytes,
            max_rows,
            max_pivot_columns,
            max_batch_bytes,
            max_cached_block_bytes,
            max_concurrent_transfers,
            max_state_bytes: _,
            cache_bytes,
            export_bytes,
        } = limits;
        Self {
            version: 1,
            locale: locale.into(),
            batch_rows,
            limits: [
                input_bytes,
                max_input_bytes,
                max_rows,
                max_pivot_columns,
                max_batch_bytes,
                max_cached_block_bytes,
                max_concurrent_transfers,
                cache_bytes,
                export_bytes,
            ],
        }
    }
    pub fn core_limits(&self) -> ResourceLimits {
        let [input_bytes, max_input_bytes, max_rows, max_pivot_columns, max_batch_bytes, max_cached_block_bytes, max_concurrent_transfers, cache_bytes, export_bytes] =
            self.limits;
        ResourceLimits {
            input_bytes,
            max_input_bytes,
            max_rows,
            max_pivot_columns,
            max_batch_bytes,
            max_cached_block_bytes,
            max_concurrent_transfers,
            max_state_bytes: None,
            cache_bytes,
            export_bytes,
        }
    }
}
pub(crate) fn header(seq: u64, kind: u8, len: usize, max: usize) -> Result<[u8; 13], WorkerError> {
    if len > max {
        return Err(WorkerError::FrameTooLarge);
    }
    let total = u32::try_from(len.checked_add(9).ok_or(WorkerError::FrameTooLarge)?)
        .map_err(|_| WorkerError::FrameTooLarge)?;
    let mut b = [0; 13];
    b[..4].copy_from_slice(&total.to_be_bytes());
    b[4..12].copy_from_slice(&seq.to_be_bytes());
    b[12] = kind;
    Ok(b)
}
pub(crate) fn read_frame(
    reader: &mut impl Read,
    max: usize,
) -> Result<(u64, u8, Vec<u8>), WorkerError> {
    let mut b = [0; 13];
    reader
        .read_exact(&mut b[..4])
        .map_err(|_| WorkerError::Io)?;
    let len = u32::from_be_bytes(b[..4].try_into().unwrap()) as usize;
    if len < 9 {
        return Err(WorkerError::Protocol);
    }
    if len - 9 > max {
        return Err(WorkerError::FrameTooLarge);
    }
    reader
        .read_exact(&mut b[4..])
        .map_err(|_| WorkerError::Io)?;
    let mut payload = Vec::new();
    payload
        .try_reserve_exact(len - 9)
        .map_err(|_| WorkerError::FrameTooLarge)?;
    payload.resize(len - 9, 0);
    reader
        .read_exact(&mut payload)
        .map_err(|_| WorkerError::Io)?;
    Ok((
        u64::from_be_bytes(b[4..12].try_into().unwrap()),
        b[12],
        payload,
    ))
}
pub(crate) fn write_frame(
    writer: &mut impl Write,
    seq: u64,
    kind: u8,
    payload: &[u8],
    max: usize,
) -> Result<(), WorkerError> {
    writer
        .write_all(&header(seq, kind, payload.len(), max)?)
        .map_err(|_| WorkerError::Io)?;
    writer.write_all(payload).map_err(|_| WorkerError::Io)?;
    writer.flush().map_err(|_| WorkerError::Io)
}
/// Encode a dispatched response; one too large for a frame becomes a recoverable
/// RESOURCE_LIMIT error instead of a write failure that ends the worker and session.
pub(crate) fn wire_reply(response: CoreResponse, max: usize) -> Result<Vec<u8>, WorkerError> {
    let refusal = CoreResponse {
        request_id: response.request_id.clone(),
        revision: response.revision.clone(),
        completeness: response.completeness.clone(),
        diagnostics: vec![],
        model_warnings: None,
        model_warning_count: None,
        result: Response::Error(pivot_core::validation::diagnostic(
            "RESOURCE_LIMIT",
            "session",
            "Response exceeds the worker frame limit",
        )),
    };
    let bytes = pivot_wire::encode_response(1, response).map_err(|_| WorkerError::Protocol)?;
    if bytes.len() <= max {
        return Ok(bytes.into_bytes());
    }
    pivot_wire::encode_response(1, refusal)
        .map(String::into_bytes)
        .map_err(|_| WorkerError::Protocol)
}
#[cfg(test)]
mod tests {
    use super::*;
    use pivot_core::session::ResourceUsage;
    #[test]
    fn oversized_response_becomes_resource_limit_error() {
        let response = CoreResponse {
            request_id: "chart-1".into(),
            revision: pivot_core::contract::Revision {
                widget_id: "w".into(),
                input: 1,
                model: 1,
                output: 1,
            },
            completeness: pivot_core::contract::Completeness {
                kind: pivot_core::contract::CompletenessKind::Complete,
                warnings: vec![],
                acquired_row_count: None,
                total_row_count: None,
                total_row_count_kind: None,
            },
            diagnostics: vec![],
            model_warnings: None,
            model_warning_count: None,
            result: Response::Error(pivot_core::validation::diagnostic(
                "X",
                "session",
                &"x".repeat(10_000),
            )),
        };
        let bytes = wire_reply(response, 2048).unwrap();
        assert!(bytes.len() <= 2048);
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["response"]["kind"], "error");
        assert_eq!(v["response"]["requestId"], "chart-1");
        assert_eq!(v["response"]["error"]["code"], "RESOURCE_LIMIT");
    }
    #[test]
    fn usage_reply_is_strict_camel_case() {
        let ok = r#"{"retainedEstimatedBytes":1,"inputEncodedBytes":2,"inputRows":3,"outputRows":4,"outputColumns":5,"activeTransfers":6}"#;
        let parse = |s: &str| serde_json::from_str::<ResourceUsage>(s);
        assert!(parse(ok).is_ok());
        assert!(parse(&ok.replace('}', r#","extra":0}"#)).is_err());
        assert!(parse(&ok.replace(r#","activeTransfers":6"#, "")).is_err());
        assert!(parse(&ok.replace(":6", ":-6")).is_err());
        assert!(parse(&ok.replace("inputRows", "input_rows")).is_err());
    }
    #[test]
    fn malformed_oversized_and_truncated_frames_fail() {
        for bytes in [
            vec![],
            vec![0, 0, 0, 8],
            vec![0, 0, 1, 0],
            vec![0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        ] {
            assert!(read_frame(&mut bytes.as_slice(), 64).is_err());
        }
    }
}
