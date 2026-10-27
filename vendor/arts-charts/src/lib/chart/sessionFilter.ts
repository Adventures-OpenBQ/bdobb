// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { CalendarDate, fromDate } from "@internationalized/date";
import { isOpen, sessionClose, sessionOpen, type ExchangeCalendar } from "../tradingCalendar";

const seconds = (at: { toDate(): Date }): number => Math.floor(at.toDate().getTime() / 1000);

/**
 * The bars of `candles` inside the calendar's regular session on their own
 * exchange-local day (session addendum §4.4). A bar is in session when
 * open <= time < close for that day, with the calendar's early close
 * shortening `close` (sessionClose reads the bundled file) and a day the
 * exchange is not open at all -- a weekend, a holiday -- dropping every bar.
 *
 * Regular FILTERS rather than dims (user ruling 2026-09-24, reversing the
 * addendum's "dims, never deletes"): the series are fed only these bars, so
 * the time scale is built without the extended hours and the axis redraws
 * without them, instead of a veil painted over bars that stay on the scale.
 *
 * ponytail: an early close shortens the filter here but the server still
 * fills the shortened hour with regular-session bars, so on 2026-11-27 the
 * chart drops 13:00-16:00 while the studies still include those bars.
 * Upgrade path: the server reads the same calendar file.
 */
export function sessionBars<T extends { time: number }>(candles: readonly T[], cal: ExchangeCalendar): T[] {
  // Session bounds per exchange-local date, memoised: a day of 1m bars would
  // otherwise ask for the same two instants 960 times.
  const bounds = new Map<string, { open: number; close: number } | null>();
  const inSession = (time: number): boolean => {
    const local = fromDate(new Date(time * 1000), cal.timezone);
    const date = new CalendarDate(local.year, local.month, local.day);
    const key = date.toString();
    let day = bounds.get(key);
    if (day === undefined) {
      day = isOpen(cal, date) ? { open: seconds(sessionOpen(cal, date)), close: seconds(sessionClose(cal, date)) } : null;
      bounds.set(key, day);
    }
    return day !== null && time >= day.open && time < day.close;
  };
  return candles.filter((c) => inSession(c.time));
}
