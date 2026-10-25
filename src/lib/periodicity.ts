// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Bucket } from "./types";

/** How often a date column's observations fall. */
export type Periodicity = "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "irregular";

export const PERIODICITY_LABEL: Record<Periodicity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  irregular: "Dates",
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86_400_000;

/**
 * The calendar date a value is stamped with, as a UTC day number, or null.
 *
 * The date PART as written, never a timezone conversion: a row stamped
 * "2024-03-31T16:00:00-04:00" is a March observation to whoever published it,
 * and converting it would move quarter-end rows into the next quarter for
 * anyone east of the source.
 * ponytail: date-part-as-written; if a feed ever stamps period ends in UTC
 * past local midnight, bucket by a declared timezone instead.
 */
function dayNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t / DAY_MS;
}

/**
 * From the MEDIAN gap between the column's distinct dates. The median, so a
 * business-day series — gaps of 1,1,1,1,3 — is daily, and one missing month
 * does not unmake a monthly series. Distinct, so a long table carrying the
 * same dates for many symbols reads the same as one symbol's would.
 *
 * Fewer than three dates is irregular: two dates have one gap, and one gap is
 * not a pattern.
 */
export function detectPeriodicity(values: readonly unknown[]): Periodicity {
  const days = [...new Set(values.map(dayNumber).filter((d): d is number => d !== null))].sort(
    (a, b) => a - b,
  );
  if (days.length < 3) return "irregular";
  const gaps = days.slice(1).map((d, i) => d - days[i]).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median === 1) return "daily";
  if (median >= 6 && median <= 8) return "weekly";
  if (median >= 28 && median <= 31) return "monthly";
  if (median >= 89 && median <= 92) return "quarterly";
  if (median >= 365 && median <= 366) return "annual";
  return "irregular";
}

/** Every bucket but the data's own. */
export type CoarseBucket = Exclude<Bucket, "native">;

const LADDER: CoarseBucket[] = ["week", "month", "quarter", "year"];

/**
 * The buckets a date pill's menu offers besides `native` — only coarser ones.
 * An irregular column (event dates) gets them all: each date is a point in
 * time and belongs to exactly one week, month, quarter and year.
 */
export function coarserBuckets(native: Periodicity): CoarseBucket[] {
  switch (native) {
    case "daily":
    case "irregular":
      return LADDER;
    case "weekly":
      return LADDER.slice(1);
    case "monthly":
      return LADDER.slice(2);
    case "quarterly":
      return LADDER.slice(3);
    case "annual":
      return [];
  }
}

/**
 * A week does not sit inside a month, a quarter or a year: the one ending
 * 2 April carries five March days, and months hold four or five of them. The
 * roll-up is still well defined (a row belongs to the period containing its
 * date) and is right for last/first/min/max/mean — it is `sum` that turns
 * approximate, which is why the panel marks it rather than refusing it.
 */
export function straddles(native: Periodicity, bucket: Bucket): boolean {
  return native === "weekly" && bucket !== "native" && bucket !== "week";
}

/**
 * How many native observations a full bucket holds, where the calendar fixes
 * it. Undefined everywhere else — daily data would need a trading calendar,
 * which the client does not have.
 */
export function expectedCount(native: Periodicity, bucket: Bucket): number | undefined {
  if (native === "monthly" && bucket === "quarter") return 3;
  if (native === "monthly" && bucket === "year") return 12;
  if (native === "quarterly" && bucket === "year") return 4;
  return undefined;
}

/** ISO 8601 week: weeks start Monday, and week 1 holds the year's first Thursday. */
function isoWeek(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Move to the Thursday of this week; its year is the ISO week-year.
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const jan1 = Date.UTC(weekYear, 0, 1);
  const week = Math.ceil(((date.getTime() - jan1) / DAY_MS + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * The group key for a date under a bucket. Every form sorts chronologically
 * AS TEXT ("2024-Q1" < "2024-Q2" < "2025-Q1"), so the engine orders date
 * groups with the same comparison it uses for any other key.
 */
export function bucketKey(value: string, bucket: Bucket): string | null {
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  switch (bucket) {
    case "native":
      return value;
    case "year":
      return y;
    case "quarter":
      return `${y}-Q${Math.floor((Number(mo) - 1) / 3) + 1}`;
    case "month":
      return `${y}-${mo}`;
    case "week":
      return isoWeek(Number(y), Number(mo), Number(d));
  }
}

/** A bucket key as the group header shows it. */
export function bucketLabel(key: string, bucket: Bucket): string {
  return bucket === "quarter" ? key.replace("-Q", " Q") : key;
}
