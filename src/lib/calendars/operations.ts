// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { LIMITS, isoDay, type CalendarBundle, type CalendarDay, type Policy } from "./contracts";
/** A bundle with its days by date and its open session labels in order. */
export type CalendarIndex = {
  bundle: CalendarBundle;
  days: ReadonlyMap<string, CalendarDay>;
  labels: readonly string[];
};
/** An operation's answer with the range it consulted, or why it has none. */
export type Outcome<T> =
  | { status: "resolved" | "provisional"; value: T; consulted: { start: string; end: string }; reason?: never }
  | { status: "unavailable"; reason: string; value?: never };
const unavailable = (reason: string): Outcome<never> => ({ status: "unavailable", reason });
/** Indexes a verified bundle for the operations below. */
export function createIndex(bundle: CalendarBundle): CalendarIndex {
  return {
    bundle,
    days: new Map(bundle.days.map((d) => [d.date, d])),
    labels: bundle.days.filter((d) => d.state === "open").map((d) => d.date),
  };
}
/**
 * Whether every day of start..end is usable under the policy: `provisional` and `conflict` days block under
 * operational-v1, and planning-v1 accepts `provisional` (flagged) but never `conflict`.
 */
function check(index: CalendarIndex, start: string, end: string, policy: Policy): Outcome<null> {
  if (
    !isoDay(start) ||
    !isoDay(end) ||
    start > end ||
    !index.bundle.coverage.complete ||
    start < index.bundle.coverage.start ||
    end > index.bundle.coverage.end
  )
    return unavailable("COVERAGE_UNAVAILABLE");
  let provisional = false;
  for (let at = Date.parse(start); at <= Date.parse(end); at += 86400000) {
    const day = index.days.get(new Date(at).toISOString().slice(0, 10));
    if (!day) return unavailable("COVERAGE_UNAVAILABLE");
    if (
      day.state === "unresolved" ||
      day.evidenceStatus === "conflict" ||
      (day.candidates.length && !day.selectedBranch)
    )
      return unavailable("AMBIGUOUS_CALENDAR");
    // Ruling 2026-10-23: only `provisional` is planning-grade. A confirmed, final or library day resolves.
    if (day.evidenceStatus === "provisional") {
      if (policy !== "planning-v1") return unavailable("PROVISIONAL_CALENDAR");
      provisional = true;
    }
  }
  return { status: provisional ? "provisional" : "resolved", value: null, consulted: { start, end } };
}
function result<T>(index: CalendarIndex, value: T, start: string, end: string, policy: Policy): Outcome<T> {
  const coverage = check(index, start, end, policy);
  return coverage.status === "unavailable" ? coverage : { ...coverage, value };
}
function lowerBound(values: readonly string[], date: string, inclusive = true) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < date || (!inclusive && values[mid] === date)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** One day's record. */
export function dayState(index: CalendarIndex, date: string, policy: Policy = "operational-v1"): Outcome<CalendarDay> {
  return result(index, index.days.get(date)!, date, date, policy);
}
/** `n` sessions from `date`, strictly past a closed anchor; 0 is the date itself. */
export function shiftSessionDate(
  index: CalendarIndex,
  date: string,
  n: number,
  policy: Policy = "operational-v1",
): Outcome<string> {
  if (!Number.isSafeInteger(n) || Math.abs(n) > LIMITS.steps) return unavailable("RESOURCE_LIMIT");
  if (!isoDay(date)) return unavailable("INVALID_DATE");
  if (!n) return result(index, date, date, date, policy);
  const rank = n > 0 ? lowerBound(index.labels, date, false) + n - 1 : lowerBound(index.labels, date) + n;
  const value = index.labels[rank];
  if (!value) return unavailable("COVERAGE_UNAVAILABLE");
  return result(index, value, date < value ? date : value, date > value ? date : value, policy);
}
export type Roll = "following" | "preceding" | "modified_following" | "modified_preceding";
/** The date rolled to a session by a business-day convention. */
export function rollSessionDate(
  index: CalendarIndex,
  date: string,
  convention: Roll,
  policy: Policy = "operational-v1",
): Outcome<string> {
  if (!["following", "preceding", "modified_following", "modified_preceding"].includes(convention))
    return unavailable("INVALID_ROLL");
  if (index.days.get(date)?.state === "open") return result(index, date, date, date, policy);
  const forward = convention.endsWith("following");
  let found = shiftSessionDate(index, date, forward ? 1 : -1, policy);
  if (found.status === "unavailable") return found;
  if (convention.startsWith("modified_") && found.value.slice(0, 7) !== date.slice(0, 7)) {
    const opposite = shiftSessionDate(index, date, forward ? -1 : 1, policy);
    if (opposite.status === "unavailable") return opposite;
    found = {
      ...opposite,
      status: found.status === "provisional" || opposite.status === "provisional" ? "provisional" : "resolved",
      consulted: {
        start: found.consulted.start < opposite.consulted.start ? found.consulted.start : opposite.consulted.start,
        end: found.consulted.end > opposite.consulted.end ? found.consulted.end : opposite.consulted.end,
      },
    };
  }
  return found;
}
/** That session's real open and close (early closes kept). */
export function sessionBounds(
  index: CalendarIndex,
  date: string,
  policy: Policy = "operational-v1",
): Outcome<{ open: string; close: string }> {
  const d = index.days.get(date);
  if (!d || d.state !== "open") return unavailable("SESSION_UNAVAILABLE");
  return result(index, { open: d.open!, close: d.close! }, date, date, policy);
}
/** The latest session whose close is at or before `instant`. */
export function lastCompleted(
  index: CalendarIndex,
  instant: string,
  policy: Policy = "operational-v1",
): Outcome<string> {
  if (!Number.isFinite(Date.parse(instant))) return unavailable("INVALID_INSTANT");
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: index.bundle.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
  if (local > index.bundle.coverage.end || local < index.bundle.coverage.start)
    return unavailable("COVERAGE_UNAVAILABLE");
  let selected: CalendarDay | undefined;
  for (const d of index.days.values())
    if (
      d.close &&
      Date.parse(d.close) <= Date.parse(instant) &&
      (!selected || Date.parse(d.close) > Date.parse(selected.close!))
    )
      selected = d;
  if (!selected) return unavailable("COVERAGE_UNAVAILABLE");
  return result(index, selected.date, selected.date, local > selected.date ? local : selected.date, policy);
}
/** Dates open on all, or any, of several calendars; every member must cover the range. */
export function jointDates(
  indices: CalendarIndex[],
  mode: "all_open" | "any_open",
  start: string,
  end: string,
  policy: Policy = "operational-v1",
): Outcome<string[]> {
  if (!indices.length || indices.length > LIMITS.members || !["all_open", "any_open"].includes(mode))
    return unavailable("RESOURCE_LIMIT");
  let provisional = false;
  for (const index of indices) {
    const c = check(index, start, end, policy);
    if (c.status === "unavailable") return c;
    if (c.status === "provisional") provisional = true;
  }
  const values: string[] = [];
  for (let at = Date.parse(start); at <= Date.parse(end); at += 86400000) {
    const d = new Date(at).toISOString().slice(0, 10);
    const open = indices.map((i) => i.days.get(d)!.state === "open");
    if (mode === "all_open" ? open.every(Boolean) : open.some(Boolean)) values.push(d);
  }
  return { status: provisional ? "provisional" : "resolved", value: values, consulted: { start, end } };
}
