// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Test-only adversarial peer. Never used by the service.
use std::io::{Read, Write};
fn read(input: &mut impl Read) -> (u64, u8, Vec<u8>) {
    let mut h = [0; 13];
    input.read_exact(&mut h).unwrap();
    let n = u32::from_be_bytes(h[..4].try_into().unwrap()) as usize;
    assert!((9..=1024 * 1024).contains(&n));
    let mut b = vec![0; n - 9];
    input.read_exact(&mut b).unwrap();
    (u64::from_be_bytes(h[4..12].try_into().unwrap()), h[12], b)
}
fn bytes(seq: u64, kind: u8, b: &[u8]) -> Vec<u8> {
    let mut frame = ((b.len() + 9) as u32).to_be_bytes().to_vec();
    frame.extend(seq.to_be_bytes());
    frame.push(kind);
    frame.extend(b);
    frame
}
fn reply(output: &mut impl Write, seq: u64, kind: u8, b: &[u8]) {
    output.write_all(&bytes(seq, kind, b)).unwrap();
    output.flush().unwrap();
}
fn block() -> ! {
    loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
    }
}
fn main() {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    let (seq, kind, b) = read(&mut input);
    let init: serde_json::Value = serde_json::from_slice(&b).unwrap();
    match init["locale"].as_str().unwrap() {
        "startup-block" => block(),
        "startup-unknown" => reply(&mut output, seq, kind, b"wrong"),
        "startup-extra" => {
            let mut b = bytes(seq, kind, b"ready/1");
            b.extend(bytes(seq, kind, b"ready/1"));
            output.write_all(&b).unwrap();
        }
        _ => reply(&mut output, seq, kind, b"ready/1"),
    }
    output.flush().unwrap();
    loop {
        let (seq, kind, b) = read(&mut input);
        match std::str::from_utf8(&b).unwrap() {
            "block" => block(),
            "stop-reading" => {
                reply(&mut output, seq, kind, b"ok");
                block();
            }
            "malformed" => output.write_all(&8u32.to_be_bytes()).unwrap(),
            "oversized" => output.write_all(&u32::MAX.to_be_bytes()).unwrap(),
            "truncated" => {
                output
                    .write_all(&[0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1])
                    .unwrap();
                output.flush().unwrap();
                return;
            }
            "utf8" => reply(&mut output, seq, kind, &[255]),
            "unknown" => reply(&mut output, seq, 99, b"x"),
            "sequence" => reply(&mut output, seq + 1, kind, b"x"),
            "extra" => {
                let mut b = bytes(seq, kind, b"ok");
                b.extend(bytes(seq, kind, b"extra"));
                output.write_all(&b).unwrap();
            }
            "exit" => return,
            "pid" => reply(
                &mut output,
                seq,
                kind,
                std::process::id().to_string().as_bytes(),
            ),
            "environment" => reply(
                &mut output,
                seq,
                kind,
                serde_json::to_string(&std::env::vars().collect::<Vec<_>>())
                    .unwrap()
                    .as_bytes(),
            ),
            "oom" => {
                let mut blocks = Vec::new();
                loop {
                    blocks.push(vec![1u8; 1024 * 1024]);
                    std::hint::black_box(&blocks);
                }
            }
            #[cfg(target_os = "linux")]
            "limit" => unsafe {
                let mut l: libc::rlimit = std::mem::zeroed();
                assert_eq!(libc::getrlimit(libc::RLIMIT_AS, &mut l), 0);
                let p = libc::mmap(
                    std::ptr::null_mut(),
                    l.rlim_max as usize + 1,
                    libc::PROT_READ | libc::PROT_WRITE,
                    libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
                    -1,
                    0,
                );
                assert_eq!(p, libc::MAP_FAILED);
                assert_eq!(
                    std::io::Error::last_os_error().raw_os_error(),
                    Some(libc::ENOMEM)
                );
                reply(
                    &mut output,
                    seq,
                    kind,
                    format!("{}:{}:ENOMEM", l.rlim_cur, l.rlim_max).as_bytes(),
                );
            },
            s if s.starts_with("fd:") => {
                let fd: i32 = s[3..].parse().unwrap();
                let closed = unsafe { libc::fcntl(fd, libc::F_GETFD) } == -1;
                reply(
                    &mut output,
                    seq,
                    kind,
                    if closed { b"closed" } else { b"open" },
                );
            }
            _ => reply(&mut output, seq, kind, &b),
        }
        output.flush().unwrap();
    }
}
