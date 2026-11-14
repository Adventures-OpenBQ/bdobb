// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { CalendarDate, fromDate } from "@internationalized/date";
import { addBusinessDays, isOpen, weekdayCalendar, DEFAULT_EXCHANGE, type ExchangeCalendar } from "../tradingCalendar";
import { parseIntervalSeconds } from "./warmup";
import { resolveRange, type ChartRange, type ChartWindow } from "./rangeExpr";

const DAY_MS = 86_400_000;
/**
 * The most bars a range may ask the fetch for (user ruling 2026-10-21: "cap
 * the range fetch span per interval", the basis being a bar budget). A range
 * is a zoom that may move the bars' START earlier, but only until the window
 * holds this many bars at the card's interval and session; past that the
 * start is clipped and the card says so. 20,000 is 51 sessions of 1m regular
 * bars and about 79 years of daily ones.
 */
export const RANGE_BAR_BUDGET = 20_000;

/** Minutes in one session, by the card's session mode. */
const SESSION_MINUTES = { regular: 390, extended: 960, "24hr": 1440 } as const;

/**
 * How many sessions the budget buys at `interval`: budget / bars-per-session
 * for an intraday interval, where a session holds ceil(minutes / interval)
 * interval-aligned bars (390/60 is 7, not 6.5), and one session per bar for
 * `1d` (five for `1w`, twenty-one for `1M`). Floored, and zero when a single
 * session holds more bars than the budget (1s regular). `null` for a label
 * that is not an interval: the caller then widens nothing.
 */
function budgetSessions(seconds: number, unit: string, session: keyof typeof SESSION_MINUTES): number {
  if (seconds >= DAY_MS / 1000) {
    const bars = unit === "w" ? seconds / 604800 * 5 : unit === "M" ? seconds / (30 * 86400) * 21 : seconds / 86400;
    return Math.floor(RANGE_BAR_BUDGET * bars);
  }
  return Math.floor(RANGE_BAR_BUDGET / Math.ceil((SESSION_MINUTES[session] * 60) / seconds));
}

/** `YYYY-MM-DD` minus `days` calendar days. */
const minusDays = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/**
 * The earliest day (`YYYY-MM-DD`) a window ending on `end` may start so that
 * it holds `sessions` sessions: open days on the card's calendar (weekdays
 * when it has none), every calendar day on a 24hr session. When `end` is not
 * itself a session it holds none, so the walk goes one session further.
 */
function earliestStart(sessions: number, session: keyof typeof SESSION_MINUTES, end: string, calendar: ExchangeCalendar | null): string {
  if (sessions < 1) return end;
  if (session === "24hr") return minusDays(end, sessions - 1);
  const cal = calendar ?? weekdayCalendar(DEFAULT_EXCHANGE);
  const at = fromDate(new Date(`${end}T12:00:00Z`), "UTC");
  const day = new CalendarDate(at.year, at.month, at.day);
  return addBusinessDays(cal, at, -(isOpen(cal, day) ? sessions - 1 : sessions)).toString().slice(0, 10);
}

/**
 * One instant as `YYYY-MM-DD` on the exchange's clock, the viewer's when the
 * symbol has none -- the same zone `resolveRange` read the range facet on,
 * so a literal `2026-09-01` round-trips to itself rather than to the day
 * before it east of Greenwich.
 */
function isoDay(ms: number, zone: string | undefined): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: zone });
}

/**
 * Where a range CHIP's view starts: the first loaded bar of the day the range
 * opens on, on the exchange's clock (v12.4.11; "if I hit 1D, 5D or 1M I get
 * the full view of the data", user 2026-09-21). `barsWindow` below asks for
 * whole DAYS -- its start is a date -- while the chip's `now-1bd` names an
 * instant, so on a Monday morning 1D loaded Friday from 04:00 and showed it
 * from 09:30 on. `times` is the loaded bars' own, ascending. A day with no
 * bars falls through to the next loaded one; no bars at all, or none on or
 * after that day, leaves the instant as it was.
 */
export function wholeDayFrom(from: number, times: readonly number[], zone: string | undefined): number {
  return firstBarOnOrAfter(isoDay(from * 1000, zone), times, zone) ?? from;
}

/**
 * The first of `times` (ascending) that falls on `day` (`YYYY-MM-DD`, the
 * exchange's clock) or later, undefined when none does.
 */
export function firstBarOnOrAfter(day: string, times: readonly number[], zone: string | undefined): number | undefined {
  // Binary search, not a scan: `isoDay` formats through Intl, and a month of
  // 1m bars is twenty thousand of them.
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (isoDay(times[mid] * 1000, zone) < day) lo = mid + 1; else hi = mid;
  }
  return times[lo];
}

/**
 * The window an EODHD chart bounds its requests with (v12.3.1 addendum):
 * the last five calendar days for an intraday interval and a year for a daily
 * one, today as the end. A range facet is a zoom and never changes the end;
 * it only moves the start earlier when the zoom reaches back past the default.
 *
 * Unbounded, the live-grid's `/series` falls back to a 365-day window and
 * EODHD answers a 1m ask with a 400, so the client always says how much it
 * wants. Both `/series` and the studies socket are handed this pair.
 *
 * The card's own `start`/`end` parameters outrank this and are applied by
 * the caller: they are the card's, not the chart view's.
 */
export function barsWindow(
  range: ChartRange | undefined,
  interval: string,
  now: Date = new Date(),
  calendar: ExchangeCalendar | null = null,
  // The card's session, for a range end using `@SOD`/`@EOD` (2026-09-29). This
  // was the one resolveRange caller passing no window at all, so a Custom range
  // the popover accepted would still have been refused here, and the FETCH
  // would have fallen back to the default five days.
  window: ChartWindow = {},
  // The card's own `end` (an ISO day), when it has one: the window's real last
  // day, which the bar budget counts back from instead of today.
  endDay?: string,
): { start: string; end: string; clippedTo?: string } {
  const zone = calendar?.timezone;
  const seconds = parseIntervalSeconds(interval);
  const days = seconds !== null && seconds < DAY_MS / 1000 ? 5 : 365;
  const today = isoDay(now.getTime(), zone);
  // A card end past today holds no bars to count: the budget counts from today then.
  const end = endDay !== undefined && endDay < today ? endDay : today;
  const dflt = { start: isoDay(now.getTime() - days * DAY_MS, zone), end };
  const resolved = range === undefined ? null : resolveRange(range, now, calendar, window);
  if (resolved === null) return dflt;
  // A range is a ZOOM (user ruling 2026-10-21): it never moves the END, so the
  // last bar and the studies' latest values are the unranged card's. It may
  // only move the START earlier, just far enough that the zoom has bars to
  // show -- never later, never shorter than the default. ISO days compare
  // lexicographically.
  const from = isoDay(resolved.from * 1000, zone);
  if (from >= dflt.start) return dflt;
  // ... but only until the window holds the bar budget (RANGE_BAR_BUDGET):
  // the limit is never later than the default start, so the default window is
  // always kept, and a start that had to be clipped says where (`clippedTo`).
  // A label that is not an interval widens nothing.
  if (seconds === null) return dflt;
  const session = window.session ?? "extended";
  const sessions = budgetSessions(seconds, /[wM]$/.exec(interval)?.[0] ?? "", session);
  // A window of N calendar days holds at most N sessions, so one that short
  // cannot exceed the budget: skip the calendar walk (a daily range is up to
  // 20,000 sessions). Counted in dates, as the limit below is.
  if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1 <= sessions) return { start: from, end };
  const limit = earliestStart(sessions, session, end, calendar);
  if (from >= limit) return { start: from, end };
  const start = limit < dflt.start ? limit : dflt.start;
  return { start, end, clippedTo: start };
}

/**
 * v12.4.2: how many weekdays the card ASKED `/series` for, so the status bar
 * can tell a fully-vaulted window (every weekday came back tagged
 * `vault_days`) from one the vault only partly covered. Counted Monday
 * through Friday from `start` through the day BEFORE `today` -- the vault
 * never carries today's still-forming session -- on the viewer's own local
 * calendar, the same clock the rest of this file's callers read `now` on.
 * Not the exchange calendar: a holiday the exchange sits out still asked
 * EODHD for a bar, and the vault answering nothing for it is a REFUSAL, not
 * a day that was never asked.
 *
 * Final whole-branch review, B4: `start` is `barsWindow`'s own `start`
 * string, which reads the EXCHANGE's zone (`isoDay` with the card's
 * calendar), not the viewer's -- so a viewer sitting east of the exchange
 * can count one weekday FEWER here than the card actually asked for. That
 * only ever undercounts: `barsSource`'s comparison then reads a fully
 * vaulted window as partial and reports `"mixed"`, never a wrong `"vault"`
 * for a window the vault did not fully cover.
 */
export function weekdaysBefore(start: string, today: Date): number {
  const [y, m, d] = start.slice(0, 10).split("-").map(Number);
  let cursor = new Date(y, m - 1, d);
  // A `start` that doesn't parse (empty, malformed) asked for nothing --
  // `barsSource` reads a `0` the same way it reads any window the vault
  // hasn't covered at all, rather than this having to invent a date.
  if (Number.isNaN(cursor.getTime())) return 0;
  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  let count = 0;
  while (cursor <= last) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return count;
}
