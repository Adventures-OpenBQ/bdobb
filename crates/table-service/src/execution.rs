// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Atomic request completion and independent process cancellation.
use crate::sessions::{conflict, limit};
use crate::ServiceError;
use pivot_native_worker::{WorkerControl, WorkerError};
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Mutex,
};
#[derive(Default)]
pub struct Execution {
    state: AtomicU8,
    control: Mutex<Option<WorkerControl>>,
}
impl Execution {
    pub fn check(&self) -> Result<(), ServiceError> {
        if self.state.load(Ordering::Acquire) == 1 {
            Err(conflict())
        } else {
            Ok(())
        }
    }
    /// Linearizes cancellation against publication. A completed result is never rolled back.
    pub fn commit(&self) -> Result<(), ServiceError> {
        self.state
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| conflict())
    }
    pub fn attach(&self, control: WorkerControl) -> Result<(), ServiceError> {
        let mut c = self.control.lock().unwrap();
        self.check()?;
        *c = Some(control);
        Ok(())
    }
    pub fn detach(&self) {
        self.control.lock().unwrap().take();
    }
    pub(crate) fn invalidate(&self) -> Option<WorkerControl> {
        if self
            .state
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            self.control.lock().unwrap().take()
        } else {
            None
        }
    }
    pub fn cancel(&self) {
        if let Some(control) = self.invalidate() {
            let _ = control.kill();
        }
    }
}
pub(crate) fn worker_error(e: WorkerError) -> ServiceError {
    match e {
        WorkerError::StartupBusy => limit("native startup admission is full"),
        WorkerError::FrameTooLarge => limit("native frame budget exceeded"),
        WorkerError::Deadline => limit("native execution deadline exceeded"),
        WorkerError::UnsupportedPlatform => crate::ServiceError::new(
            crate::ErrorCode::InvalidConfig,
            "contained execution requires Linux",
        ),
        WorkerError::InvalidConfig => {
            crate::sessions::invalid("unsupported locale or worker configuration")
        }
        _ => crate::ServiceError::new(
            crate::ErrorCode::Gone,
            "native worker unavailable; recreate the session from its source",
        ),
    }
}
