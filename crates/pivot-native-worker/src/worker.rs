// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#[cfg(target_os = "linux")]
use crate::protocol::*;
use crate::WorkerError;
/// Private executable entry point. No in-process fallback is provided.
#[doc(hidden)]
pub fn run_worker() -> Result<(), WorkerError> {
    #[cfg(not(target_os = "linux"))]
    {
        Err(WorkerError::UnsupportedPlatform)
    }
    #[cfg(target_os = "linux")]
    {
        use pivot_native::NativeSession;
        let mut args = std::env::args_os().skip(1);
        let memory = args
            .next()
            .and_then(|s| s.to_str().and_then(|s| s.parse::<u64>().ok()))
            .ok_or(WorkerError::InvalidConfig)?;
        let max = args
            .next()
            .and_then(|s| s.to_str().and_then(|s| s.parse::<usize>().ok()))
            .ok_or(WorkerError::InvalidConfig)?;
        if args.next().is_some() {
            return Err(WorkerError::InvalidConfig);
        }
        crate::WorkerConfig::new(
            "/worker".into(),
            memory,
            max,
            std::time::Duration::from_secs(1),
        )?;
        let mut limit: libc::rlimit = unsafe { std::mem::zeroed() };
        if unsafe { libc::getrlimit(libc::RLIMIT_AS, &mut limit) } != 0
            || limit.rlim_cur != memory
            || limit.rlim_max != memory
        {
            return Err(WorkerError::InvalidConfig);
        }
        let mut input = std::io::stdin().lock();
        let mut output = std::io::stdout().lock();
        let (seq, kind, init) = read_frame(&mut input, max)?;
        if seq != 0 || kind != INIT {
            return Err(WorkerError::Protocol);
        }
        let init: Init = serde_json::from_slice(&init).map_err(|_| WorkerError::Protocol)?;
        if init.version != 1 {
            return Err(WorkerError::Protocol);
        }
        // State accounting is disabled only after the OS hard limit is verified.
        let mut session = NativeSession::new(&init.locale, init.core_limits())
            .map_err(|_| WorkerError::Protocol)?;
        session
            .set_batch_rows(init.batch_rows)
            .map_err(|_| WorkerError::Protocol)?;
        write_frame(&mut output, 0, INIT, b"ready/1", max)?;
        let mut sequence = 1u64;
        loop {
            let (seq, kind, body) = read_frame(&mut input, max)?;
            if seq != sequence {
                return Err(WorkerError::Protocol);
            }
            let response = match kind {
                WIRE => {
                    let text = std::str::from_utf8(&body).map_err(|_| WorkerError::Protocol)?;
                    let envelope: pivot_wire::Request =
                        serde_json::from_str(text).map_err(|_| WorkerError::Protocol)?;
                    if envelope.session_id != 1 {
                        return Err(WorkerError::Protocol);
                    }
                    let request = envelope
                        .into_core_request()
                        .map_err(|_| WorkerError::Protocol)?;
                    wire_reply(session.dispatch(request), max)?
                }
                USAGE if body.is_empty() => serde_json::to_vec(&session.resource_usage())
                    .map_err(|_| WorkerError::Protocol)?,
                _ => return Err(WorkerError::Protocol),
            };
            write_frame(&mut output, seq, kind, &response, max)?;
            sequence = sequence.checked_add(1).ok_or(WorkerError::Protocol)?;
        }
    }
}
