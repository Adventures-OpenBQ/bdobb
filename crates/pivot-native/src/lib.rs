// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(clippy::result_large_err)]
//! Native ICU ordering and session ownership for the portable analytical core.
pub mod ordering;
mod timsort;
pub use ordering::NativeOrder;
use pivot_core::{
    contract::Diagnostic,
    session::{CoreRequest, CoreResponse, ResourceLimits, ResourceUsage, Session},
};
pub struct NativeSession {
    core: Session,
    order: NativeOrder,
}
impl NativeSession {
    pub fn new(locale: &str, limits: ResourceLimits) -> Result<Self, Diagnostic> {
        let order = NativeOrder::new(locale)?;
        Ok(Self {
            core: Session::new(locale.to_owned(), limits),
            order,
        })
    }
    pub fn dispatch(&mut self, request: CoreRequest) -> CoreResponse {
        self.core.dispatch(request, &self.order)
    }
    pub fn set_batch_rows(&mut self, rows: u32) -> Result<(), Diagnostic> {
        self.core.set_batch_rows(rows)
    }
    pub fn resource_usage(&self) -> ResourceUsage {
        self.core.resource_usage()
    }
}
