#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{contract::*, session::*};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, value::RawValue, Value};
use std::collections::BTreeMap;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub protocol_version: u32,
    pub session_id: u32,
    /// Kept as raw JSON: fields decode straight into their typed targets, never
    /// through a serde_json::Value tree (~17x the wire size for large inputs).
    pub request: Box<RawValue>,
}
/// Top-level request fields, each still raw JSON.
type Fields = BTreeMap<String, Box<RawValue>>;
fn get<T: DeserializeOwned>(v: &Fields, key: &str) -> Result<T, String> {
    serde_json::from_str(
        v.get(key)
            .ok_or_else(|| format!("Missing request field {key}"))?
            .get(),
    )
    .map_err(|e| e.to_string())
}
fn optional<T: DeserializeOwned>(v: &Fields, key: &str) -> Result<Option<T>, String> {
    v.get(key)
        .map(|value| serde_json::from_str(value.get()).map_err(|e| e.to_string()))
        .transpose()
}
fn def(v: &RawValue) -> Result<ValidatedDefinition, String> {
    let wire: WireDefinition = serde_json::from_str(v.get()).map_err(|e| e.to_string())?;
    pivot_core::validation::validate_definition(&wire).map_err(|d| d.message)
}
/// Decode the existing worker envelope for either native or Wasm dispatch.
pub fn decode_request(json: &str) -> Result<CoreRequest, String> {
    let request: Request = serde_json::from_str(json).map_err(|e| e.to_string())?;
    request.into_core_request()
}
impl Request {
    /// Session handle ownership is checked by the transport before dispatch.
    pub fn into_core_request(self) -> Result<CoreRequest, String> {
        if self.protocol_version != pivot_core::PROTOCOL_VERSION {
            return Err("Rust request protocol/session mismatch".into());
        }
        let fields: Fields =
            serde_json::from_str(self.request.get()).map_err(|_| "Invalid request object")?;
        request(&fields)
    }
}
fn request(v: &Fields) -> Result<CoreRequest, String> {
    let definition = || def(v.get("definition").ok_or("Missing definition")?);
    let kind: String = optional(v, "kind")
        .ok()
        .flatten()
        .ok_or("Missing request kind")?;
    let kind = kind.as_str();
    let fields: &[&str] = match kind {
        "registerInput" => &["input", "inputRevision"],
        "importFile" => &["name", "bytes", "inputRevision"],
        "applyModel" => &[
            "definition",
            "selection",
            "reconcileMissing",
            "previousSelectionNamespace",
            "provenAbsentIds",
            "runtimeParams",
        ],
        "previewDefinition" => &["definition"],
        "bindFormula" => &["definition", "draft", "bindings"],
        "memberDomain" => &[
            "definition",
            "categoryId",
            "categoryRecipe",
            "offset",
            "limit",
            "search",
        ],
        "columnProfile" => &["definition", "scope", "offset", "limit", "fields"],
        "identityWitness" => &["path", "ids"],
        "selection" => &["action", "visibleIds"],
        "rows" => &["request"],
        "facets" => &["categoryId"],
        "inspect" => &[
            "collection",
            "offset",
            "limit",
            "definitionId",
            "paramKey",
            "categoryId",
            "categoryRecipe",
            "groupEvidence",
        ],
        "chartData" => &["fields"],
        "presented" => &["transferId", "ignoreSelection"],
        "nextSubset" => &["transferId", "sequence"],
        "cancel" => &["targetRequestId"],
        "inputSchema" | "totals" | "dispose" => &[],
        _ => return Err("Unsupported Rust wire operation".into()),
    };
    for key in v.keys() {
        if !["kind", "requestId", "revision"].contains(&key.as_str())
            && !fields.contains(&key.as_str())
        {
            return Err(format!("Unknown request field {key}"));
        }
    }
    let operation = match kind {
        "registerInput" => Operation::RegisterInput {
            input: get(v, "input")?,
            input_revision: get(v, "inputRevision")?,
        },
        "importFile" => Operation::ImportFile {
            name: get(v, "name")?,
            bytes: get(v, "bytes")?,
            input_revision: get(v, "inputRevision")?,
        },
        "inputSchema" => Operation::InputSchema,
        "applyModel" => Operation::ApplyModel {
            definition: definition()?,
            selection: get(v, "selection")?,
            reconcile_missing: get(v, "reconcileMissing")?,
            previous_selection_namespace: optional(v, "previousSelectionNamespace")?,
            proven_absent_ids: get(v, "provenAbsentIds")?,
            runtime_params: get::<Vec<(String, RuntimeParam)>>(v, "runtimeParams")?
                .into_iter()
                .collect(),
        },
        "previewDefinition" => Operation::PreviewDefinition(definition()?),
        "bindFormula" => Operation::BindFormula {
            definition: definition()?,
            draft: get(v, "draft")?,
            bindings: get(v, "bindings")?,
        },
        "memberDomain" => Operation::MemberDomain {
            definition: definition()?,
            category_id: get(v, "categoryId")?,
            category_recipe: get(v, "categoryRecipe")?,
            offset: get(v, "offset")?,
            limit: get(v, "limit")?,
            search: optional(v, "search")?,
        },
        "columnProfile" => Operation::ColumnProfile {
            definition: definition()?,
            scope: get(v, "scope")?,
            offset: get(v, "offset")?,
            limit: get(v, "limit")?,
            fields: optional(v, "fields")?,
        },
        "identityWitness" => Operation::IdentityWitness {
            path: get::<Vec<Box<RawValue>>>(v, "path")
                .map_err(|_| "Missing witness path")?
                .iter()
                .map(|d| def(d))
                .collect::<Result<_, _>>()?,
            ids: get(v, "ids")?,
        },
        "selection" => Operation::Selection {
            action: get(v, "action")?,
            visible_ids: get(v, "visibleIds")?,
        },
        "rows" => Operation::Rows(get(v, "request")?),
        "facets" => Operation::Facets {
            category_id: get(v, "categoryId")?,
        },
        "inspect" => {
            let collection = match optional::<String>(v, "collection")
                .ok()
                .flatten()
                .as_deref()
            {
                Some("definitions") => InspectionCollection::Definitions,
                Some("warnings") => InspectionCollection::Warnings,
                Some("periodBounds") => InspectionCollection::PeriodBounds,
                Some("groupDomain") => InspectionCollection::GroupDomain,
                _ => return Err("Invalid inspection collection".into()),
            };
            Operation::Inspect(InspectionRequest {
                collection,
                offset: get(v, "offset")?,
                limit: get(v, "limit")?,
                definition_id: optional(v, "definitionId")?,
                param_key: optional(v, "paramKey")?,
                category_id: optional(v, "categoryId")?,
                category_recipe: optional(v, "categoryRecipe")?,
                group_evidence: optional(v, "groupEvidence")?,
            })
        }
        "totals" => Operation::Totals,
        "chartData" => Operation::ChartData {
            fields: get(v, "fields")?,
        },
        "presented" => Operation::Presented {
            transfer_id: get(v, "transferId")?,
            ignore_selection: optional(v, "ignoreSelection")?.unwrap_or(false),
        },
        "nextSubset" => Operation::NextSubset {
            transfer_id: get(v, "transferId")?,
            sequence: get(v, "sequence")?,
        },
        "cancel" => Operation::Cancel {
            target_request_id: get(v, "targetRequestId")?,
        },
        "dispose" => Operation::Dispose,
        _ => return Err("Unsupported Rust wire operation".into()),
    };
    Ok(CoreRequest {
        request_id: get(v, "requestId")?,
        revision: get(v, "revision")?,
        operation,
    })
}
/// Encode the unchanged worker response shape; HTTP identities belong outside it.
pub fn encode_response(session_id: u32, response: CoreResponse) -> Result<String, String> {
    let (kind, payload) = match response.result {
        Response::Registered => ("registered", json!({})),
        Response::InputSchema(columns) => ("inputSchema", json!({"columns":columns})),
        Response::ViewReady(v) => ("viewReady", json!(v)),
        Response::Rows(v) => ("rows", json!(v)),
        Response::Totals(v) => ("totals", json!(v)),
        Response::Facets {
            category_id,
            values,
        } => {
            let mut v = json!(values);
            v["categoryId"] = json!(category_id);
            ("facets", v)
        }
        Response::Selection(v) => ("selection", json!(v)),
        Response::ChartData(v) => ("chartData", json!(v)),
        Response::Subset(v) => ("subset", json!(v)),
        Response::PreviewDefinition(v) => ("previewDefinition", json!(v)),
        Response::BindFormula(v) => ("bindFormula", json!(v)),
        Response::MemberDomain(v) => ("memberDomain", json!(v)),
        Response::ColumnProfile(v) => ("columnProfile", json!(v)),
        Response::Inspect(v) => ("inspect", json!(v)),
        Response::IdentityWitness(v) => ("identityWitness", json!({"identities":v})),
        Response::Cancelled => ("cancelled", json!({})),
        Response::Disposed => ("disposed", json!({})),
        Response::Error(v) => ("error", json!({"error":v})),
    };
    let mut envelope = json!({"kind":kind,"requestId":response.request_id,"revision":response.revision,"completeness":response.completeness,"diagnostics":response.diagnostics});
    if let Some(w) = response.model_warnings {
        envelope["modelWarnings"] = json!(w)
    }
    if let Some(w) = response.model_warning_count {
        envelope["modelWarningCount"] = json!(w)
    }
    if let Value::Object(payload) = payload {
        envelope.as_object_mut().unwrap().extend(payload);
    }
    serde_json::to_string(&json!({"protocolVersion":pivot_core::PROTOCOL_VERSION,"sessionId":session_id,"response":envelope}))
        .map_err(|e| e.to_string())
}
