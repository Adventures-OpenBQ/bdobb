// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { CalendarDate } from "@internationalized/date";
import { sessionClose, sessionOpen, type ExchangeCalendar } from "../tradingCalendar";
import type { CatalogEntry } from "./studyExpression";
import type { Series } from "../types";

/**
 * Study warm-up (owner report, 2026-09-27): on an EODHD chart the studies
 * socket was handed the SAME `start`/`end` as `/series`, so a study's earliest
 * points were computed from a sample that begins at the window's own first bar
 * -- an `SMA(200)` on a five-day 1m window starts as the average of 1, 2, 3 …
 * bars, which swings wildly before it settles (the wild excursion at the left
 * edge of BTC-USD). The fix is to ask the study socket for extra bars of
 * history BEFORE the visible window, so the first VISIBLE point already has a
 * full look-back behind it. The candles stay in the user's window; the study
 * points that land before the first candle simply fall outside the visible
 * range the chart already bounds, so there is nothing to clip.
 *
 * The owner asked that this stay "a one time call, since that data wont tick":
 * the padded start is derived ONLY from the resolved window start, the interval
 * and the card's studies -- never from `now` or a tick -- so the socket URL
 * does not churn and refetch on every render.
 *
 * How many bars of warm-up the card's studies need (`warmupBars`):
 *
 * - Per study, SUM its window values, do NOT take their max. MACD's signal EMA
 *   runs ON the MACD line, so its warm-up is slow + signal, not
 *   max(slow, signal). Summing is exactly right for that chained case and
 *   merely generous for a parallel one (BBANDS' single window) -- and
 *   over-fetching a few bars once is cheap, while under-fetching is the bug
 *   being fixed.
 * - Across studies, take the MAX of those per-study sums: one request has to
 *   satisfy the hungriest study on the card.
 * - Which params are look-back windows is the registry's to say, not ours:
 *   `CatalogEntry.windows` names them (`macd` -> `["fast", "slow", "signal"]`).
 *   We never guess at names like "period" or "length".
 * - A window value may be a `bd` business-day string ("50bd") rather than a
 *   number -- read its leading integer, and ignore anything unparseable rather
 *   than throwing.
 * - A non-study series contributes nothing. A study the registry does not
 *   carry contributes nothing either: it cannot be computed at all.
 * - Zero studies, or studies with no windows, means ZERO extra bars -- the
 *   padding disappears entirely rather than always adding a constant.
 */

/**
 * How much history one window length is padded to. An EMA is not converged
 * after a single window length -- three of them is the usual rule of thumb, so
 * a converged first visible point wants roughly three windows behind it. This
 * is a heuristic, not an exact figure; raise it if a study still swings at the
 * left edge, lower it to fetch fewer bars.
 */
const WARMUP_FACTOR = 3;

/** The leading integer of a window value (number, or a `bd` string), else null. */
function windowInteger(value: number | string | undefined): number | null {
  const n = parseInt(String(value), 10);
  return Number.isNaN(n) ? null : n;
}

export function warmupBars(
  series: readonly Series[],
  lookup: (name: string) => CatalogEntry | undefined,
): number {
  let max = 0;
  for (const s of series) {
    if (s.type !== "study" || s.name === undefined) continue;
    const entry = lookup(s.name);
    if (entry === undefined) continue;                 // uncomputable -> contributes nothing
    let sum = 0;
    for (const name of entry.windows) {
      const n = windowInteger(s.params[name]);
      if (n !== null) sum += n;
    }
    if (sum > max) max = sum;
  }
  // max === 0 (no studies, or none with a readable window) folds through to 0.
  return max * WARMUP_FACTOR;
}

// Mirrors ArtsChartsRenderer's `secondsOf` (the renderer turns an interval into
// seconds the same way): a count and a unit. Every label the package speaks is
// read: the wire's `5m`/`1h`/`1w`, the month `1M`, and the displayed `90min`.
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, min: 60, h: 3600, d: 86400, w: 604800, M: 30 * 86400 };
/** An interval label's bar length in seconds, null when it is not one (window.ts reads that as "do not widen"). */
export function parseIntervalSeconds(interval: string): number | null {
  const match = /^(\d+)(s|min|m|h|d|w|M)$/.exec(interval);
  return match === null || Number(match[1]) === 0 ? null : Number(match[1]) * UNIT_SECONDS[match[2]];
}
function intervalSeconds(interval: string): number {
  return parseIntervalSeconds(interval) ?? 60;
}
/** Intraday is anything shorter than a day; a daily-or-longer bar counts as one bar per day in `barsPerDay`, and `sessionsPerBar` widens it for weeks and months. */
const INTRADAY = /^\d+[smh]$/;

/**
 * Sessions one daily-or-longer bar spans: `nd` n, `nw` 5n, `nM` 21n -- the counts the
 * range cap uses (window.ts `budgetSessions`). An intraday or unread label is 1.
 */
const SESSIONS_PER_UNIT: Record<string, number> = { d: 1, w: 5, M: 21 };
function sessionsPerBar(interval: string): number {
  const match = /^(\d+)(d|w|M)$/.exec(interval);
  return match === null ? 1 : Number(match[1]) * SESSIONS_PER_UNIT[match[2]];
}

/**
 * A calendar-less symbol (crypto, forex, anything unclassified) is padded as if
 * it traded a SHORT 6.5h session rather than around the clock. Fewer bars per
 * day means MORE days of padding, which over-fetches -- and over-fetching is
 * safe. Assuming a 24h session would compute the fewest days and so UNDER-fetch
 * on an equity, reintroducing the very bug this fixes. This is the one place
 * the safe direction is not obvious.
 */
const NO_CALENDAR_SESSION_SECONDS = 6.5 * 3600;

/** A couple of days of slack over the 7/5 weekday estimate, for holidays. Over-fetching is safe. */
const HOLIDAY_SLACK_DAYS = 2;

const DAY_MS = 86_400_000;

/** The session length (seconds) on `start`'s own date, from the exchange calendar's hours. */
function sessionSecondsOf(start: string, calendar: ExchangeCalendar): number {
  const [y, m, d] = start.split("-").map(Number);
  const date = new CalendarDate(y, m, d);
  return (sessionClose(calendar, date).toDate().getTime() - sessionOpen(calendar, date).toDate().getTime()) / 1000;
}

/**
 * Move an ISO `YYYY-MM-DD` day (the shape `barsWindow` returns) earlier by
 * enough calendar days to cover `bars` bars of warm-up, and return the same
 * shape. `bars === 0` returns `start` unchanged, byte for byte.
 *
 * Bars per trading day: for an intraday interval, the session's length over the
 * interval's; a daily-or-longer bar instead spans `sessionsPerBar` trading days.
 * Trading days convert to calendar
 * days at 7/5 (rounded up) plus a little holiday slack. The arithmetic is a
 * pure date shift in UTC -- it never reads `now` -- so the same window always
 * pads to the same start.
 */
export function padStart(
  start: string,
  bars: number,
  interval: string,
  calendar: ExchangeCalendar | null,
): string {
  if (bars === 0) return start;
  const sessionSeconds = calendar === null ? NO_CALENDAR_SESSION_SECONDS : sessionSecondsOf(start, calendar);
  // A daily-or-longer bar counts as one bar per day in `barsPerDay`, and `sessionsPerBar`
  // widens it for weeks and months; an intraday one, however many fit the session. `Math.max(1, …)` guards the divide-by-zero a sub-session
  // count would cause (a 4h bar on a 6.5h session is still one bar a day here).
  const barsPerDay = INTRADAY.test(interval) ? Math.max(1, Math.floor(sessionSeconds / intervalSeconds(interval))) : 1;
  const tradingDays = Math.ceil(bars / barsPerDay) * sessionsPerBar(interval);
  const calendarDays = Math.ceil((tradingDays * 7) / 5) + HOLIDAY_SLACK_DAYS;
  const [y, m, d] = start.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) - calendarDays * DAY_MS);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
