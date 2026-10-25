// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Private operator configuration, never included in responses or diagnostic logs.
use crate::{
    http::HttpState,
    sessions::{RuntimeConfig, SessionManager},
    *,
};
use pivot_native_worker::WorkerConfig;
use serde::Deserialize;
use std::{
    io::Read,
    net::SocketAddr,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerConfig {
    pub listen: SocketAddr,
    pub catalog_path: PathBuf,
    pub catalog: CatalogConfig,
    pub auth: AuthConfig,
    pub ingestion: IngestConfig,
    pub worker: WorkerSettings,
    #[serde(default)]
    pub runtime: RuntimeConfig,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerSettings {
    pub executable: PathBuf,
    pub memory_budget_bytes: u64,
    pub max_frame_bytes: usize,
    pub max_starting_workers: usize,
}
impl ServerConfig {
    pub fn load(path: &Path) -> Result<Self, ServiceError> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| config_error())?;
        let meta = file.metadata().map_err(|_| config_error())?;
        if !meta.is_file() || meta.len() > 1024 * 1024 {
            return Err(config_error());
        }
        let mut bytes = Vec::new();
        file.take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| config_error())?;
        if bytes.len() > 1024 * 1024 {
            return Err(config_error());
        }
        serde_json::from_slice(&bytes).map_err(|_| config_error())
    }
    pub fn build(self) -> Result<(SocketAddr, HttpState), ServiceError> {
        if !cfg!(target_os = "linux") {
            return Err(ServiceError::new(
                ErrorCode::InvalidConfig,
                "contained table execution requires Linux",
            ));
        }
        let limits = self.catalog.limits.clone();
        let auth = Arc::new(Authenticator::new(self.auth)?);
        let catalog = Arc::new(SourceCatalog::open(
            &self.catalog_path,
            self.catalog.clone(),
        )?);
        let ingest = Ingestor::new(self.ingestion, limits.clone())?;
        let worker = WorkerConfig::new(
            self.worker.executable,
            self.worker.memory_budget_bytes,
            self.worker.max_frame_bytes,
            Duration::from_secs(limits.max_job_seconds),
        )
        .and_then(|c| c.with_max_starting_workers(self.worker.max_starting_workers))
        .and_then(|c| c.with_batch_rows(limits.max_row_block_rows.min(500) as u32))
        .map_err(|_| config_error())?;
        let manager = Arc::new(SessionManager::new(
            catalog,
            ingest,
            limits,
            self.runtime,
            worker,
        )?);
        Ok((self.listen, HttpState::new(auth, manager, self.catalog)))
    }
}
fn config_error() -> ServiceError {
    ServiceError::new(
        ErrorCode::InvalidConfig,
        "invalid private service configuration",
    )
}
