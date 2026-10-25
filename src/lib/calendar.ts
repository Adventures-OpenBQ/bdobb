// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { CalendarDate, parseDate, parseAbsolute, parseTime, toCalendarDateTime, toZoned, type ZonedDateTime } from "@internationalized/date";
import { CalendarError, bundleRevision, type CalendarBinding, type Policy } from "./calendars/contracts";
import {dayState,shiftSessionDate,rollSessionDate,sessionBounds,type CalendarIndex,type Outcome} from './calendars/operations';
import { CATALOGUE, calendarEntry, calendarSpelling } from "./calendars/catalogue";
import nyse from "../../docs/data/nyse-calendar.json";
import { isRecord } from "./isRecord";
import { logOnce } from "./logger";
import { isoWeekday } from "./periods";

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
  sessionIndex?: CalendarIndex;
  calendarPolicy?: Policy;
  calendarUse?: {provisional:boolean; ranges:{start:string;end:string}[]};
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
  /**
   * A placeholder with no calendar behind it -- still loading, or refused -- and why. Any atom that needs a calendar
   * throws this message (dateExpressions.ts), so an opted-in card never falls back to weekdays (review C1).
   */
  unavailable?: string;
};

/** A calendar's regular hours, zone and trading week, as the weekday fallback runs it. */
export type ExchangeHours = { name: string; timezone: string; open: string; close: string; workingDays: Weekday[] };

/**
 * Every calendar openbq-docker serves (spec 2026-10-24: the full exchange_calendars set), with its regular hours, zone
 * and trading week, from the vendored catalogue. The weekday fallback is built from this. A name outside it is unknown:
 * refused at resolution, never run on XNYS hours.
 */
export const EXCHANGE_HOURS: Record<string, ExchangeHours> = Object.fromEntries(
  CATALOGUE.map((e) => [e.mic, { name: e.name, timezone: e.timezone, open: e.open, close: e.close, workingDays: e.workingDays }]),
);

/** A catalogue calendar, in its own spelling. `Object.hasOwn`, not `in`, so `constructor` is no calendar. */
export const isKnownCalendar = (mic: string): boolean => Object.hasOwn(EXCHANGE_HOURS, mic);

export const DEFAULT_EXCHANGE = "XNYS";

/** Years outside this range are never requested from a backend (spec §2). */
export const CALENDAR_YEAR_MIN = 1990;
export const CALENDAR_YEAR_MAX = 2040;

/** The years the bundled NYSE file covers. */
export const BUNDLED_YEARS: readonly number[] = [2026, 2027, 2028];

export function inCalendarRange(year: number): boolean {
  return year >= CALENDAR_YEAR_MIN && year <= CALENDAR_YEAR_MAX;
}

/**
 * A dashboard's stored exchange, read leniently (spec "Dashboard Exchange menu"): a catalogue calendar in its own
 * spelling; any other short name kept, upper-cased like every other source (calendarSpelling), so the menu shows it
 * and its cards say "Unknown calendar" until it is repaired; anything else, nothing.
 */
export function parseExchange(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (name === "" || name.length > 32) return undefined;
  return calendarSpelling(name);
}

/** Symbol suffix -> calendar, EODHD and Yahoo spellings, from the catalogue (spec "Symbol suffixes"). */
const SYMBOL_CALENDARS = new Map(
  CATALOGUE.flatMap((e) => [...e.suffixes.eodhd, ...e.suffixes.yahoo].map((s) => [s, e.mic] as const)),
);

/**
 * The calendar a symbol's last dot-suffix names, or nothing. An unsuffixed symbol (`AAPL`, `T`), crypto, FX and any
 * other suffix infer nothing, and neither does a list (`AAPL,VOD.L`): the spec maps a symbol, not a basket.
 */
export function symbolCalendar(symbol: string): string | undefined {
  const s = symbol.trim();
  if (s === "" || /[,\s]/.test(s)) return undefined;
  const dot = s.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const suffix = s.slice(dot + 1).toUpperCase();
  return SYMBOL_CALENDARS.get(suffix);
}

/** Which precedence step chose a field's calendar (spec "Which calendar a field uses"). */
export type CalendarFrom = "expression" | "symbol" | "param" | "widget" | "dashboard" | "default";
/** A field's calendar key and where it came from; `symbol` is set when step 2 chose it. */
export type CalendarChoice = { mic: string; from: CalendarFrom; symbol?: string };

/** A single exchange binding is its MIC, so it shares the key every other path uses; any other binding is its JSON. */
export function bindingKey(binding: CalendarBinding): string {
  return binding.kind === "single" && binding.calendarId.startsWith("exchange:")
    ? binding.calendarId.slice("exchange:".length)
    : `binding:${JSON.stringify(binding)}`;
}

/** A calendar key as a person reads it: a MIC, or a binding's calendar or members. */
export function calendarName(id: string): string {
  if (!id.startsWith("binding:")) return id;
  try {
    const b = JSON.parse(id.slice("binding:".length)) as { calendarId?: string; members?: string[] };
    return b.members?.join("+") ?? b.calendarId ?? id;
  } catch {
    return id;
  }
}

/**
 * Spec precedence steps 2-6 for one field: the card's `symbol` parameter by suffix, the parameter's exchange, the
 * widget's calendarBinding then its exchange, the dashboard's exchange, XNYS. Step 1, an atom's own `(MIC)`, is the
 * resolver's (dateExpressions.ts), since one value's two atoms may name different calendars. Every path resolves one field the same way.
 */
export function calendarOf(
  widget: { exchange?: string; calendarBinding?: CalendarBinding; params?: readonly { paramName: string }[] } | undefined,
  param: { exchange?: string } | undefined,
  dashboard: string | undefined,
  values: Record<string, string> = {},
): CalendarChoice {
  if (widget?.params?.some((p) => p.paramName === "symbol")) {
    const symbol = (values.symbol ?? "").trim();
    const mic = symbolCalendar(symbol);
    if (mic) return { mic, from: "symbol", symbol };
  }
  if (param?.exchange) return { mic: param.exchange, from: "param" };
  if (widget?.calendarBinding) return { mic: bindingKey(widget.calendarBinding), from: "widget" };
  if (widget?.exchange) return { mic: widget.exchange, from: "widget" };
  if (dashboard) return { mic: dashboard, from: "dashboard" };
  return { mic: DEFAULT_EXCHANGE, from: "default" };
}

/** "XLON (from the expression)", "XTKS (from symbol 7203.T)", "Default (XNYS)": the Date expression footer's words. */
export function describeCalendar(choice: CalendarChoice): string {
  const name = calendarName(choice.mic);
  switch (choice.from) {
    case "expression":
      return `${name} (from the expression)`;
    case "symbol":
      return `${name} (from symbol ${choice.symbol})`;
    case "param":
      return `${name} (from the parameter)`;
    case "widget":
      return `${name} (from the widget)`;
    case "dashboard":
      return `${name} (from the dashboard)`;
    case "default":
      return `Default (${name})`;
  }
}

const WEEKDAYS: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON_TO_FRI: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const TIME = /^\d{2}:\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The pattern admits "25:00:00", which parseTime (what atTime calls) throws
// on — later, inside resolveValue, where the RangeError takes every card on
// the MIC to its ErrorBoundary. So parseTime itself is the check, here.
const timeOf = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !TIME.test(value)) return undefined;
  try {
    parseTime(value);
    return value;
  } catch {
    return undefined;
  }
};

/** A zone toZoned can resolve: Intl is what it asks, so Intl is the check. */
function isZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

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
 * regular hours (or ones the date library cannot use: an unknown zone, a
 * 25:00:00 open) means nothing can be resolved from it, and the loader falls
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
  if (!isRecord(data) || !isZone(data.Timezone)) return null;
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
  // Spec: a name outside the catalogue is unknown and never runs on New York's hours.
  if (!isKnownCalendar(code)) throw new CalendarError("UNKNOWN_CALENDAR", `Unknown calendar ${code}`);
  const hours = EXCHANGE_HOURS[code];
  return {
    code,
    name: hours.name,
    timezone: hours.timezone,
    session: { open: hours.open, close: hours.close, workingDays: [...hours.workingDays] },
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
 * FIRST such cause, which is what the ⚠ badge's tooltip shows. `provisional`
 * is set when a planning-v1 answer rested on a provisional calendar day.
 */
export type CalendarTrace = {
  years: Set<number>;
  fallback: boolean;
  reason?: string;
  provisional?: boolean;
  /**
   * The first calendar (and year, when the calendar holds others) the resolution stepped on as plain weekdays. Unlike
   * `fallback` it is not set by the bundled NYSE file inside its years, which holds real closures. A form refuses on it
   * (ruling RF5).
   */
  weekdays?: { calendar: string; year?: number };
};

export const newTrace = (): CalendarTrace => ({ years: new Set(), fallback: false });

/**
 * Every legacy-calendar helper reads a date through here. A date outside the catalogue's bounds for the calendar is
 * refused, with or without a trace (ruling RF6): no calendar covers it, so it is not a year the backend refused, which
 * keeps the weekday table and its ⚠.
 */
function consult(cal: ExchangeCalendar, date: CalendarDate, trace: CalendarTrace | undefined): void {
  const bounds = calendarEntry(cal.code)?.bounds;
  const day = date.toString();
  if (bounds && (day < bounds.start || day > bounds.end)) {
    throw new CalendarError(
      "COVERAGE_UNAVAILABLE",
      `${cal.code} COVERAGE_UNAVAILABLE (coverage ${bounds.start} to ${bounds.end})`,
    );
  }
  if (!trace) return;
  trace.years.add(date.year);
  if (cal.source === "weekdays") {
    trace.fallback = true;
    trace.weekdays ??= { calendar: cal.code };
    trace.reason ??= `No trading calendar for ${cal.code} on this backend; weekdays only`;
    return;
  }
  if (cal.source === "bundled") {
    trace.fallback = true;
    trace.reason ??= `No trading calendar for ${cal.code} on this backend; using the bundled NYSE calendar`;
  }
  if (!cal.years.includes(date.year)) {
    trace.fallback = true;
    trace.weekdays ??= { calendar: cal.code, year: date.year };
    trace.reason ??= `No ${cal.code} calendar for ${date.year}; weekdays assumed`;
  }
}

/** Monday first, as WEEKDAYS is ordered. */
const weekdayOf = (date: CalendarDate): Weekday => WEEKDAYS[isoWeekday(date) - 1];

/**
 * Open means a working weekday that is not an Official closure. An
 * EarlyClose day is open (it closes early); a Bank day is open too — the
 * addendum is explicit that a bank holiday is not a market closure for US
 * equities and must not be conflated with Official.
 */
export function isOpen(cal: ExchangeCalendar, date: CalendarDate, trace?: CalendarTrace): boolean {
  if (cal.sessionIndex)
    return calendarValue(cal, dayState(cal.sessionIndex, date.toString(), cal.calendarPolicy), trace).state === "open";
  consult(cal, date, trace);
  if (!cal.session.workingDays.includes(weekdayOf(date))) return false;
  const entry = cal.holidays[date.toString()];
  return entry === undefined || entry.type !== "Official";
}

/**
 * One retained-bundle operation's answer (PR #67), or a CalendarError that names the calendar, its revision and its
 * coverage, so the card can say why it has none (review I7). A provisional answer -- planning-v1 only -- marks the
 * trace; that flag is what the card's Provisional badge reads.
 */
export function calendarValue<T>(cal: ExchangeCalendar, result: Outcome<T>, trace?: CalendarTrace): T {
  if (result.status === "unavailable") {
    const bundle = cal.sessionIndex?.bundle;
    const detail = bundle
      ? ` (revision ${bundleRevision(bundle)}, coverage ${bundle.coverage.start} to ${bundle.coverage.end})`
      : "";
    throw new CalendarError(result.reason, `${cal.code} ${result.reason}${detail}`);
  }
  if (cal.calendarUse) {
    cal.calendarUse.ranges.push(result.consulted);
    if (result.status === "provisional") cal.calendarUse.provisional = true;
  }
  if (result.status === "provisional" && trace) trace.provisional = true;
  return result.value;
}

/** A wall-clock time on `date` in the exchange's own zone, as an instant. */
const atTime = (cal: ExchangeCalendar, date: CalendarDate, time: string): ZonedDateTime =>
  toZoned(toCalendarDateTime(date, parseTime(time)), cal.timezone);

/** The instant the session on `date` opens; `trace` receives a provisional mark when a bundle day was provisional. */
export function sessionOpen(cal: ExchangeCalendar, date: CalendarDate, trace?: CalendarTrace): ZonedDateTime {
  if (cal.sessionIndex)
    return parseAbsolute(
      calendarValue(cal, sessionBounds(cal.sessionIndex, date.toString(), cal.calendarPolicy), trace).open,
      cal.timezone,
    );
  return atTime(cal, date, cal.session.open);
}

/** The instant the session on `date` closes (early closes kept); `trace` as for sessionOpen. */
export function sessionClose(cal: ExchangeCalendar, date: CalendarDate, trace?: CalendarTrace): ZonedDateTime {
  if (cal.sessionIndex)
    return parseAbsolute(
      calendarValue(cal, sessionBounds(cal.sessionIndex, date.toString(), cal.calendarPolicy), trace).close,
      cal.timezone,
    );
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
  if (cal.sessionIndex)
    return parseDate(
      calendarValue(cal, rollSessionDate(cal.sessionIndex, date.toString(), "following", cal.calendarPolicy), trace),
    );
  let d = date;
  while (!isOpen(cal, d, trace)) d = d.add({ days: 1 });
  return d;
}

/** The latest open day on or before `date`; the trace is as for nextOpen. */
export function prevOpen(cal: ExchangeCalendar, date: CalendarDate, trace?: CalendarTrace): CalendarDate {
  if (cal.sessionIndex)
    return parseDate(
      calendarValue(cal, rollSessionDate(cal.sessionIndex, date.toString(), "preceding", cal.calendarPolicy), trace),
    );
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
  const days = Math.abs(to.compare(from));
  // Every year the window spans, not just its two ends: T-500bd from October
  // 2026 lands in 2024, and a trace naming only 2024 and 2026 meant
  // useTradingCalendar never fetched 2025, whose closures then went
  // uncounted with no ⚠. consult() reads only the year, so 1 January stands
  // in for the middle ones. The bd digit cap keeps this to ~40 years.
  consult(cal, from, trace);
  for (let y = Math.min(from.year, to.year) + 1; y < Math.max(from.year, to.year); y += 1) {
    consult(cal, new CalendarDate(y, 1, 1), trace);
  }
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
  if (cal.sessionIndex) {
    const label = calendarValue(
      cal,
      shiftSessionDate(cal.sessionIndex, new CalendarDate(at.year, at.month, at.day).toString(), n, cal.calendarPolicy),
      trace,
    );
    if (!n) return at;
    const d=parseDate(label);
    return toZoned(toCalendarDateTime(d,parseTime(`${String(at.hour).padStart(2,'0')}:${String(at.minute).padStart(2,'0')}:${String(at.second).padStart(2,'0')}`)),at.timeZone,cal.calendarPolicy==='legacy-v1'?'compatible':'reject');
  }
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
