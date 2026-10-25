// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Native subset materialization stays inside bounded service/worker ownership.
use super::*;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeriveSession {
    pub parent: Identity,
    pub revision: Revision,
    pub request_id: String,
    pub protocol_version: u32,
    pub widget_id: String,
    pub locale: String,
    pub input_revision: u64,
}
pub(super) struct SessionReservation<'a> {
    registry: &'a Mutex<Registry>,
    owner: String,
}
impl Drop for SessionReservation<'_> {
    fn drop(&mut self) {
        decrement(&mut self.registry.lock().unwrap().openings, &self.owner, 1);
    }
}
impl SessionManager {
    pub(super) fn reserve_session(
        &self,
        owner: &Principal,
    ) -> Result<SessionReservation<'_>, ServiceError> {
        let mut registry = self.registry.lock().unwrap();
        if registry.sessions.len() + registry.openings.values().sum::<usize>()
            >= self.runtime.max_sessions
            || registry
                .sessions
                .values()
                .filter(|s| s.owner == *owner)
                .count()
                + registry.openings.get(&owner.0).copied().unwrap_or(0)
                >= self.limits.max_sessions_per_principal
        {
            return Err(limit("session admission limit exceeded"));
        }
        *registry.openings.entry(owner.0.clone()).or_default() += 1;
        Ok(SessionReservation {
            registry: &self.registry,
            owner: owner.0.clone(),
        })
    }
    pub async fn derive_session(
        self: &Arc<Self>,
        owner: Principal,
        path: &str,
        req: DeriveSession,
    ) -> Result<Value, ServiceError> {
        if req.parent.session_id != path
            || req.parent.result_id.is_none()
            || req.protocol_version != 1
            || !crate::config::identifier(&req.widget_id)
            || req.request_id.is_empty()
            || req.request_id.len() > 256
            || req.locale.len() > 128
            || [
                req.input_revision,
                req.revision.input,
                req.revision.model,
                req.revision.output,
            ]
            .iter()
            .any(|v| *v > MAX_SAFE)
        {
            return Err(invalid("invalid linked derivation request"));
        }
        pivot_native::NativeOrder::new(&req.locale)
            .map_err(|_| invalid("unsupported locale or incompatible native ordering"))?;
        let session = self.owned(&owner, path)?;
        // Pin before queue admission: a later apply/refresh cannot retarget this work.
        let published = {
            let state = session.state.lock().unwrap();
            identity_matches(&state, &req.parent)?;
            if !same(&state.published.revision, &req.revision) {
                return Err(conflict());
            }
            state.published.clone()
        };
        let principal = owner.clone();
        self.run_registered(
            owner,
            Some((session.clone(), req.request_id.clone())),
            move |m, cancel| {
                let _reservation = m.reserve_session(&principal)?;
                let input_slot = m.reserve_slot(&principal, RetainedKind::Input)?;
                // Job memory (32 * max_parse_bytes plus command buffers) was reserved before queueing.
                let input = m.derived_input(&principal, &published, input_slot, &cancel)?;
                cancel.check()?;
                // Publication is atomic with respect to parent disposal/expiry, but independent of refresh.
                let open = OpenSession {
                    source_id: String::new(),
                    protocol_version: req.protocol_version,
                    widget_id: req.widget_id,
                    locale: req.locale,
                    input_revision: req.input_revision,
                };
                m.publish_input(&principal, open, input, &cancel, Some(&session))
            },
        )
        .await
    }
    fn derived_input(
        &self,
        owner: &Principal,
        published: &Arc<Published>,
        input_slot: Slot,
        cancel: &Execution,
    ) -> Result<Arc<Input>, ServiceError> {
        // Export owns cursor cleanup on success, oversized/malformed data, cancellation and panic.
        let cursor = Export {
            _slot: self.reserve_slot(owner, RetainedKind::Export)?,
            owner: owner.clone(),
            identity: published.identity.clone(),
            published: published.clone(),
            expires: Instant::now() + Duration::from_secs(self.limits.max_job_seconds),
            transfer_id: id("derived")?,
            native_id: id("transfer")?,
            request_id: id("derive")?,
            fingerprint: String::new(),
            closed: Default::default(),
            cleaned: Default::default(),
            state: Default::default(),
        };
        // Cancellation fences publication without killing this shared parent.
        // An in-flight bounded RPC finishes under its own hard worker deadline;
        // job memory and cursor ownership remain charged until cleanup.
        let mut dataset = Value::Null;
        let mut bytes = 0usize;
        let mut rows = 0usize;
        for sequence in 0..=(self.limits.max_input_rows as u64) {
            cancel.check()?;
            let mut request = json!({"requestId":cursor.native_id,"revision":published.revision,"transferId":cursor.native_id});
            if sequence == 0 {
                request["kind"] = json!("presented");
                request["ignoreSelection"] = json!(false);
            } else {
                request["kind"] = json!("nextSubset");
                request["sequence"] = json!(sequence);
            }
            let wire = json!({"protocolVersion":1,"sessionId":1,"request":request}).to_string();
            let result = {
                let mut native = published.native.lock().map_err(|_| gone())?;
                cancel.check()?;
                native.session.dispatch_wire(&wire).map_err(worker_error)?
            };
            if let Some(observer) = &self.observer {
                observer.after_derived_batch(&published.revision, sequence);
            }
            if result.len() > self.limits.max_export_batch_bytes {
                return Err(limit("derived batch exceeds byte limit"));
            }
            bytes = bytes
                .checked_add(result.len())
                .ok_or_else(|| limit("derived source byte overflow"))?;
            if bytes > self.limits.max_parse_bytes as usize {
                return Err(limit("derived source exceeds byte limit"));
            }
            let mut envelope: Value =
                serde_json::from_str(&result).map_err(|_| invalid("invalid native subset"))?;
            let batch = &mut envelope["response"];
            if batch["kind"] != "subset" {
                return Err(limit("native subset refused"));
            }
            if batch["requestId"] != cursor.native_id
                || batch["transferId"] != cursor.native_id
                || batch["sequence"] != sequence
                || batch["revision"] != serde_json::to_value(&published.revision).unwrap()
            {
                return Err(conflict());
            }
            let final_batch = batch["final"]
                .as_bool()
                .ok_or_else(|| invalid("invalid native subset final flag"))?;
            let chunk = batch["rows"]
                .as_array_mut()
                .ok_or_else(|| invalid("invalid native subset rows"))?;
            rows = rows
                .checked_add(chunk.len())
                .ok_or_else(|| limit("derived source row overflow"))?;
            if chunk.len() > self.worker_config.batch_rows() as usize
                || rows > self.limits.max_input_rows
                || (!final_batch && chunk.is_empty())
            {
                return Err(limit("derived source exceeds row admission"));
            }
            let chunk = std::mem::take(chunk);
            if sequence == 0 {
                let columns = batch["columns"]
                    .as_array()
                    .ok_or_else(|| invalid("missing subset schema"))?;
                if columns.len() > self.limits.max_input_columns {
                    return Err(limit("derived source exceeds column admission"));
                }
                dataset = json!({"rows":[],"columns":batch["columns"],"resultRevision":published.revision.model,"outputRevision":published.revision.output,
                    "provenance":batch["provenance"],"completeness":batch["completeness"],"freshness":batch["freshness"],"diagnostics":batch["diagnostics"]});
                for key in ["modelWarnings", "modelWarningCount"] {
                    if let Some(value) = batch.get(key) {
                        dataset[key] = value.clone();
                    }
                }
                if dataset["provenance"].get("lineage").is_none() {
                    dataset["provenance"]["lineage"] = json!([]);
                }
                dataset["provenance"]["lineage"].as_array_mut().ok_or_else(|| invalid("invalid subset lineage"))?.push(json!({"widgetId":published.revision.widget_id,"resultRevision":published.revision.model,"outputRevision":published.revision.output}));
            }
            dataset["rows"].as_array_mut().unwrap().extend(chunk);
            if final_batch {
                cancel.check()?;
                // Validate the complete ordinary source contract, never serialized internal state.
                let source: pivot_core::contract::SourceDataset =
                    serde_json::from_value(dataset)
                        .map_err(|_| invalid("invalid derived source metadata"))?;
                let json = serde_json::to_string(&source)
                    .map_err(|_| invalid("derived source encoding failed"))?;
                if json.len() > self.limits.max_parse_bytes as usize {
                    return Err(limit("derived source exceeds byte limit"));
                }
                return Ok(Arc::new(Input {
                    json: json.into_boxed_str(),
                    _slot: input_slot,
                }));
            }
        }
        Err(limit("derived source batch limit exceeded"))
    }
}
