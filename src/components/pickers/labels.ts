// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { getLocalTimeZone, toCalendarDateTime, type CalendarDate } from "@internationalized/date";
import { parseWireDatetime, splitRange } from "../../lib/dateExpressions";
import {
  formatFiscalLabel,
  fiscalYearSpan,
  parseFiscalYear,
  parseQuarter,
  parseWeek,
  quarterSpan,
  weekSpan,
  type FiscalQuarter,
} from "../../lib/periods";

/**
 * The text of every trigger and grid cell, in one place, so the row, the
 * popovers and the e2e locators spell a period the same way. `FY` appears
 * whenever the type is fiscal, a December year end included: `FY2026-Q3` is
 * calendar Q3 2026, and saying so is what lets a reader compare it with a
 * September member's `FY2026-Q4` beside it.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const EMPTY = "—";

export function monthSpanLabel(start: CalendarDate, end: CalendarDate): string {
  const from = MONTHS[start.month - 1];
  const to = MONTHS[end.month - 1];
  return start.year === end.year ? `${from}–${to} ${start.year}` : `${from} ${start.year}–${to} ${end.year}`;
}

export function quarterLabel(value: string): string {
  if (value === "") return EMPTY;
  const q = parseQuarter(value);
  return q ? formatFiscalLabel(q.fy, q.q) : value;
}

export function quarterCellLabel(quarter: FiscalQuarter, fyEnd: number): string {
  const { start, end } = quarterSpan(quarter, fyEnd);
  return `${formatFiscalLabel(quarter.fy, quarter.q)} (${monthSpanLabel(start, end)})`;
}

/** v5.4.0: `FY2025-Q4 – FY2026-Q4`, each half as quarterLabel spells it. */
export function quarterRangeLabel(value: string): string {
  const [start, end] = splitRange(value);
  return `${quarterLabel(start)} – ${quarterLabel(end)}`;
}

export function fiscalYearLabel(value: string): string {
  if (value === "") return EMPTY;
  const fy = parseFiscalYear(value);
  return fy === null ? value : formatFiscalLabel(fy);
}

export function fiscalYearCellLabel(fy: number, fyEnd: number): string {
  const { start, end } = fiscalYearSpan(fy, fyEnd);
  return `${formatFiscalLabel(fy)} (${monthSpanLabel(start, end)})`;
}

export function weekLabel(value: string): string {
  if (value === "") return EMPTY;
  const week = parseWeek(value);
  if (!week) return value;
  const { start, end } = weekSpan(week);
  const days =
    start.month === end.month
      ? `${MONTHS[start.month - 1]} ${start.day}–${end.day}`
      : `${MONTHS[start.month - 1]} ${start.day}–${MONTHS[end.month - 1]} ${end.day}`;
  return `W${String(week.week).padStart(2, "0")} ${week.year} · ${days}`;
}

/**
 * Zone abbreviations come from Intl with `timeZoneName: "short"`, which is
 * `EDT` for New York in an en-US locale and a `GMT+2`-style string for zones
 * that have no English abbreviation — either is honest.
 */
export function datetimeLabel(value: string, zone: string = getLocalTimeZone()): string {
  if (value === "") return EMPTY;
  const at = parseWireDatetime(value, zone);
  if (!at) return value;
  const zoneName =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(at.toDate())
      .find((p) => p.type === "timeZoneName")?.value ?? zone;
  return `${toCalendarDateTime(at.set({ millisecond: 0 })).toString().replace("T", " ")} ${zoneName}`;
}

export function rangeLabel(value: string): string {
  const [start, end] = splitRange(value);
  return `${start === "" ? EMPTY : start} – ${end === "" ? EMPTY : end}`;
}
