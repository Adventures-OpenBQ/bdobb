// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one "is this a plain JSON object" predicate. Arrays are excluded: every
 * shape this app narrows to is an object with named fields, and an array that
 * passed here would be indexed by name and read as empty.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
