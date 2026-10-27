// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The one "is this a plain JSON object" predicate. Arrays are excluded: every
 * shape this app narrows to is an object with named fields, and an array that
 * passed here would be indexed by name and read as empty.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
