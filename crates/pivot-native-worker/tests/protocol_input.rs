#![cfg(target_os = "linux")]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use std::{
    io::{Read, Write},
    os::{fd::AsRawFd, unix::process::CommandExt},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

const INIT: &[u8] =
    br#"{"version":1,"locale":"en-US","batchRows":500,"limits":[null,null,null,null,null,null,null,null,null]}"#;
const DEADLINE: Duration = Duration::from_secs(2);

struct Worker {
    child: Child,
    stdout: Vec<u8>,
    status: Option<ExitStatus>,
}
impl Worker {
    fn new() -> Self {
        let mut c = Command::new(env!("CARGO_BIN_EXE_pivot-native-worker"));
        c.args(["134217728", "1024"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_clear();
        unsafe {
            c.pre_exec(|| {
                let r = libc::rlimit {
                    rlim_cur: 134217728,
                    rlim_max: 134217728,
                };
                if libc::setrlimit(libc::RLIMIT_AS, &r) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let worker = Self {
            child: c.spawn().unwrap(),
            stdout: Vec::new(),
            status: None,
        };
        let fd = worker.child.stdout.as_ref().unwrap().as_raw_fd();
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        assert!(flags >= 0);
        assert_eq!(
            unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) },
            0
        );
        worker
    }
    fn send(&mut self, bytes: &[u8]) {
        // Retain stdin: complete invalid frames must cause rejection themselves.
        self.child.stdin.as_mut().unwrap().write_all(bytes).unwrap();
    }
    fn read_available(&mut self) {
        let mut buffer = [0; 1024];
        loop {
            match self.child.stdout.as_mut().unwrap().read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    self.stdout.extend_from_slice(&buffer[..n]);
                    assert!(self.stdout.len() <= 4096, "unexpected excess worker output");
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => panic!("read worker output: {e}"),
            }
        }
    }
    fn observe(&mut self, duration: Duration) {
        let until = Instant::now() + duration;
        loop {
            self.read_available();
            self.status = self.child.try_wait().unwrap();
            if self.status.is_some() {
                self.read_available();
                return;
            }
            if Instant::now() >= until {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn rejected(&self, expected_prior_output: &[u8]) -> bool {
        self.status.is_some_and(|status| !status.success()) && self.stdout == expected_prior_output
    }
    fn assert_rejected(&self, expected_prior_output: &[u8]) {
        assert!(self.rejected(expected_prior_output),
            "worker did not reject without accepting input: status={:?}, stdout={:?}, expected prior stdout={:?}",
            self.status, self.stdout, expected_prior_output);
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn frame(seq: u64, kind: u8, body: &[u8]) -> Vec<u8> {
    let mut f = ((9 + body.len()) as u32).to_be_bytes().to_vec();
    f.extend(seq.to_be_bytes());
    f.push(kind);
    f.extend(body);
    f
}
fn rejects(bytes: &[u8], expected_prior_output: &[u8]) {
    let mut worker = Worker::new();
    worker.send(bytes);
    worker.observe(DEADLINE);
    worker.assert_rejected(expected_prior_output);
}
#[test]
fn rejection_helper_does_not_classify_valid_init_as_rejected() {
    let mut worker = Worker::new();
    worker.send(&frame(0, 0, INIT));
    worker.observe(DEADLINE);
    let ready = frame(0, 0, b"ready/1");
    assert_eq!(worker.stdout, ready);
    assert!(
        worker.status.is_none(),
        "valid init must wait for the next command"
    );
    assert!(!worker.rejected(&[]));
    assert!(!worker.rejected(&ready));

    // Reproduce the reviewer's EOF case: a nonzero exit does not undo acceptance.
    drop(worker.child.stdin.take());
    worker.observe(DEADLINE);
    assert!(worker.status.is_some_and(|status| !status.success()));
    assert!(
        !worker.rejected(&[]),
        "ready/1 proves the init was accepted before EOF"
    );
}
#[test]
fn real_worker_rejects_complete_invalid_initial_frames_without_eof() {
    for bytes in [
        vec![0, 0, 0, 8],
        vec![0, 0, 8, 0],
        frame(0, 9, INIT),
        frame(1, 0, INIT),
        frame(0, 0, b"{}"),
        frame(0, 0, br#"{"version":1,"locale":"en-US","batchRows":0,"limits":[null,null,null,null,null,null,null,null,null]}"#),
        frame(0, 0, br#"{"version":1,"locale":"en-US","batchRows":501,"limits":[null,null,null,null,null,null,null,null,null]}"#),
        frame(0, 0, br#"{"version":1,"locale":"en-US","limits":[null,null,null,null,null,null,null,null,null]}"#),
        frame(0, 0, br#"{"version":2,"locale":"en-US","batchRows":500,"limits":[null,null,null,null,null,null,null,null,null]}"#),
        frame(0, 0, br#"{"version":1,"locale":"en-US","batchRows":500,"limits":[null,null,null,null,null,null,null,null,null],"extra":true}"#),
    ] {
        rejects(&bytes, &[]);
    }
}
#[test]
fn real_worker_rejects_complete_invalid_commands_without_eof() {
    for tail in [
        frame(1, 99, b""),
        frame(1, 2, b"extra"),
        frame(0, 2, b""),
        frame(1, 0, INIT),
    ] {
        let mut bytes = frame(0, 0, INIT);
        bytes.extend(tail);
        // Initialization may be acknowledged; the invalid command may not be.
        rejects(&bytes, &frame(0, 0, b"ready/1"));
    }
}
#[test]
fn real_worker_waits_for_truncated_frames_then_rejects_eof() {
    for (bytes, expected_prior_output) in [
        (vec![], vec![]),
        (vec![0, 0], vec![]),
        (vec![0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0], vec![]),
        (
            {
                let mut bytes = frame(0, 0, INIT);
                bytes.extend([0, 0, 0, 9, 0]);
                bytes
            },
            frame(0, 0, b"ready/1"),
        ),
    ] {
        let mut worker = Worker::new();
        worker.send(&bytes);
        worker.observe(Duration::from_millis(100));
        assert!(
            worker.status.is_none(),
            "incomplete input must wait for more bytes"
        );
        assert!(!worker.rejected(&expected_prior_output));
        drop(worker.child.stdin.take());
        worker.observe(DEADLINE);
        worker.assert_rejected(&expected_prior_output);
    }
}
