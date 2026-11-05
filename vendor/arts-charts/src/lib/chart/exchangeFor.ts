// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { ChartWindow } from "./rangeExpr";
import { getLocalTimeZone } from "@internationalized/date";
import { parseExpression, resolveExpression, wireDatetime, type Expression } from "../dates";
import { DEFAULT_EXCHANGE, exchangeOf, weekdayCalendar, type ExchangeCalendar } from "../tradingCalendar";
import type { AnchorResolver } from "./indicatorsParam";

/** What live-grid's `/symbol_meta` says the symbol is, from its own `classify`. */
export type AssetClass = "us" | "crypto" | "forex";

/**
 * The symbol's exchange from its asset class (v12.3.0 slice 4, the
 * "exchange from the asset class" ruling): a US equity trades on the
 * exchange the card, its widget or the dashboard names -- v5's own
 * `exchangeOf`, XNYS by default -- and anything else has none. Null is a
 * real answer, not "unknown yet": with no exchange the session toggle
 * hides, `bd`, `@open` and `@close` are refused, and the clocks read the
 * viewer's zone. An asset class the backend has not reported (an older
 * live-grid without `asset` on `/symbol_meta`, or the fetch still in
 * flight) is treated the same way, so nothing is ever assumed about a
 * symbol the backend has not classified.
 *
 * ponytail: `us` maps to one exchange; a US-listed symbol on NASDAQ still
 * runs on XNYS hours, which are the same hours. Upgrade path: a per-symbol
 * exchange from `/symbol_meta` once EODHD's exchange code is mapped to a MIC.
 */
export function exchangeFor(
  asset: AssetClass | undefined,
  widget: { exchange?: string } | undefined,
  dashboardExchange?: string,
): string | null {
  return asset === "us" ? exchangeOf(widget, undefined, dashboardExchange) : null;
}

/** The anchors a resolution cannot answer without knowing when the exchange is open. */
const CALENDAR_ANCHORS = new Set(["trade_date", "prev_trade_date", "session_open", "session_close"]);

/**
 * Whether the expression consults the exchange calendar anywhere: a trading
 * anchor, a `bd` offset, or an `@open`/`@close` suffix. `T@14:00` does not --
 * it is a wall-clock time on today's date -- and neither does `now-5d`.
 *
 * Exported since the final review's I1: the range popover (rangeExpr.ts) asks
 * the same question of the same grammar, and one grammar must not have two
 * resolver identities on one card.
 */
export function needsCalendar(expr: Expression): boolean {
  const { anchor, offsets, at } = expr.start;
  return (anchor.kind === "named" && CALENDAR_ANCHORS.has(anchor.name))
    || offsets.some((offset) => offset.unit === "bd")
    || (at !== undefined && at.kind !== "clock");
}

/**
 * The study socket's anchor resolver for one exchange (or none): a v5
 * expression to the absolute instant the wire carries, or null when it
 * cannot be answered. With a calendar every production resolves, in the
 * exchange's zone. With none the viewer's zone stands in and every
 * calendar-needing production is refused -- `T@14:00` still resolves on a
 * crypto card (there is no session to name, but there is a two o'clock),
 * while `FQ0@open` and `T-1bd@close` come back null and indicatorsParam
 * leaves their studies off the wire. Chosen over "no exchange, no resolver
 * at all": that would drop the one anchor a crypto card most plausibly
 * carries, for the cost of the dozen lines above.
 *
 * `now` is fixed at construction: the renderer memoises one resolver per
 * calendar and passes the same closure to the wire and to every
 * matchSeries call, so both sides resolve `T` to the same day -- the
 * "resolution happens when the string is derived" ponytail in
 * indicatorsParam.ts carries the midnight consequence.
 *
 * `window` (the branch-end round, finding 1) is the card's own start/end,
 * so `S` and `E` resolve in a study anchor as they already do in a panel's
 * `xs`/`xe` and a performance rebase -- the spec lists a study anchor among
 * the positions they are valid in, and without it `AVWAP(S@09:30)` was
 * dropped from the wire in silence. Each expression is answered ONCE per
 * resolver: the closure's identity is what the renderer keys the socket URL
 * on, so the cache is what keeps two calls in one derivation -- the wire's
 * and matchSeries' -- from disagreeing about `E` while a bar arrives
 * between them.
 */
export function anchorResolver(
  calendar: ExchangeCalendar | null,
  now: Date = new Date(),
  window: ChartWindow = {},
): AnchorResolver {
  const { zone, calendar: cal } = calendarContext(calendar);
  const answered = new Map<string, string | null>();
  return (text) => {
    const cached = answered.get(text);
    if (cached !== undefined) return cached;
    const expr = parseExpression(text);
    const at = expr === null || (calendar === null && needsCalendar(expr))
      ? null
      : resolveExpression(text, now, zone, { calendar: cal, start: window.start, end: window.end });
    const wire = at === null ? null : wireDatetime(at);
    answered.set(text, wire);
    return wire;
  };
}

/**
 * The resolution context one card's grammar runs in: the zone a bare clock
 * is read on, and the calendar every production consults. With an exchange
 * both are the exchange's -- the bundled holidays included. With none:
 *
 * I1 fix: with no exchange, `T@14:00`'s clock branch (the host grammar's
 * applyAt) must build the instant on the VIEWER's zone, not XNYS's -- the
 * zone every other control on a crypto/forex card already reads. Standing
 * in a weekday calendar whose timezone is the viewer's own keeps that
 * branch's `cal.timezone` read honest without touching resolveExpression.
 *
 * Shared with the range popover (the final review's I1): the popover built
 * its own ctx -- none at all, so `resolveValue` fell back to XNYS's weekday
 * table for every card -- and the two consumers then answered `T-1bd`
 * differently on the same card. One function, one answer.
 */
export function calendarContext(
  calendar: ExchangeCalendar | null,
): { zone: string | undefined; calendar: ExchangeCalendar } {
  return {
    zone: calendar?.timezone,
    calendar: calendar ?? { ...weekdayCalendar(DEFAULT_EXCHANGE), timezone: getLocalTimeZone() },
  };
}
