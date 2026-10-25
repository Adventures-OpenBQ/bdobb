// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded blocking execution, immutable acquisition and fenced native publication.
use crate::execution::{worker_error, Execution};
use crate::{exports::Export, *};
use pivot_core::{
    contract::Revision,
    session::{CoreRequest, Operation, ResourceLimits, Response},
};
use pivot_native_worker::{WorkerConfig, WorkerControl, WorkerSession};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

mod derivation;
pub use derivation::DeriveSession;

pub const MAX_SAFE: u64 = 9_007_199_254_740_991;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RuntimeConfig {
    pub compute_workers: usize,
    pub max_admitted_jobs: usize,
    pub max_sessions: usize,
    pub max_retained_slots: usize,
    pub max_retained_slots_per_principal: usize,
    pub max_exports_per_principal: usize,
    pub max_http_requests: usize,
    pub max_command_bytes: usize,
    pub body_seconds: u64,
    pub total_memory_budget_bytes: u64,
    pub principal_memory_budget_bytes: u64,
}
impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            compute_workers: 4,
            max_admitted_jobs: 16,
            max_sessions: 128,
            max_retained_slots: 256,
            max_retained_slots_per_principal: 24,
            max_exports_per_principal: 8,
            max_http_requests: 32,
            max_command_bytes: 2 * 1024 * 1024,
            body_seconds: 30,
            total_memory_budget_bytes: 64 * 1024 * 1024 * 1024,
            principal_memory_budget_bytes: 32 * 1024 * 1024 * 1024,
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenSession {
    pub source_id: String,
    pub protocol_version: u32,
    pub widget_id: String,
    pub locale: String,
    pub input_revision: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub session_id: String,
    pub source_snapshot_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_id: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Refresh {
    pub input_revision: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub session_id: String,
    pub source_snapshot_id: String,
    pub result_id: Option<String>,
    pub wire: String,
    pub refresh: Option<Refresh>,
}
impl Command {
    pub fn identity(&self) -> Identity {
        Identity {
            session_id: self.session_id.clone(),
            source_snapshot_id: self.source_snapshot_id.clone(),
            result_id: self.result_id.clone(),
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    #[serde(flatten)]
    pub identity: Identity,
    pub wire: String,
}
#[derive(Default)]
struct Counts {
    jobs: BTreeMap<String, usize>,
    slots: BTreeMap<String, usize>,
    exports: BTreeMap<String, usize>,
    total_slots: usize,
    memory: u64,
    principal_memory: BTreeMap<String, u64>,
}
pub(crate) struct Slot {
    counts: Arc<Mutex<Counts>>,
    owner: String,
    export: bool,
    _memory: Memory,
}
impl Drop for Slot {
    fn drop(&mut self) {
        let mut c = self.counts.lock().unwrap();
        c.total_slots -= 1;
        decrement(&mut c.slots, &self.owner, 1);
        if self.export {
            decrement(&mut c.exports, &self.owner, 1);
        }
    }
}
struct Job {
    counts: Arc<Mutex<Counts>>,
    owner: String,
    _queue: OwnedSemaphorePermit,
    _memory: Memory,
}
impl Drop for Job {
    fn drop(&mut self) {
        decrement(&mut self.counts.lock().unwrap().jobs, &self.owner, 1);
    }
}
fn decrement<N: Copy + Default + PartialEq + std::ops::SubAssign>(
    map: &mut BTreeMap<String, N>,
    owner: &str,
    by: N,
) {
    if let Some(n) = map.get_mut(owner) {
        *n -= by;
        if *n == N::default() {
            map.remove(owner);
        }
    }
}
struct Memory {
    counts: Arc<Mutex<Counts>>,
    owner: String,
    bytes: u64,
}
impl Drop for Memory {
    fn drop(&mut self) {
        let mut c = self.counts.lock().unwrap();
        c.memory -= self.bytes;
        decrement(&mut c.principal_memory, &self.owner, self.bytes);
    }
}
struct Abort(Arc<Execution>);
impl Drop for Abort {
    fn drop(&mut self) {
        // Fence immediately, even if every blocking executor thread is occupied.
        // Only the potentially blocking kill/reap is deferred.
        if let Some(control) = self.0.invalidate() {
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn_blocking(move || {
                    let _ = control.kill();
                });
            } else {
                let _ = control.kill();
            }
        }
    }
}
enum RetainedKind {
    Input,
    Native,
    Export,
}
struct Input {
    json: Box<str>,
    _slot: Slot,
}
pub(crate) struct Native {
    pub session: WorkerSession,
    _slot: Slot,
}
pub(crate) struct Published {
    pub identity: Identity,
    pub revision: Revision,
    pub native: Mutex<Native>,
    pub control: WorkerControl,
}
struct SessionState {
    source: Option<String>,
    widget: String,
    locale: String,
    input: Arc<Input>,
    published: Arc<Published>,
    expires: Instant,
    generation: u64,
    highest: Option<Revision>,
    last: Option<Attempt>,
    pending: BTreeMap<usize, (String, Arc<Execution>)>,
    disposed: bool,
}
struct Attempt {
    request_id: String,
    revision: Revision,
    fingerprint: String,
    cancel: Arc<Execution>,
    reply: Option<Reply>,
}
struct OwnedSession {
    owner: Principal,
    state: Mutex<SessionState>,
}
struct Pending {
    session: Arc<OwnedSession>,
    key: usize,
}
impl Drop for Pending {
    fn drop(&mut self) {
        self.session.state.lock().unwrap().pending.remove(&self.key);
    }
}
/// Metadata has already been fenced; only blocking process/cursor cleanup remains.
pub(crate) struct ControlCleanup {
    controls: Vec<WorkerControl>,
    exports: Vec<Arc<Export>>,
    _session: Arc<OwnedSession>,
}
impl ControlCleanup {
    pub(crate) fn finish(self) {
        for control in &self.controls {
            let _ = control.kill();
        }
        for export in &self.exports {
            export.close();
        }
    }
    pub(crate) async fn finish_async(self) -> Result<(), ServiceError> {
        tokio::task::spawn_blocking(move || self.finish())
            .await
            .map_err(|_| invalid("control cleanup failed"))
    }
}
/// Bounded control lane (cancel, dispose, export delete) beside max_http_requests.
pub const CONTROL_HTTP_REQUESTS: usize = 2;
#[derive(Default)]
struct Registry {
    sessions: BTreeMap<String, Arc<OwnedSession>>,
    openings: BTreeMap<String, usize>,
    pub(crate) exports: BTreeMap<String, Arc<Export>>,
}
/// A scheduling boundary for deterministic lifecycle tests; production uses no hook.
/// Implementations may delay work, but cannot replace native computation or its output.
pub trait ComputeObserver: Send + Sync {
    fn before_apply(&self, _request: &CoreRequest) {}
    fn after_apply(&self, _request: &CoreRequest) {}
    fn after_read(&self, _request: &CoreRequest) {}
    fn after_derived_batch(&self, _revision: &Revision, _sequence: u64) {}
}
pub struct SessionManager {
    closing: std::sync::atomic::AtomicBool,
    pub catalog: Arc<SourceCatalog>,
    ingest: Ingestor,
    pub limits: ServiceLimits,
    pub runtime: RuntimeConfig,
    worker_config: WorkerConfig,
    base_memory: u64,
    registry: Mutex<Registry>,
    counts: Arc<Mutex<Counts>>,
    workers: Arc<Semaphore>,
    queue: Arc<Semaphore>,
    observer: Option<Arc<dyn ComputeObserver>>,
}
impl SessionManager {
    pub fn new(
        catalog: Arc<SourceCatalog>,
        ingest: Ingestor,
        limits: ServiceLimits,
        runtime: RuntimeConfig,
        worker_config: WorkerConfig,
    ) -> Result<Self, ServiceError> {
        limits.validate()?;
        if [
            limits.max_input_rows,
            limits.max_input_columns,
            limits.max_output_columns,
            limits.max_row_block_rows,
        ]
        .iter()
        .any(|n| *n as u64 > MAX_SAFE)
        {
            return Err(invalid("unsafe exact-count admission limits"));
        }
        let parser_heap = ingest.reserved_heap_bytes()?;
        let http_memory = (runtime.max_http_requests as u64)
            .checked_add(CONTROL_HTTP_REQUESTS as u64)
            .and_then(|n| {
                n.checked_mul(
                    limits
                        .max_upload_bytes
                        .max(runtime.max_command_bytes as u64),
                )
            })
            .ok_or_else(|| invalid("memory configuration overflow"))?;
        let base_memory = worker_config
            .reserved_startup_memory_bytes()
            .checked_add(parser_heap)
            .and_then(|n| n.checked_add(http_memory))
            .and_then(|n| {
                n.checked_add(worker_config.max_starting_workers() as u64 * 2 * 1024 * 1024)
            })
            .ok_or_else(|| invalid("memory configuration overflow"))?;
        if base_memory >= runtime.total_memory_budget_bytes
            || runtime.principal_memory_budget_bytes == 0
            || worker_config.batch_rows() as usize > limits.max_row_block_rows.min(500)
            || worker_config.max_frame_bytes()
                < (limits.max_parse_bytes as usize).saturating_add(4096)
        {
            return Err(invalid("inconsistent worker or memory budgets"));
        }

        if [
            runtime.compute_workers,
            runtime.max_admitted_jobs,
            runtime.max_sessions,
            runtime.max_retained_slots,
            runtime.max_retained_slots_per_principal,
            runtime.max_exports_per_principal,
            runtime.max_http_requests,
            runtime.max_command_bytes,
        ]
        .contains(&0)
            || runtime.body_seconds == 0
            || runtime.max_admitted_jobs < runtime.compute_workers
            || runtime.max_command_bytes > 64 * 1024 * 1024
            || limits.max_session_seconds > 31_536_000
            || limits.max_job_seconds > 86400
            || runtime.body_seconds > 86400
            || runtime.max_admitted_jobs > Semaphore::MAX_PERMITS
            || runtime.max_http_requests > Semaphore::MAX_PERMITS
        {
            return Err(invalid("invalid runtime limits"));
        }
        Ok(Self {
            closing: std::sync::atomic::AtomicBool::new(false),
            catalog,
            ingest,
            limits,
            runtime: runtime.clone(),
            worker_config,
            base_memory,
            registry: Mutex::new(Registry::default()),
            counts: Arc::new(Mutex::new(Counts::default())),
            workers: Arc::new(Semaphore::new(runtime.compute_workers)),
            queue: Arc::new(Semaphore::new(runtime.max_admitted_jobs)),
            observer: None,
        })
    }
    pub fn with_observer(mut self, observer: Arc<dyn ComputeObserver>) -> Self {
        self.observer = Some(observer);
        self
    }
    pub async fn run<
        T: Send + 'static,
        F: FnOnce(Arc<Self>, Arc<Execution>) -> Result<T, ServiceError> + Send + 'static,
    >(
        self: &Arc<Self>,
        owner: Principal,
        f: F,
    ) -> Result<T, ServiceError> {
        self.run_registered(owner, None, f).await
    }
    pub(crate) async fn run_session<
        T: Send + 'static,
        F: FnOnce(Arc<Self>, Arc<Execution>, Command) -> Result<T, ServiceError> + Send + 'static,
    >(
        self: &Arc<Self>,
        owner: Principal,
        path: &str,
        command: Command,
        f: F,
    ) -> Result<T, ServiceError> {
        if command.session_id != path || command.wire.len() > self.runtime.max_command_bytes {
            return Err(invalid("invalid command identity or size"));
        }
        let request = decode_command(&command)?;
        let session = self.owned(&owner, path)?;
        self.run_registered(owner, Some((session, request.request_id)), move |m, c| {
            f(m, c, command)
        })
        .await
    }
    async fn run_registered<
        T: Send + 'static,
        F: FnOnce(Arc<Self>, Arc<Execution>) -> Result<T, ServiceError> + Send + 'static,
    >(
        self: &Arc<Self>,
        owner: Principal,
        registration: Option<(Arc<OwnedSession>, String)>,
        f: F,
    ) -> Result<T, ServiceError> {
        if self.closing.load(std::sync::atomic::Ordering::Acquire) {
            return Err(gone());
        }
        let memory = self.memory(&owner, self.job_memory())?;
        let queue = self
            .queue
            .clone()
            .try_acquire_owned()
            .map_err(|_| limit("compute admission queue is full"))?;
        {
            let mut c = self.counts.lock().unwrap();
            let n = c.jobs.entry(owner.0.clone()).or_default();
            if *n >= self.limits.max_concurrent_jobs_per_principal {
                return Err(limit("principal compute admission is full"));
            }
            *n += 1;
        }
        let job = Job {
            counts: self.counts.clone(),
            owner: owner.0,
            _queue: queue,
            _memory: memory,
        };
        let flag = Arc::new(Execution::default());
        let _abort = Abort(flag.clone());
        let pending = if let Some((session, request_id)) = registration {
            let key = Arc::as_ptr(&flag) as usize;
            {
                let mut state = session.state.lock().unwrap();
                live(&state)?;
                state.pending.insert(key, (request_id, flag.clone()));
            }
            Some(Pending { session, key })
        } else {
            None
        };
        let manager = self.clone();
        tokio::time::timeout(
            Duration::from_secs(self.limits.max_job_seconds),
            async move {
                let permit = manager
                    .workers
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| gone())?;
                tokio::task::spawn_blocking(move || {
                    let _job = job;
                    let _pending = pending;
                    let _permit = permit;
                    flag.check()?;
                    f(manager, flag)
                })
                .await
                .map_err(|_| ServiceError::new(ErrorCode::Io, "native execution failed"))?
            },
        )
        .await
        .map_err(|_| limit("execution deadline exceeded; publication cancelled"))?
    }
    fn job_memory(&self) -> u64 {
        self.limits
            .max_parse_bytes
            .saturating_mul(32)
            .saturating_add(self.limits.max_upload_bytes.saturating_mul(2))
            .saturating_add(self.runtime.max_command_bytes as u64 * 16)
    }
    fn memory(&self, owner: &Principal, bytes: u64) -> Result<Memory, ServiceError> {
        let mut c = self.counts.lock().unwrap();
        let principal = c.principal_memory.get(&owner.0).copied().unwrap_or(0);
        if self
            .base_memory
            .saturating_add(c.memory)
            .saturating_add(bytes)
            > self.runtime.total_memory_budget_bytes
            || principal.saturating_add(bytes) > self.runtime.principal_memory_budget_bytes
        {
            return Err(limit("service or principal memory reservation exceeded"));
        }
        c.memory += bytes;
        *c.principal_memory.entry(owner.0.clone()).or_default() += bytes;
        Ok(Memory {
            counts: self.counts.clone(),
            owner: owner.0.clone(),
            bytes,
        })
    }
    fn reserve_slot(&self, owner: &Principal, kind: RetainedKind) -> Result<Slot, ServiceError> {
        // Input retains boxed encoded bytes, not a worker. Encoding and boxing
        // peaks remain covered by the admitted job's transient reservation.
        let bytes = match kind {
            RetainedKind::Input => self.limits.max_parse_bytes.checked_add(64 * 1024),
            RetainedKind::Export => (self.limits.max_export_batch_bytes as u64).checked_mul(8),
            RetainedKind::Native => (self.worker_config.max_frame_bytes() as u64)
                .checked_mul(3)
                .and_then(|n| n.checked_add(self.worker_config.reserved_memory_bytes()))
                .and_then(|n| n.checked_add(self.limits.max_cache_bytes))
                .and_then(|n| n.checked_add(2 * 1024 * 1024)),
        }
        .ok_or_else(|| invalid("retained memory configuration overflow"))?;
        let export = matches!(kind, RetainedKind::Export);
        let memory = self.memory(owner, bytes)?;
        let mut c = self.counts.lock().unwrap();
        if export
            && c.exports.get(&owner.0).copied().unwrap_or(0)
                >= self.runtime.max_exports_per_principal
        {
            return Err(limit("export admission limit exceeded"));
        }
        if c.total_slots >= self.runtime.max_retained_slots
            || c.slots.get(&owner.0).copied().unwrap_or(0)
                >= self.runtime.max_retained_slots_per_principal
        {
            return Err(limit("retained input/result budget exceeded"));
        }
        c.total_slots += 1;
        *c.slots.entry(owner.0.clone()).or_default() += 1;
        if export {
            *c.exports.entry(owner.0.clone()).or_default() += 1;
        }
        Ok(Slot {
            counts: self.counts.clone(),
            owner: owner.0.clone(),
            export,
            _memory: memory,
        })
    }
    fn resource_limits(&self) -> ResourceLimits {
        ResourceLimits {
            max_input_bytes: Some(self.limits.max_parse_bytes as usize),
            max_rows: Some(self.limits.max_input_rows),
            max_pivot_columns: Some(self.limits.max_output_columns),
            max_batch_bytes: Some(self.limits.max_export_batch_bytes),
            // Heap estimates for a delivered block are independent of encoded wire bytes.
            max_cached_block_bytes: Some(self.limits.max_cache_bytes as usize),
            max_concurrent_transfers: Some(self.runtime.max_exports_per_principal),
            max_state_bytes: Some(self.limits.max_cache_bytes as usize),
            cache_bytes: Some(self.limits.max_cache_bytes as usize),
            export_bytes: Some(self.limits.max_export_batch_bytes),
            ..Default::default()
        }
    }
    fn native(
        &self,
        owner: &Principal,
        locale: &str,
        input: &Input,
        revision: &Revision,
        cancel: &Execution,
    ) -> Result<Native, ServiceError> {
        let slot = self.reserve_slot(owner, RetainedKind::Native)?;
        let mut worker =
            WorkerSession::spawn(self.worker_config.clone(), locale, self.resource_limits())
                .map_err(worker_error)?;
        cancel.attach(worker.control())?;
        let wire=format!("{{\"protocolVersion\":1,\"sessionId\":1,\"request\":{{\"kind\":\"registerInput\",\"requestId\":\"register\",\"revision\":{},\"inputRevision\":{},\"input\":{}}}}}",serde_json::to_string(revision).unwrap(),revision.input,input.json);
        let response = worker.dispatch_wire(&wire).map_err(worker_error)?;
        if response_kind(&response)? != "registered" {
            return Err(limit("input exceeds native admission limits"));
        }
        cancel.check()?;
        Ok(Native {
            session: worker,
            _slot: slot,
        })
    }
    fn acquire(
        &self,
        owner: &Principal,
        source: &str,
        widget: &str,
        revision: u64,
    ) -> Result<Arc<Input>, ServiceError> {
        let slot = self.reserve_slot(owner, RetainedKind::Input)?;
        let lease = self.catalog.acquire(owner, source)?;
        let dataset = self.ingest.ingest(&lease, widget, revision)?;
        let json =
            serde_json::to_string(&dataset).map_err(|_| invalid("source encoding failed"))?;
        if json.len() > self.limits.max_parse_bytes as usize {
            return Err(limit("encoded input exceeds budget"));
        }
        Ok(Arc::new(Input {
            json: json.into_boxed_str(),
            _slot: slot,
        }))
    }
    pub fn open(
        &self,
        owner: &Principal,
        req: OpenSession,
        cancel: &Arc<Execution>,
    ) -> Result<Value, ServiceError> {
        if req.protocol_version != 1
            || req.input_revision > MAX_SAFE
            || !crate::config::identifier(&req.widget_id)
            || req.locale.len() > 128
        {
            return Err(invalid("unsupported protocol, widget or revision"));
        }

        pivot_native::NativeOrder::new(&req.locale)
            .map_err(|_| invalid("unsupported locale or incompatible native ordering"))?;
        self.cleanup();
        let _reservation = self.reserve_session(owner)?;
        let input = self.acquire(owner, &req.source_id, &req.widget_id, req.input_revision)?;
        self.publish_input(owner, req, input, cancel, None)
    }
    fn publish_input(
        &self,
        owner: &Principal,
        req: OpenSession,
        input: Arc<Input>,
        cancel: &Arc<Execution>,
        parent: Option<&OwnedSession>,
    ) -> Result<Value, ServiceError> {
        let rev = Revision {
            widget_id: req.widget_id.clone(),
            input: req.input_revision,
            model: 0,
            output: 0,
        };
        let native = self.native(owner, &req.locale, &input, &rev, cancel)?;
        let identity = Identity {
            session_id: id("session")?,
            source_snapshot_id: id("snapshot")?,
            result_id: None,
        };
        let control = native.session.control();
        let published = Arc::new(Published {
            identity: identity.clone(),
            revision: rev,
            native: Mutex::new(native),
            control,
        });
        let parent = parent.map(|s| s.state.lock().unwrap());
        if let Some(state) = &parent {
            live(state)?;
        }
        let mut r = self.registry.lock().unwrap();
        if self.closing.load(std::sync::atomic::Ordering::Acquire) {
            return Err(gone());
        }
        cancel.commit()?;
        cancel.detach();
        r.sessions.insert(
            identity.session_id.clone(),
            Arc::new(OwnedSession {
                owner: owner.clone(),
                state: Mutex::new(SessionState {
                    source: (!req.source_id.is_empty()).then_some(req.source_id),
                    widget: req.widget_id,
                    locale: req.locale,
                    input,
                    published,
                    expires: Instant::now() + Duration::from_secs(self.limits.max_session_seconds),
                    generation: 0,
                    highest: None,
                    last: None,
                    pending: BTreeMap::new(),
                    disposed: false,
                }),
            }),
        );
        let mut value = serde_json::to_value(identity).unwrap();
        value["capabilities"] = capabilities();
        value["limits"] = serde_json::to_value(&self.limits).unwrap();
        value["expiresInSeconds"] = json!(self.limits.max_session_seconds);
        Ok(value)
    }
    fn owned(&self, owner: &Principal, id: &str) -> Result<Arc<OwnedSession>, ServiceError> {
        let r = self.registry.lock().unwrap();
        let s = r
            .sessions
            .get(id)
            .filter(|s| s.owner == *owner)
            .ok_or_else(gone)?
            .clone();
        drop(r);
        let state = s.state.lock().unwrap();
        live(&state)?;
        drop(state);
        Ok(s)
    }
    pub(crate) async fn execute_command(
        self: &Arc<Self>,
        owner: Principal,
        path: String,
        command: Command,
    ) -> Result<Reply, ServiceError> {
        if command.session_id != path || command.wire.len() > self.runtime.max_command_bytes {
            return Err(invalid("invalid command identity or size"));
        }
        let q = decode_command(&command)?;
        if matches!(q.operation, Operation::Dispose | Operation::Cancel { .. }) {
            let session = self.owned(&owner, &path)?;
            identity_matches(&session.state.lock().unwrap(), &command.identity())?;
            let (cleanup, result) = match &q.operation {
                Operation::Dispose => (
                    self.fence_control(&owner, &path, None, true)?,
                    Response::Disposed,
                ),
                Operation::Cancel { target_request_id } => (
                    self.fence_control(&owner, &path, Some(target_request_id), false)?,
                    Response::Cancelled,
                ),
                _ => unreachable!(),
            };
            cleanup.finish_async().await?;
            return reply(
                command.identity(),
                pivot_core::session::CoreResponse {
                    request_id: q.request_id,
                    revision: q.revision,
                    completeness: empty_completeness(),
                    diagnostics: vec![],
                    model_warnings: None,
                    model_warning_count: None,
                    result,
                },
            );
        }
        let p = owner.clone();
        let route = path.clone();
        self.run_session(owner, &path, command, move |m, c, command| {
            m.command(&p, &route, command, c)
        })
        .await
    }
    pub fn command(
        &self,
        owner: &Principal,
        path: &str,
        command: Command,
        cancel: Arc<Execution>,
    ) -> Result<Reply, ServiceError> {
        let q = decode_command(&command)?;
        self.preflight(&q)?;
        if let Operation::NextSubset {
            transfer_id,
            sequence,
        } = &q.operation
        {
            return self.subset_next(
                owner,
                &command.identity(),
                transfer_id,
                *sequence,
                &q.request_id,
                &cancel,
            );
        }
        let session = self.owned(owner, path)?;
        if matches!(q.operation, Operation::Presented { .. }) {
            return self.start_export(owner, command, &cancel).map(|(_, r)| r);
        }
        if matches!(q.operation, Operation::ApplyModel { .. }) {
            return self.apply(owner, session, command, q, cancel);
        }
        if command.refresh.is_some() {
            return Err(invalid("refresh requires applyModel"));
        }
        let published = {
            let state = session.state.lock().unwrap();
            identity_matches(&state, &command.identity())?;
            if q.revision.widget_id != state.widget
                || q.revision.input != state.published.revision.input
            {
                return Err(conflict());
            }
            state.published.clone()
        };
        // Published workers are shared by reads and pinned exports. Routine caller
        // cancellation fences this reply, never kills another consumer's worker.
        // Admission/deadlines bound waiters; no session/registry lock is held here.
        let mut native = published.native.lock().map_err(|_| gone())?;
        cancel.check()?;
        let wire = native
            .session
            .dispatch_wire(&command.wire)
            .map_err(worker_error)?;
        if let Some(observer) = &self.observer {
            observer.after_read(&q);
        }
        cancel.check()?;
        cancel.commit()?;
        cancel.detach();
        Ok(Reply {
            identity: published.identity.clone(),
            wire,
        })
    }
    fn preflight(&self, q: &CoreRequest) -> Result<(), ServiceError> {
        let requested = match &q.operation {
            Operation::Rows(r) => Some(r.limit),
            Operation::MemberDomain { limit, .. } => Some(*limit),
            Operation::ColumnProfile {
                limit: page,
                fields,
                ..
            } => {
                if !(1..=100).contains(page) || fields.as_ref().is_some_and(|f| f.len() > 100) {
                    return Err(limit("column profile page exceeds 100 fields"));
                }
                None
            }
            Operation::Inspect(r) => Some(r.limit),
            Operation::RegisterInput { .. } | Operation::ImportFile { .. } => {
                return Err(invalid("use managed source acquisition"))
            }
            _ => None,
        };
        if requested.is_some_and(|n| n == 0 || n as usize > self.limits.max_row_block_rows) {
            return Err(limit("requested block exceeds row limit"));
        }
        Ok(())
    }
    fn apply(
        &self,
        owner: &Principal,
        session: Arc<OwnedSession>,
        command: Command,
        q: CoreRequest,
        cancel: Arc<Execution>,
    ) -> Result<Reply, ServiceError> {
        let fingerprint = crate::digest(
            format!(
                "{}\n{:?}\n{:?}",
                command.wire,
                command.refresh,
                command.identity()
            )
            .as_bytes(),
        );
        let (generation, input, locale, source, widget, snapshot, previous) = {
            let mut s = session.state.lock().unwrap();
            live(&s)?;
            if let Some(last) = &s.last {
                if same(&last.revision, &q.revision) {
                    if last.fingerprint != fingerprint {
                        return Err(conflict());
                    }
                    if let Some(r) = &last.reply {
                        return Ok(r.clone());
                    }
                    return Err(ServiceError::new(
                        ErrorCode::Conflict,
                        "revision already attempted; retry with a newer model/output revision",
                    ));
                }
            }
            identity_matches(&s, &command.identity())?;
            if q.revision.widget_id != s.widget {
                return Err(conflict());
            }
            if command.refresh.is_some() && s.source.is_none() {
                return Err(invalid(
                    "derived source is immutable; derive a new child from its parent",
                ));
            }
            let target_input = command
                .refresh
                .as_ref()
                .map_or(s.published.revision.input, |r| r.input_revision);
            if target_input != q.revision.input
                || command
                    .refresh
                    .as_ref()
                    .is_some_and(|r| r.input_revision <= s.published.revision.input)
            {
                return Err(conflict());
            }
            if let Some(high) = &s.highest {
                if q.revision.input < high.input
                    || q.revision.model <= high.model
                    || q.revision.output <= high.output
                {
                    return Err(conflict());
                }
            }
            let previous = s.last.as_ref().map(|a| a.cancel.clone());
            s.generation += 1;
            s.highest = Some(q.revision.clone());
            s.last = Some(Attempt {
                request_id: q.request_id.clone(),
                revision: q.revision.clone(),
                fingerprint,
                cancel: cancel.clone(),
                reply: None,
            });
            (
                s.generation,
                s.input.clone(),
                s.locale.clone(),
                s.source.clone(),
                s.widget.clone(),
                s.published.identity.source_snapshot_id.clone(),
                previous,
            )
        };
        if let Some(previous) = previous {
            previous.cancel();
        }
        if let Some(observer) = &self.observer {
            observer.before_apply(&q);
        }
        cancel.check()?;
        let (input, snapshot) = if command.refresh.is_some() {
            (
                self.acquire(
                    owner,
                    source.as_deref().ok_or_else(conflict)?,
                    &widget,
                    q.revision.input,
                )?,
                id("snapshot")?,
            )
        } else {
            (input, snapshot)
        };
        cancel.check()?;
        let mut native = self.native(owner, &locale, &input, &q.revision, &cancel)?;
        let response = native
            .session
            .dispatch_wire(&command.wire)
            .map_err(worker_error)?;
        if let Some(o) = &self.observer {
            o.after_apply(&q);
        }
        cancel.check()?;
        let mut s = session.state.lock().unwrap();
        live(&s)?;
        if s.generation != generation {
            return Err(conflict());
        }
        cancel.check()?;
        if response_kind(&response)? != "viewReady" {
            return Ok(Reply {
                identity: s.published.identity.clone(),
                wire: response,
            });
        }
        let identity = Identity {
            session_id: command.session_id,
            source_snapshot_id: snapshot,
            result_id: Some(id("result")?),
        };
        let response = Reply {
            identity: identity.clone(),
            wire: response,
        };
        if serde_json::to_vec(&response).unwrap().len() > self.limits.max_export_batch_bytes {
            return Err(limit("result schema exceeds response limit"));
        }
        cancel.commit()?;
        cancel.detach();
        let control = native.session.control();
        let old_input = std::mem::replace(&mut s.input, input);
        let old_publication = std::mem::replace(
            &mut s.published,
            Arc::new(Published {
                identity,
                revision: q.revision,
                native: Mutex::new(native),
                control,
            }),
        );
        s.last.as_mut().unwrap().reply = Some(response.clone());
        drop(s);
        // Reap retired workers without holding publication metadata locks.
        drop(old_publication);
        drop(old_input);
        Ok(response)
    }
    pub(crate) fn fence_control(
        &self,
        owner: &Principal,
        id: &str,
        target: Option<&str>,
        dispose: bool,
    ) -> Result<ControlCleanup, ServiceError> {
        let session = self.owned(owner, id)?;
        let mut controls = Vec::new();
        let mut exports = Vec::new();
        {
            let mut state = session.state.lock().unwrap();
            live(&state)?;
            if dispose {
                state.disposed = true;
                controls.push(state.published.control.clone());
            }
            if let Some(attempt) = state
                .last
                .as_ref()
                .filter(|a| target.is_none_or(|t| a.request_id == t))
            {
                if let Some(control) = attempt.cancel.invalidate() {
                    controls.push(control);
                }
                state.generation += 1;
            }
            for (request, execution) in state.pending.values() {
                if target.is_none_or(|t| t == request) {
                    if let Some(control) = execution.invalidate() {
                        controls.push(control);
                    }
                }
            }
            // Use the same session -> registry ordering as export publication.
            let mut registry = self.registry.lock().unwrap();
            let keys = registry
                .exports
                .iter()
                .filter(|(_, e)| {
                    e.owner == *owner
                        && e.identity.session_id == id
                        && target.is_none_or(|t| t == e.request_id)
                })
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            for key in keys {
                let export = registry.exports.remove(&key).unwrap();
                export
                    .closed
                    .store(true, std::sync::atomic::Ordering::Release);
                if dispose {
                    controls.push(export.published.control.clone());
                }
                exports.push(export);
            }
            if dispose {
                registry.sessions.remove(id);
            }
        }
        Ok(ControlCleanup {
            controls,
            exports,
            _session: session,
        })
    }
    pub fn cleanup(&self) {
        self.sweep(false);
    }
    /// Disposes expired sessions and exports, or all of them.
    fn sweep(&self, all: bool) {
        let sessions = self
            .registry
            .lock()
            .unwrap()
            .sessions
            .iter()
            .map(|(id, s)| (id.clone(), s.clone()))
            .collect::<Vec<_>>();
        for (id, s) in sessions {
            if all || s.state.lock().unwrap().expires <= Instant::now() {
                self.dispose_expired(&s, &id);
            }
        }
        for (key, e) in self.export_refs() {
            if all || e.expires <= Instant::now() {
                let _ = e.published.control.kill();
                let _ = self.delete_export(&e.owner, &key);
            }
        }
    }
    fn dispose_expired(&self, session: &OwnedSession, id: &str) {
        let controls = {
            let mut s = session.state.lock().unwrap();
            s.disposed = true;
            let mut controls = vec![s.published.control.clone()];
            for (_, execution) in s.pending.values() {
                controls.extend(execution.invalidate());
            }
            if let Some(attempt) = &s.last {
                controls.extend(attempt.cancel.invalidate());
            }
            controls
        };
        for control in controls {
            let _ = control.kill();
        }
        self.registry.lock().unwrap().sessions.remove(id);
    }
    pub fn shutdown(&self) {
        self.closing
            .store(true, std::sync::atomic::Ordering::Release);
        self.sweep(true);
    }
    pub fn usage(&self) -> Value {
        let c = self.counts.lock().unwrap();
        json!({"retainedSlots":c.total_slots,"admittedJobs":c.jobs.values().sum::<usize>(),"reservedMemoryBytes":self.base_memory+c.memory,"startupReservedMemoryBytes":self.worker_config.reserved_startup_memory_bytes()})
    }
}

pub(crate) fn same(a: &Revision, b: &Revision) -> bool {
    a.widget_id == b.widget_id && a.input == b.input && a.model == b.model && a.output == b.output
}
fn live(s: &SessionState) -> Result<(), ServiceError> {
    if s.disposed || s.expires <= Instant::now() {
        Err(gone())
    } else {
        Ok(())
    }
}
fn identity_matches(s: &SessionState, id: &Identity) -> Result<(), ServiceError> {
    live(s)?;
    if &s.published.identity != id {
        Err(conflict())
    } else {
        Ok(())
    }
}
pub(crate) fn reply(
    identity: Identity,
    response: pivot_core::session::CoreResponse,
) -> Result<Reply, ServiceError> {
    Ok(Reply {
        identity,
        wire: pivot_wire::encode_response(1, response)
            .map_err(|_| invalid("response encoding failed"))?,
    })
}
pub(crate) fn check(cancel: &Execution) -> Result<(), ServiceError> {
    cancel.check()
}
pub(crate) fn response_kind(wire: &str) -> Result<String, ServiceError> {
    serde_json::from_str::<Value>(wire)
        .ok()
        .and_then(|v| v["response"]["kind"].as_str().map(str::to_owned))
        .ok_or_else(|| invalid("invalid native response"))
}
pub(crate) fn id(prefix: &str) -> Result<String, ServiceError> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b)
        .map_err(|_| ServiceError::new(ErrorCode::Io, "identifier allocation failed"))?;
    Ok(format!("{prefix}_{}", crate::hex(&b)))
}
pub(crate) fn invalid(message: &str) -> ServiceError {
    ServiceError::new(ErrorCode::InvalidInput, message)
}
pub(crate) fn limit(message: &str) -> ServiceError {
    ServiceError::new(ErrorCode::LimitExceeded, message)
}
pub(crate) fn conflict() -> ServiceError {
    ServiceError::new(ErrorCode::Conflict, "snapshot, result or revision mismatch")
}
pub(crate) fn gone() -> ServiceError {
    ServiceError::new(
        ErrorCode::Gone,
        "session or result unavailable; recreate from the saved source reference",
    )
}
fn empty_completeness() -> pivot_core::contract::Completeness {
    serde_json::from_value(json!({"kind":"unknown","warnings":[]})).unwrap()
}
pub fn capabilities() -> Value {
    json!({"protocolVersions":[1],"definitionVersions":[1,2],"aggregations":["sum","min","max","mean","median","count","uniqueCount","first","last"],"formulaFunctions":["sum","min","max","mean","median","count","uniqueCount","first","last","IF"],"fiscal":true,"inspection":true,"selection":true,"identityWitness":true,"remoteAcquisition":true,"linkedDerivation":true,"safeExactCountAdmission":true,"features":["grouping","splits","sourceFormulas","aggregateFormulas","memberScope","runtimeParams","checklists","resultFilters","statement","preview","bindFormula","memberDomain","columnProfile","chart","export"]})
}

impl SessionManager {
    fn export_refs(&self) -> Vec<(String, Arc<Export>)> {
        self.registry
            .lock()
            .unwrap()
            .exports
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
    pub fn start_export(
        &self,
        owner: &Principal,
        command: Command,
        cancel: &Execution,
    ) -> Result<(String, Reply), ServiceError> {
        let identity = command.identity();
        let q = decode_command(&command)?;
        let (transfer, ignore) = match q.operation {
            Operation::Presented {
                transfer_id,
                ignore_selection,
            } => (transfer_id, ignore_selection),
            _ => return Err(invalid("export requires presented request")),
        };
        if command.refresh.is_some() || transfer.is_empty() || transfer.len() > 256 {
            return Err(invalid("invalid export request"));
        }
        let fingerprint = crate::digest(format!("{:?}\n{}", identity, command.wire).as_bytes());
        let session = self.owned(owner, &identity.session_id)?;
        for (key, e) in self.export_refs() {
            if e.owner == *owner
                && e.identity.session_id == identity.session_id
                && e.transfer_id == transfer
            {
                let state = session.state.lock().unwrap();
                live(&state)?;
                if e.expires <= Instant::now()
                    || e.closed.load(std::sync::atomic::Ordering::Acquire)
                {
                    return Err(gone());
                }
                if e.fingerprint != fingerprint {
                    return Err(conflict());
                }
                let s = e.state.try_lock().map_err(|_| conflict())?;
                if s.sequence != 0 {
                    return Err(conflict());
                }
                return Ok((key, s.last.clone().ok_or_else(conflict)?));
            }
        }
        let (published, expires) = {
            let s = session.state.lock().unwrap();
            identity_matches(&s, &identity)?;
            if identity.result_id.is_none() || !same(&s.published.revision, &q.revision) {
                return Err(conflict());
            }
            (s.published.clone(), s.expires)
        };
        let key = id("export")?;
        let e = Arc::new(Export {
            _slot: self.reserve_slot(owner, RetainedKind::Export)?,
            owner: owner.clone(),
            identity: identity.clone(),
            published,
            expires,
            transfer_id: transfer,
            native_id: id("transfer")?,
            request_id: q.request_id,
            fingerprint,
            closed: Default::default(),
            cleaned: Default::default(),
            state: Default::default(),
        });
        let wire=json!({"protocolVersion":1,"sessionId":1,"request":{"kind":"presented","requestId":e.native_id,"revision":e.published.revision,"transferId":e.native_id,"ignoreSelection":ignore}}).to_string();
        let result = {
            let mut native = e.published.native.lock().map_err(|_| gone())?;
            cancel.check()?;
            native.session.dispatch_wire(&wire).map_err(worker_error)?
        };
        let (response, final_batch) = export_reply(&e, result)?;
        if serde_json::to_vec(&response).unwrap().len() > self.limits.max_export_batch_bytes {
            return Err(limit("export response exceeds byte limit"));
        }
        {
            let mut s = e.state.lock().unwrap();
            s.last = Some(response.clone());
            s.final_batch = final_batch;
        }
        // No code acquires session/export locks while holding the registry lock.
        let s = session.state.lock().unwrap();
        live(&s)?;
        let mut registry = self.registry.lock().unwrap();
        if registry.exports.values().any(|existing| {
            existing.identity.session_id == identity.session_id
                && existing.transfer_id == e.transfer_id
        }) {
            return Err(conflict());
        }
        cancel.commit()?;
        registry.exports.insert(key.clone(), e);
        Ok((key, response))
    }
    pub fn export_batch(
        &self,
        owner: &Principal,
        key: &str,
        sequence: u64,
        cancel: &Execution,
    ) -> Result<Reply, ServiceError> {
        let e = self
            .registry
            .lock()
            .unwrap()
            .exports
            .get(key)
            .cloned()
            .ok_or_else(gone)?;
        if e.owner != *owner
            || e.expires <= Instant::now()
            || e.closed.load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(gone());
        }
        // Wait for the shared native worker before taking export cursor metadata.
        // The existing admitted job retains its reservation until this bounded RPC finishes.
        let mut native = e.published.native.lock().map_err(|_| gone())?;
        cancel.check()?;
        if e.closed.load(std::sync::atomic::Ordering::Acquire) {
            return Err(gone());
        }
        let mut s = e.state.lock().map_err(|_| gone())?;
        if sequence == s.sequence {
            return s.last.clone().ok_or_else(conflict);
        }
        if s.final_batch || sequence != s.sequence + 1 {
            return Err(ServiceError::new(
                ErrorCode::Conflict,
                "only the next sequence or latest batch retry is allowed",
            ));
        }
        let wire=json!({"protocolVersion":1,"sessionId":1,"request":{"kind":"nextSubset","requestId":e.native_id,"revision":e.published.revision,"transferId":e.native_id,"sequence":sequence}}).to_string();
        let response = native
            .session
            .dispatch_wire(&wire)
            .map_err(worker_error)
            .and_then(|wire| export_reply(&e, wire));
        let (response, final_batch) = match response {
            Ok(batch) => batch,
            Err(error) => {
                drop(s);
                drop(native);
                self.delete_export(owner, key)?;
                return Err(error);
            }
        };
        if serde_json::to_vec(&response).unwrap().len() > self.limits.max_export_batch_bytes {
            drop(s);
            drop(native);
            self.delete_export(owner, key)?;
            return Err(limit("export response exceeds byte limit"));
        }
        // Cache before observing caller cancellation: the native cursor already advanced.
        // A timed-out GET can safely retry this same sequence and receive these exact bytes.
        s.sequence = sequence;
        s.final_batch = final_batch;
        s.last = Some(response.clone());
        cancel.check()?;
        if e.closed.load(std::sync::atomic::Ordering::Acquire) {
            return Err(gone());
        }
        Ok(response)
    }
    fn subset_next(
        &self,
        owner: &Principal,
        identity: &Identity,
        transfer: &str,
        sequence: u64,
        request: &str,
        cancel: &Execution,
    ) -> Result<Reply, ServiceError> {
        let (key, e) = self
            .export_refs()
            .into_iter()
            .find(|(_, e)| {
                e.owner == *owner
                    && e.identity.session_id == identity.session_id
                    && e.transfer_id == transfer
            })
            .ok_or_else(gone)?;
        if e.identity != *identity || e.request_id != request {
            return Err(conflict());
        }
        self.export_batch(owner, &key, sequence, cancel)
    }
    pub fn delete_export(&self, owner: &Principal, key: &str) -> Result<(), ServiceError> {
        let e = {
            let mut r = self.registry.lock().unwrap();
            if r.exports.get(key).is_none_or(|e| e.owner != *owner) {
                return Err(gone());
            }
            r.exports.remove(key).unwrap()
        };
        e.close();
        Ok(())
    }
}
fn export_reply(e: &Export, wire: String) -> Result<(Reply, bool), ServiceError> {
    let mut value: Value =
        serde_json::from_str(&wire).map_err(|_| invalid("invalid export response"))?;
    if value["response"]["kind"] != "subset" {
        return Err(limit(
            "native export refused; reduce batch size or reacquire result",
        ));
    }
    let final_batch = value["response"]["final"]
        .as_bool()
        .ok_or_else(|| invalid("invalid export response"))?;
    // Only service-generated transport IDs change; serde_json retains signed numeric zero.
    value["response"]["requestId"] = json!(e.request_id);
    value["response"]["transferId"] = json!(e.transfer_id);
    Ok((
        Reply {
            identity: e.identity.clone(),
            wire: serde_json::to_string(&value).unwrap(),
        },
        final_batch,
    ))
}
fn decode_command(command: &Command) -> Result<CoreRequest, ServiceError> {
    let envelope: pivot_wire::Request =
        serde_json::from_str(&command.wire).map_err(|_| invalid("invalid core wire request"))?;
    if envelope.session_id != 1 {
        return Err(invalid("native wire handle must be 1"));
    }
    let q = envelope
        .into_core_request()
        .map_err(|_| invalid("invalid core wire request"))?;
    if q.request_id.is_empty()
        || q.request_id.len() > 256
        || [q.revision.input, q.revision.model, q.revision.output]
            .iter()
            .any(|n| *n > MAX_SAFE)
    {
        return Err(invalid("invalid request correlation or revision"));
    }
    Ok(q)
}

#[cfg(test)]
mod execution_tests {
    use super::*;
    #[test]
    fn request_drop_invalidates_publication_before_control_executor_runs() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(1)
            .build()
            .unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        runtime.block_on(async {
            let blocked = tokio::task::spawn_blocking(move || {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            });
            started_rx.recv().unwrap();
            let execution = Arc::new(Execution::default());
            drop(Abort(execution.clone()));
            let invalidated = execution.check().is_err();
            release_tx.send(()).unwrap();
            blocked.await.unwrap();
            assert!(
                invalidated,
                "request cancellation must fence publication synchronously"
            );
        });
    }
    // Control-lane bodies (cancel, dispose) are read alongside the ordinary lane.
    #[test]
    fn http_memory_reserves_ordinary_and_control_request_bodies() {
        let dir = tempfile::tempdir().unwrap();
        let limits = ServiceLimits::default();
        let catalog = Arc::new(SourceCatalog::open(dir.path(), CatalogConfig::default()).unwrap());
        let ingest = Ingestor::new(
            IngestConfig {
                node: "/node".into(),
                entry: "/child.mjs".into(),
                backend_config: None,
                max_concurrent_children: 4,
                max_child_heap_mb: 128,
            },
            limits.clone(),
        )
        .unwrap();
        let worker = WorkerConfig::new(
            "/worker".into(),
            512 * 1024 * 1024,
            limits.max_parse_bytes as usize + 4096,
            Duration::from_secs(limits.max_job_seconds),
        )
        .unwrap();
        let runtime = RuntimeConfig {
            max_http_requests: 3,
            ..Default::default()
        };
        let body = limits
            .max_upload_bytes
            .max(runtime.max_command_bytes as u64);
        let expected = worker.reserved_startup_memory_bytes()
            + ingest.reserved_heap_bytes().unwrap()
            + (3 + CONTROL_HTTP_REQUESTS as u64) * body
            + worker.max_starting_workers() as u64 * 2 * 1024 * 1024;
        let manager = SessionManager::new(catalog, ingest, limits, runtime, worker).unwrap();
        assert_eq!(manager.base_memory, expected);
    }
    fn manager() -> (tempfile::TempDir, SessionManager) {
        let dir = tempfile::tempdir().unwrap();
        let limits = ServiceLimits::default();
        let catalog = Arc::new(SourceCatalog::open(dir.path(), CatalogConfig::default()).unwrap());
        let ingest = Ingestor::new(
            IngestConfig {
                node: "/node".into(),
                entry: "/child.mjs".into(),
                backend_config: None,
                max_concurrent_children: 4,
                max_child_heap_mb: 128,
            },
            limits.clone(),
        )
        .unwrap();
        let worker = WorkerConfig::new(
            "/worker".into(),
            512 * 1024 * 1024,
            limits.max_parse_bytes as usize + 4096,
            Duration::from_secs(limits.max_job_seconds),
        )
        .unwrap();
        let manager =
            SessionManager::new(catalog, ingest, limits, RuntimeConfig::default(), worker).unwrap();
        (dir, manager)
    }
    #[test]
    fn column_profile_is_advertised_and_its_page_is_bounded() {
        assert!(capabilities()["features"]
            .as_array()
            .unwrap()
            .contains(&json!("columnProfile")));
        let (_dir, manager) = manager();
        let definition = pivot_core::validation::validate_definition(
            &serde_json::from_value(
                json!({"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":""}}),
            )
            .unwrap(),
        )
        .unwrap();
        let q = |limit: u32, fields: usize| CoreRequest {
            request_id: "profile".into(),
            revision: Revision {
                widget_id: "w".into(),
                input: 1,
                model: 1,
                output: 1,
            },
            operation: Operation::ColumnProfile {
                definition: definition.clone(),
                scope: pivot_core::session::ProfileScope::Input,
                offset: 0,
                limit,
                fields: (fields > 0).then(|| (0..fields).map(|i| format!("f{i}")).collect()),
            },
        };
        for (limit, fields) in [(0, 0), (101, 0), (100, 101)] {
            assert!(manager.preflight(&q(limit, fields)).is_err(), "{limit} {fields}");
        }
        for (limit, fields) in [(1, 0), (100, 100)] {
            assert!(manager.preflight(&q(limit, fields)).is_ok(), "{limit} {fields}");
        }
    }
}
