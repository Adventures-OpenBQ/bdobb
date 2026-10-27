// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * A stored param value as an instant, when it is a literal date and not an
 * expression: the card's `start`/`end` as `S` and `E` read them.
 *
 * A bare `YYYY-MM-DD` is midnight LOCAL, not UTC -- `Date.parse` reads it as
 * UTC, and the resolver then projects it back in the viewer's zone, so
 * `start=2026-09-10` answered `S` with the 9th for everyone west of
 * Greenwich. Anything carrying a time (or an offset) is parsed as written.
 */
export function paramInstant(value: string | undefined): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isFinite(at) ? new Date(at) : undefined;
}

