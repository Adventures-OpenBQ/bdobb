// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! One-shot private Node acquisition. Only complete validated datasets leave this module.
//! Call on a blocking executor; HTTP admission and per-principal jobs belong to the caller.
use crate::{ErrorCode, ServiceError, ServiceLimits, SourceLease, StoredSource};
use base64::Engine;
use pivot_core::{contract::SourceDataset, session::Operation};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    io::{Read, Write},
    os::fd::AsRawFd,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

/// Trusted operator paths only. No client-supplied executable, arguments or endpoints.
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IngestConfig {
    pub node: PathBuf,
    /// Built using `node scripts/build-table-ingest.mjs`.
    pub entry: PathBuf,
    /// Private JSON ServerBackendConfig. Contains URLs/headers; never return to clients.
    pub backend_config: Option<PathBuf>,
    pub max_concurrent_children: usize,
    pub max_child_heap_mb: usize,
}
#[derive(Clone)]
pub struct Ingestor {
    inner: Arc<Inner>,
}
struct Inner {
    config: IngestConfig,
    limits: ServiceLimits,
    active: AtomicUsize,
    max_request: usize,
}
struct Admission<'a>(&'a AtomicUsize);
impl Drop for Admission<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
struct Running(Child);
impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ParseLimits {
    max_bytes: u64,
    max_rows: usize,
    max_columns: usize,
    timeout_ms: u64,
}
#[derive(Serialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
enum Acquisition<'a> {
    File { name: &'a str, bytes: String },
    Backend { binding: &'a crate::BackendBinding },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request<'a> {
    widget_id: &'a str,
    input_revision: u64,
    limits: ParseLimits,
    #[serde(flatten)]
    acquisition: Acquisition<'a>,
}
fn failed() -> ServiceError {
    ServiceError::new(
        ErrorCode::InvalidInput,
        "table ingestion failed; source remains available for retry",
    )
}
fn limit() -> ServiceError {
    ServiceError::new(
        ErrorCode::LimitExceeded,
        "table ingestion exceeded its resource limit; source remains available for retry",
    )
}
fn io_error() -> ServiceError {
    ServiceError::new(ErrorCode::Io, "table ingestion process could not complete")
}
impl Ingestor {
    pub fn new(config: IngestConfig, limits: ServiceLimits) -> Result<Self, ServiceError> {
        limits.validate()?;
        let max_request = limits
            .max_upload_bytes
            .checked_add(2)
            .and_then(|n| n.checked_div(3))
            .and_then(|n| n.checked_mul(4))
            .and_then(|n| n.checked_add(limits.max_metadata_bytes as u64))
            .and_then(|n| n.checked_add(8192))
            .ok_or_else(limit)?;
        if !config.node.is_absolute()
            || !config.entry.is_absolute()
            || config
                .backend_config
                .as_ref()
                .is_some_and(|p| !p.is_absolute())
            || config.max_concurrent_children == 0
            || !(16..=65536).contains(&config.max_child_heap_mb)
            || max_request > u32::MAX as u64
            || limits.max_parse_bytes > u32::MAX as u64
            || limits.max_job_seconds.checked_mul(1000).is_none()
        {
            return Err(ServiceError::new(
                ErrorCode::InvalidConfig,
                "invalid ingestion process configuration",
            ));
        }
        Ok(Self {
            inner: Arc::new(Inner {
                config,
                limits,
                active: AtomicUsize::new(0),
                max_request: max_request as usize,
            }),
        })
    }
    /// V8 heap reservation shared by all clones; external buffers remain separately bounded.
    pub fn reserved_heap_bytes(&self) -> Result<u64, ServiceError> {
        (self.inner.config.max_child_heap_mb as u64)
            .checked_mul(1024 * 1024)
            .and_then(|n| n.checked_mul(self.inner.config.max_concurrent_children as u64))
            .ok_or_else(|| {
                ServiceError::new(ErrorCode::InvalidConfig, "parser heap reservation overflow")
            })
    }
    /// Uses the admitted file descriptor, never reconstructing a path or mutating durable sources.
    pub fn ingest(
        &self,
        lease: &SourceLease,
        widget_id: &str,
        input_revision: u64,
    ) -> Result<SourceDataset, ServiceError> {
        if widget_id.is_empty() || widget_id.len() > 128 || input_revision > 9_007_199_254_740_991 {
            return Err(failed());
        }
        let inner = &self.inner;
        inner
            .active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < inner.config.max_concurrent_children).then_some(n + 1)
            })
            .map_err(|_| limit())?;
        let _admitted = Admission(&inner.active);
        let started = Instant::now();
        let acquisition = match &lease.source {
            StoredSource::Upload {
                metadata,
                byte_length,
                ..
            } => {
                if *byte_length > inner.limits.max_upload_bytes {
                    return Err(limit());
                }
                Acquisition::File {
                    name: &metadata.filename,
                    bytes: base64::engine::general_purpose::STANDARD.encode(lease.read_upload()?),
                }
            }
            StoredSource::Backend { binding } => Acquisition::Backend { binding },
        };
        let request = serde_json::to_vec(&Request {
            widget_id,
            input_revision,
            limits: ParseLimits {
                max_bytes: inner.limits.max_upload_bytes,
                max_rows: inner.limits.max_input_rows,
                max_columns: inner.limits.max_input_columns,
                timeout_ms: inner.limits.max_job_seconds * 1000,
            },
            acquisition,
        })
        .map_err(|_| failed())?;
        if request.len() > inner.max_request {
            return Err(limit());
        }
        let response = self.run(&request, started)?;
        // Both Wasm and native service decode the same tagged value positions.
        let wire: pivot_wire::Request = serde_json::from_slice(&response).map_err(|_| failed())?;
        if wire.session_id != 0 {
            return Err(failed());
        }
        let decoded = wire.into_core_request().map_err(|_| failed())?;
        if decoded.request_id != "ingest"
            || decoded.revision.widget_id != widget_id
            || decoded.revision.input != input_revision
            || decoded.revision.model != 0
            || decoded.revision.output != 0
        {
            return Err(failed());
        }
        let Operation::RegisterInput {
            input,
            input_revision: received,
        } = decoded.operation
        else {
            return Err(failed());
        };
        if received != input_revision {
            return Err(failed());
        }
        validate_dataset(&input, &inner.limits)?;
        Ok(input)
    }
    fn run(&self, request: &[u8], started: Instant) -> Result<Vec<u8>, ServiceError> {
        let inner = &self.inner;
        let mut command = Command::new(&inner.config.node);
        command
            .arg(format!(
                "--max-old-space-size={}",
                inner.config.max_child_heap_mb
            ))
            .arg(&inner.config.entry)
            .arg("--max-request-bytes")
            .arg(inner.max_request.to_string())
            .arg("--max-output-bytes")
            .arg(inner.limits.max_parse_bytes.to_string());
        if let Some(path) = &inner.config.backend_config {
            command.arg("--backend-config").arg(path);
        }
        // Avoid inheriting desktop tokens, proxy settings, NODE_OPTIONS and unrelated secrets.
        command
            .env_clear()
            .env("LANG", "C.UTF-8")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = Running(command.spawn().map_err(|_| io_error())?);
        let mut stdin = Some(child.0.stdin.take().ok_or_else(io_error)?);
        let mut stdout = child.0.stdout.take().ok_or_else(io_error)?;
        let mut stderr = child.0.stderr.take().ok_or_else(io_error)?;
        nonblocking(stdin.as_ref().unwrap())?;
        nonblocking(&stdout)?;
        nonblocking(&stderr)?;
        let mut frame = Vec::with_capacity(request.len() + 4);
        frame.extend_from_slice(&(request.len() as u32).to_be_bytes());
        frame.extend_from_slice(request);
        let mut sent = 0;
        let mut output = Vec::new();
        let mut output_done = false;
        let mut error_done = false;
        let mut stderr_bytes = 0;
        let mut status = None;
        loop {
            if started.elapsed() >= Duration::from_secs(inner.limits.max_job_seconds) {
                return Err(limit());
            }
            if let Some(pipe) = &mut stdin {
                match pipe.write(&frame[sent..(sent + 65536).min(frame.len())]) {
                    Ok(0) => return Err(failed()),
                    Ok(n) => sent += n,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => {
                        stdin = None;
                    }
                    Err(_) => return Err(io_error()),
                }
                if sent == frame.len() {
                    stdin = None;
                }
            }
            if !output_done {
                output_done = drain(&mut stdout, |chunk| {
                    if output.len() + chunk.len() > inner.limits.max_parse_bytes as usize + 4 {
                        return Err(limit());
                    }
                    output.extend_from_slice(chunk);
                    if output.len() >= 4 {
                        let expected = u32::from_be_bytes(output[..4].try_into().unwrap()) as usize;
                        if expected == 0 || expected > inner.limits.max_parse_bytes as usize {
                            return Err(limit());
                        }
                        if output.len() > expected + 4 {
                            return Err(failed());
                        }
                    }
                    Ok(())
                })?;
            }
            if !error_done {
                error_done = drain(&mut stderr, |chunk| {
                    stderr_bytes += chunk.len();
                    if stderr_bytes > 16384 {
                        Err(limit())
                    } else {
                        Ok(())
                    }
                })?;
            }
            if status.is_none() {
                status = child.0.try_wait().map_err(|_| io_error())?;
            }
            if let Some(status) = status {
                if output_done && error_done {
                    if !status.success() || sent != frame.len() || output.len() < 4 {
                        return Err(failed());
                    }
                    let expected = u32::from_be_bytes(output[..4].try_into().unwrap()) as usize;
                    if output.len() != expected + 4 {
                        return Err(failed());
                    }
                    return Ok(output.split_off(4));
                }
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}
fn nonblocking(fd: &impl AsRawFd) -> Result<(), ServiceError> {
    pivot_native_worker::nonblocking(fd.as_raw_fd()).map_err(|_| io_error())
}
fn drain(
    pipe: &mut impl Read,
    mut consume: impl FnMut(&[u8]) -> Result<(), ServiceError>,
) -> Result<bool, ServiceError> {
    let mut chunk = [0u8; 8192];
    // Yield after a bounded number of reads so a chatty child cannot postpone the deadline.
    for _ in 0..16 {
        match pipe.read(&mut chunk) {
            Ok(0) => return Ok(true),
            Ok(n) => consume(&chunk[..n])?,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => return Ok(false),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err(io_error()),
        }
    }
    Ok(false)
}
fn validate_dataset(input: &SourceDataset, limits: &ServiceLimits) -> Result<(), ServiceError> {
    if input.rows.len() > limits.max_input_rows || input.columns.len() > limits.max_input_columns {
        return Err(limit());
    }
    if input.result_revision > 9_007_199_254_740_991
        || input.output_revision > 9_007_199_254_740_991
        || input.provenance.source_widget_id.is_empty()
        || input
            .freshness
            .last_success_at
            .is_some_and(|n| !n.is_finite())
    {
        return Err(failed());
    }
    let mut fields: BTreeSet<&str> = input.columns.iter().map(|c| c.id.as_str()).collect();
    let check = |value| pivot_core::validation::validate_wire_value(value).map_err(|_| failed());
    for row in &input.rows {
        if row.id.is_empty() {
            return Err(failed());
        }
        for (key, value) in &row.values {
            fields.insert(key);
            check(value)?;
        }
        if fields.len() > limits.max_input_columns {
            return Err(limit());
        }
        for member in row.group_path.iter().flatten() {
            check(&member.value)?;
        }
    }
    for column in &input.columns {
        if column.id.is_empty() {
            return Err(failed());
        }
        for value in column.metadata.iter().flat_map(|m| m.values()) {
            check(value)?;
        }
        for member in column.split_path.iter().flatten() {
            check(&member.value)?;
        }
    }
    for value in input
        .provenance
        .metadata
        .iter()
        .chain(&input.provenance.parameters)
        .chain(&input.provenance.receipt)
        .flat_map(|m| m.values())
    {
        check(value)?;
    }
    Ok(())
}
