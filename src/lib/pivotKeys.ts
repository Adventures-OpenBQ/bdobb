// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { PivotConfig } from "./types";

/**
 * U+001F, the ASCII unit separator: it joins group keys into a path and split
 * keys into a column id. Each value is first JSON encoded by pivotValueKey,
 * so a separator inside a source value is escaped.
 */
export const KEY_SEP = "\x1f";

/** Stable, separator-safe identity for a primitive pivot dimension value. */
export function pivotValueKey(value: unknown): string {
  if (value === null || value === undefined || value === "") return JSON.stringify(["blank", null]);
  switch (typeof value) {
    case "string": return JSON.stringify(["string", value]);
    case "number": {
      const number = Number.isNaN(value) ? "NaN" : value === Infinity ? "Infinity"
        : value === -Infinity ? "-Infinity" : Object.is(value, -0) ? 0 : value;
      return JSON.stringify(["number", number]);
    }
    case "boolean": return JSON.stringify(["boolean", value]);
    case "bigint": return JSON.stringify(["bigint", value.toString()]);
    default: return JSON.stringify([typeof value, String(value)]);
  }
}

/** Warnings for restored folds whose original meaning cannot be safely inferred. */
export function pivotFoldWarnings(config: PivotConfig): string[] {
  const legacy = config.legacyExpanded && Object.keys(config.legacyExpanded).length > 0;
  const unmarked = config.keyEncoding !== "typed-v1" && config.expanded !== true &&
    config.expanded !== undefined && Object.keys(config.expanded).length > 0;
  if (legacy || unmarked) return ["Some saved row folds use an older key format and remain inactive. Review or clear them before folding again."];
  if (config.keyEncoding !== "typed-v1" || config.expanded === true || !config.expanded) return [];
  const words: Record<string, number> = { NaN, Infinity, "-Infinity": -Infinity };
  const invalid = Symbol();
  // Decode each part, then accept it only if it re-encodes to itself.
  const valid = (path: string) => path.split(KEY_SEP).every((part) => {
    try {
      const value: unknown = JSON.parse(part);
      if (!Array.isArray(value) || value.length !== 2) return false;
      const [tag, content] = value;
      const decoded =
        tag === "blank" && content === null ? null
        : (tag === "string" || tag === "boolean" || tag === "number") && typeof content === tag ? content
        : tag === "number" && typeof content === "string" && Object.hasOwn(words, content) ? words[content]
        : tag === "bigint" && typeof content === "string" ? BigInt(content)
        : invalid;
      return decoded !== invalid && part === pivotValueKey(decoded);
    } catch { return false; }
  });
  return Object.keys(config.expanded).some((path) => !valid(path))
    ? ["Some saved row folds have invalid typed keys and remain inactive. Review or clear them."] : [];
}
