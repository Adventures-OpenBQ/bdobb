// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use std::collections::BTreeMap;
use std::io::{self, Read};
use std::sync::Arc;
use table_service::{BackendBinding, ServiceLimits};
use table_service::{
    CatalogConfig, ErrorCode, Principal, SourceCatalog, StoredSource, UploadMetadata,
};

fn owner() -> Principal {
    Principal("alice@example.com".into())
}
fn metadata() -> UploadMetadata {
    UploadMetadata {
        filename: "private.csv".into(),
        media_type: "text/csv".into(),
    }
}
fn open(path: &std::path::Path) -> SourceCatalog {
    SourceCatalog::open(path, CatalogConfig::default()).unwrap()
}

// Missing ownership checks would expose both the source metadata and its payload.
#[test]
fn foreign_principal_cannot_read_or_delete() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = open(dir.path());
    let source = catalog
        .create_upload(&owner(), "first", metadata(), &b"secret\n42"[..])
        .unwrap();
    let foreign = Principal("bob@example.com".into());
    assert_eq!(
        catalog
            .acquire(&foreign, &source.source_id)
            .map(|l| l.source)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert_eq!(
        catalog
            .acquire(&foreign, &source.source_id)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert_eq!(
        catalog
            .delete(&foreign, &source.source_id)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert_eq!(
        catalog
            .acquire(&owner(), &source.source_id)
            .unwrap()
            .read_upload()
            .unwrap(),
        b"secret\n42"
    );
}

// Reissuing an acquisition must not create duplicate durable objects.
#[test]
fn retry_returns_same_source() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = open(dir.path());
    let first = catalog
        .create_upload(&owner(), "first", metadata(), &b"a,b\n1,2"[..])
        .unwrap();
    let second = catalog
        .create_upload(&owner(), "first", metadata(), &b"a,b\n1,2"[..])
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(
        catalog
            .create_upload(&owner(), "first", metadata(), &b"different"[..])
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
}

struct Interrupted(bool);
impl Read for Interrupted {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if !self.0 {
            self.0 = true;
            buffer[0] = b'x';
            return Ok(1);
        }
        Err(io::Error::new(io::ErrorKind::UnexpectedEof, "interrupted"))
    }
}

// Publishing before the stream finishes would leave an apparently available source.
#[test]
fn interrupted_upload_is_not_published() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = open(dir.path());
    assert_eq!(
        catalog
            .create_upload(&owner(), "first", metadata(), Interrupted(false))
            .unwrap_err()
            .code,
        ErrorCode::Io
    );
    let source = catalog
        .create_upload(&owner(), "first", metadata(), &b"complete"[..])
        .unwrap();
    assert_eq!(
        catalog
            .acquire(&owner(), &source.source_id)
            .unwrap()
            .read_upload()
            .unwrap(),
        b"complete"
    );
    let partial_count = std::fs::read_dir(dir.path())
        .unwrap()
        .flat_map(|entry| {
            std::fs::read_dir(entry.unwrap().path())
                .into_iter()
                .flatten()
        })
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".pending-")
        })
        .count();
    assert_eq!(partial_count, 0);
}

// In-memory-only indexes would lose the source and idempotency record on restart.
#[test]
fn restart_reopens_committed_upload() {
    let dir = tempfile::tempdir().unwrap();
    let source = {
        let catalog = open(dir.path());
        catalog
            .create_upload(&owner(), "first", metadata(), &b"durable"[..])
            .unwrap()
    };
    let catalog = open(dir.path());
    assert!(matches!(
        catalog
            .acquire(&owner(), &source.source_id)
            .map(|l| l.source)
            .unwrap(),
        StoredSource::Upload { .. }
    ));
    assert_eq!(
        catalog
            .acquire(&owner(), &source.source_id)
            .unwrap()
            .read_upload()
            .unwrap(),
        b"durable"
    );
    assert_eq!(
        catalog
            .create_upload(&owner(), "first", metadata(), &b"durable"[..])
            .unwrap(),
        source
    );
}

#[test]
fn deleted_source_is_unavailable_but_admitted_lease_retains_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = open(dir.path());
    let source = catalog
        .create_upload(&owner(), "first", metadata(), &b"pinned"[..])
        .unwrap();
    let lease = catalog.acquire(&owner(), &source.source_id).unwrap();
    catalog.delete(&owner(), &source.source_id).unwrap();
    assert_eq!(
        catalog
            .acquire(&owner(), &source.source_id)
            .map(|l| l.source)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert_eq!(lease.read_upload().unwrap(), b"pinned");
    assert_eq!(lease.read_upload().unwrap(), b"pinned");
    assert_eq!(
        catalog
            .create_upload(&owner(), "first", metadata(), &b"pinned"[..])
            .unwrap_err()
            .code,
        ErrorCode::Gone
    );
}

#[test]
fn streaming_limit_stops_at_one_excess_byte_and_cleans_partial() {
    struct Counting {
        count: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl Read for Counting {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            buf.fill(b'x');
            self.count
                .fetch_add(buf.len(), std::sync::atomic::Ordering::SeqCst);
            Ok(buf.len())
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let mut config = CatalogConfig::default();
    config.limits.max_upload_bytes = 3;
    let catalog = SourceCatalog::open(dir.path(), config).unwrap();
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    assert_eq!(
        catalog
            .create_upload(
                &owner(),
                "key",
                metadata(),
                Counting {
                    count: count.clone()
                }
            )
            .unwrap_err()
            .code,
        ErrorCode::LimitExceeded
    );
    assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 4);
    assert!(catalog
        .create_upload(&owner(), "key", metadata(), &b"abc"[..])
        .is_ok());
}

#[test]
fn concurrent_idempotent_publication_is_single_and_conflicts_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = Arc::new(open(dir.path()));
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let catalog = catalog.clone();
            std::thread::spawn(move || {
                catalog
                    .create_upload(&owner(), "parallel", metadata(), &b"same"[..])
                    .unwrap()
            })
        })
        .collect();
    let refs: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert!(refs.iter().all(|source| source == &refs[0]));
    let mut changed = metadata();
    changed.filename = "changed.csv".into();
    assert_eq!(
        catalog
            .create_upload(&owner(), "parallel", changed, &b"same"[..])
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    assert!(
        matches!(SourceCatalog::open(dir.path(), CatalogConfig::default()), Err(error) if error.code == ErrorCode::Conflict)
    );
}

#[test]
fn backend_registration_is_allowlisted_durable_and_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = CatalogConfig::default();
    config.backend_widgets.insert(
        "market".into(),
        BTreeMap::from([("prices".into(), ["symbol".to_string()].into())]),
    );
    let binding = BackendBinding {
        backend_id: "market".into(),
        widget_id: "prices".into(),
        params: BTreeMap::from([("symbol".into(), serde_json::json!("ABC"))]),
    };
    let source = {
        let catalog = SourceCatalog::open(dir.path(), config.clone()).unwrap();
        let source = catalog
            .register_backend(&owner(), "register", binding.clone())
            .unwrap();
        assert_eq!(
            catalog
                .register_backend(&owner(), "register", binding.clone())
                .unwrap(),
            source
        );
        let mut bad = binding.clone();
        bad.backend_id = "https://attacker.test".into();
        assert_eq!(
            catalog
                .register_backend(&owner(), "bad", bad)
                .unwrap_err()
                .code,
            ErrorCode::InvalidInput
        );
        let mut bad = binding.clone();
        bad.params
            .insert("authorization".into(), serde_json::json!("secret"));
        assert_eq!(
            catalog
                .register_backend(&owner(), "bad", bad)
                .unwrap_err()
                .code,
            ErrorCode::InvalidInput
        );
        source
    };
    let catalog = SourceCatalog::open(dir.path(), config).unwrap();
    assert_eq!(
        catalog
            .acquire(&owner(), &source.source_id)
            .map(|l| l.source)
            .unwrap(),
        StoredSource::Backend { binding }
    );
}

#[test]
fn identifiers_and_metadata_cannot_escape_storage() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = open(dir.path());
    for id in ["../private", "/etc/passwd", "s_../../secret", ""] {
        assert_eq!(
            catalog
                .acquire(&owner(), id)
                .map(|l| l.source)
                .unwrap_err()
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            catalog.delete(&owner(), id).unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }
    let mut bad = metadata();
    bad.filename = "../secret.csv".into();
    assert_eq!(
        catalog
            .create_upload(&owner(), "key", bad, &b"x"[..])
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        catalog
            .create_upload(&Principal("".into()), "key", metadata(), &b"x"[..])
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
}

#[cfg(unix)]
#[test]
fn symlink_root_namespace_or_payload_is_refused_without_foreign_reads() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let external = tempfile::tempdir().unwrap();
    let link = dir.path().join("link");
    symlink(external.path(), &link).unwrap();
    assert!(SourceCatalog::open(&link, CatalogConfig::default()).is_err());
    std::fs::remove_file(link).unwrap();
    let catalog = open(dir.path());
    let source = catalog
        .create_upload(&owner(), "first", metadata(), &b"owned"[..])
        .unwrap();
    let namespace = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.is_dir())
        .unwrap();
    let payload = namespace.join(&source.source_id).join("payload");
    let secret = external.path().join("secret");
    std::fs::write(&secret, "FOREIGN").unwrap();
    std::fs::remove_file(&payload).unwrap();
    symlink(&secret, payload).unwrap();
    assert!(catalog.acquire(&owner(), &source.source_id).is_err());
    drop(catalog);
    std::fs::remove_dir_all(&namespace).unwrap();
    symlink(external.path(), &namespace).unwrap();
    assert!(SourceCatalog::open(dir.path(), CatalogConfig::default()).is_err());
    assert_eq!(std::fs::read(secret).unwrap(), b"FOREIGN");
}

#[test]
fn restart_discards_unpublished_and_deleted_directories() {
    let dir = tempfile::tempdir().unwrap();
    let source = {
        let catalog = open(dir.path());
        catalog
            .create_upload(&owner(), "first", metadata(), &b"durable"[..])
            .unwrap()
    };
    let namespace = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.is_dir())
        .unwrap();
    for name in [".pending-abandoned", ".deleted-abandoned"] {
        let path = namespace.join(name);
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("partial"), b"orphan").unwrap();
    }
    let catalog = open(dir.path());
    assert!(catalog
        .acquire(&owner(), &source.source_id)
        .map(|l| l.source)
        .is_ok());
    assert!(!namespace.join(".pending-abandoned").exists());
    assert!(!namespace.join(".deleted-abandoned").exists());
}

#[test]
fn source_quota_is_principal_scoped_and_zero_limits_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = CatalogConfig::default();
    config.limits.max_sources_per_principal = 1;
    let catalog = SourceCatalog::open(dir.path(), config).unwrap();
    catalog
        .create_upload(&owner(), "first", metadata(), &b"x"[..])
        .unwrap();
    assert_eq!(
        catalog
            .create_upload(&owner(), "second", metadata(), &b"x"[..])
            .unwrap_err()
            .code,
        ErrorCode::LimitExceeded
    );
    assert!(catalog
        .create_upload(&Principal("bob".into()), "second", metadata(), &b"x"[..])
        .is_ok());
    let limits = ServiceLimits {
        max_upload_bytes: 0,
        ..ServiceLimits::default()
    };
    assert_eq!(
        limits.validate().unwrap_err().code,
        ErrorCode::InvalidConfig
    );
}

// Revoking an adapter must block its acquisition without taking unrelated
// private uploads or the entire durable catalog offline after restart.
#[test]
fn revoked_backend_is_unavailable_without_breaking_catalog_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = CatalogConfig::default();
    config.backend_widgets.insert(
        "market".into(),
        BTreeMap::from([("prices".into(), Default::default())]),
    );
    let (backend, upload) = {
        let catalog = SourceCatalog::open(dir.path(), config).unwrap();
        let backend = catalog
            .register_backend(
                &owner(),
                "backend",
                BackendBinding {
                    backend_id: "market".into(),
                    widget_id: "prices".into(),
                    params: BTreeMap::new(),
                },
            )
            .unwrap();
        let upload = catalog
            .create_upload(&owner(), "upload", metadata(), &b"safe"[..])
            .unwrap();
        (backend, upload)
    };
    let catalog = open(dir.path());
    assert_eq!(
        catalog
            .acquire(&owner(), &backend.source_id)
            .map(|l| l.source)
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        catalog
            .acquire(&owner(), &backend.source_id)
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        catalog
            .acquire(&owner(), &upload.source_id)
            .unwrap()
            .read_upload()
            .unwrap(),
        b"safe"
    );
    catalog.delete(&owner(), &backend.source_id).unwrap();
}

#[test]
fn deletion_frees_active_source_quota_but_preserves_retry_tombstone() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = CatalogConfig::default();
    config.limits.max_sources_per_principal = 1;
    let catalog = SourceCatalog::open(dir.path(), config).unwrap();
    let source = catalog
        .create_upload(&owner(), "first", metadata(), &b"old"[..])
        .unwrap();
    catalog.delete(&owner(), &source.source_id).unwrap();
    assert!(catalog
        .create_upload(&owner(), "second", metadata(), &b"new"[..])
        .is_ok());
    assert_eq!(
        catalog
            .create_upload(&owner(), "first", metadata(), &b"old"[..])
            .unwrap_err()
            .code,
        ErrorCode::Gone
    );
}

#[test]
fn expired_tombstones_free_record_capacity_without_reviving_old_source_id() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = CatalogConfig::default();
    config.limits.max_sources_per_principal = 1;
    config.limits.max_idempotency_records_per_principal = 1;
    config.limits.idempotency_retention_seconds = 1;
    let clock_ms = Arc::new(std::sync::atomic::AtomicU64::new(1000));
    let clock: table_service::CatalogClock = {
        let clock_ms = clock_ms.clone();
        Arc::new(move || {
            std::time::UNIX_EPOCH
                + std::time::Duration::from_millis(
                    clock_ms.load(std::sync::atomic::Ordering::SeqCst),
                )
        })
    };
    let catalog =
        SourceCatalog::open_with_clock(dir.path(), config.clone(), clock.clone()).unwrap();
    let old = catalog
        .create_upload(&owner(), "key", metadata(), &b"old"[..])
        .unwrap();
    catalog.delete(&owner(), &old.source_id).unwrap();
    assert_eq!(
        catalog
            .create_upload(&owner(), "key", metadata(), &b"old"[..])
            .unwrap_err()
            .code,
        ErrorCode::Gone
    );
    assert_eq!(
        catalog
            .create_upload(&owner(), "other", metadata(), &b"new"[..])
            .unwrap_err()
            .code,
        ErrorCode::LimitExceeded
    );
    clock_ms.store(2001, std::sync::atomic::Ordering::SeqCst);
    drop(catalog);
    let catalog = SourceCatalog::open_with_clock(dir.path(), config, clock).unwrap();
    assert_eq!(
        catalog
            .acquire(&owner(), &old.source_id)
            .map(|l| l.source)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    let fresh = catalog
        .create_upload(&owner(), "key", metadata(), &b"new"[..])
        .unwrap();
    assert_ne!(fresh, old);
    assert_eq!(
        catalog
            .acquire(&owner(), &old.source_id)
            .map(|l| l.source)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}

// A failed metadata replacement can leave an uncommitted temp record. Retrying
// deletion in the same process must remain possible without restarting service.
#[test]
fn delete_retries_past_an_uncommitted_metadata_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = open(dir.path());
    let source = catalog
        .create_upload(&owner(), "key", metadata(), &b"owned"[..])
        .unwrap();
    let namespace = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.is_dir())
        .unwrap();
    std::fs::write(
        namespace.join(&source.source_id).join("metadata.next"),
        b"partial",
    )
    .unwrap();
    catalog.delete(&owner(), &source.source_id).unwrap();
    assert_eq!(
        catalog
            .acquire(&owner(), &source.source_id)
            .map(|l| l.source)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}

#[test]
fn source_descriptors_use_camel_case_without_storage_paths_or_principals() {
    let source = StoredSource::Upload {
        metadata: metadata(),
        byte_length: 3,
        sha256: "a".repeat(64),
    };
    assert_eq!(
        serde_json::to_value(source).unwrap(),
        serde_json::json!({ "kind": "upload", "metadata": { "filename": "private.csv", "mediaType": "text/csv" }, "byteLength": 3, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
    );
}

// Exercises the automatic-root API boundary. This normal restart verifies
// committed source behavior, not survival of a host power failure.
#[test]
fn newly_created_catalog_root_reopens_committed_upload() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("new-catalog");
    assert!(!root.exists());
    let source = {
        let catalog = open(&root);
        catalog
            .create_upload(&owner(), "first", metadata(), &b"durable"[..])
            .unwrap()
    };
    let catalog = open(&root);
    assert_eq!(
        catalog
            .acquire(&owner(), &source.source_id)
            .unwrap()
            .read_upload()
            .unwrap(),
        b"durable"
    );
}

#[test]
fn missing_or_non_directory_root_parent_is_a_sanitized_storage_error() {
    let parent = tempfile::tempdir().unwrap();
    let invalid_parent = parent.path().join("file-parent");
    std::fs::write(&invalid_parent, b"unrelated").unwrap();
    for root in [
        parent.path().join("missing-parent/catalog"),
        invalid_parent.join("catalog"),
    ] {
        let error = match SourceCatalog::open(&root, CatalogConfig::default()) {
            Err(error) => error,
            Ok(_) => panic!("invalid parent opened a catalog"),
        };
        assert_eq!(error.code, ErrorCode::Io);
        assert_eq!(error.message, "source storage operation failed");
        assert!(!root.exists());
    }
    assert_eq!(std::fs::read(invalid_parent).unwrap(), b"unrelated");
}
// An in-flight or abandoned staging directory is not a record and must not block admission.
#[test]
fn staging_directories_do_not_block_admission() {
    let dir = tempfile::tempdir().unwrap();
    let catalog = open(dir.path());
    catalog
        .create_upload(&owner(), "first", metadata(), &b"a\n1"[..])
        .unwrap();
    let namespace = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.is_dir())
        .unwrap();
    for name in [".pending-s_inflight", ".deleted-s_gone"] {
        std::fs::create_dir(namespace.join(name)).unwrap();
    }
    catalog
        .create_upload(&owner(), "second", metadata(), &b"a\n2"[..])
        .unwrap();
}
// The catalog must refuse every parameter value the Node backend adapter refuses
// (server/table-ingest/backend.ts param()), or a registered source can never ingest.
#[test]
fn backend_params_match_ingestion_limits() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = CatalogConfig::default();
    config.backend_widgets.insert(
        "market".into(),
        BTreeMap::from([("prices".into(), ["symbol".to_string()].into())]),
    );
    let catalog = SourceCatalog::open(dir.path(), config).unwrap();
    let register = |key: &str, value: serde_json::Value| {
        catalog.register_backend(
            &owner(),
            key,
            BackendBinding {
                backend_id: "market".into(),
                widget_id: "prices".into(),
                params: BTreeMap::from([("symbol".into(), value)]),
            },
        )
    };
    for (i, value) in [
        serde_json::json!("//evil.test/x"),
        serde_json::json!("HTTP:evil"),
        serde_json::json!("https:x"),
        serde_json::json!("File:/etc/passwd"),
        serde_json::json!("a".repeat(4097)),
        serde_json::json!(vec!["A"; 65]),
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            register(&format!("bad{i}"), value.clone())
                .unwrap_err()
                .code,
            ErrorCode::InvalidInput,
            "{value}"
        );
    }
    for (i, value) in [
        serde_json::json!("é".repeat(4096)),
        serde_json::json!(vec!["A"; 64]),
        serde_json::json!("a/b"),
    ]
    .into_iter()
    .enumerate()
    {
        register(&format!("ok{i}"), value).unwrap();
    }
}
