// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Post-fork helpers: syscalls and fixed stack buffers only, no allocation or locks.
use std::io;
pub(crate) fn cloexec_inherited_fds() -> io::Result<()> {
    if unsafe { libc::syscall(libc::SYS_close_range, 3u32, u32::MAX, 4u32) } == 0 {
        return Ok(());
    }
    match io::Error::last_os_error().raw_os_error() {
        Some(libc::ENOSYS | libc::EINVAL) => cloexec_via_proc(),
        _ => Err(io::Error::last_os_error()),
    }
}
fn cloexec_via_proc() -> io::Result<()> {
    // Linux procfs lists the exact inherited table, including descriptors above a
    // subsequently lowered RLIMIT_NOFILE. Raw getdents64 avoids opendir allocation.
    let directory = unsafe {
        libc::open(
            c"/proc/self/fd".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    };
    if directory < 0 {
        return Err(io::Error::last_os_error());
    }
    let result = (|| {
        let mut buffer = [0u8; 4096];
        loop {
            let count = unsafe {
                libc::syscall(
                    libc::SYS_getdents64,
                    directory,
                    buffer.as_mut_ptr(),
                    buffer.len(),
                )
            };
            if count < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            if count == 0 {
                return Ok(());
            }
            let mut offset = 0usize;
            while offset < count as usize {
                if count as usize - offset < 20 {
                    return Err(io::Error::from_raw_os_error(libc::EIO));
                }
                let length =
                    u16::from_ne_bytes([buffer[offset + 16], buffer[offset + 17]]) as usize;
                if length < 20 || length > count as usize - offset {
                    return Err(io::Error::from_raw_os_error(libc::EIO));
                }
                let mut number = 0i32;
                let mut valid = false;
                for &byte in &buffer[offset + 19..offset + length] {
                    if byte == 0 {
                        break;
                    }
                    if !byte.is_ascii_digit() {
                        valid = false;
                        break;
                    }
                    number = number
                        .checked_mul(10)
                        .and_then(|n| n.checked_add((byte - b'0') as i32))
                        .ok_or_else(|| io::Error::from_raw_os_error(libc::EIO))?;
                    valid = true;
                }
                if valid && number > 2 {
                    let flags = unsafe { libc::fcntl(number, libc::F_GETFD) };
                    if flags < 0
                        || unsafe { libc::fcntl(number, libc::F_SETFD, flags | libc::FD_CLOEXEC) }
                            < 0
                    {
                        return Err(io::Error::last_os_error());
                    }
                }
                offset += length;
            }
        }
    })();
    unsafe {
        libc::close(directory);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        os::{
            fd::{AsRawFd, FromRawFd, OwnedFd},
            unix::process::CommandExt,
        },
        process::Command,
    };
    #[test]
    fn old_kernel_descriptor_fallback_closes_inherited_high_fd() {
        let source = std::fs::File::open("/etc/hostname").unwrap();
        let raw = unsafe { libc::fcntl(source.as_raw_fd(), libc::F_DUPFD, 200) };
        assert!(raw >= 200);
        let fd = unsafe { OwnedFd::from_raw_fd(raw) };
        let mut command = Command::new("/usr/bin/test");
        command.args(["!", "-e", &format!("/proc/self/fd/{}", fd.as_raw_fd())]);
        unsafe {
            command.pre_exec(cloexec_via_proc);
        }
        assert!(command.status().unwrap().success());
    }
}
