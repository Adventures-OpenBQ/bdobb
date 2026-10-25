// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
fn main() {
    if pivot_native_worker::run_worker().is_err() {
        std::process::exit(2);
    }
}
