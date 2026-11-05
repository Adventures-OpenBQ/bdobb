// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { parseExpression } from "../dates";
import { shownAs } from "./rangeExpr";

/**
 * The interval control's whole vocabulary lives here (spec 2026-09-25, G3):
 * a list of WIRE values, a display mapping over them, and the box's
 * grammar-duration parser. Pure -- no React, no chart -- so the regression
 * this sub-project exists to prevent (`5m` must not mean five minutes) is
 * pinned without a DOM, in intervalLabel.test.ts.
 */

/**
 * The seven built-in wire values (spec 2026-09-25, G3). The renderer uses
 * these only when the widget manifest declares no `interval` options of its
 * own; a manifest that declares options wins. These are the BACKEND's
 * vocabulary -- `m` is a minute here, as kdb's ta_series_ws reads it -- so
 * they are not translated on the wire, only relabelled for display.
 */
export const INTERVAL_WIRE_VALUES: readonly string[] = ["1s", "1m", "5m", "15m", "30m", "1h", "1d"];

/**
 * How a wire interval is SHOWN (spec 2026-09-25, G2/G3/G4). This IS the
 * range's own `shownAs`: the card speaks one vocabulary, so the interval's
 * display mapping and the range's are the same rule, not two. In the date
 * grammar `m` is a month and a minute is spelt `min`, so the wire `5m` (five
 * minutes) shows as `5min`. Applied to whatever value arrives -- a built-in
 * or a backend-declared one -- so a backend offering `5m` still shows `5min`,
 * and a value the rule does not touch (`2h`) shows as itself.
 */
export const intervalLabel = (value: string): string =>
  // A one-month bar shows as `1mo`, the box's own spelling of it (shownAs would give the
  // range's `1m`, which the box reads as a refusal), so opening Custom… on it round-trips.
  value === "1M" ? "1mo" : shownAs(value);

/** A parsed, servable duration (spec 2026-09-25, G6): the resolved seconds, the wire string the backend expects, and a human label for the preview. */
export type IntervalDuration = { seconds: number; wire: string; label: string };

// The wire's fixed-width units (spec 2026-09-25, G11): seconds, minutes,
// hours, days -- the only widths kdb's xbar can bucket on a constant number
// of nanoseconds. The date grammar's `min` maps to the wire's `m` (a minute);
// `s`/`h`/`d` are the same letter on both sides.
const WIRE_SECONDS: Record<string, number> = { s: 1, min: 60, h: 3600, d: 86400 };
const WIRE_UNIT: Record<string, string> = { s: "s", min: "m", h: "h", d: "d" };

/** Seconds as a compact `1h 30min` reading for the preview line. */
function humanizeDuration(seconds: number): string {
  let rest = seconds;
  const d = Math.floor(rest / 86400); rest %= 86400;
  const h = Math.floor(rest / 3600); rest %= 3600;
  const min = Math.floor(rest / 60); const s = rest % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (min) parts.push(`${min}min`);
  if (s) parts.push(`${s}s`);
  return parts.join(" ") || "0s";
}

/**
 * A typed duration -> the wire string and its seconds, or a refusal (spec
 * 2026-09-25, G5/G6/G9/G11).
 *
 * The duration is read through the app's OWN grammar, not a second copy of
 * it: we anchor the text on `T-` and hand it to `parseExpression`, so `min`
 * is minutes and `m`/`mo` are months exactly as the host grammar documents.
 * That is what makes `5m` five months here -- the regression the whole
 * sub-project guards -- rather than five minutes.
 *
 * Only the wire's fixed-width units are servable (G11): a month, quarter,
 * year or week is refused with a line naming the unit, never translated to a
 * minute wire string (`3mo` -> months, and `3m` would be three MINUTES). The
 * translation to the wire happens once, here, so nothing downstream learns a
 * second grammar (G6).
 */
export function parseIntervalDuration(text: string): IntervalDuration | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { error: "Type a duration, e.g. 90min, 4h or 2d." };
  // An interval is a length, not a range (spec G5): the two-endpoint form the
  // package prototype offered is refused here rather than subtracted.
  if (trimmed.includes("/") || trimmed.includes("..")) {
    return { error: "An interval is a single length, not a range (e.g. 90min)." };
  }
  // Reuse the grammar: `T-<text>` is one anchor and one offset when `text` is
  // a single duration. Anything else (no offset, several offsets, an `@`
  // suffix, a leading sign or a bare `T`) leaves this a literal we refuse.
  const expr = parseExpression(`T-${trimmed}`);
  const atom = expr?.start;
  if (expr === null || expr.end !== undefined || atom === undefined
      || atom.at !== undefined || atom.offsets.length !== 1) {
    return { error: "Type a single duration, e.g. 90min, 4h or 2d." };
  }
  const { amount, unit } = atom.offsets[0];
  // A week or a month (user ruling 2026-10-26: "1 month should fall under custom"):
  // one of each is a bar every provider serves (`1w`, `1M`), never bucketed here. A month
  // is accepted only as `1mo` or `1M`: `1m` stays a refusal, because a minute is the
  // likelier meaning of what was typed (G1).
  if (unit === "w") {
    return amount === 1
      ? { seconds: 604_800, wire: "1w", label: "1 week" }
      : { error: `${amount} weeks is not a bar interval — 1w is the weekly bar.` };
  }
  if (unit === "m" && amount === 1) {
    return /(mo|M)$/i.test(trimmed) && !trimmed.endsWith("m")
      ? { seconds: 2_592_000, wire: "1M", label: "1 month" }
      : { error: "1m reads as a month — type 1min for minutes, or 1mo for a monthly bar." };
  }
  if (!(unit in WIRE_SECONDS)) {
    // The grammar read a unit the wire cannot bucket. Months get the specific
    // line, because `3m` in the box would otherwise be mistaken for minutes.
    if (unit === "m") {
      return { error: `${amount} ${amount === 1 ? "month" : "months"} is not a bar interval — type ${amount}min for minutes.` };
    }
    return { error: "An interval must be a whole number of seconds, minutes, hours or days." };
  }
  const seconds = amount * WIRE_SECONDS[unit];
  // G9: a zero, negative or non-integer duration is refused. With the fixed
  // units above `seconds` is always a positive integer, so this guards the
  // contract (and any future unit) rather than a path these inputs reach.
  if (!Number.isInteger(seconds) || seconds <= 0) {
    return { error: "An interval must be a whole number of seconds greater than zero." };
  }
  return { seconds, wire: `${amount}${WIRE_UNIT[unit]}`, label: humanizeDuration(seconds) };
}
