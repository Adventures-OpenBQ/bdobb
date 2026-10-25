// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Linux-contained native execution. See README for admission and platform guarantees.
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
#[derive(Debug)]
struct StartupPool {
    max: usize,
    active: AtomicUsize,
}
#[derive(Clone, Debug)]
pub struct WorkerConfig {
    // Only the Linux spawn path reads it.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    executable: PathBuf,
    memory_budget_bytes: u64,
    max_frame_bytes: usize,
    command_deadline: Duration,
    batch_rows: u32,
    startup: Arc<StartupPool>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkerError {
    InvalidConfig,
    UnsupportedPlatform,
    Spawn,
    StartupBusy,
    Io,
    Protocol,
    FrameTooLarge,
    Deadline,
    Terminated,
}
impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "native worker: {self:?}")
    }
}
impl std::error::Error for WorkerError {}
impl WorkerConfig {
    /// Set the row cap for every presented-transfer batch (1 through 500).
    pub fn with_batch_rows(mut self, rows: u32) -> Result<Self, WorkerError> {
        if !(1..=500).contains(&rows) {
            return Err(WorkerError::InvalidConfig);
        }
        self.batch_rows = rows;
        Ok(self)
    }
    pub fn batch_rows(&self) -> u32 {
        self.batch_rows
    }
    pub fn new(
        executable: PathBuf,
        memory_budget_bytes: u64,
        max_frame_bytes: usize,
        command_deadline: Duration,
    ) -> Result<Self, WorkerError> {
        if !executable.is_absolute()
            || memory_budget_bytes == 0
            || memory_budget_bytes >= i64::MAX as u64
            || max_frame_bytes == 0
            || max_frame_bytes > (u32::MAX as usize - 9)
            || command_deadline.is_zero()
            || command_deadline > Duration::from_secs(86400)
        {
            return Err(WorkerError::InvalidConfig);
        }
        Ok(Self {
            executable,
            memory_budget_bytes,
            max_frame_bytes,
            command_deadline,
            batch_rows: 500,
            startup: Arc::new(StartupPool {
                max: 1,
                active: AtomicUsize::new(0),
            }),
        })
    }
    /// Configure before cloning; all clones share this startup bound.
    pub fn with_max_starting_workers(mut self, max: usize) -> Result<Self, WorkerError> {
        if !(1..=1024).contains(&max)
            || self.memory_budget_bytes.checked_mul(max as u64).is_none()
            || Arc::strong_count(&self.startup) != 1
            || self.active_startups() != 0
        {
            return Err(WorkerError::InvalidConfig);
        }
        self.startup = Arc::new(StartupPool {
            max,
            active: AtomicUsize::new(0),
        });
        Ok(self)
    }
    pub fn max_starting_workers(&self) -> usize {
        self.startup.max
    }
    pub fn active_startups(&self) -> usize {
        self.startup.active.load(Ordering::Acquire)
    }
    /// Reserve once per shared configuration, in addition to admitted live workers.
    pub fn reserved_startup_memory_bytes(&self) -> u64 {
        self.memory_budget_bytes * self.startup.max as u64
    }
    /// Whole child virtual address-space reservation, including loader, ICU and heap.
    pub fn reserved_memory_bytes(&self) -> u64 {
        self.memory_budget_bytes
    }
    pub fn max_frame_bytes(&self) -> usize {
        self.max_frame_bytes
    }
    pub fn command_deadline(&self) -> Duration {
        self.command_deadline
    }
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
mod protocol;

mod driver;
pub use driver::{nonblocking, WorkerControl, WorkerSession};
pub use pivot_core::session::{ResourceLimits, ResourceUsage};

#[cfg(target_os = "linux")]
mod os;
mod worker;
#[doc(hidden)]
pub use worker::run_worker;

#[cfg(target_os = "linux")]
mod startup;
