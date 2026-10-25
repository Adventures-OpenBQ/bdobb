// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{config, digest, hex, CatalogConfig, ErrorCode, Principal, ServiceError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Trusted service clock injection supports deterministic lifecycle qualification.
pub type CatalogClock = Arc<dyn Fn() -> SystemTime + Send + Sync>;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRef {
    pub source_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadMetadata {
    /// Display-only basename. Never used in filesystem operations.
    pub filename: String,
    pub media_type: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackendBinding {
    pub backend_id: String,
    pub widget_id: String,
    pub params: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum StoredSource {
    Upload {
        metadata: UploadMetadata,
        byte_length: u64,
        sha256: String,
    },
    Backend {
        binding: BackendBinding,
    },
}

/// An admitted snapshot pin. Deletion revokes future catalog access but cannot
/// invalidate this descriptor. Dropping the lease releases the retained bytes.
#[derive(Debug)]
pub struct SourceLease {
    pub source: StoredSource,
    upload: Option<File>,
    max_upload_bytes: u64,
}
impl SourceLease {
    /// Bounded, integrity-checked read without exposing a caller-usable path.
    /// Uses positional reads so repeated/concurrent reads do not share a cursor.
    pub fn read_upload(&self) -> Result<Vec<u8>, ServiceError> {
        use std::os::unix::fs::FileExt;
        let (
            StoredSource::Upload {
                byte_length,
                sha256,
                ..
            },
            Some(file),
        ) = (&self.source, &self.upload)
        else {
            return Err(ServiceError::new(
                ErrorCode::InvalidInput,
                "source is not an upload",
            ));
        };
        if *byte_length > self.max_upload_bytes {
            return Err(limit());
        }
        let mut bytes = vec![0; *byte_length as usize];
        file.read_exact_at(&mut bytes, 0)?;
        if digest(&bytes) != *sha256 {
            return Err(corrupt());
        }
        Ok(bytes)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u32,
    source_id: String,
    idempotency_hash: String,
    request_hash: String,
    // A tombstone retains only opaque hashes, never upload metadata or bytes.
    source: Option<StoredSource>,
    deleted_at_ms: Option<u64>,
}

/// A single process owns a catalog volume (advisory lock held for its lifetime).
/// Shared callers serialize publication, deletion and idempotency under one mutex.
/// Keep this synchronous disk/stream work off the HTTP reactor thread.
pub struct SourceCatalog {
    root: private_fs::Dir,
    config: CatalogConfig,
    _lock: File,
    gate: Mutex<()>,
    clock: CatalogClock,
}
impl SourceCatalog {
    pub fn open(path: impl AsRef<Path>, config: CatalogConfig) -> Result<Self, ServiceError> {
        Self::open_with_clock(path, config, Arc::new(SystemTime::now))
    }
    pub fn open_with_clock(
        path: impl AsRef<Path>,
        config: CatalogConfig,
        clock: CatalogClock,
    ) -> Result<Self, ServiceError> {
        config.validate()?;
        let root = private_fs::Dir::open_root(path.as_ref())?;
        let lock = root.file(".catalog.lock", libc::O_CREAT | libc::O_RDWR)?;
        use std::os::fd::AsRawFd;
        // SAFETY: lock owns a valid descriptor for this call and catalog lifetime.
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err(ServiceError::new(
                ErrorCode::Conflict,
                "source catalog is already in use",
            ));
        }
        let catalog = Self {
            root,
            config,
            _lock: lock,
            gate: Mutex::new(()),
            clock,
        };
        catalog.recover()?;
        Ok(catalog)
    }

    pub fn create_upload<R: Read>(
        &self,
        principal: &Principal,
        idempotency_key: &str,
        metadata: UploadMetadata,
        mut bytes: R,
    ) -> Result<SourceRef, ServiceError> {
        principal.validate()?;
        validate_key(idempotency_key)?;
        validate_metadata(&metadata, self.config.limits.max_metadata_bytes)?;
        let _gate = self.gate.lock().map_err(|_| storage())?;
        let namespace = self.namespace(principal, true)?;
        let key = digest(idempotency_key.as_bytes());
        let existing = self.find(&namespace, &key)?;
        if existing.is_none() {
            self.admit(&namespace)?;
        }
        let source_id = opaque_id()?;
        let pending_name = format!(".pending-{source_id}");
        let pending = namespace.create_dir(&pending_name)?;
        let result = (|| {
            let mut file =
                pending.file("payload", libc::O_CREAT | libc::O_EXCL | libc::O_WRONLY)?;
            let mut hasher = Sha256::new();
            let mut length = 0u64;
            let mut buffer = [0; 16 * 1024];
            loop {
                let remaining = self.config.limits.max_upload_bytes - length;
                let size = ((remaining + 1).min(buffer.len() as u64)) as usize;
                let count = match bytes.read(&mut buffer[..size]) {
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    result => result?,
                };
                if count == 0 {
                    break;
                }
                length += count as u64;
                if length > self.config.limits.max_upload_bytes {
                    return Err(limit());
                }
                file.write_all(&buffer[..count])?;
                hasher.update(&buffer[..count]);
            }
            let source = StoredSource::Upload {
                metadata,
                byte_length: length,
                sha256: hex(&hasher.finalize()),
            };
            let request_hash = fingerprint(&source)?;
            if let Some(existing) = existing {
                return retry(existing, &request_hash);
            }
            file.sync_all()?;
            let record = Record {
                version: 1,
                source_id: source_id.clone(),
                idempotency_hash: key,
                request_hash,
                source: Some(source),
                deleted_at_ms: None,
            };
            self.publish(&namespace, &pending_name, &pending, &record)?;
            Ok(SourceRef { source_id })
        })();
        // Once renamed this name is absent. Errors and retries leave no partial bytes.
        namespace.remove_tree_if_present(&pending_name)?;
        result
    }

    pub fn register_backend(
        &self,
        principal: &Principal,
        idempotency_key: &str,
        binding: BackendBinding,
    ) -> Result<SourceRef, ServiceError> {
        principal.validate()?;
        validate_key(idempotency_key)?;
        self.validate_backend(&binding)?;
        let source = StoredSource::Backend { binding };
        let request_hash = fingerprint(&source)?;
        let key = digest(idempotency_key.as_bytes());
        let _gate = self.gate.lock().map_err(|_| storage())?;
        let namespace = self.namespace(principal, true)?;
        if let Some(existing) = self.find(&namespace, &key)? {
            return retry(existing, &request_hash);
        }
        self.admit(&namespace)?;
        let source_id = opaque_id()?;
        let pending_name = format!(".pending-{source_id}");
        let pending = namespace.create_dir(&pending_name)?;
        let record = Record {
            version: 1,
            source_id: source_id.clone(),
            idempotency_hash: key,
            request_hash,
            source: Some(source),
            deleted_at_ms: None,
        };
        let result = self
            .publish(&namespace, &pending_name, &pending, &record)
            .map(|_| SourceRef { source_id });
        namespace.remove_tree_if_present(&pending_name)?;
        result
    }

    pub fn acquire(
        &self,
        principal: &Principal,
        source_id: &str,
    ) -> Result<SourceLease, ServiceError> {
        principal.validate()?;
        validate_source_id(source_id)?;
        let _gate = self.gate.lock().map_err(|_| storage())?;
        let namespace = self.namespace(principal, false)?;
        let source = self
            .record(&namespace, source_id)?
            .source
            .ok_or_else(not_found)?;
        let upload = match &source {
            StoredSource::Upload { byte_length, .. } => {
                if *byte_length > self.config.limits.max_upload_bytes {
                    return Err(limit());
                }
                let file = namespace
                    .child(source_id)?
                    .file("payload", libc::O_RDONLY)?;
                if !file.metadata()?.is_file() || file.metadata()?.len() != *byte_length {
                    return Err(corrupt());
                }
                Some(file)
            }
            StoredSource::Backend { binding } => {
                self.validate_backend(binding)?;
                None
            }
        };
        Ok(SourceLease {
            source,
            upload,
            max_upload_bytes: self.config.limits.max_upload_bytes,
        })
    }

    pub fn delete(&self, principal: &Principal, source_id: &str) -> Result<(), ServiceError> {
        principal.validate()?;
        validate_source_id(source_id)?;
        let _gate = self.gate.lock().map_err(|_| storage())?;
        let namespace = self.namespace(principal, false)?;
        let mut record = self.record(&namespace, source_id)?;
        if record.source.take().is_none() {
            return Err(not_found());
        }
        record.deleted_at_ms = Some(self.now_ms()?);
        let dir = namespace.child(source_id)?;
        dir.remove_tree_if_present("metadata.next")?;
        write_record(&dir, "metadata.next", &record)?;
        dir.rename("metadata.next", "metadata.json")?;
        dir.sync()?; // Durable revocation precedes reclaiming payload bytes.
        dir.remove_tree_if_present("payload")?;
        dir.sync()?;
        Ok(())
    }

    fn namespace(
        &self,
        principal: &Principal,
        create: bool,
    ) -> Result<private_fs::Dir, ServiceError> {
        let name = format!("p_{}", digest(principal.0.as_bytes()));
        let namespace = if create {
            self.root.ensure_dir(&name)?
        } else {
            self.root.child(&name).map_err(map_not_found)?
        };
        self.prune(&namespace)?;
        Ok(namespace)
    }
    fn find(&self, namespace: &private_fs::Dir, key: &str) -> Result<Option<Record>, ServiceError> {
        for id in namespace.entries()? {
            if id.starts_with("s_") {
                let record = self.record(namespace, &id)?;
                if record.idempotency_hash == key {
                    return Ok(Some(record));
                }
            }
        }
        Ok(None)
    }
    fn admit(&self, namespace: &private_fs::Dir) -> Result<(), ServiceError> {
        // Staging (.pending-*/.deleted-*) directories are not records, as in find()/prune().
        let ids: Vec<String> = namespace
            .entries()?
            .into_iter()
            .filter(|id| id.starts_with("s_"))
            .collect();
        if ids.len() >= self.config.limits.max_idempotency_records_per_principal {
            return Err(limit());
        }
        let mut active = 0;
        for id in ids {
            if self.record(namespace, &id)?.source.is_some() {
                active += 1;
            }
        }
        if active >= self.config.limits.max_sources_per_principal {
            return Err(limit());
        }
        Ok(())
    }
    fn publish(
        &self,
        namespace: &private_fs::Dir,
        pending_name: &str,
        pending: &private_fs::Dir,
        record: &Record,
    ) -> Result<(), ServiceError> {
        write_record(pending, "metadata.json", record)?;
        pending.sync()?;
        namespace.rename(pending_name, &record.source_id)?;
        namespace.sync()?;
        Ok(())
    }
    fn record(&self, namespace: &private_fs::Dir, source_id: &str) -> Result<Record, ServiceError> {
        validate_source_id(source_id)?;
        let dir = namespace.child(source_id).map_err(map_not_found)?;
        let file = dir.file("metadata.json", libc::O_RDONLY)?;
        let bound = self.config.limits.max_metadata_bytes as u64 + 4096;
        if !file.metadata()?.is_file() || file.metadata()?.len() > bound {
            return Err(corrupt());
        }
        let mut bytes = Vec::new();
        file.take(bound + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > bound {
            return Err(corrupt());
        }
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
        if record.version != 1
            || record.source_id != source_id
            || !valid_hash(&record.idempotency_hash)
            || !valid_hash(&record.request_hash)
            || record.source.is_none() != record.deleted_at_ms.is_some()
        {
            return Err(corrupt());
        }
        if let Some(source) = &record.source {
            match source {
                StoredSource::Upload {
                    metadata,
                    byte_length: _,
                    sha256,
                } => {
                    validate_metadata(metadata, self.config.limits.max_metadata_bytes)
                        .map_err(|_| corrupt())?;
                    if !valid_hash(sha256) {
                        return Err(corrupt());
                    }
                }
                StoredSource::Backend { binding } => {
                    validate_backend_shape(binding, self.config.limits.max_metadata_bytes)
                        .map_err(|_| corrupt())?
                }
            }
            if fingerprint(source)? != record.request_hash {
                return Err(corrupt());
            }
        }
        Ok(record)
    }
    fn validate_backend(&self, binding: &BackendBinding) -> Result<(), ServiceError> {
        validate_backend_shape(binding, self.config.limits.max_metadata_bytes)?;
        let invalid = || {
            ServiceError::new(
                ErrorCode::InvalidInput,
                "backend, widget or parameters are not admitted",
            )
        };
        let allowed = self
            .config
            .backend_widgets
            .get(&binding.backend_id)
            .and_then(|widgets| widgets.get(&binding.widget_id))
            .ok_or_else(invalid)?;
        for key in binding.params.keys() {
            if !allowed.contains(key) {
                return Err(invalid());
            }
        }
        Ok(())
    }
    fn recover(&self) -> Result<(), ServiceError> {
        for name in self.root.entries()? {
            if name == ".catalog.lock" {
                continue;
            }
            if !name.starts_with("p_") || !valid_hash(&name[2..]) {
                return Err(corrupt());
            }
            let namespace = self.root.child(&name)?;
            for id in namespace.entries()? {
                if id.starts_with(".pending-") || id.starts_with(".deleted-") {
                    namespace.remove_tree_if_present(&id)?;
                } else {
                    let record = self.record(&namespace, &id)?;
                    let dir = namespace.child(&id)?;
                    dir.remove_tree_if_present("metadata.next")?;
                    if record.source.is_none() {
                        dir.remove_tree_if_present("payload")?;
                    }
                    dir.sync()?;
                }
            }
            namespace.sync()?;
            self.prune(&namespace)?;
        }
        Ok(())
    }
    fn now_ms(&self) -> Result<u64, ServiceError> {
        (self.clock)()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|d| u64::try_from(d.as_millis()).ok())
            .ok_or_else(|| {
                ServiceError::new(
                    ErrorCode::InvalidConfig,
                    "catalog clock is outside the supported range",
                )
            })
    }
    fn prune(&self, namespace: &private_fs::Dir) -> Result<(), ServiceError> {
        let now = self.now_ms()?;
        let retention_ms = self.config.limits.idempotency_retention_seconds * 1000;
        let mut changed = false;
        for id in namespace.entries()? {
            if id.starts_with("s_") {
                let record = self.record(namespace, &id)?;
                if record
                    .deleted_at_ms
                    .is_some_and(|deleted| now.saturating_sub(deleted) >= retention_ms)
                {
                    let deleted_name = format!(".deleted-{id}");
                    // Depublish atomically before unlinking the record. A crash
                    // during recursive cleanup can never leave a live half-record.
                    namespace.rename(&id, &deleted_name)?;
                    namespace.sync()?;
                    namespace.remove_tree_if_present(&deleted_name)?;
                    changed = true;
                }
            }
        }
        if changed {
            namespace.sync()?;
        }
        Ok(())
    }
}
/// Mirrors param() in server/table-ingest/backend.ts so every accepted binding can ingest.
fn simple_value(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(_) => false,
        serde_json::Value::Array(values) => {
            values.len() <= 64 && values.iter().all(|v| !v.is_array() && simple_value(v))
        }
        serde_json::Value::String(value) => {
            let lower = value.to_ascii_lowercase();
            // JS string length counts UTF-16 code units.
            value.encode_utf16().count() <= 4096
                && !["//", "http:", "https:", "file:"]
                    .iter()
                    .any(|p| lower.contains(p))
                && !value.chars().any(char::is_control)
        }
        _ => true,
    }
}
fn validate_backend_shape(binding: &BackendBinding, max: usize) -> Result<(), ServiceError> {
    if !config::identifier(&binding.backend_id)
        || !config::identifier(&binding.widget_id)
        || binding.params.len() > 1024
        || binding.params.iter().any(|(key, value)| {
            !config::identifier(key) || config::forbidden_parameter(key) || !simple_value(value)
        })
    {
        return Err(ServiceError::new(
            ErrorCode::InvalidInput,
            "invalid backend binding",
        ));
    }
    check_encoded_size(binding, max)
}
/// Count serialization bytes without first allocating an unbounded JSON buffer.
fn check_encoded_size(value: &impl Serialize, max: usize) -> Result<(), ServiceError> {
    struct Counter {
        remaining: usize,
    }
    impl Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > self.remaining {
                return Err(std::io::Error::other("limit"));
            }
            self.remaining -= bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Counter { remaining: max }, value).map_err(|_| limit())
}
fn write_record(dir: &private_fs::Dir, name: &str, record: &Record) -> Result<(), ServiceError> {
    let mut file = dir.file(name, libc::O_CREAT | libc::O_EXCL | libc::O_WRONLY)?;
    serde_json::to_writer(&mut file, record).map_err(|_| storage())?;
    file.sync_all()?;
    Ok(())
}
fn fingerprint(source: &StoredSource) -> Result<String, ServiceError> {
    Ok(digest(&serde_json::to_vec(source).map_err(|_| storage())?))
}
fn retry(existing: Record, request_hash: &str) -> Result<SourceRef, ServiceError> {
    if existing.request_hash != request_hash {
        return Err(ServiceError::new(
            ErrorCode::Conflict,
            "idempotency key was used for a different request",
        ));
    }
    if existing.source.is_none() {
        return Err(ServiceError::new(
            ErrorCode::Gone,
            "source was deleted; use a new idempotency key for new acquisition",
        ));
    }
    Ok(SourceRef {
        source_id: existing.source_id,
    })
}
fn opaque_id() -> Result<String, ServiceError> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| storage())?;
    Ok(format!("s_{}", hex(&bytes)))
}
fn validate_source_id(id: &str) -> Result<(), ServiceError> {
    if !id.starts_with("s_") || !valid_hash(&id[2..]) {
        return Err(ServiceError::new(
            ErrorCode::InvalidInput,
            "invalid source identifier",
        ));
    }
    Ok(())
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate_key(key: &str) -> Result<(), ServiceError> {
    if key.is_empty() || key.len() > 256 || key.chars().any(char::is_control) {
        return Err(ServiceError::new(
            ErrorCode::InvalidInput,
            "invalid idempotency key",
        ));
    }
    Ok(())
}
fn validate_metadata(metadata: &UploadMetadata, max: usize) -> Result<(), ServiceError> {
    if metadata.filename.is_empty()
        || metadata.filename.len() > 255
        || metadata.filename == "."
        || metadata.filename == ".."
        || metadata.filename.contains(['/', '\\'])
        || metadata.filename.chars().any(char::is_control)
        || metadata.media_type.is_empty()
        || metadata.media_type.len() > 128
        || !metadata.media_type.bytes().all(|b| b.is_ascii_graphic())
    {
        return Err(ServiceError::new(
            ErrorCode::InvalidInput,
            "invalid upload metadata",
        ));
    }
    check_encoded_size(metadata, max)
}
fn limit() -> ServiceError {
    ServiceError::new(ErrorCode::LimitExceeded, "source admission limit exceeded")
}
fn storage() -> ServiceError {
    ServiceError::new(ErrorCode::Io, "source storage operation failed")
}
fn corrupt() -> ServiceError {
    ServiceError::new(ErrorCode::CorruptStorage, "source storage is inconsistent")
}
fn not_found() -> ServiceError {
    ServiceError::new(
        ErrorCode::NotFound,
        "source is unavailable; reacquire it or upload the file again",
    )
}
fn map_not_found(error: ServiceError) -> ServiceError {
    if error.code == ErrorCode::NotFound {
        not_found()
    } else {
        error
    }
}

/// All post-open operations are relative to owned directory descriptors. Symlink
/// swaps in ancestor paths therefore cannot redirect a source read or deletion.
mod private_fs {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    pub(super) struct Dir(File);
    fn name(value: &str) -> Result<CString, ServiceError> {
        if value.is_empty() || value.contains('/') || matches!(value, "." | "..") {
            return Err(corrupt());
        }
        CString::new(value).map_err(|_| corrupt())
    }
    fn io_error() -> ServiceError {
        if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
            return not_found();
        }
        storage()
    }
    impl Dir {
        pub fn open_root(path: &Path) -> Result<Self, ServiceError> {
            Self::open_root_with_parent_sync(path, File::sync_all)
        }
        fn open_root_with_parent_sync(
            path: &Path,
            sync_parent: impl FnOnce(&File) -> std::io::Result<()>,
        ) -> Result<Self, ServiceError> {
            match std::fs::create_dir(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.into()),
            }
            let file = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(path)?;
            file.set_permissions(std::fs::Permissions::from_mode(0o700))?;
            // Syncing children cannot make a newly-created root's entry durable.
            // The configured ancestor path is trusted (and may contain symlinks).
            // Sync on every open: a previous failed sync may have left the root
            // present, so a retry must not skip this durability boundary.
            let parent_path = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| {
                    if path.has_root() {
                        path
                    } else {
                        Path::new(".")
                    }
                });
            let parent = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC)
                .open(parent_path)?;
            sync_parent(&parent)?;
            Ok(Self(file))
        }
        pub fn file(&self, value: &str, flags: i32) -> Result<File, ServiceError> {
            let name = name(value)?;
            // SAFETY: directory descriptor and NUL-terminated basename are valid.
            let fd = unsafe {
                libc::openat(
                    self.0.as_raw_fd(),
                    name.as_ptr(),
                    flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                    0o600,
                )
            };
            if fd < 0 {
                return Err(io_error());
            }
            // SAFETY: openat returned a fresh descriptor now uniquely owned by File.
            let file = unsafe { File::from_raw_fd(fd) };
            if !file.metadata()?.is_file() {
                return Err(corrupt());
            }
            Ok(file)
        }
        pub fn child(&self, value: &str) -> Result<Self, ServiceError> {
            let name = name(value)?;
            // SAFETY: valid owned descriptor and basename; NOFOLLOW rejects symlinks.
            let fd = unsafe {
                libc::openat(
                    self.0.as_raw_fd(),
                    name.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(io_error());
            }
            // SAFETY: fd is fresh and becomes owned by this Dir.
            Ok(Self(unsafe { File::from_raw_fd(fd) }))
        }
        pub fn create_dir(&self, value: &str) -> Result<Self, ServiceError> {
            let name = name(value)?;
            // SAFETY: arguments refer to an owned directory and valid basename.
            if unsafe { libc::mkdirat(self.0.as_raw_fd(), name.as_ptr(), 0o700) } != 0 {
                return Err(io_error());
            }
            self.child(value)
        }
        pub fn ensure_dir(&self, value: &str) -> Result<Self, ServiceError> {
            let name = name(value)?;
            // SAFETY: arguments refer to an owned directory and valid basename.
            if unsafe { libc::mkdirat(self.0.as_raw_fd(), name.as_ptr(), 0o700) } != 0
                && std::io::Error::last_os_error().kind() != std::io::ErrorKind::AlreadyExists
            {
                return Err(io_error());
            }
            let dir = self.child(value)?;
            self.sync()?;
            Ok(dir)
        }
        pub fn entries(&self) -> Result<Vec<String>, ServiceError> {
            // Opening "." gives a distinct open file description: dup would share
            // the directory cursor and silently skip entries on subsequent scans.
            let current = c".";
            // SAFETY: owned descriptor; constant NUL-terminated name.
            let fd = unsafe {
                libc::openat(
                    self.0.as_raw_fd(),
                    current.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(io_error());
            }
            // SAFETY: fdopendir takes ownership of the fresh directory descriptor.
            let stream = unsafe { libc::fdopendir(fd) };
            if stream.is_null() {
                // SAFETY: fdopendir did not take ownership on failure.
                unsafe {
                    libc::close(fd);
                }
                return Err(io_error());
            }
            let result = (|| {
                let mut names = Vec::new();
                loop {
                    errno::set_errno(errno::Errno(0));
                    // SAFETY: stream remains live until closed below; returned entry
                    // is copied before the next readdir call invalidates it.
                    let entry = unsafe { libc::readdir(stream) };
                    if entry.is_null() {
                        if errno::errno().0 != 0 {
                            return Err(storage());
                        }
                        break;
                    }
                    // SAFETY: POSIX readdir guarantees a NUL-terminated d_name.
                    let value = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }
                        .to_str()
                        .map_err(|_| corrupt())?;
                    if !matches!(value, "." | "..") {
                        names.push(value.to_string());
                    }
                }
                Ok(names)
            })();
            // SAFETY: stream was created above and is closed exactly once here.
            unsafe {
                libc::closedir(stream);
            }
            result
        }
        pub fn rename(&self, from: &str, to: &str) -> Result<(), ServiceError> {
            let from = name(from)?;
            let to = name(to)?;
            // SAFETY: both basenames are valid relative to the same owned directory.
            if unsafe {
                libc::renameat(
                    self.0.as_raw_fd(),
                    from.as_ptr(),
                    self.0.as_raw_fd(),
                    to.as_ptr(),
                )
            } != 0
            {
                return Err(io_error());
            }
            Ok(())
        }
        pub fn sync(&self) -> Result<(), ServiceError> {
            self.0.sync_all().map_err(Into::into)
        }
        pub fn remove_tree_if_present(&self, value: &str) -> Result<(), ServiceError> {
            let name = name(value)?;
            // SAFETY: fstatat initializes stat on success; NOFOLLOW inspects links.
            let mut stat: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe {
                libc::fstatat(
                    self.0.as_raw_fd(),
                    name.as_ptr(),
                    &mut stat,
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                let error = io_error();
                if error.code == ErrorCode::NotFound {
                    return Ok(());
                }
                return Err(error);
            }
            let flags = if stat.st_mode & libc::S_IFMT == libc::S_IFDIR {
                let child = self.child(value)?;
                for entry in child.entries()? {
                    child.remove_tree_if_present(&entry)?;
                }
                libc::AT_REMOVEDIR
            } else {
                0
            };
            // SAFETY: unlinkat removes only this directory-relative name; never follows links.
            if unsafe { libc::unlinkat(self.0.as_raw_fd(), name.as_ptr(), flags) } != 0 {
                return Err(io_error());
            }
            Ok(())
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::MetadataExt;

        // Removing/ignoring the parent sync or skipping it for an existing root
        // would make this test fail. The callback substitutes one real I/O boundary.
        #[test]
        fn parent_sync_failure_prevents_open_and_retry_still_syncs() {
            let parent = tempfile::tempdir().unwrap();
            let root = parent.path().join("new-catalog");
            let error = match Dir::open_root_with_parent_sync(&root, |_| {
                Err(std::io::Error::other("injected sync failure"))
            }) {
                Err(error) => error,
                Ok(_) => panic!("parent sync failure must prevent successful open"),
            };
            assert_eq!(error.code, ErrorCode::Io);
            assert!(root.is_dir());
            let expected_parent = parent.path().metadata().unwrap();
            let mut synced = false;
            let _root = Dir::open_root_with_parent_sync(&root, |directory| {
                let actual_parent = directory.metadata()?;
                assert_eq!(actual_parent.dev(), expected_parent.dev());
                assert_eq!(actual_parent.ino(), expected_parent.ino());
                synced = true;
                directory.sync_all()
            })
            .unwrap();
            assert!(synced, "retry must sync even though the root now exists");
        }
    }
}
