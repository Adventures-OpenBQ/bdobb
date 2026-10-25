// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fromDate, getLocalTimeZone, toCalendarDate } from "@internationalized/date";
import type { CalendarCardState, CalendarMode, CalendarRowUnit, CalendarUnit } from "./types";

/**
 * The calendar view's pure half: everything that turns rows into cells and
 * cells into a grid, with no React and no DOM, so it tests as functions.
 *
 * Two kinds of time live here and they are never confused:
 *
 * - An INSTANT (a `Date`) is a moment on the timeline. Which day cell it
 *   belongs to depends on the zone the reader is in; `localDate` answers that
 *   with Intl, never with `getDate()`, so the test suite can ask the question
 *   for Tokyo while the machine sits in New York.
 * - A CIVIL DATE (a `YYYY-MM-DD` string) is a calendar square. The cursor,
 *   the grid, the business-day set and an all-day event are all civil dates,
 *   and the arithmetic on them (`addDays`, `mondayOf`) is done in UTC on
 *   purpose: UTC has no DST, so "add one day" is always 24 hours and the
 *   result is read straight back as a date.
 */

export type EventTime = { kind: "instant"; at: Date } | { kind: "allday"; date: string };

export const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * A bare date is an all-day event and stays on that date in every zone. A
 * naive datetime is UTC: that is what EODHD emits (its CPI row says 12:30
 * for the 08:30 Eastern release) and what openbb-api passes through. An
 * offset or `Z` is honoured as written. Anything else is not a time.
 */
export function parseEventTime(value: unknown): EventTime | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { kind: "instant", at: value };
  if (typeof value !== "string") return null;
  if (BARE_DATE.test(value)) {
    // Reject 2026-13-40: Date.parse of a bare date is UTC and strict in every engine.
    return Number.isNaN(Date.parse(value)) ? null : { kind: "allday", date: value };
  }
  if (!DATE_PREFIX.test(value)) return null;
  const naive = NAIVE.exec(value);
  const iso = naive ? `${naive[1]}T${naive[2]}Z` : value;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : { kind: "instant", at: new Date(ms) };
}

/** The civil date an instant falls on in `timeZone` (the system zone when omitted). */
export function localDate(at: Date, timeZone?: string): string {
  return toCalendarDate(fromDate(at, timeZone ?? getLocalTimeZone())).toString();
}

/** The wall clock of an instant in `timeZone`, plus the hour as a fraction for the axis. */
export function localClock(at: Date, timeZone?: string): { hh: string; mm: string; frac: number } {
  const { hour, minute } = fromDate(at, timeZone ?? getLocalTimeZone());
  return { hh: String(hour).padStart(2, "0"), mm: String(minute).padStart(2, "0"), frac: hour + minute / 60 };
}

export type CalendarEvent = {
  time: EventTime;
  /** The civil date of the cell this event sits in. */
  day: string;
  title: string;
  row: Record<string, unknown>;
};

/**
 * Rows to cells. A row whose date does not parse is dropped rather than
 * invented a date for; a row without a title shows its day so the cell is
 * never blank. Within a day, all-day events lead and instants follow in time
 * order, which is the order a trader reads a day in.
 */
export function bucketRows(
  rows: Array<Record<string, unknown>>,
  dateField: string,
  titleField: string,
  timeZone?: string,
): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>();
  for (const row of rows) {
    const time = parseEventTime(row[dateField]);
    if (!time) continue;
    const day = time.kind === "allday" ? time.date : localDate(time.at, timeZone);
    const raw = row[titleField];
    const title = raw === null || raw === undefined || raw === "" ? day : String(raw);
    let list = out.get(day);
    if (!list) out.set(day, (list = []));
    list.push({ time, day, title, row });
  }
  for (const list of out.values()) {
    list.sort((a, b) => {
      if (a.time.kind !== b.time.kind) return a.time.kind === "allday" ? -1 : 1;
      if (a.time.kind === "allday" || b.time.kind === "allday") return 0;
      return a.time.at.getTime() - b.time.at.getTime();
    });
  }
  return out;
}

/**
 * The Type / Series filter's half of the pure layer. The EODHD earnings
 * calendar lists several hundred tickers a day, which as a calendar is
 * unreadable until the reader picks the names they follow; `field` is the
 * column the series are read from (the Type) and `series` the values kept.
 *
 * Matching is deliberately forgiving in exactly one way. EODHD writes a
 * symbol with its exchange suffix — `AAPL.US`, `DNLM.LSE` — and a person
 * types the bare ticker, so a series matches a cell that is the series plus
 * a DOTTED suffix as well as one that equals it. Dotted, not merely
 * prefixed: `BRK` must not quietly claim `BRK-B`, which is a different
 * company's row, and only the exchange convention puts a dot there.
 *
 * An empty or absent list is not a filter that matches nothing — it is no
 * filter at all, and the same array comes back so the caller's `useMemo`
 * downstream sees no new reference.
 */
export function filterSeries(
  rows: Array<Record<string, unknown>>,
  field: string,
  series: string[] | undefined,
): Array<Record<string, unknown>> {
  if (!series || series.length === 0) return rows;
  const wanted = new Set(series.map((s) => s.trim().toLowerCase()));
  return rows.filter((row) => {
    const value = String(row[field]).trim().toLowerCase();
    if (wanted.has(value)) return true;
    const dot = value.indexOf(".");
    return dot > 0 && wanted.has(value.slice(0, dot));
  });
}

/**
 * The values the Series box offers as a datalist: sorted, unique, non-empty.
 * Capped because the suggestion list is a convenience, not the data — a
 * month of a global earnings calendar is thousands of tickers, and an
 * unbounded `<datalist>` is thousands of DOM nodes for a control the reader
 * types three characters into.
 */
export function distinctValues(rows: Array<Record<string, unknown>>, field: string, limit = 500): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text !== "") seen.add(text);
  }
  return [...seen].sort().slice(0, limit);
}

/**
 * The three-level tree filter, the pure half. Where Type / Series is one
 * column and a list of values, this is the shape an economic calendar
 * actually has: **Source** (who publishes) → **Release** (the publication or
 * survey) → **Statistic** (the event as the provider names it). openbq-eodhd
 * 9.6.0 fills OpenBB's own `source` and `category` fields from its statistics
 * index, so a row arrives carrying its own first two levels and the app maps
 * nothing.
 *
 * A path is an ARRAY of segments, never a joined string, because event names
 * contain slashes ("Retail Sales Ex Gas/Autos") and a joined key would split
 * one statistic into two. A row the provider could not classify keeps both
 * fields empty and lands under **Other**, which is always drawn: nothing
 * disappears from the tree because the index has not caught up with the feed.
 */
export type TreeNode = { name: string; path: string[]; count: number; children: TreeNode[] };

/** The bucket for a row whose source or release the provider did not name. */
const OTHER = "Other";

function segment(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : OTHER;
}

/**
 * A row's place in the tree. The third segment is the title column's value —
 * the same string the cell shows — so the tree and the grid can never disagree
 * about what a statistic is called; `titleField` defaults to `event`, which is
 * what an OpenBB economic-calendar row names it.
 */
export function eventPath(row: Record<string, unknown>, titleField = "event"): [string, string, string] {
  const title = row[titleField];
  return [
    segment(row.source),
    segment(row.category),
    title === null || title === undefined ? "" : String(title),
  ];
}

/** The length of the longest rule in `rules` that is a prefix of `path`, or -1. */
function longestRule(path: string[], rules: string[][] | undefined): number {
  let best = -1;
  for (const rule of rules ?? []) {
    if (rule.length > path.length || rule.length <= best) continue;
    if (rule.every((seg, i) => seg === path[i])) best = rule.length;
  }
  return best;
}

/**
 * The whole rule of the filter in one function: the most specific rule that
 * matches wins, and with no rule at all everything is allowed — so a default
 * card persists nothing and a statistic added under an included release
 * appears by itself. `exclude` and `include` are both lists of paths; a tie at
 * the same length between the two lists cannot arise, because `toggleTreePath`
 * removes the opposite rule at a path before it writes one.
 */
export function treeAllows(path: string[], exclude?: string[][], include?: string[][]): boolean {
  return longestRule(path, include) >= longestRule(path, exclude);
}

/**
 * The rows the tree keeps. No rules is no filter — the same array comes back,
 * by reference, so the caller's `useMemo` chain downstream sees no change,
 * exactly as `filterSeries` does.
 */
export function filterTree(
  rows: Array<Record<string, unknown>>,
  exclude?: string[][],
  include?: string[][],
  titleField = "event",
): Array<Record<string, unknown>> {
  if ((exclude?.length ?? 0) === 0 && (include?.length ?? 0) === 0) return rows;
  return rows.filter((row) => treeAllows(eventPath(row, titleField), exclude, include));
}

function sortNodes(nodes: TreeNode[]): void {
  // Other last wherever it appears, alphabetical otherwise: it is the bucket
  // for what the index does not know, and a reader scanning for a source
  // should not trip over it in the middle of the B's.
  nodes.sort((a, b) => (a.name === OTHER ? 1 : 0) - (b.name === OTHER ? 1 : 0) || a.name.localeCompare(b.name));
  for (const node of nodes) sortNodes(node.children);
}

/**
 * The tree the popover draws, with each node's row count. Counts are ROWS,
 * not statistics: "EIA 154" is what the reader is deciding about, and a
 * release with one statistic printed weekly is not a small thing.
 */
export function buildTree(rows: Array<Record<string, unknown>>, titleField = "event"): TreeNode[] {
  const roots: TreeNode[] = [];
  // One index over every depth, keyed by the path joined on a NUL — a
  // character no provider name contains, unlike the slash that made a joined
  // path unusable as an identity in the first place.
  const index = new Map<string, TreeNode>();
  for (const row of rows) {
    const path = eventPath(row, titleField);
    let siblings = roots;
    for (let depth = 0; depth < path.length; depth++) {
      const key = path.slice(0, depth + 1).join("\u0000");
      let node = index.get(key);
      if (!node) {
        node = { name: path[depth], path: path.slice(0, depth + 1), count: 0, children: [] };
        index.set(key, node);
        siblings.push(node);
      }
      node.count += 1;
      siblings = node.children;
    }
  }
  sortNodes(roots);
  return roots;
}

/**
 * A node's tri-state, as the two numbers the checkbox needs: allowed leaves of
 * total leaves. All is ticked, none is unticked, anything between is
 * indeterminate. Leaves, not rows, because the box answers "is every statistic
 * under this shown", which is a question about the tree rather than about how
 * often each statistic happens to print.
 */
export function treeCounts(
  node: TreeNode,
  exclude?: string[][],
  include?: string[][],
): { allowed: number; total: number } {
  if (node.children.length === 0) {
    return { allowed: treeAllows(node.path, exclude, include) ? 1 : 0, total: 1 };
  }
  let allowed = 0;
  let total = 0;
  for (const child of node.children) {
    const sub = treeCounts(child, exclude, include);
    allowed += sub.allowed;
    total += sub.total;
  }
  return { allowed, total };
}

/**
 * One click on a box, as two new rule lists. Three steps, in order:
 *
 * 1. Every rule at `path` or below it goes, whichever list it is in — the
 *    reader has just spoken about the whole subtree, so nothing under it may
 *    keep contradicting them.
 * 2. A node that was fully allowed is being turned off, so its path joins
 *    `exclude`; anything else (none or some of it allowed) is being turned
 *    fully on, so its path joins `include`.
 * 3. The new rule is dropped when it only restates what the nearest surviving
 *    ancestor rule — or the default, which is "allowed" — already says. That
 *    is what makes the lists shrink back to empty when a reader ticks
 *    everything on again, rather than accumulating a rule per click forever.
 *
 * Step 3 needs no ancestor search of its own: step 1 has already removed every
 * rule at `path` and below, so asking `treeAllows` about `path` against the
 * stripped lists answers exactly "what would this node inherit".
 */
export function toggleTreePath(
  path: string[],
  exclude: string[][] | undefined,
  include: string[][] | undefined,
  allAllowed: boolean,
): { exclude: string[][]; include: string[][] } {
  const keep = (rules: string[][] | undefined) =>
    (rules ?? []).filter((rule) => !(rule.length >= path.length && path.every((seg, i) => rule[i] === seg)));
  const nextExclude = keep(exclude);
  const nextInclude = keep(include);
  const inherited = treeAllows(path, nextExclude, nextInclude);
  if (allAllowed) {
    if (inherited) nextExclude.push(path);
  } else if (!inherited) {
    nextInclude.push(path);
  }
  return { exclude: nextExclude, include: nextInclude };
}

export const DEFAULT_BUSINESS_DAYS = [1, 2, 3, 4, 5];

function toUtc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fromUtc(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const at = toUtc(day);
  at.setUTCDate(at.getUTCDate() + n);
  return fromUtc(at);
}

/** The first day of the month `offset` months from `day`'s month. */
export function firstOfMonth(day: string, offset: number): string {
  const at = toUtc(day);
  return fromUtc(new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1)));
}

export function lastOfMonth(day: string): string {
  return addDays(firstOfMonth(day, 1), -1);
}

/** ISO weekday: Monday 1 through Sunday 7. */
export function isoWeekday(day: string): number {
  const w = toUtc(day).getUTCDay();
  return w === 0 ? 7 : w;
}

export function mondayOf(day: string): string {
  return addDays(day, 1 - isoWeekday(day));
}

export function todayLocal(timeZone?: string): string {
  return localDate(new Date(), timeZone);
}

/**
 * Unique, ascending, inside 1..7, and never empty: an empty set would draw
 * no columns at all, so it falls back to the weekday default. The toolbar
 * refuses to uncheck the last day for the same reason; this is the guard
 * for a hand-edited dashboard file.
 */
export function sortedBusinessDays(days: number[] | undefined): number[] {
  const set = [...new Set((days ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))];
  return set.length === 0 ? [...DEFAULT_BUSINESS_DAYS] : set.sort((a, b) => a - b);
}

function weekRow(monday: string, businessDays: number[]): string[] {
  return businessDays.map((d) => addDays(monday, d - 1));
}

/**
 * The day cells for one page of the grid, as rows of civil dates. Month is
 * every week from the one holding the 1st through the one holding the last
 * day; Week is the cursor's week; Day is the cursor. The caller decides how
 * an out-of-month cell is dimmed; the grid only says which dates exist.
 */
export function gridWeeks(
  unit: Exclude<CalendarUnit, "continuous">,
  cursor: string,
  businessDays: number[],
): string[][] {
  if (unit === "day") return [[cursor]];
  if (unit === "week") return [weekRow(mondayOf(cursor), businessDays)];
  const first = firstOfMonth(cursor, 0);
  const last = lastOfMonth(cursor);
  const rows: string[][] = [];
  for (let monday = mondayOf(first); monday <= last; monday = addDays(monday, 7)) {
    rows.push(weekRow(monday, businessDays));
  }
  return rows;
}

/**
 * Which mode a card is in, plus the paged unit and the row unit that go with
 * it. This is the whole of the compatibility story for the 2026-09-07 rework:
 * a card persisted before it carries `unit` only, and the old `continuous`
 * WAS the vertical week sheet, so it reads as one; every other unit was a
 * page. Nothing is rewritten on disk — the card keeps its `unit` until the
 * reader changes something, and a `mode` once written wins outright, which is
 * why a card left on `unit: "continuous"` and then switched to Horizontal is
 * Horizontal. `unit` is narrowed to the three paged units here so the callers
 * that ask the grid for a page never have to re-handle `continuous`.
 */
export function resolveMode(state: CalendarCardState): {
  mode: CalendarMode;
  unit: Exclude<CalendarUnit, "continuous">;
  rowUnit: CalendarRowUnit;
} {
  const paged = state.unit && state.unit !== "continuous" ? state.unit : "month";
  if (state.mode) return { mode: state.mode, unit: paged, rowUnit: state.rowUnit ?? "week" };
  // Read `state.rowUnit` here too, the same as the `state.mode` branch above:
  // a pre-rework card can carry `{ unit: "continuous" }` and a later-written
  // `rowUnit: "day"` (the agenda patched onto it before `mode` itself was ever
  // written), and hardcoding "week" here threw that patch away — the Vertical
  // toolbar's Days button would write state that this function then ignored.
  if (state.unit === "continuous") return { mode: "vertical", unit: "month", rowUnit: state.rowUnit ?? "week" };
  return { mode: "paged", unit: paged, rowUnit: "week" };
}

/**
 * Every business day from `from` through `to`, inclusive and ascending: the
 * cells of the day-shaped modes (Vertical's agenda and Horizontal's ribbon),
 * which count days where the week modes count weeks. Civil dates compare as
 * strings because `YYYY-MM-DD` sorts lexically the way it sorts in time.
 */
export function businessDaysBetween(from: string, to: string, businessDays: number[]): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (businessDays.includes(isoWeekday(day))) out.push(day);
  }
  return out;
}

/**
 * Static's rows: whole weeks from the one holding `start` through the one
 * holding `end`, the same row shape `gridWeeks` produces so the grid draws
 * them without knowing which mode asked. The caller dims the cells that fall
 * outside [start, end]; this only says which dates the rows cover.
 */
export function staticWeeks(start: string, end: string, businessDays: number[]): string[][] {
  const rows: string[][] = [];
  for (let monday = mondayOf(start); monday <= end; monday = addDays(monday, 7)) {
    rows.push(weekRow(monday, businessDays));
  }
  return rows;
}

export function continuousWeeks(firstMonday: string, count: number, businessDays: number[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < count; i++) rows.push(weekRow(addDays(firstMonday, 7 * i), businessDays));
  return rows;
}

/**
 * One unit forward or back. Day steps to the next date IN the business set,
 * so a Mon–Fri calendar goes Friday to Monday. Continuous has no cursor
 * motion of its own; the scroll box moves and the cursor only matters for
 * where it starts and what it fetches.
 */
export function stepCursor(unit: CalendarUnit, cursor: string, n: number, businessDays: number[]): string {
  if (unit === "month") return firstOfMonth(cursor, n);
  if (unit === "week") return addDays(cursor, 7 * n);
  if (unit === "continuous") return cursor;
  const dir = n < 0 ? -1 : 1;
  let day = cursor;
  for (let left = Math.abs(n); left > 0; left--) {
    do day = addDays(day, dir);
    while (!businessDays.includes(isoWeekday(day)));
  }
  return day;
}

/**
 * The endless modes' opening sheet, in whole weeks: one week before the
 * cursor's week, the cursor's week, and five after it (user ruling,
 * 2026-10-18). Five after rather than four because "a month ahead" has to
 * hold for a cursor on any weekday: from a Sunday, a month on is day 36 of
 * the cursor's week's Monday, past a four-week tail (day 34) and inside a
 * five-week one (day 41). The old sheet, twelve weeks either side, asked
 * EODHD for six months of every symbol and ran past the 55 s gateway limit.
 */
export const SHEET_WEEKS_BEFORE = 1;
export const SHEET_WEEKS = 7;

/**
 * The date range worth having in hand for this page: what is visible, padded
 * to whole weeks, plus one unit either side so a wheel step lands on rows
 * that are already here. Continuous is the endless modes' opening sheet
 * (above), Monday to Sunday, so what the renderer first draws is exactly what
 * it first fetches.
 */
export function fetchWindow(
  unit: CalendarUnit,
  cursor: string,
): { start_date: string; end_date: string } {
  if (unit === "month") {
    const start = mondayOf(firstOfMonth(cursor, -1));
    const end = addDays(mondayOf(lastOfMonth(firstOfMonth(cursor, 1))), 6);
    return { start_date: start, end_date: end };
  }
  const monday = mondayOf(cursor);
  if (unit === "continuous") {
    const first = addDays(monday, -7 * SHEET_WEEKS_BEFORE);
    return { start_date: first, end_date: addDays(first, 7 * SHEET_WEEKS - 1) };
  }
  return { start_date: addDays(monday, -7), end_date: addDays(monday, 13) };
}

/** Events in [from, to] whose day is outside the business set: what the grid is not showing. */
export function hiddenEventCount(
  buckets: Map<string, unknown[]>,
  from: string,
  to: string,
  businessDays: number[],
): number {
  let n = 0;
  for (const [day, list] of buckets) {
    if (day < from || day > to) continue;
    if (!businessDays.includes(isoWeekday(day))) n += list.length;
  }
  return n;
}

const SAMPLE = 5;

function columnIsDates(rows: Array<Record<string, unknown>>, key: string): boolean {
  const values = rows.slice(0, SAMPLE).map((r) => r[key]).filter((v) => v !== null && v !== undefined);
  return values.length > 0 && values.every((v) => parseEventTime(v) !== null);
}

const DATE_NAMES = ["date", "auction_date"];
/**
 * `security_term` beats `type` because a real `treasury_auctions` row carries
 * both, and its `type` is the literal "Bill" / "Note" / "Bond" — three titles
 * for fourteen auctions. `security_term` ("3-Year", "10-Year") is what tells
 * one auction from another. An economic calendar has no `security_term`, so
 * its `type` ("CPI", "Core CPI") still wins there.
 */
const TITLE_NAMES = ["event", "security_term", "type", "name", "title"];

/**
 * Names first, values second. `detectTimeColumn` in chartShapes.ts scans
 * values only, which is right for a chart's axis; a calendar payload often
 * carries several date columns (issue_date, maturity_date, announcement_date)
 * and the one to lay out on is the one the provider named `date` or
 * `auction_date`. Anything else falls back to the first date-valued column.
 */
export function detectDateColumn(rows: Array<Record<string, unknown>>): string | null {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]);
  for (const name of DATE_NAMES) if (keys.includes(name) && columnIsDates(rows, name)) return name;
  for (const key of keys) if (columnIsDates(rows, key)) return key;
  return null;
}

export function detectTitleColumn(rows: Array<Record<string, unknown>>, dateField: string): string | null {
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]).filter((k) => k !== dateField);
  const isText = (key: string) => rows.slice(0, SAMPLE).some((r) => typeof r[key] === "string" && r[key] !== "");
  for (const name of TITLE_NAMES) if (keys.includes(name) && isText(name)) return name;
  for (const key of keys) if (isText(key) && !columnIsDates(rows, key)) return key;
  return null;
}

/**
 * One wheel gesture, one unit. Trackpads deliver a flick as dozens of small
 * deltas over a few hundred milliseconds; a mouse wheel delivers one big one.
 * Accumulating to a threshold turns both into a single step, and the lock
 * swallows the rest of the flick so it cannot become a second step. A change
 * of direction throws the accumulator away: a hesitant hand should not have
 * to undo its own momentum.
 */
export function createWheelStepper(threshold = 40, lockMs = 300): (deltaY: number, now: number) => -1 | 0 | 1 {
  let acc = 0;
  let lockedUntil = 0;
  return (deltaY, now) => {
    if (now < lockedUntil) return 0;
    if (acc !== 0 && Math.sign(deltaY) !== Math.sign(acc)) acc = 0;
    acc += deltaY;
    if (Math.abs(acc) < threshold) return 0;
    const dir = acc > 0 ? 1 : -1;
    acc = 0;
    lockedUntil = now + lockMs;
    return dir;
  };
}

const EODHD_SYMBOL = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.([A-Za-z]{1,6})$/;

/**
 * The public logo for an EODHD symbol, or null for anything else. EODHD
 * writes symbols as TICKER.EXCHANGE (`AAPL.US`, `DNLM.LSE`) and serves each
 * logo as a static file at `/img/logos/<EXCHANGE>/<ticker>.png` — exchange
 * upper-case, ticker lower-case, no token and no credit (episode 9, *Stock
 * logos*). The last dot is the exchange separator, so a ticker that itself
 * carries a dot still resolves. A plain title ("Core PPI", "3-Year") is not a
 * symbol and gets nothing; that is what keeps the rule safe to apply to
 * every calendar row.
 */
export function eodhdLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = EODHD_SYMBOL.exec(value.trim());
  if (!m) return null;
  return `https://eodhd.com/img/logos/${m[2].toUpperCase()}/${m[1].toLowerCase()}.png`;
}
