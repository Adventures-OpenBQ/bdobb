// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Portable Pivot contracts and legacy execution. No browser, UI, acquisition, or thread dependency.
pub mod contract;
pub mod validation;
pub const PROTOCOL_VERSION: u32 = 1;
pub mod ordering;
pub mod pivot;
pub mod profile;

pub mod categories;
pub mod fiscal;
pub mod formulas;
pub mod scopes;

pub mod analytical;
pub mod authoring;
pub mod inspection;
pub mod provider_contract;
pub mod session;
pub mod statement;
pub mod witness;
