// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Cap cancellation noise at the original tolerance for the reported subtotal.
export function statementRoundingTolerance(reported: number, magnitude: number): number {
  return Math.min(
    Number.EPSILON * Math.max(Math.abs(reported), magnitude),
    1e-9 * Math.max(1, Math.abs(reported)),
  );
}
