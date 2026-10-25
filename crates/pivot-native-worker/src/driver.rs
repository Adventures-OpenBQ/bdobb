// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{protocol::*, WorkerConfig, WorkerError};
use pivot_core::session::{ResourceLimits, ResourceUsage};
use std::{
    io::{self, Read, Write},
    os::fd::AsRawFd,
    process::{Child, ChildStdin, ChildStdout},
    sync::{mpsc, Arc, Mutex},
    time::Instant,
};

/// Independent terminal cancellation. A killed session cannot be reused.
#[derive(Clone)]
pub struct WorkerControl {
    child: Arc<Process>,
}
struct Process {
    child: Mutex<Option<Child>>,
    supervisor_stop: mpsc::Sender<()>,
}
impl Drop for Process {
    fn drop(&mut self) {
        if let Some(child) = self
            .child
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = self.supervisor_stop.send(());
    }
}
impl WorkerControl {
    /// Kill and reap under the same ownership lock. Never sends a signal to a bare PID.
    pub fn kill(&self) -> Result<(), WorkerError> {
        let mut guard = self.child.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(child) = guard.as_mut() {
            // Child::kill does not signal after this Child was reaped. Keeping the
            // child in the slot until wait succeeds also makes cleanup retryable.
            let _ = child.kill();
            child.wait().map_err(|_| WorkerError::Io)?;
            *guard = None;
            let _ = self.child.supervisor_stop.send(());
        }
        Ok(())
    }
    pub fn is_terminated(&self) -> bool {
        self.child
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_none()
    }
    fn check(&self) -> Result<(), WorkerError> {
        let mut guard = self.child.child.lock().unwrap_or_else(|e| e.into_inner());
        let Some(child) = guard.as_mut() else {
            return Err(WorkerError::Terminated);
        };
        if child.try_wait().map_err(|_| WorkerError::Io)?.is_some() {
            *guard = None;
            let _ = self.child.supervisor_stop.send(());
            return Err(WorkerError::Terminated);
        }
        Ok(())
    }
}
pub struct WorkerSession {
    config: WorkerConfig,
    control: WorkerControl,
    input: ChildStdin,
    output: ChildStdout,
    seq: u64,
}
impl WorkerSession {
    pub fn spawn(
        config: WorkerConfig,
        locale: &str,
        limits: ResourceLimits,
    ) -> Result<Self, WorkerError> {
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (config, locale, limits);
            Err(WorkerError::UnsupportedPlatform)
        }
        #[cfg(target_os = "linux")]
        {
            use std::{
                os::unix::process::CommandExt,
                process::{Command, Stdio},
            };
            if locale.len() > config.max_frame_bytes {
                return Err(WorkerError::FrameTooLarge);
            }
            let init = serde_json::to_vec(&Init::new(locale, limits, config.batch_rows))
                .map_err(|_| WorkerError::Protocol)?;
            if init.len() > config.max_frame_bytes {
                return Err(WorkerError::FrameTooLarge);
            }
            let deadline = Instant::now() + config.command_deadline;
            let mut command = Command::new(&config.executable);
            command
                .args([
                    config.memory_budget_bytes.to_string(),
                    config.max_frame_bytes.to_string(),
                ])
                .env_clear()
                .current_dir("/")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            let memory = config.memory_budget_bytes;
            let parent = unsafe { libc::getpid() };
            // Only async-signal-safe syscalls in the post-fork child.
            unsafe {
                command.pre_exec(move || {
                    let limit = libc::rlimit {
                        rlim_cur: memory,
                        rlim_max: memory,
                    };
                    let zero = libc::rlimit {
                        rlim_cur: 0,
                        rlim_max: 0,
                    };
                    if libc::setrlimit(libc::RLIMIT_AS, &limit) != 0
                        || libc::setrlimit(libc::RLIMIT_CORE, &zero) != 0
                        || libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0
                        || libc::prctl(
                            libc::PR_SET_NO_NEW_PRIVS,
                            1 as libc::c_ulong,
                            0 as libc::c_ulong,
                            0 as libc::c_ulong,
                            0 as libc::c_ulong,
                        ) != 0
                    {
                        return Err(io::Error::last_os_error());
                    }
                    if libc::getppid() != parent {
                        return Err(io::Error::from_raw_os_error(libc::ECHILD));
                    }
                    crate::os::cloexec_inherited_fds()
                });
            }
            let (child, stop_tx) = crate::startup::spawn(&config, command, deadline)?;
            let control = WorkerControl {
                child: Arc::new(Process {
                    child: Mutex::new(Some(child)),
                    supervisor_stop: stop_tx,
                }),
            };
            // From this point every failure has a cleanup owner.
            let mut child = control
                .child
                .child
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let input = child.as_mut().unwrap().stdin.take().unwrap();
            let output = child.as_mut().unwrap().stdout.take().unwrap();
            drop(child);
            let mut session = Self {
                config,
                control,
                input,
                output,
                seq: 0,
            };
            nonblocking(session.input.as_raw_fd())?;
            nonblocking(session.output.as_raw_fd())?;
            let ack = session.rpc_until(INIT, &init, deadline)?;
            if ack != b"ready/1" {
                return Err(WorkerError::Protocol);
            }
            Ok(session)
        }
    }
    pub fn control(&self) -> WorkerControl {
        self.control.clone()
    }
    pub fn kill(&self) -> Result<(), WorkerError> {
        self.control.kill()
    }
    pub fn dispatch_wire(&mut self, wire: &str) -> Result<String, WorkerError> {
        let bytes = self.rpc_until(
            WIRE,
            wire.as_bytes(),
            Instant::now() + self.config.command_deadline,
        )?;
        String::from_utf8(bytes).map_err(|_| {
            let _ = self.kill();
            WorkerError::Protocol
        })
    }
    pub fn resource_usage(&mut self) -> Result<ResourceUsage, WorkerError> {
        let bytes = self.rpc_until(USAGE, &[], Instant::now() + self.config.command_deadline)?;
        serde_json::from_slice::<ResourceUsage>(&bytes).map_err(|_| {
            let _ = self.kill();
            WorkerError::Protocol
        })
    }
    fn rpc_until(
        &mut self,
        kind: u8,
        payload: &[u8],
        deadline: Instant,
    ) -> Result<Vec<u8>, WorkerError> {
        // Oversized caller input has not touched the channel and is recoverable.
        let head = header(self.seq, kind, payload.len(), self.config.max_frame_bytes)?;
        let result = (|| {
            self.control.check()?;
            transfer(&self.control, &mut self.input, &head, deadline)?;
            transfer(&self.control, &mut self.input, payload, deadline)?;
            let mut reader = DeadlineRead {
                inner: &mut self.output,
                control: &self.control,
                deadline,
                error: None,
            };
            let frame = read_frame(&mut reader, self.config.max_frame_bytes);
            if let Some(error) = reader.error {
                return Err(error);
            }
            let (seq, response_kind, body) = frame?;
            if seq != self.seq || response_kind != kind {
                return Err(WorkerError::Protocol);
            }
            // Unsolicited bytes already queued violate the one-response protocol.
            let mut extra = [0];
            match self.output.read(&mut extra) {
                Ok(0) => return Err(WorkerError::Terminated),
                Ok(_) => return Err(WorkerError::Protocol),
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(WorkerError::Io),
            }
            self.seq = self.seq.checked_add(1).ok_or(WorkerError::Protocol)?;
            Ok(body)
        })();
        if result.is_err() {
            let _ = self.kill();
        }
        result
    }
}
impl Drop for WorkerSession {
    fn drop(&mut self) {
        let _ = self.control.kill();
    }
}
/// Shared with table-service's ingest pipes.
#[doc(hidden)]
pub fn nonblocking(fd: i32) -> Result<(), WorkerError> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        Err(WorkerError::Io)
    } else {
        Ok(())
    }
}
fn ready(
    control: &WorkerControl,
    fd: i32,
    event: i16,
    deadline: Instant,
) -> Result<(), WorkerError> {
    control.check()?;
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or(WorkerError::Deadline)?;
    let mut p = libc::pollfd {
        fd,
        events: event,
        revents: 0,
    };
    let millis = remaining.as_millis().clamp(1, 20) as i32;
    let result = unsafe { libc::poll(&mut p, 1, millis) };
    if result < 0 && io::Error::last_os_error().kind() != io::ErrorKind::Interrupted {
        return Err(WorkerError::Io);
    }
    Ok(())
}
fn transfer(
    control: &WorkerControl,
    out: &mut ChildStdin,
    mut bytes: &[u8],
    deadline: Instant,
) -> Result<(), WorkerError> {
    while !bytes.is_empty() {
        ready(control, out.as_raw_fd(), libc::POLLOUT, deadline)?;
        match out.write(bytes) {
            Ok(0) => return Err(WorkerError::Io),
            Ok(n) => bytes = &bytes[n..],
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) => {}
            Err(_) => return Err(WorkerError::Io),
        }
    }
    Ok(())
}
struct DeadlineRead<'a> {
    inner: &'a mut ChildStdout,
    control: &'a WorkerControl,
    deadline: Instant,
    error: Option<WorkerError>,
}
impl Read for DeadlineRead<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            if let Err(error) = ready(
                self.control,
                self.inner.as_raw_fd(),
                libc::POLLIN,
                self.deadline,
            ) {
                self.error = Some(error);
                return Err(io::Error::other("worker stopped"));
            }
            match self.inner.read(buf) {
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                    ) => {}
                other => return other,
            }
        }
    }
}
