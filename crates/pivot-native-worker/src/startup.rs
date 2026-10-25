// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{StartupPool, WorkerConfig, WorkerError};
use std::sync::{atomic::Ordering, Arc};
struct Permit(Arc<StartupPool>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::AcqRel);
    }
}
use std::{
    process::{Child, Command},
    sync::mpsc,
    time::Instant,
};
pub(crate) fn spawn(
    config: &WorkerConfig,
    mut command: Command,
    deadline: Instant,
) -> Result<(Child, mpsc::Sender<()>), WorkerError> {
    config
        .startup
        .active
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
            if n < config.startup.max {
                Some(n + 1)
            } else {
                None
            }
        })
        .map_err(|_| WorkerError::StartupBusy)?;
    let permit = Permit(config.startup.clone());
    // PDEATHSIG follows the spawning Linux thread. Keep it alive through reap.
    let (result_tx, result_rx) = mpsc::sync_channel(0);
    let (stop_tx, stop_rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("pivot-worker-owner".into())
        .stack_size(128 * 1024)
        .spawn(move || {
            let result = command.spawn().map_err(|_| WorkerError::Spawn);
            match result_tx.send(result) {
                Ok(()) => {
                    drop(permit);
                    let _ = stop_rx.recv();
                }
                Err(mpsc::SendError(Ok(mut child))) => {
                    let _ = child.kill();
                    loop {
                        match child.wait() {
                            Ok(_) => break,
                            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                            // If exclusive ownership was violated by an outside reaper,
                            // fail closed: do not admit another unknown pending child.
                            Err(_) => {
                                std::mem::forget(permit);
                                return;
                            }
                        }
                    }
                    drop(permit);
                }
                Err(_) => {}
            }
        })
        .map_err(|_| WorkerError::Spawn)?;
    let child = result_rx
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|e| match e {
            mpsc::RecvTimeoutError::Timeout => WorkerError::Deadline,
            mpsc::RecvTimeoutError::Disconnected => WorkerError::Spawn,
        })??;
    Ok((child, stop_tx))
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        os::{
            fd::{AsRawFd, FromRawFd, OwnedFd},
            unix::process::CommandExt,
        },
        time::Duration,
    };
    struct Gate(std::fs::File);
    impl Drop for Gate {
        fn drop(&mut self) {
            let _ = self.0.write_all(&[1]);
        }
    }
    fn pipe() -> (std::fs::File, std::fs::File) {
        let mut f = [0; 2];
        assert_eq!(unsafe { libc::pipe2(f.as_mut_ptr(), libc::O_CLOEXEC) }, 0);
        unsafe {
            (
                std::fs::File::from(OwnedFd::from_raw_fd(f[0])),
                std::fs::File::from(OwnedFd::from_raw_fd(f[1])),
            )
        }
    }
    #[test]
    fn timed_out_startup_retains_shared_slot_until_child_reaped() {
        let (gate_read, gate_write) = pipe();
        let mut gate_write = Gate(gate_write);
        let (mut pid_read, pid_write) = pipe();
        let g = gate_read.as_raw_fd();
        let p = pid_write.as_raw_fd();
        let mut command = Command::new("/usr/bin/true");
        unsafe {
            command.pre_exec(move || {
                let pid = libc::getpid().to_ne_bytes();
                if libc::write(p, pid.as_ptr().cast(), pid.len()) != pid.len() as isize {
                    return Err(std::io::Error::last_os_error());
                }
                let mut byte = 0u8;
                if libc::read(g, (&mut byte as *mut u8).cast(), 1) != 1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let config = WorkerConfig::new(
            "/usr/bin/true".into(),
            128 * 1024 * 1024,
            1024,
            Duration::from_millis(100),
        )
        .unwrap();
        let result = spawn(&config, command, Instant::now() + config.command_deadline());
        assert!(matches!(result, Err(WorkerError::Deadline)));
        // Release the gate even when an assertion fails, so the regression test
        // itself cannot strand a fork blocked before exec.
        let mut descriptor = libc::pollfd {
            fd: pid_read.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        assert_eq!(unsafe { libc::poll(&mut descriptor, 1, 1000) }, 1);
        let mut pid = [0; 4];
        pid_read.read_exact(&mut pid).unwrap();
        let pid = i32::from_ne_bytes(pid);
        let active = config.active_startups();
        let busy = spawn(
            &config.clone(),
            Command::new("/usr/bin/true"),
            Instant::now() + Duration::from_millis(100),
        );
        gate_write.0.write_all(&[1]).unwrap();
        if let Ok((mut child, stop)) = busy {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stop.send(());
            panic!("startup admission allowed a second child");
        }
        assert!(matches!(busy, Err(WorkerError::StartupBusy)));
        assert_eq!(active, 1);
        let until = Instant::now() + Duration::from_secs(2);
        while config.active_startups() != 0 && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(config.active_startups(), 0);
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
        let (mut child, stop) = spawn(
            &config,
            Command::new("/usr/bin/true"),
            Instant::now() + Duration::from_secs(1),
        )
        .unwrap();
        child.wait().unwrap();
        let _ = stop.send(());
    }
}
