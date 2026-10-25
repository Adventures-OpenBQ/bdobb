// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";

/**
 * What a column's `renderFn` and `renderFnParams` do to one cell's
 * appearance. Pure, so TableRenderer only has to apply the answer.
 *
 * Acted on: `greenRed`, `titleCase`, and `renderFnParams.colorRules`.
 * `cellOnClick` is acted on too, but not here — it is a click target, not an
 * appearance, and lives in cellClickOf (src/lib/tableColumns.ts).
 * `hoverCard` is acted on in TableRenderer (HoverCardCell), validated by
 * hoverCardOf (src/lib/tableColumns.ts). Parsed and deliberately ignored, per
 * the design's out-of-scope list: `columnColor`, `showCellChange`, `sparkline`.
 */

export type ColorRuleCondition =
  | "eq"
  | "ne"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "between"
  | "contains"
  | "notContains";

/**
 * One colorRules entry, with `range` already normalised into `min`/`max` so
 * the matcher does not have to know which shape the manifest used.
 */
export type ColorRule = {
  condition: ColorRuleCondition;
  value?: unknown;
  min?: number;
  max?: number;
  color: string;
  /** true paints the background instead of the text. */
  fill?: boolean;
};

export type CellVisual = {
  className?: "cell-pos" | "cell-neg";
  color?: string;
  fill?: boolean;
};

/**
 * Every condition except `between` compares against `value`, so one without a
 * value has nothing to compare and is dropped. `between` reads min/max.
 */
const NEEDS_VALUE = new Set<string>([
  "eq",
  "ne",
  "gt",
  "lt",
  "gte",
  "lte",
  "contains",
  "notContains",
]);

const CONDITIONS = new Set<string>([...NEEDS_VALUE, "between"]);

/** Zero is neither: a flat day is not a gain and not a loss. */
export function greenRedClass(value: unknown): "cell-pos" | "cell-neg" | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  if (value > 0) return "cell-pos";
  if (value < 0) return "cell-neg";
  return undefined;
}

/**
 * Words are whitespace-delimited. An underscore is NOT treated as a word
 * break: rewriting "some_value" into "Some Value" would be a second,
 * unasked-for transformation on top of title-casing.
 */
export function titleCase(text: string): string {
  return text.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * The `colorRules` out of an opaque `renderFnParams`. A rule with an unknown
 * condition or no string colour is dropped, exactly as widgetsJson drops an
 * ill-typed param property.
 */
export function colorRules(params: Record<string, unknown> | undefined): ColorRule[] {
  const raw = params?.colorRules;
  if (!Array.isArray(raw)) return [];
  const rules: ColorRule[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    if (typeof entry.condition !== "string" || !CONDITIONS.has(entry.condition)) continue;
    if (typeof entry.color !== "string") continue;
    if (NEEDS_VALUE.has(entry.condition) && entry.value === undefined) continue;
    const rule: ColorRule = { condition: entry.condition as ColorRuleCondition, color: entry.color };
    if ("value" in entry) rule.value = entry.value;
    // `range` is the Workspace reference's `{ min, max }` object; anything
    // else leaves the bounds unset, and `between` then matches nothing —
    // the same drop-what-is-ill-typed rule as every other field here.
    const range = entry.range;
    if (isRecord(range)) {
      if (typeof range.min === "number") rule.min = range.min;
      if (typeof range.max === "number") rule.max = range.max;
    }
    if (typeof entry.fill === "boolean") rule.fill = entry.fill;
    rules.push(rule);
  }
  return rules;
}

function matches(rule: ColorRule, value: unknown): boolean {
  const bothNumbers = typeof value === "number" && typeof rule.value === "number";
  switch (rule.condition) {
    case "eq":
      // Strict: a manifest that quotes its number gets no match rather than a
      // coerced one that could colour the wrong cells.
      return value === rule.value;
    case "ne":
      return value !== rule.value;
    case "gt":
      return bothNumbers && (value as number) > (rule.value as number);
    case "lt":
      return bothNumbers && (value as number) < (rule.value as number);
    case "gte":
      return bothNumbers && (value as number) >= (rule.value as number);
    case "lte":
      return bothNumbers && (value as number) <= (rule.value as number);
    case "between":
      return (
        typeof value === "number" &&
        rule.min !== undefined &&
        rule.max !== undefined &&
        value >= rule.min &&
        value <= rule.max
      );
    // Both sides are stringified, so an unquoted needle in the manifest works
    // as well as a quoted one. Anything that is neither a string nor a number
    // has no sensible textual form and matches nothing.
    case "contains":
    case "notContains": {
      if (typeof rule.value !== "string" && typeof rule.value !== "number") return false;
      const found = String(value).includes(String(rule.value));
      return rule.condition === "contains" ? found : !found;
    }
  }
  return false;
}

/**
 * When a column carries colorRules they govern its colour outright and no
 * sign class is set: a cell-neg class plus an inline colour would fight, and
 * the inline colour would silently win. With no colorRules, greenRed decides.
 *
 * The rules arrive ALREADY PARSED — tableColumns validates them once per
 * column, because this runs once per cell and re-validating an opaque
 * renderFnParams here would repeat that work on every row of every render.
 */
export function cellVisual(
  column: { renderFn: string[]; colorRules?: ColorRule[] },
  value: unknown,
): CellVisual {
  const rules = column.colorRules ?? [];
  if (rules.length > 0) {
    // The FIRST match wins, as the spec says — not the narrowest.
    const rule = rules.find((r) => matches(r, value));
    if (!rule) return {};
    return rule.fill === true ? { color: rule.color, fill: true } : { color: rule.color };
  }
  if (!column.renderFn.includes("greenRed")) return {};
  const className = greenRedClass(value);
  return className ? { className } : {};
}
