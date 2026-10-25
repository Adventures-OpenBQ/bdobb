// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_native_worker::WorkerConfig;
use std::{path::PathBuf, time::Duration};
#[test]
fn invalid_admission_is_rejected() {
    for (path, memory, frame, deadline) in [
        ("relative", 1024, 512, Duration::from_secs(1)),
        ("/worker", 0, 512, Duration::from_secs(1)),
        ("/worker", 1024, 0, Duration::from_secs(1)),
        ("/worker", 1024, usize::MAX, Duration::from_secs(1)),
        ("/worker", 1024, 512, Duration::ZERO),
    ] {
        assert!(WorkerConfig::new(PathBuf::from(path), memory, frame, deadline).is_err());
    }
}
#[test]
#[cfg(not(target_os = "linux"))]
fn unsupported_os_is_explicit() {
    use pivot_native_worker::{ResourceLimits, WorkerError, WorkerSession};
    let config = WorkerConfig::new(
        PathBuf::from("/worker"),
        128 * 1024 * 1024,
        1024,
        Duration::from_secs(1),
    )
    .unwrap();
    assert!(matches!(
        WorkerSession::spawn(config, "en-US", ResourceLimits::default()),
        Err(WorkerError::UnsupportedPlatform)
    ));
}

#[test]
fn startup_capacity_is_validated_and_shared() {
    let config = WorkerConfig::new(
        "/worker".into(),
        128 * 1024 * 1024,
        1024,
        Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(config.max_starting_workers(), 1);
    assert_eq!(config.reserved_startup_memory_bytes(), 128 * 1024 * 1024);
    assert!(config.clone().with_max_starting_workers(0).is_err());
    assert!(config.clone().with_max_starting_workers(1025).is_err());
    let config = config.with_max_starting_workers(2).unwrap();
    assert_eq!(config.reserved_startup_memory_bytes(), 256 * 1024 * 1024);
    assert!(config.clone().with_max_starting_workers(3).is_err());
}

#[test]
fn batch_rows_default_and_bounds_are_validated() {
    use pivot_native_worker::WorkerError;
    let config = WorkerConfig::new(
        "/worker".into(),
        128 * 1024 * 1024,
        1024,
        Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(config.batch_rows(), 500);
    for rows in [0, 501, u32::MAX] {
        assert!(matches!(
            config.clone().with_batch_rows(rows),
            Err(WorkerError::InvalidConfig)
        ));
    }
    for rows in [1, 2, 500] {
        assert_eq!(
            config.clone().with_batch_rows(rows).unwrap().batch_rows(),
            rows
        );
    }
}
