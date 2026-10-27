// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { getLocalTimeZone, parseDate, toCalendarDateTime, toZoned } from "@internationalized/date";
import { parseExpression, parseWireDatetime, previewExpression, resolveValue, type Preview } from "../dateExpressions";
import type { ExchangeCalendar } from "../tradingCalendar";
import { calendarContext, needsCalendar } from "./exchangeFor";

/**
 * The range chips (spec §4.3) as expressions in the v5 grammar, one
 * `datetime` atom per end, so the same resolver every widget parameter uses
 * answers the chart -- not a fork. A range is a VIEW: it zooms the time
 * scale and never touches the interval or the studies' window (the v12.2
 * decision, kept). `mo` is a month in this grammar (`min` is a minute).
 */
export type ChartRange = { from: string; to: string };

/**
 * What a range end may be resolved against besides the clock and the calendar:
 * the widget's own window (`S` / `E`, v12.4.0) and -- v5.3.0 §3 `data_bounds` --
 * the first and last instant of the bars it has loaded (`earliest` / `latest`).
 * Spread straight into the resolver's context, so the names are the context's.
 */
export type ChartWindow = {
  start?: Date; end?: Date; bounds?: { min?: Date; max?: Date };
  /**
   * The card's Session choice, for `@SOD` / `@EOD` (user, 2026-09-29: a Custom
   * range of `T-Mon@SOD` .. `T+FRI@EOD` "did not work" in a demo). Those two
   * are the one production that reads card state -- the regular session on a
   * regular-hours card, the extended day on an extended one -- so the resolver
   * REFUSES them when no session is given rather than guess. Nothing here gave
   * one, so every `@SOD`/`@EOD` in a chart range, even a bare `T@SOD`, read as
   * "not a date". Same name as the resolver context's key, because this
   * object is spread straight into it.
   */
  session?: "extended" | "regular" | "24hr";
};

/**
 * How a unit-bearing token is SHOWN (v12.4.9, user ruling 2026-09-21). In the
 * date grammar `m` is a month and a minute has to be spelt `min`, so the card
 * reads the same way: the `5m` interval shows as `5min`, and the month range
 * shows as `1m`. Display only -- an interval's value stays the backend's wire
 * form (`5m`), and a preset's identity stays `1M` wherever it is stored.
 */
export const shownAs = (token: string): string =>
  token.replace(/^(\d+)m$/, "$1min").replace(/^(\d+)M$/, "$1m");

export const RANGE_PRESETS: { label: "1D" | "5D" | "1M"; range: ChartRange }[] = [
  { label: "1D", range: { from: "now-1d", to: "now" } },
  { label: "5D", range: { from: "now-5d", to: "now" } },
  { label: "1M", range: { from: "now-1mo", to: "now" } },
];

/**
 * A production the exchange calendar has to answer -- `T-1bd`,
 * `session_open`, `FQ0@open` -- on a card whose symbol has no exchange
 * (crypto, forex, unclassified). Refused rather than resolved on a stand-in
 * table, which is exactly what the study resolver does with the same
 * question (exchangeFor's `anchorResolver`): the "not a date" reading under
 * that field and the disabled Apply are the refusal the user sees.
 */
function refused(value: string, calendar: ExchangeCalendar | null): boolean {
  if (calendar !== null) return false;
  const expr = parseExpression(value);
  return expr !== null && needsCalendar(expr);
}

/**
 * One end as an instant: an expression through the resolver, a literal ISO
 * date/datetime as itself. `resolveValue("datetime", …)` projects an
 * expression through `wireDatetime`, which always carries a UTC offset
 * (`2026-09-16T12:00:00+00:00`) -- `parseWireDatetime` reads that shape
 * directly. A bare `YYYY-MM-DD` literal (no offset) is not that shape: it is
 * midnight in the given zone, read with the calendar-date parser instead.
 *
 * The final review's I1: the ctx is the CARD's (`calendarContext`), not the
 * resolver's own default -- the bundled NYSE holidays on a US card, the
 * viewer's zone and no calendar productions at all on a crypto one. Passing
 * a zone alone left `resolveExpression` on the XNYS weekday table, so the
 * popover's `T-1bd` and the study socket's disagreed across a holiday.
 *
 * v12.4.0: exported, and `window` carries the widget's own start/end
 * instants for the `S` and `E` anchors (T1's grammar addition). The panel
 * editor's `xs`/`xe` and a performance series' rebase anchor are the same
 * question this function already answers for a range end -- one expression,
 * one literal fallback, one calendar -- so they ask it here rather than
 * each building a resolver of their own out of `resolveExpression`, which
 * would answer null for the bare `2026-01-05` a user may reasonably type.
 */
export function resolveInstant(
  value: string,
  now: Date,
  calendar: ExchangeCalendar | null,
  window: ChartWindow = {},
): number | null {
  if (refused(value, calendar)) return null;
  const { zone, calendar: cal } = calendarContext(calendar);
  const resolved = resolveValue("datetime", value, { now, zone, calendar: cal, ...window });
  const asInstant = parseWireDatetime(resolved, zone);
  if (asInstant !== null) return Math.floor(asInstant.toDate().getTime() / 1000);
  try {
    const midnight = toZoned(toCalendarDateTime(parseDate(resolved)), zone ?? getLocalTimeZone());
    return Math.floor(midnight.toDate().getTime() / 1000);
  } catch {
    return null;
  }
}

/** Both ends in unix seconds, or null when either fails or they are reversed.
 * `window` (v12.4.0): the widget's own start/end instants, for `S`/`E` in
 * either end -- the same window `resolveInstant` already takes for a panel's
 * `xs`/`xe` and a performance anchor. */
/**
 * What a range MEANS on this card. The 1D and 5D chips are stored as `now-1d` and
 * `now-5d`, which are calendar days -- and early on a Monday `now-1d` is Sunday to
 * Monday: no session in it at all, so an EODHD chart asked for an empty window (a 502
 * from the real stack) and `now-5d` was three sessions, not five. "I expect if I hit
 * 1D, 5D or 1M I get the full view of the data" (2026-09-21). On a card whose symbol has
 * an exchange the two chips count TRADING days; with none (crypto, forex -- there is no
 * calendar to count sessions on, and the market never closes) they stay calendar days.
 *
 * Here, in the one function every reader of a range goes through -- the fetch window
 * (barsWindow), both zooms and the hero change -- so they cannot disagree, and a card
 * saved before this reads the same way. What is STORED, and which chip lights
 * (presetFor), do not change. A window the user typed is theirs, untouched.
 */
function meant(range: ChartRange, calendar: ExchangeCalendar | null): ChartRange {
  if (calendar === null) return range;
  const chip = presetFor(range);
  return chip === "1D" ? { from: "now-1bd", to: "now" } : chip === "5D" ? { from: "now-5bd", to: "now" } : range;
}

export function resolveRange(
  stored: ChartRange, now: Date = new Date(), calendar: ExchangeCalendar | null = null,
  window: ChartWindow = {},
): { from: number; to: number } | null {
  const range = meant(stored, calendar);
  const from = resolveInstant(range.from, now, calendar, window);
  const to = resolveInstant(range.to, now, calendar, window);
  if (from === null || to === null || from >= to) return null;
  return { from, to };
}

/**
 * What ONE end resolves to right now, as text -- the reading a field prints
 * directly beneath itself.
 *
 * Per end rather than per range on purpose: `previewRange` is null the moment
 * either end fails, which is the right answer for a single combined line but
 * the wrong one under a field, where a typo in From would blank the reading
 * under a perfectly good To.
 */
export function previewInstant(
  value: string, now: Date = new Date(), calendar: ExchangeCalendar | null = null,
  window: ChartWindow = {},
): string | null {
  const preview = previewChartExpression(value, now, calendar, window);
  if (preview !== null) return preview.text;
  // A literal previews as itself, if it is one.
  return resolveInstant(value, now, calendar, window) === null ? null : value;
}

/**
 * One end as the WIRE datetime the v5 `datetime` control displays
 * (`2026-09-14T09:30:15-04:00`), or "" when it does not resolve.
 *
 * The chart's Custom range is TWO `datetime` ends, not a `date_range`: the v5
 * range control is dates only (v5.2.0 period-pickers design, the controlKind
 * table -- `range` is two `DateField`s and a `RangeCalendar`, no time), and the
 * app's own precedent for a two-ended datetime window is two `datetime` params
 * (v11.1.0 Delta explorer, Start and End). So each end gets the same
 * `DatetimePicker` a v5 datetime parameter gets, and this is what feeds it.
 */
export function instantWire(
  value: string, now: Date = new Date(), calendar: ExchangeCalendar | null = null,
  window: ChartWindow = {},
): string {
  if (refused(value, calendar)) return "";
  const { zone, calendar: cal } = calendarContext(calendar);
  const resolved = resolveValue("datetime", value, { now, zone, calendar: cal, ...window });
  return parseWireDatetime(resolved, zone) === null ? "" : resolved;
}

/**
 * The same reading `previewInstant` gives, as the `Preview` a RelativeTab's
 * context is required to return.
 */
export function previewChartExpression(
  value: string, now: Date = new Date(), calendar: ExchangeCalendar | null = null,
  window: ChartWindow = {},
): Preview | null {
  if (refused(value, calendar)) return null;
  const { zone, calendar: cal } = calendarContext(calendar);
  return previewExpression("datetime", value, { now, zone, calendar: cal, ...window });
}

/** The popover's live line: what each end resolves to right now. */
export function previewRange(
  range: ChartRange, now: Date = new Date(), calendar: ExchangeCalendar | null = null,
  window: ChartWindow = {},
): { from: string; to: string } | null {
  const from = previewInstant(range.from, now, calendar, window);
  const to = previewInstant(range.to, now, calendar, window);
  return from === null || to === null ? null : { from, to };
}

/**
 * Which chip a stored range lights: a preset by value, else Custom. No range
 * at all lights nothing -- `null`, not Custom: the card is fitting everything
 * loaded, which is a state of its own and not a custom window the user chose.
 */
export function presetFor(range: ChartRange | undefined): "1D" | "5D" | "1M" | "Custom" | null {
  if (range === undefined) return null;
  return RANGE_PRESETS.find((p) => p.range.from === range.from && p.range.to === range.to)?.label ?? "Custom";
}
