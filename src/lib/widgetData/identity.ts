// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { Row } from "../tableColumns";
import type { DatasetRow } from "./types";

/** Typed canonical encoding; field names are literal own keys, never access paths. */
function encode(value: unknown): unknown {
  if (value === null) return ["null"];
  switch (typeof value) {
    case "undefined": return ["undefined"];
    case "number": return ["number", Object.is(value, -0) ? "-0" : Number.isFinite(value) ? value : String(value)];
    case "string": case "boolean": return [typeof value, value];
    case "bigint": return ["bigint", String(value)];
    case "object": {
      if (value instanceof Date) return ["date", value.toISOString()];
      if (Array.isArray(value)) return ["array", Array.from(value, encode)];
      return ["object", Object.keys(value).sort().map(key => [key, encode((value as Row)[key])])];
    }
    default: throw new TypeError("Dataset identity requires data values, not functions or symbols");
  }
}

/**
 * Unique provider keys survive reordering/content edits. Invalid or duplicate keys
 * fall back for the entire result to content plus occurrence. Identical duplicates
 * have no stable individual distinction across refreshes.
 */
export function identifyRows(rows: Row[], keyFields?: string[]): DatasetRow[] {
  const keys = keyFields?.length && rows.every(row => keyFields.every(field =>
    Object.hasOwn(row, field) && row[field] !== null && row[field] !== undefined))
    ? rows.map(row => JSON.stringify(keyFields.map(field => [field, encode(row[field])]))) : undefined;
  const useKeys = keys && new Set(keys).size === rows.length;
  const occurrences = new Map<string, number>();
  return rows.map((row, index) => {
    if (useKeys) return { id: JSON.stringify(["key", keys[index]]), values: row };
    const content = JSON.stringify(encode(row));
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { id: JSON.stringify(["content", content, occurrence]), values: row };
  });
}

/** Path is already typed-encoded by the pivot engine; signature includes fields/buckets. */
export function groupIdentity(path: string, groupingSignature: string): string {
  return JSON.stringify(["group", groupingSignature, path]);
}
