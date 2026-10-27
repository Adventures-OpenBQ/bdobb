// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * Number and time formatting for the advanced chart's chrome (spec §6).
 *
 * Every function is pure and locale-pinned to en-US: the legend, the status
 * bar and the axis labels all read the same way on every machine, and a
 * streaming value never changes width with the user's locale. Digit width
 * itself is the CSS's job (tabular-nums on .chart-legend and .chart-status).
 */

import { getFormatter } from "../format";

const MAX_DECIMALS = 8;

/**
 * How many decimals the price scale needs so a visible range `span` wide
 * still shows at least three distinct ticks. Two is the floor (§6: "2
 * decimals minimum"); a range under a unit adds one decimal per power of
 * ten until three steps fit. A degenerate span -- zero, NaN, nothing
 * loaded yet -- reads as two rather than as eight.
 */
export function priceDecimals(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 2;
  let decimals = 2;
  while (decimals < MAX_DECIMALS && span / 10 ** -decimals < 3) decimals += 1;
  return decimals;
}

/** `value` at exactly `decimals` places with thousands separators. */
export function formatPrice(value: number, decimals: number): string {
  return getFormatter("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/**
 * A volume with an SI suffix via Intl's own compact notation: 620K, 350K,
 * 1.2M, 12M, 2.5B. Two significant figures, matching the legend's other
 * numbers, means a small whole count can round too ("999" prints "1K").
 *
 * The studies/chart spec's addendum gives "0.35M" as the example; per the
 * user's 2026-09-17 ruling, Intl's own compact output ships instead of a
 * hand-rolled unit table, and Intl renders that same value "350K".
 */
export function formatVolume(value: number): string {
  return getFormatter("en-US", { notation: "compact", maximumSignificantDigits: 2 }).format(value);
}

/**
 * The delta chip's text and direction. Direction is triple-encoded (§10.3):
 * a glyph, an explicit sign and, through the returned key, a colour. The
 * minus is U+2212, which is the width of a plus in every tabular font; a
 * hyphen-minus is narrower and would make the chip jitter as the sign
 * flips.
 */
export function formatDelta(
  change: number, percent: number, decimals: number,
): { text: string; direction: "up" | "down" | "flat" } {
  if (change === 0) return { text: `${formatPrice(0, decimals)} (${formatPrice(0, 2)}%)`, direction: "flat" };
  const up = change > 0;
  const sign = up ? "+" : "−";
  const glyph = up ? "▲" : "▼";
  return {
    // No sign on the PERCENT (user, 2026-09-26): it repeats the one on the
    // change beside it. Direction stays triple-encoded as §10.3 requires --
    // the glyph, the sign on the change, and the colour -- so dropping the
    // second sign costs no redundancy that the spec asked for.
    text: `${glyph} ${sign}${formatPrice(Math.abs(change), decimals)} (${formatPrice(Math.abs(percent), 2)}%)`,
    direction: up ? "up" : "down",
  };
}

/**
 * The bar's clock for the legend head ("@ 16:59"): HH:MM in the given zone,
 * with seconds only for sub-minute bars, and the date alone for daily
 * bars, whose time is midnight by construction. Mirrors chartTimeLabels'
 * axis rules so the legend and the axis never disagree about a bar.
 */
export function formatClock(time: number, intervalSeconds: number, timeZone?: string): string {
  const at = new Date(time * 1000);
  if (intervalSeconds >= 86400) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(at);
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
    ...(intervalSeconds < 60 ? { second: "2-digit" } : {}),
  }).format(at);
}

/**
 * "EDT", "EST", "UTC": the zone's short name at an instant, for the status
 * bar's last-bar time. Local when no zone is given -- the viewer's clock,
 * which is also what the intraday axis shows. Slice 4 hands the exchange's
 * zone in once the calendar resolver knows it.
 */
export function zoneAbbreviation(timeZone?: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}
