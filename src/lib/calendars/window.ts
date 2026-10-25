// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { PERIOD_UNIT, parseExpression, splitRange, type Atom } from "../dateExpressions";
import { LIMITS } from "./contracts";
import { calendarEntry } from "./catalogue";

/** A bundle request's inclusive date range. */
export type BundleWindow = { start: string; end: string };

/** Days one unit of each offset can move a date, rounded up. Weekday steps (MON..SUN) are a week each. */
const UNIT_DAYS: Record<string, number> = { s: 0, min: 0, h: 1, d: 1, w: 7, m: 31, q: 92, fq: 92, y: 366, fy: 366 };

/** How far from now one atom can land, in days, generously. */
function reach(atom: Atom): number {
  // A period anchor starts up to a year back (FY0) before its own count moves it.
  let days = atom.anchor.kind === "period" ? 366 + Math.abs(atom.anchor.n) * UNIT_DAYS[PERIOD_UNIT[atom.anchor.period]] : 0;
  if (atom.anchor.kind === "expiry") days += 31 * (Math.abs(atom.anchor.n) + 1);
  for (const o of atom.offsets) {
    // Business days: five in seven, plus two weeks for a holiday season.
    days += o.unit === "bd" ? Math.ceil((o.amount * 7) / 5) + 14 : o.amount * (UNIT_DAYS[o.unit] ?? 7);
  }
  return days;
}

/** Years either side of now: 2 × 9 + 1 = 19 whole years, inside LIMITS.days (20 years). */
const MAX_SIDE_YEARS = Math.floor((LIMITS.days / 366 - 1) / 2);

/**
 * The whole UTC years a card's expressions can reach from `now` (review I2: always one year either side, so `T-2y`
 * failed). Whole years because openbq-docker aligns to them, so a one-day change asks for the same bundle. A reach
 * past MAX_SIDE_YEARS is cut there, and resolving beyond it is a visible COVERAGE_UNAVAILABLE.
 */
export function bundleWindow(values: readonly string[], now: Date): BundleWindow {
  let days = 0;
  for (const value of values) {
    for (const half of splitRange(value)) {
      const expr = parseExpression(half);
      if (expr) for (const atom of expr.end ? [expr.start, expr.end] : [expr.start]) days = Math.max(days, reach(atom));
    }
  }
  const side = Math.min(MAX_SIDE_YEARS, Math.ceil(days / 365) + 1);
  const year = now.getUTCFullYear();
  return { start: `${year - side}-01-01`, end: `${year + side}-12-31` };
}

// What openbq-docker serves a binding outside the catalogue (a payment or settlement calendar): its route window.
const FLOOR = "1990-01-01";
const CEILING = "2040-12-31";

/**
 * `window` for one calendar, clamped into the dates the catalogue says it is served for (P11, R10b; 2026-10-24: XSHG
 * from 1990-12-03, XSES to 2026-12-31). Asking outside them is refused by openbq-docker, which would fail the whole card.
 * Both ends are clamped, so a window wholly past the bounds asks for the nearest served day and the atom that reaches
 * past it shows its own COVERAGE_UNAVAILABLE (review focus 1).
 */
export function calendarWindow(calendarId: string, window: BundleWindow): BundleWindow {
  const served = calendarId.startsWith("exchange:") ? calendarEntry(calendarId.slice("exchange:".length))?.bounds : undefined;
  const lo = served?.start ?? FLOOR;
  const hi = served?.end ?? CEILING;
  const clamp = (day: string) => (day < lo ? lo : day > hi ? hi : day);
  return { start: clamp(window.start), end: clamp(window.end) };
}
