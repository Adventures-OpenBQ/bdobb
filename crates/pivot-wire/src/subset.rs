// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Stream plain continuation rows; retain the general encoder for metadata and annotations.
use super::*;

pub(super) fn encode(session_id: u32, response: &CoreResponse) -> Option<Result<String, String>> {
    let Response::Subset(batch) = &response.result else {
        return None;
    };
    if batch.sequence == 0
        || batch.columns.is_some()
        || batch.provenance.is_some()
        || batch.freshness.is_some()
        || !batch.rows.iter().all(plain)
    {
        return None;
    }
    // Field order deliberately matches the legacy Value maps' sorted keys.
    // Small structured metadata still goes through Value; only the row graph
    // bypasses that allocation. WireValue emits tag/value in sorted order and
    // records retain their ordered entry arrays.
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Subset<'a> {
        completeness: Value,
        diagnostics: Value,
        #[serde(rename = "final")]
        final_batch: bool,
        kind: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_warning_count: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_warnings: Option<Value>,
        request_id: &'a str,
        revision: Value,
        rows: &'a [DatasetRow],
        sequence: u64,
        transfer_id: &'a str,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Envelope<'a> {
        protocol_version: u32,
        response: Subset<'a>,
        session_id: u32,
    }
    Some(
        serde_json::to_string(&Envelope {
            protocol_version: pivot_core::PROTOCOL_VERSION,
            response: Subset {
                completeness: json!(response.completeness),
                diagnostics: json!(response.diagnostics),
                final_batch: batch.final_batch,
                kind: "subset",
                model_warning_count: response.model_warning_count,
                model_warnings: response.model_warnings.as_ref().map(|w| json!(w)),
                request_id: &response.request_id,
                revision: json!(response.revision),
                rows: &batch.rows,
                sequence: batch.sequence,
                transfer_id: &batch.transfer_id,
            },
            session_id,
        })
        .map_err(|e| e.to_string()),
    )
}
fn plain(row: &DatasetRow) -> bool {
    // Exhaustive destructuring forces a decision if DatasetRow gains fields.
    let DatasetRow {
        id: _,
        values: _,
        group_path,
        cell_errors,
        cell_formats,
    } = row;
    group_path.is_none() && cell_errors.is_none() && cell_formats.is_none()
}
