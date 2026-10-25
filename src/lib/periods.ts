// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { CalendarDate, endOfMonth } from "@internationalized/date";
import { isRecord } from "./isRecord";

/**
 * Everything a fiscal or ISO period IS, as pure functions over CalendarDate.
 * Nothing here knows about widgets, groups or the wire: paramGroups.ts
 * relabels a group value through `relabel`, dateExpressions.ts projects an
 * instant into a label through `fiscalPeriod` / `isoWeek`, and the pickers
 * draw their grids from the spans. One file, so the three cannot disagree
 * about which months a quarter covers.
 */
export type DateSpan = { start: CalendarDate; end: CalendarDate };
export type FiscalQuarter = { fy: number; q: number };
export type IsoWeek = { year: number; week: number };

// en-US pinned: EODHD sends English month names whatever the user's locale.
export const MONTH_NAMES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleString("en-US", { month: "long" }).toLowerCase(),
);

/** The two param types whose labels depend on a fiscal year end. */
// v5.4.0: and `quarter_range`, whose two halves are quarter labels.
export function isFiscalType(type: string | undefined): boolean {
  return type === "quarter" || type === "fiscal_year" || type === "quarter_range";
}

/**
 * The companion addendum's `_parse_fy_end_month`, with one difference: the
 * fallback to December is the CALLER's last rung (useFiscalYearEnd's
 * precedence), not this function's, because a source that answers something
 * unreadable has to fall through to the next source rather than silently
 * become December. EODHD sends a full month name ("September"); a hand-written
 * manifest may send the number; a three-letter abbreviation costs nothing.
 */
export function parseFyEndMonth(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (text === "") return undefined;
  if (/^\d{1,2}$/.test(text)) return parseFyEndMonth(Number(text));
  const index = MONTH_NAMES.findIndex((m) => m === text || m.slice(0, 3) === text);
  return index === -1 ? undefined : index + 1;
}

/**
 * The three response shapes a `fiscalYearEndEndpoint` may answer with: a
 * number, a month name, or an object carrying either under `fiscalYearEnd`.
 * Anything else is undefined — "no answer" — never a guess.
 */
export function fiscalYearEndOf(payload: unknown): number | undefined {
  if (isRecord(payload)) return parseFyEndMonth(payload.fiscalYearEnd);
  return parseFyEndMonth(payload);
}

/**
 * Verbatim from docs/specs/v5.2.0-addendum-eodhd-fiscal-quarter-alignment.md:
 * the US SEC convention, where a fiscal year is labelled by the calendar year
 * it ENDS in. AAPL (September) reports 2024-12-28 as FY2025-Q1.
 */
export function fiscalPeriod(end: CalendarDate, fyEndMonth: number): FiscalQuarter {
  const fyStartMonth = (fyEndMonth % 12) + 1;
  const monthsSinceStart = (end.month - fyStartMonth + 12) % 12;
  const q = Math.floor(monthsSinceStart / 3) + 1;
  const fy = end.month <= fyEndMonth ? end.year : end.year + 1;
  return { fy, q };
}

/** The year ends on the last day of `fyEndMonth` of `fy` and started a year and a day earlier. */
export function fiscalYearSpan(fy: number, fyEndMonth: number): DateSpan {
  const end = endOfMonth(new CalendarDate(fy, fyEndMonth, 1));
  const start = end.add({ days: 1 }).subtract({ years: 1 });
  return { start, end };
}

/** First day of the quarter's first month to the last day of its third. */
export function quarterSpan({ fy, q }: FiscalQuarter, fyEndMonth: number): DateSpan {
  const start = fiscalYearSpan(fy, fyEndMonth).start.add({ months: (q - 1) * 3 });
  return { start, end: endOfMonth(start.add({ months: 2 })) };
}

const QUARTER = /^(\d{4})-Q([1-4])$/;
const FISCAL_YEAR = /^\d{4}$/;
const WEEK = /^(\d{4})-W(\d{2})$/;

export function formatQuarter({ fy, q }: FiscalQuarter): string {
  return `${fy}-Q${q}`;
}

/**
 * The one display spelling of a fiscal period, for every company and every
 * surface (pickers, pivot and statement headers): `FY2026`, `FY2026-Q3`,
 * `FY2026-TTM` — OpenBB's own label form. Display only: stored values, keys
 * and the wire keep their own spelling. crates/pivot-core's
 * `fiscal_period_label` is its twin.
 */
export function formatFiscalLabel(fy: number, period?: number | "TTM"): string {
  return period === undefined ? `FY${fy}` : `FY${fy}-${period === "TTM" ? "TTM" : `Q${period}`}`;
}

/**
 * OpenBB's label spelling (spec §4.9): `FY2026-Q3` and `FY2026` read as
 * `2026-Q3` and `2026`. Exactly four unsigned digits, so `FY-1` and `FY+2`
 * — the expression shorthand — are never taken for labels. Storage and the
 * wire keep the unprefixed form; this is how a seeded prefixed value gets
 * there.
 */
export function unprefixLabel(value: string): string {
  const m = /^FY(\d{4}(?:-Q[1-4])?)$/.exec(value);
  return m ? m[1] : value;
}

export function parseQuarter(value: string): FiscalQuarter | null {
  const m = QUARTER.exec(unprefixLabel(value));
  return m ? { fy: Number(m[1]), q: Number(m[2]) } : null;
}

export function parseFiscalYear(value: string): number | null {
  const label = unprefixLabel(value);
  return FISCAL_YEAR.test(label) ? Number(label) : null;
}

/**
 * A month as the SYSTEM locale abbreviates it (spec §4.5): `Dec` in
 * English, `déc.` in French. Unlike MONTH_NAMES above, which is pinned to
 * en-US because it parses what EODHD sends, this is only ever shown.
 */
export function monthLabel(month: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(2000, month - 1, 1));
}

/** Monday is 1, Sunday is 7 — the ISO 8601 numbering. */
export function isoWeekday(date: CalendarDate): number {
  const sundayFirst = date.toDate("UTC").getUTCDay();
  return sundayFirst === 0 ? 7 : sundayFirst;
}

/**
 * ISO 8601: a week belongs to the year its Thursday falls in, and week 1 is
 * the week containing January 4. Both rules are what put Jan 1 2027 in
 * 2026-W53 and Dec 31 2024 in 2025-W01.
 */
export function isoWeek(date: CalendarDate): IsoWeek {
  const thursday = date.add({ days: 4 - isoWeekday(date) });
  const jan1 = new CalendarDate(thursday.year, 1, 1);
  return { year: thursday.year, week: Math.floor(thursday.compare(jan1) / 7) + 1 };
}

export function weekSpan({ year, week }: IsoWeek): DateSpan {
  const jan4 = new CalendarDate(year, 1, 4);
  const firstMonday = jan4.subtract({ days: isoWeekday(jan4) - 1 });
  const start = firstMonday.add({ weeks: week - 1 });
  return { start, end: start.add({ days: 6 }) };
}

export function formatWeek({ year, week }: IsoWeek): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function parseWeek(value: string): IsoWeek | null {
  const m = WEEK.exec(value);
  if (!m) return null;
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const parsed = { year: Number(m[1]), week };
  // Only a long year has a W53; in any other, weekSpan's W53 is the next
  // year's W01, so the week that span starts in has to belong to this year.
  return isoWeek(weekSpan(parsed).start).year === parsed.year ? parsed : null;
}

export function midpoint(start: CalendarDate, end: CalendarDate): CalendarDate {
  return start.add({ days: Math.floor(end.compare(start) / 2) });
}

/**
 * A group of type `quarter` or `fiscal_year` stores its label under a
 * DECEMBER year end, so one stored value means one calendar span to every
 * member. Converting between year ends goes through the span's MIDPOINT,
 * never an endpoint: WMT's Aug–Oct 2026 quarter (2027-Q3 under January) has
 * its midpoint in mid-September, which is calendar 2026-Q3, and 2026-Q3's own
 * midpoint (mid-August) lands back in Aug–Oct — so non-coinciding quarters
 * round-trip. An endpoint would slide to a neighbouring quarter one way.
 *
 * Anything that is not a label — an expression such as `T-1q`, an empty
 * string — is returned untouched, so an expression stored in a group reaches
 * every member as an expression and the wire projects it under each member's
 * own year end.
 */
export function relabel(value: string, fromFyEnd: number, toFyEnd: number): string {
  if (fromFyEnd === toFyEnd) return value;
  // v5.4.0: a quarter_range composite relabels half by half and keeps the
  // separator it was stored with; an expression half passes through as every
  // expression does, and a date half is no label, so it does too.
  const range = /^(.*?)(\/|\.\.)(.*)$/.exec(value);
  if (range) return `${relabel(range[1], fromFyEnd, toFyEnd)}${range[2]}${relabel(range[3], fromFyEnd, toFyEnd)}`;
  const quarter = parseQuarter(value);
  if (quarter) {
    const { start, end } = quarterSpan(quarter, fromFyEnd);
    return formatQuarter(fiscalPeriod(midpoint(start, end), toFyEnd));
  }
  const fy = parseFiscalYear(value);
  if (fy !== null) {
    const { start, end } = fiscalYearSpan(fy, fromFyEnd);
    return String(fiscalPeriod(midpoint(start, end), toFyEnd).fy);
  }
  return value;
}
