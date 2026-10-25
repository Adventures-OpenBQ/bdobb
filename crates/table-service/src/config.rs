// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{ErrorCode, ServiceError};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Provisional admission defaults; deployment qualification must measure actual workloads.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ServiceLimits {
    pub max_upload_bytes: u64,
    pub max_metadata_bytes: usize,
    pub max_sources_per_principal: usize,
    /// Active records plus retained deleted-key tombstones. Deletion never grows this count.
    pub max_idempotency_records_per_principal: usize,
    /// Deleted-key retry guarantee; expired tombstones may be pruned during any operation.
    pub idempotency_retention_seconds: u64,
    pub max_parse_bytes: u64,
    pub max_input_rows: usize,
    pub max_input_columns: usize,
    pub max_output_columns: usize,
    pub max_row_block_rows: usize,
    pub max_export_batch_bytes: usize,
    pub max_sessions_per_principal: usize,
    pub max_concurrent_jobs_per_principal: usize,
    pub max_session_seconds: u64,
    pub max_job_seconds: u64,
    pub max_cache_bytes: u64,
}
impl Default for ServiceLimits {
    fn default() -> Self {
        Self {
            max_upload_bytes: 64 * 1024 * 1024,
            max_metadata_bytes: 16 * 1024,
            max_sources_per_principal: 1024,
            max_idempotency_records_per_principal: 2048,
            idempotency_retention_seconds: 24 * 60 * 60,
            max_parse_bytes: 256 * 1024 * 1024,
            max_input_rows: 1_000_000,
            max_input_columns: 4096,
            max_output_columns: 4096,
            max_row_block_rows: 1000,
            max_export_batch_bytes: 1024 * 1024,
            max_sessions_per_principal: 8,
            max_concurrent_jobs_per_principal: 2,
            max_session_seconds: 1800,
            max_job_seconds: 60,
            max_cache_bytes: 256 * 1024 * 1024,
        }
    }
}
impl ServiceLimits {
    pub fn validate(&self) -> Result<(), ServiceError> {
        let all = [
            self.max_upload_bytes,
            self.max_metadata_bytes as u64,
            self.max_sources_per_principal as u64,
            self.max_idempotency_records_per_principal as u64,
            self.idempotency_retention_seconds,
            self.max_parse_bytes,
            self.max_input_rows as u64,
            self.max_input_columns as u64,
            self.max_output_columns as u64,
            self.max_row_block_rows as u64,
            self.max_export_batch_bytes as u64,
            self.max_sessions_per_principal as u64,
            self.max_concurrent_jobs_per_principal as u64,
            self.max_session_seconds,
            self.max_job_seconds,
            self.max_cache_bytes,
        ];
        if all.contains(&0)
            || all.iter().any(|n| *n > isize::MAX as u64 - 4096)
            || self.max_metadata_bytes > 1024 * 1024
            || self.max_idempotency_records_per_principal < self.max_sources_per_principal
            || self
                .idempotency_retention_seconds
                .checked_mul(1000)
                .is_none()
        {
            return Err(ServiceError::new(
                ErrorCode::InvalidConfig,
                "limits must be positive and representable; metadata is capped at 1 MiB and record capacity must cover active sources",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CatalogConfig {
    pub limits: ServiceLimits,
    /// backend ID -> widget ID -> admitted parameter names. Empty means no backends.
    /// URLs and credentials belong to trusted acquisition configuration, never this binding.
    pub backend_widgets: BTreeMap<String, BTreeMap<String, BTreeSet<String>>>,
}
impl CatalogConfig {
    pub fn validate(&self) -> Result<(), ServiceError> {
        self.limits.validate()?;
        for (backend, widgets) in &self.backend_widgets {
            if !identifier(backend) || widgets.is_empty() {
                return Err(invalid_config());
            }
            for (widget, params) in widgets {
                if !identifier(widget)
                    || params
                        .iter()
                        .any(|p| !identifier(p) || forbidden_parameter(p))
                {
                    return Err(invalid_config());
                }
            }
        }
        Ok(())
    }
}
fn invalid_config() -> ServiceError {
    ServiceError::new(
        ErrorCode::InvalidConfig,
        "invalid backend/widget parameter allowlist",
    )
}
pub(crate) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
        && value != "."
        && value != ".."
}
pub(crate) fn forbidden_parameter(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    [
        "url",
        "uri",
        "endpoint",
        "header",
        "authorization",
        "credential",
        "password",
        "token",
        "secret",
        "api_key",
        "apikey",
    ]
    .iter()
    .any(|key| value.contains(key))
}
