// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { CalendarDate } from "@internationalized/date";
import type { ParamOption } from "./types";
import { fiscalPeriod } from "./periods";

/**
 * The app's names for a statement widget's period choices. FQ, not Q: a statement's quarter is the
 * REPORTER's fiscal quarter (every provider was checked against WMT, whose year
 * ends in January), while Q stays the calendar quarter of economic series. The
 * VALUE is never touched -- it is what the provider accepts.
 */
const LABELS: Record<string, string> = {
  annual: "FY", FY: "FY",
  quarter: "FQ", quarterly: "FQ", Q: "FQ",
  ttm: "TTM", TTM: "TTM",
  quarterly_yoy: "FQ YoY",
};

export function fiscalPeriodLabel(value: string): string | undefined {
  return Object.hasOwn(LABELS, value) ? LABELS[value] : undefined;
}

/**
 * A company-statement period: the param is `period` and it offers a year and a
 * quarter form. `frequency` (economic series) and `calendar_period` (SEC's
 * calendar-aligned frames) are calendar periods and keep their own labels.
 */
export function isStatementPeriodParam(p: { paramName: string; options?: ParamOption[] }): boolean {
  if (p.paramName !== "period") return false;
  const values = new Set((p.options ?? []).map((o) => o.value));
  return (values.has("annual") || values.has("FY")) && (values.has("quarter") || values.has("quarterly") || values.has("Q"));
}

/**
 * The options relabelled, with one FQ: TMX offers both `quarter` and
 * `quarterly`, so the option whose value is stored wins and the other goes
 * (else the first). Both values still reach the provider unchanged.
 */
export function fiscalPeriodOptions(options: ParamOption[], current: string): ParamOption[] {
  const fq = options.filter((o) => fiscalPeriodLabel(o.value) === "FQ");
  const keep = fq.find((o) => o.value === current) ?? fq[0];
  return options
    .filter((o) => fiscalPeriodLabel(o.value) !== "FQ" || o === keep)
    .map((o) => ({ ...o, label: fiscalPeriodLabel(o.value) ?? o.label }));
}

/** A group's value as chips show it: a `period` group's value by its fiscal name. */
export function groupValueLabel(g: { paramName: string; value: string }): string {
  return g.paramName === "period" ? (fiscalPeriodLabel(g.value) ?? g.value) : g.value;
}

export type Row = Record<string, unknown>;

type Kind = "quarter" | "annual" | "ttm";
const KIND: Record<string, Kind> = {
  quarter: "quarter", quarterly: "quarter", quarterly_yoy: "quarter", Q: "quarter",
  annual: "annual", FY: "annual", ttm: "ttm", TTM: "ttm",
};

/** `2026-07-31` or `2026-07-31T…` as a date, else null. */
function dateOf(value: unknown): CalendarDate | null {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? new CalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/**
 * The month a reported period really closes: 52/53-week filers end on a
 * weekday near a month's end, so days 1-7 count toward the month before.
 */
function reportMonth(end: CalendarDate): CalendarDate {
  return end.day <= 7 ? end.subtract({ days: end.day }) : end;
}

/** A row's kind from its own fiscal_period (a local table has no period param): FY, Q…/FQ…, TTM. */
function rowKind(row: Row): Kind | undefined {
  const v = typeof row.fiscal_period === "string" ? row.fiscal_period.trim() : "";
  return /^F?Q[1-4]$/i.test(v) ? "quarter" : Object.hasOwn(KIND, v) ? KIND[v] : undefined;
}

/** The card's note when statement rows keep their reported labels; on a dataset it rides as a diagnostic. */
export const FISCAL_AS_REPORTED = { code: "FISCAL_AS_REPORTED", severity: "info" as const, message: "Fiscal labels as reported" };

/**
 * The upper-cased symbols of the rows whose own fiscal_period names a statement kind; null when there are none.
 * Empty past the worker protocol's year-end limits (more than 1000 symbols, or one over 64 chars): no
 * year end is asked, and as correctStatementRows relabels a file all or nothing, its rows stay as reported.
 */
export function statementReporters(rows: Row[]): string[] | null {
  const matched = rows.filter((r) => rowKind(r) !== undefined);
  if (!matched.length) return null;
  const symbols = [...new Set(matched.flatMap((r) => typeof r.symbol === "string" && r.symbol ? [r.symbol.toUpperCase()] : []))];
  return symbols.length > 1000 || symbols.some((s) => s.length > 64) ? [] : symbols;
}

/**
 * Statement rows with fiscal_period / fiscal_year derived from each row's
 * period end and its reporter's fiscal year end. December filers read
 * Q2 / 2027; any other year end FQ2 / FY2027; annual rows FY; TTM rows TTM with
 * their year untouched. Nothing is guessed: an unknown year end, or several
 * symbols with no symbol column to tell rows apart, or a statement row whose
 * period end (`period_ending`, else `date`) is unreadable, returns the rows as
 * reported.
 *
 * perRow (a local table): `period` is ignored and each row's own fiscal_period
 * names its kind; rows that name none are left unchanged and need no year end.
 */
export function correctStatementRows(
  rows: Row[], period: string, yearEnds: Record<string, number | null>, cardSymbols: string[], perRow = false,
): { rows: Row[]; asReported: boolean } {
  const kinds = rows.map((r) => (perRow ? rowKind(r) : KIND[period]));
  if (perRow && kinds.every((k) => k === undefined)) return { rows, asReported: false };
  if (!perRow && KIND[period] === undefined) return { rows, asReported: true };
  const symbolOf = (row: Row): string | undefined =>
    typeof row.symbol === "string" ? row.symbol.toUpperCase() : cardSymbols.length === 1 ? cardSymbols[0].toUpperCase() : undefined;
  const months = rows.map((r, i) => {
    if (kinds[i] === undefined) return 0;
    const s = symbolOf(r);
    return s === undefined ? null : (yearEnds[s] ?? null);
  });
  // yfinance's long rows name their period end `date`.
  const ends = rows.map((r) => dateOf(r.period_ending ?? r.date));
  if (months.some((m) => m === null) || kinds.some((k, i) => k !== undefined && k !== "ttm" && ends[i] === null)) return { rows, asReported: true };
  const out = rows.map((row, i) => {
    const kind = kinds[i];
    if (kind === undefined) return row;
    const m = months[i] as number;
    if (kind === "ttm") return { ...row, fiscal_period: "TTM" };
    const end = ends[i] as CalendarDate;
    const { fy, q } = fiscalPeriod(reportMonth(end), m);
    // Always text: formatCell compacts a number (2026 would show as "2.03K") and a
    // corrected column would mix "FY2027" strings with numbers. The Statement
    // view's period header still prefixes FY, because "2026" does not start with FY.
    const year = m === 12 ? String(fy) : `FY${fy}`;
    return { ...row, fiscal_period: kind === "annual" ? "FY" : `${m === 12 ? "Q" : "FQ"}${q}`, fiscal_year: year };
  });
  return { rows: out, asReported: false };
}
