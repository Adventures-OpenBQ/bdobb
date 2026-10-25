// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Private durable sources and authenticated ownership for the managed table service.
//! HTTP adapters must authenticate every request before calling this library.

pub mod auth;
pub mod config;
pub mod errors;
pub mod execution;
pub mod exports;
pub mod http;
pub mod ingest;
pub mod server_config;
pub mod sessions;
pub mod sources;

pub use auth::{AuthConfig, Authenticator, Principal, RequestCredentials};
pub use config::{CatalogConfig, ServiceLimits};
pub use ingest::{IngestConfig, Ingestor};
pub use sources::{
    BackendBinding, CatalogClock, SourceCatalog, SourceLease, SourceRef, StoredSource,
    UploadMetadata,
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Unauthorized,
    NotFound,
    Gone,
    InvalidInput,
    InvalidConfig,
    Conflict,
    LimitExceeded,
    Io,
    CorruptStorage,
}

/// Safe for clients: messages never include filesystem paths, credentials or foreign metadata.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ServiceError {
    pub code: ErrorCode,
    pub message: String,
}

impl ServiceError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl std::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for ServiceError {}
impl From<std::io::Error> for ServiceError {
    fn from(_: std::io::Error) -> Self {
        Self::new(ErrorCode::Io, "source storage operation failed")
    }
}

pub(crate) fn digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex(&Sha256::digest(bytes))
}
pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
