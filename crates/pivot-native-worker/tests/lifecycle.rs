// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(all(target_os = "linux", feature = "test-fixture"))]
use pivot_native_worker::{ResourceLimits, WorkerConfig, WorkerError, WorkerSession};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
fn fixture(deadline: Duration) -> WorkerSession {
    WorkerSession::spawn(
        WorkerConfig::new(
            PathBuf::from(env!("CARGO_BIN_EXE_worker-fixture")),
            128 * 1024 * 1024,
            1024,
            deadline,
        )
        .unwrap(),
        "en-US",
        ResourceLimits::default(),
    )
    .unwrap()
}
#[test]
fn malformed_extra_oversized_truncated_and_exit_are_terminal() {
    for command in [
        "malformed",
        "extra",
        "oversized",
        "truncated",
        "unknown",
        "utf8",
        "sequence",
        "exit",
    ] {
        let mut worker = fixture(Duration::from_secs(3));
        let control = worker.control();
        let error = worker.dispatch_wire(command).unwrap_err();
        match command {
            "oversized" => assert_eq!(error, WorkerError::FrameTooLarge),
            "truncated" | "exit" => {
                assert!(matches!(error, WorkerError::Io | WorkerError::Terminated))
            }
            _ => assert_eq!(error, WorkerError::Protocol, "{command}"),
        }
        assert!(control.is_terminated(), "{command}");
    }
}
#[test]
fn deadlines_cover_blocked_read_and_write_and_reap() {
    let mut worker = fixture(Duration::from_millis(150));
    let control = worker.control();
    let now = Instant::now();
    assert_eq!(
        worker.dispatch_wire("block").unwrap_err(),
        WorkerError::Deadline
    );
    assert!(now.elapsed() < Duration::from_secs(2));
    assert!(control.is_terminated());
}
#[test]
fn independent_cancel_and_drop_reap_without_waiting_for_rpc() {
    let mut worker = fixture(Duration::from_secs(30));
    let control = worker.control();
    let pid: u32 = worker.dispatch_wire("pid").unwrap().parse().unwrap();
    let handle = std::thread::spawn(move || worker.dispatch_wire("block"));
    std::thread::sleep(Duration::from_millis(50));
    let now = Instant::now();
    control.kill().unwrap();
    assert!(now.elapsed() < Duration::from_secs(1));
    assert!(handle.join().unwrap().is_err());
    assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
    // Repeated cancellation cannot target a newly reused process ID.
    for _ in 0..30 {
        control.kill().unwrap();
    }
    let mut worker = fixture(Duration::from_secs(3));
    let control = worker.control();
    let pid = worker.dispatch_wire("pid").unwrap();
    drop(worker);
    assert!(control.is_terminated());
    assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
}
#[test]
fn cleared_secrets_and_hard_address_space_limit() {
    std::env::set_var("PIVOT_TEST_PARENT_SECRET", "must-not-leak");
    let mut worker = fixture(Duration::from_secs(3));
    assert_eq!(worker.dispatch_wire("environment").unwrap(), "[]");
    assert_eq!(
        worker.dispatch_wire("limit").unwrap(),
        "134217728:134217728:ENOMEM"
    );
    let raw =
        "  {\"structural\":-0, \"fraction\":-0.0,\"tagged\":{\"tag\":\"f64\",\"value\":\"-0\"}}  ";
    assert_eq!(worker.dispatch_wire(raw).unwrap(), raw);
    let control = worker.control();
    assert!(worker.dispatch_wire("oom").is_err());
    assert!(control.is_terminated());
    let mut other = fixture(Duration::from_secs(3));
    assert_eq!(other.dispatch_wire("ok").unwrap(), "ok");
}
#[test]
fn oversized_request_does_not_corrupt_session() {
    let mut worker = fixture(Duration::from_secs(3));
    assert_eq!(
        worker.dispatch_wire(&"a".repeat(1025)).unwrap_err(),
        WorkerError::FrameTooLarge
    );
    assert_eq!(worker.dispatch_wire("usable").unwrap(), "usable");
}
#[test]
fn spawn_owner_thread_can_retire_without_killing_session() {
    let mut worker = std::thread::spawn(|| fixture(Duration::from_secs(3)))
        .join()
        .unwrap();
    std::thread::sleep(Duration::from_millis(30));
    assert_eq!(worker.dispatch_wire("still alive").unwrap(), "still alive");
}
#[test]
fn startup_is_bounded_and_invalid_ack_is_rejected() {
    for locale in ["startup-block", "startup-unknown", "startup-extra"] {
        let config = WorkerConfig::new(
            PathBuf::from(env!("CARGO_BIN_EXE_worker-fixture")),
            128 * 1024 * 1024,
            1024,
            Duration::from_millis(200),
        )
        .unwrap();
        let now = Instant::now();
        assert!(WorkerSession::spawn(config, locale, ResourceLimits::default()).is_err());
        assert!(now.elapsed() < Duration::from_secs(2));
    }
}
#[test]
fn deadline_includes_a_full_pipe_write() {
    let config = WorkerConfig::new(
        PathBuf::from(env!("CARGO_BIN_EXE_worker-fixture")),
        128 * 1024 * 1024,
        256 * 1024,
        Duration::from_millis(200),
    )
    .unwrap();
    let mut worker = WorkerSession::spawn(config, "en-US", ResourceLimits::default()).unwrap();
    assert_eq!(worker.dispatch_wire("stop-reading").unwrap(), "ok");
    let control = worker.control();
    assert_eq!(
        worker.dispatch_wire(&"a".repeat(256 * 1024)).unwrap_err(),
        WorkerError::Deadline
    );
    assert!(control.is_terminated());
}
#[test]
fn inherited_non_cloexec_descriptor_is_closed() {
    use std::os::fd::AsRawFd;
    let file = std::fs::File::open("/etc/hostname").unwrap();
    let fd = file.as_raw_fd();
    assert_eq!(unsafe { libc::fcntl(fd, libc::F_SETFD, 0) }, 0);
    let mut worker = fixture(Duration::from_secs(3));
    assert_eq!(worker.dispatch_wire(&format!("fd:{fd}")).unwrap(), "closed");
}
