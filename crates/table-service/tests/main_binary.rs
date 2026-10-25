// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![cfg(target_os = "linux")]
use serde_json::json;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    os::unix::fs::PermissionsExt,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
struct Running(Child);
impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[test]
fn configured_binary_serves_authenticated_routes_and_stops_on_sigterm() {
    let dir = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let path = dir.path().join("service.json");
    let config = json!({"listen":address.to_string(),"catalog_path":dir.path().join("sources"),"catalog":{"limits":{"max_parse_bytes":8388608,"max_upload_bytes":1048576}},"auth":{"desktop_tokens":{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":"alice"}},"ingestion":{"node":std::env::var("TABLE_INGEST_NODE").unwrap(),"entry":format!("{}/../../server/table-ingest/dist/child.mjs",env!("CARGO_MANIFEST_DIR")),"backend_config":null,"max_concurrent_children":1,"max_child_heap_mb":128},"worker":{"executable":"/target/debug/pivot-native-worker","memory_budget_bytes":536870912u64,"max_frame_bytes":8392704,"max_starting_workers":1},"runtime":{"compute_workers":2,"max_admitted_jobs":4,"max_http_requests":4}});
    std::fs::write(&path, config.to_string()).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let mut child = Running(
        Command::new(env!("CARGO_BIN_EXE_table-service"))
            .env("TABLE_SERVICE_CONFIG", &path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap(),
    );
    let start = Instant::now();
    loop {
        if TcpStream::connect(address).is_ok() {
            break;
        }
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "service startup failed"
        );
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
    let call = |path: &str, auth: bool| {
        let mut s = TcpStream::connect(address).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        write!(
            s,
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{}\r\n",
            if auth {
                "Authorization: Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\n"
            } else {
                ""
            }
        )
        .unwrap();
        let mut response = String::new();
        s.read_to_string(&mut response).unwrap();
        response
    };
    assert!(call("/healthz", false).starts_with("HTTP/1.1 401"));
    let response = call("/capabilities", true);
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains("safeExactCountAdmission"));
    assert!(!response.contains("aaaaaaaa"));
    // SAFETY: this PID belongs to the live child owned by Running; no unrelated process is targeted.
    unsafe {
        assert_eq!(libc::kill(child.0.id() as i32, libc::SIGTERM), 0);
    }
    let start = Instant::now();
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
}
