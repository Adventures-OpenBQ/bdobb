// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { CalendarDate, parseTime, toCalendarDateTime, toZoned, type ZonedDateTime } from "@internationalized/date";
import nyse from "./nyse-calendar.json";
import { isRecord } from "./isRecord";
import { logOnce } from "./logger";

/**
 * A trading calendar as the resolver reads it: the addendum's
 * `ExchangeCalendar` (docs/specs/v5.3.0-addendum-trading-calendar.md §3),
 * normalised from the EODHD v2 shape whether it came from the card's backend,
 * from the bundled NYSE file, or was synthesised from the weekday table. The
 * resolver never sees which — except through `source`, which is what the ⚠
 * badge reads — so one set of helpers (Task 2) serves every path.
 *
 * `years` names the years whose holidays are actually loaded. A date outside
 * them is answered weekday-only and flagged, so a calendar is never silently
 * trusted past the data it holds.
 */
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type HolidayType = "Official" | "Bank" | "EarlyClose";
export type HolidayEntry = { holiday: string; type: HolidayType; earlyClose?: string };
export type CalendarSource = "backend" | "bundled" | "weekdays";
export type ExchangeCalendar = {
  code: string;
  name: string;
  timezone: string;
  session: {
    open: string;
    close: string;
    workingDays: Weekday[];
    preMarket?: { open: string; close: string };
    afterHours?: { open: string; close: string };
    /** Kept for completeness (XTKS, XHKG); no anchor reads it. */
    lunchBreak?: { start: string; end: string };
  };
  holidays: Record<string, HolidayEntry>;
  years: number[];
  source: CalendarSource;
};

export type ExchangeHours = { name: string; timezone: string; open: string; close: string };

/**
 * The six MICs the design names, with their regular hours and zones. The
 * weekday fallback is built from this; anything else uses XNYS hours in
 * America/New_York, under its own code, so an unknown MIC still resolves.
 */
export const EXCHANGE_HOURS: Record<string, ExchangeHours> = {
  XNYS: { name: "New York Stock Exchange", timezone: "America/New_York", open: "09:30:00", close: "16:00:00" },
  XLON: { name: "London Stock Exchange", timezone: "Europe/London", open: "08:00:00", close: "16:30:00" },
  XTSE: { name: "Toronto Stock Exchange", timezone: "America/Toronto", open: "09:30:00", close: "16:00:00" },
  XETR: { name: "Xetra", timezone: "Europe/Berlin", open: "09:00:00", close: "17:30:00" },
  XTKS: { name: "Tokyo Stock Exchange", timezone: "Asia/Tokyo", open: "09:00:00", close: "15:30:00" },
  XHKG: { name: "Hong Kong Stock Exchange", timezone: "Asia/Hong_Kong", open: "09:30:00", close: "16:00:00" },
};

export const DEFAULT_EXCHANGE = "XNYS";

/** Years outside this range are never requested from a backend (spec §2). */
export const CALENDAR_YEAR_MIN = 1990;
export const CALENDAR_YEAR_MAX = 2040;

/** The years the bundled NYSE file covers. */
export const BUNDLED_YEARS: readonly number[] = [2026, 2027, 2028];

export function inCalendarRange(year: number): boolean {
  return year >= CALENDAR_YEAR_MIN && year <= CALENDAR_YEAR_MAX;
}

/** The param's own exchange, else the widget's, else XNYS (spec §2). */
// v5.4.0 (spec §5): the dashboard's exchange sits between the widget's and
// XNYS. Every caller passes it — wireParams from WireContext.exchange,
// useTradingCalendar and ParamControls from the dashboard.
export function exchangeOf(
  widget: { exchange?: string } | undefined,
  param: { exchange?: string } | undefined,
  dashboard?: string,
): string {
  return param?.exchange ?? widget?.exchange ?? dashboard ?? DEFAULT_EXCHANGE;
}

/**
 * v5.4.0: a dashboard's stored exchange, read leniently like its presets —
 * one of the six MICs the rail menu offers, or nothing. `Object.hasOwn`, not
 * `in`, so `constructor` is no exchange.
 */
export function parseExchange(value: unknown): string | undefined {
  return typeof value === "string" && Object.hasOwn(EXCHANGE_HOURS, value) ? value : undefined;
}

const WEEKDAYS: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON_TO_FRI: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TIME = /^\d{2}:\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const timeOf = (value: unknown): string | undefined =>
  typeof value === "string" && TIME.test(value) ? value : undefined;

/**
 * "Mon, Tue, …" or "Mon,Tue,…": EODHD is inconsistent about the spaces, so
 * the split trims. A value that names no weekday at all is unreadable and
 * falls back to Monday–Friday rather than to an exchange that never opens.
 */
function parseWorkingDays(value: unknown): Weekday[] {
  if (typeof value !== "string") return [...MON_TO_FRI];
  const days = value
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));
  return days.length > 0 ? days : [...MON_TO_FRI];
}

/**
 * The EODHD v2 envelope (`{ data: { Timezone, TradingHours, ExchangeHolidays } }`)
 * as an ExchangeCalendar, or null when it cannot be one: no zone or no
 * regular hours means nothing can be resolved from it, and the loader falls
 * through to the next source. `code` is the MIC the CALLER asked for, never
 * the payload's `Code` ("US" in the fixture): the calendar is filed under the
 * question, not the answer.
 *
 * Holidays are keyed and sorted by ISO date; an entry with no name, an
 * unknown type or a non-date key is dropped. An EarlyClose with no time is
 * the one case the addendum says to surface rather than swallow: it is
 * dropped — the day is then a regular session — and named once in the log.
 */
export function normalizeCalendar(
  raw: unknown,
  code: string,
  years: readonly number[],
  source: CalendarSource,
): ExchangeCalendar | null {
  const data = isRecord(raw) ? raw.data : undefined;
  if (!isRecord(data) || typeof data.Timezone !== "string") return null;
  const hours = isRecord(data.TradingHours) ? data.TradingHours : undefined;
  const open = timeOf(hours?.Open);
  const close = timeOf(hours?.Close);
  if (!hours || !open || !close) return null;

  const session: ExchangeCalendar["session"] = { open, close, workingDays: parseWorkingDays(hours.WorkingDays) };
  const preOpen = timeOf(hours.PreMarketOpen);
  const preClose = timeOf(hours.PreMarketClose);
  if (preOpen && preClose) session.preMarket = { open: preOpen, close: preClose };
  const afterOpen = timeOf(hours.AfterHoursOpen);
  const afterClose = timeOf(hours.AfterHoursClose);
  if (afterOpen && afterClose) session.afterHours = { open: afterOpen, close: afterClose };
  const lunchStart = timeOf(hours.LunchBreakStart);
  const lunchEnd = timeOf(hours.LunchBreakEnd);
  if (lunchStart && lunchEnd) session.lunchBreak = { start: lunchStart, end: lunchEnd };

  const holidays: Record<string, HolidayEntry> = {};
  const list = isRecord(data.ExchangeHolidays) ? data.ExchangeHolidays : {};
  for (const date of Object.keys(list).sort()) {
    if (!DATE.test(date)) continue;
    const entry = list[date];
    if (!isRecord(entry) || typeof entry.Holiday !== "string") continue;
    const type = entry.Type;
    if (type !== "Official" && type !== "Bank" && type !== "EarlyClose") continue;
    if (type === "EarlyClose") {
      const earlyClose = timeOf(entry.EarlyClose);
      if (!earlyClose) {
        void logOnce(
          `calendar-early-close:${code}:${date}`,
          `calendar ${code}: ${date} is EarlyClose with no time; treated as a regular session`,
        );
        continue;
      }
      holidays[date] = { holiday: entry.Holiday, type, earlyClose };
      continue;
    }
    holidays[date] = { holiday: entry.Holiday, type };
  }

  return {
    code,
    name: typeof data.Name === "string" ? data.Name : code,
    timezone: data.Timezone,
    session,
    holidays,
    years: [...years].sort((a, b) => a - b),
    source,
  };
}

/**
 * Step 4 of the loader (spec §2): no holidays, the MIC's regular hours and
 * zone, Monday–Friday. `years` is empty, so every date consulted on it is
 * flagged as a fallback (Task 2's trace).
 */
export function weekdayCalendar(code: string): ExchangeCalendar {
  const hours = EXCHANGE_HOURS[code] ?? EXCHANGE_HOURS[DEFAULT_EXCHANGE];
  return {
    code,
    name: hours.name,
    timezone: hours.timezone,
    session: { open: hours.open, close: hours.close, workingDays: [...MON_TO_FRI] },
    holidays: {},
    years: [],
    source: "weekdays",
  };
}

/**
 * Step 3 of the loader: the NYSE file, imported at build time so the app
 * carries it whatever the backend serves. Bundled for XNYS only — the
 * addendum's §6 explains why no other venue gets a hand-transcribed file.
 */
export function bundledCalendar(code: string): ExchangeCalendar | null {
  return code === DEFAULT_EXCHANGE ? normalizeCalendar(nyse, code, BUNDLED_YEARS, "bundled") : null;
}

/** Two years of one exchange as one calendar; `base` keeps its hours and zone. */
export function mergeCalendars(base: ExchangeCalendar, more: ExchangeCalendar): ExchangeCalendar {
  return {
    ...base,
    holidays: { ...base.holidays, ...more.holidays },
    years: [...new Set([...base.years, ...more.years])].sort((a, b) => a - b),
  };
}

/**
 * What one resolution consulted. `years` is every calendar year any helper
 * below looked at — useTradingCalendar fetches the ones its calendar does
 * not hold yet. `fallback` is set the moment an answer came from anything
 * but the card's own backend for a year it holds, and `reason` keeps the
 * FIRST such cause, which is what the ⚠ badge's tooltip shows.
 */
export type CalendarTrace = { years: Set<number>; fallback: boolean; reason?: string };

export const newTrace = (): CalendarTrace => ({ years: new Set(), fallback: false });

function consult(cal: ExchangeCalendar, date: CalendarDate, trace: CalendarTrace | undefined): void {
  if (!trace) return;
  trace.years.add(date.year);
  if (cal.source === "weekdays") {
    trace.fallback = true;
    trace.reason ??= `No trading calendar for ${cal.code} on this backend; weekdays only`;
    return;
  }
  if (cal.source === "bundled") {
    trace.fallback = true;
    trace.reason ??= `No trading calendar for ${cal.code} on this backend; using the bundled NYSE calendar`;
  }
  if (!cal.years.includes(date.year)) {
    trace.fallback = true;
    trace.reason ??= inCalendarRange(date.year)
      ? `No ${cal.code} calendar for ${date.year}; weekdays assumed`
      : `${cal.code} calendars cover ${CALENDAR_YEAR_MIN}–${CALENDAR_YEAR_MAX}; weekdays assumed for ${date.year}`;
  }
}

/** Monday first, as WEEKDAYS is ordered; getUTCDay() counts from Sunday. */
const weekdayOf = (date: CalendarDate): Weekday => WEEKDAYS[(date.toDate("UTC").getUTCDay() + 6) % 7];

/**
 * Open means a working weekday that is not an Official closure. An
 * EarlyClose day is open (it closes early); a Bank day is open too — the
 * addendum is explicit that a bank holiday is not a market closure for US
 * equities and must not be conflated with Official.
 */
export function isOpen(cal: ExchangeCalendar, date: CalendarDate, trace?: CalendarTrace): boolean {
  consult(cal, date, trace);
  if (!cal.session.workingDays.includes(weekdayOf(date))) return false;
  const entry = cal.holidays[date.toString()];
  return entry === undefined || entry.type !== "Official";
}

export function isEarlyClose(cal: ExchangeCalendar, date: CalendarDate): boolean {
  return cal.holidays[date.toString()]?.type === "EarlyClose";
}

/** A wall-clock time on `date` in the exchange's own zone, as an instant. */
const atTime = (cal: ExchangeCalendar, date: CalendarDate, time: string): ZonedDateTime =>
  toZoned(toCalendarDateTime(date, parseTime(time)), cal.timezone);

export function sessionOpen(cal: ExchangeCalendar, date: CalendarDate): ZonedDateTime {
  return atTime(cal, date, cal.session.open);
}

export function sessionClose(cal: ExchangeCalendar, date: CalendarDate): ZonedDateTime {
  const entry = cal.holidays[date.toString()];
  const time = entry?.type === "EarlyClose" && entry.earlyClose ? entry.earlyClose : cal.session.close;
  return atTime(cal, date, time);
}

/**
 * The loops below terminate because parseWorkingDays never yields an empty
 * list and holidays are finite: at most a week of weekend plus a handful of
 * closures separates two open days on any real exchange.
 */
export function nextOpen(cal: ExchangeCalendar, date: CalendarDate, trace?: CalendarTrace): CalendarDate {
  let d = date;
  while (!isOpen(cal, d, trace)) d = d.add({ days: 1 });
  return d;
}

export function prevOpen(cal: ExchangeCalendar, date: CalendarDate, trace?: CalendarTrace): CalendarDate {
  let d = date;
  while (!isOpen(cal, d, trace)) d = d.subtract({ days: 1 });
  return d;
}

/**
 * Open days strictly between `from` and `to` in the `step` direction,
 * counted without testing each day. Working weekdays come from the week
 * arithmetic: the calendar distance in days contains floor(days/7) full
 * working weeks, and the remainder — at most six days — is walked
 * directly. Official closures inside the window come from the holiday
 * table itself, so that loop runs over holiday entries (a few hundred
 * across a merged calendar), never over window days. Weekday-only and
 * coverage-gap years have no holiday entries, which matches consult()'s
 * "weekdays assumed" semantics for those dates.
 */
function openDaysWindow(
  cal: ExchangeCalendar,
  from: CalendarDate,
  to: CalendarDate,
  step: 1 | -1,
  trace: CalendarTrace | undefined,
): number {
  const days = Math.abs(Math.round(
    (to.toDate("UTC").getTime() - from.toDate("UTC").getTime()) / 86400000,
  ));
  consult(cal, from, trace);
  consult(cal, to, trace);
  const working = cal.session.workingDays;
  const weeks = Math.floor(days / 7);
  let remainderOpen = 0;
  {
    let d = from;
    for (let i = weeks * 7; i < days; i += 1) {
      d = d.add({ days: step });
      if (working.includes(weekdayOf(d))) remainderOpen += 1;
    }
  }
  // Days walked are (from, to] going forward and [to, from) going backward;
  // the entry range mirrors whichever half-open window the direction implies.
  const lo = step === 1 ? from.toString() : to.toString();
  const hi = step === 1 ? to.toString() : from.toString();
  let closures = 0;
  for (const key of Object.keys(cal.holidays)) {
    if (step === 1 ? key <= lo || key > hi : key < lo || key >= hi) continue;
    if (cal.holidays[key].type !== "Official") continue;
    const d = new CalendarDate(+key.slice(0, 4), +key.slice(5, 7), +key.slice(8, 10));
    if (working.includes(weekdayOf(d))) closures += 1;
  }
  return Math.max(weeks * working.length + remainderOpen - closures, 0);
}

/**
 * The `bd` unit: n open days forward or back from `at`, counted on the
 * calendar, with `at`'s own time of day kept. Stepping is done on the
 * instant's OWN date (its zone), not the exchange's: `T-5bd` on a London
 * user's `T` steps London dates. `set` re-resolves the wall time on the new
 * date, which is what a calendar step means.
 *
 * Estimate-then-adjust, not a day-by-day walk. `T-50bd` is ten trading
 * weeks, so the estimate is 50 + 2·floor(50/5) = 70 calendar days back;
 * the holidays in that window are then counted in ONE pass, the end is
 * extended by the closure count, and only the delta is re-walked — each
 * added day tested for open/closed until the count is exact. The old
 * implementation tested every single day through isOpen, which is why the
 * 4-digit `bd` cap existed: `T-999999bd` walked a million days (~1.4 s).
 * The scales are the result of the adjust loop, which ends when the open
 * tally equals |n| exactly; the digit caps stay as parse-time input bounds.
 */
export function addBusinessDays(
  cal: ExchangeCalendar,
  at: ZonedDateTime,
  n: number,
  trace?: CalendarTrace,
): ZonedDateTime {
  if (n === 0) return at;
  const step = n < 0 ? -1 : 1;
  const total = Math.abs(n);
  const start = new CalendarDate(at.year, at.month, at.day);

  // Estimate assuming a working week with no closures: every full five
  // business days costs two weekend days. The remainder needs no correction
  // here — the count pass below measures the actual window.
  const estimate = total + 2 * Math.floor(total / 5);
  let end = start.add({ days: step * estimate });

  // ONE consultation of the holiday calendar for the window, done
  // arithmetically: working weekdays are counted from the week length and
  // Official closures from the holiday table's range, so the cost scales
  // with the holiday entries — not with the window's days. (The naive form
  // of this walk calls isOpen once per day and is what made T-999999bd
  // take ~1.4 s.)
  let open = openDaysWindow(cal, start, end, step, trace);

  // Adjust only the delta: holidays push the target further out, so walk
  // just the extension each added day is tested until the tally is exact.
  // Over-estimates (open > total) cannot occur — the estimate counts no
  // closures — but the guard keeps the loop honest if a future calendar
  // ever marks a weekend as open.
  while (open < total) {
    end = end.add({ days: step });
    if (isOpen(cal, end, trace)) open += 1;
  }
  while (open > total) {
    if (isOpen(cal, end, trace)) open -= 1;
    end = end.subtract({ days: step });
  }

  // The tally being exact does not make `end` itself a session. Neither
  // correction loop runs when the estimated window already holds exactly
  // `total` open days, and the estimate is plain arithmetic -- five business
  // days is seven calendar ones -- so it lands wherever it lands. From a
  // CLOSED start that is routinely a weekend: Saturday 2026-09-19 with
  // n = -5 estimates Saturday 2026-09-12, whose window does hold exactly
  // five sessions, and a Saturday was returned as a business-day answer.
  //
  // Walking back AGAINST the direction of travel fixes it without changing
  // the count: the days skipped are closed ones, which were never in the
  // tally, so the first open day reached is still the `total`-th session
  // from the start. Terminates for the same reason nextOpen does -- working
  // days are never empty and holidays are finite.
  while (!isOpen(cal, end, trace)) end = end.subtract({ days: step });

  return at.set({ year: end.year, month: end.month, day: end.day });
}
