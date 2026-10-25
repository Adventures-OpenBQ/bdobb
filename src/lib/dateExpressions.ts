// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  CalendarDate,
  Time,
  ZonedDateTime,
  fromDate,
  getLocalTimeZone,
  parseAbsolute,
  parseDate,
  parseTime,
  toCalendarDateTime,
  toZoned,
} from "@internationalized/date";
import {
  DEFAULT_EXCHANGE,
  addBusinessDays,
  calendarValue,
  isKnownCalendar,
  isOpen,
  newTrace,
  nextOpen,
  prevOpen,
  sessionClose,
  sessionOpen,
  weekdayCalendar,
  type CalendarFrom,
  type CalendarTrace,
  type ExchangeCalendar,
} from "./calendar";
import { calendarSpelling, isOvernight } from "./calendars/catalogue";
import { CalendarError } from "./calendars/contracts";
import { lastCompleted } from "./calendars/operations";
import { expiryBack, parseOptionSymbol } from "./optionSymbol";
import { logOnce } from "./logger";
import {
  fiscalPeriod,
  fiscalYearSpan,
  formatQuarter,
  formatWeek,
  isoWeek,
  isoWeekday,
  quarterSpan,
  unprefixLabel,
  weekSpan,
} from "./periods";

/**
 * The param types whose values are periods. A param of one of these types
 * with no declared groupType is keyed by its type (paramGroups.ts), its
 * control is period-aware (params.ts controlKind), and an expression in its
 * value is projected into the type's own label (resolveValue below).
 */
const PERIOD_TYPE_NAMES = ["date", "datetime", "date_range", "quarter", "fiscal_year", "week", "time", "quarter_range"] as const;
export const PERIOD_TYPES: ReadonlySet<string> = new Set(PERIOD_TYPE_NAMES);
export type PeriodType = (typeof PERIOD_TYPE_NAMES)[number];

export function isPeriodType(type: string | undefined): type is PeriodType {
  return type !== undefined && PERIOD_TYPES.has(type);
}

/**
 * v5.4.0: the two types whose value is a `start/end` composite, sent as two
 * wire params — the control's own name and its `rangeEnd`. A `date_range`
 * resolves each half as a date, a `quarter_range` each half as a quarter.
 */
export function isRangeType(type: string | undefined): type is "date_range" | "quarter_range" {
  return type === "date_range" || type === "quarter_range";
}

/**
 * Where a range splits: the first `/` or `..` outside a `(…)` qualifier, whose `/` is part of a calendar name (`24/7`,
 * 2026-10-24). One linear pass, tracking paren depth, so a long value cannot make it backtrack.
 */
function rangeSeparator(value: string): { at: number; width: number } | undefined {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && c === "/") return { at: i, width: 1 };
    else if (depth === 0 && c === "." && value[i + 1] === ".") return { at: i, width: 2 };
  }
  return undefined;
}

/** True when a value is a composite `start/end` (or `start..end`); the `/` in `(24/7)` does not count. */
export function isRange(value: string): boolean {
  return rangeSeparator(value) !== undefined;
}

/**
 * A composite `start/end` as its two halves; `..` is accepted as the typed
 * spelling of the same range (spec §1) and a value with neither is all start.
 */
export function splitRange(value: string): [string, string] {
  const sep = rangeSeparator(value);
  return sep ? [value.slice(0, sep.at), value.slice(sep.at + sep.width)] : [value, ""];
}

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type Unit = "s" | "min" | "h" | "d" | "bd" | "w" | "m" | "q" | "y" | "fq" | "fy" | Weekday;
export type Offset = { sign: 1 | -1; amount: number; unit: Unit };
export type PeriodLetter = "W" | "M" | "Q" | "Y" | "FQ" | "FY";
export type AnchorName = "T" | "$today" | "now" | "trade_date" | "prev_trade_date" | "session_open" | "session_close"
  // v5.3.0 §2: the data-driven bounds, specified here and first shipped in 5.3.3.
  | "earliest" | "latest";
export type Anchor =
  | { kind: "named"; name: AnchorName }
  | { kind: "period"; period: PeriodLetter; n: number }
  /**
   * An option contract's expiry, `n` monthlies away: back for a minus,
   * forward for a plus. Its own shorthand like
   * a period anchor's, and for the same reason: `EXP-1` has to mean one
   * EXPIRY earlier, and a named anchor would read the `-1` as a day.
   */
  | { kind: "expiry"; n: number };
/**
 * The `@` production (bdobb-v2 v12.3.0, f8fcfdc16): a time of day pinned onto whatever date the anchor and its
 * offsets land on. `clock` is a wall time on the calendar's clock; `open` and `close` are that date's session
 * hours, so an early close shortens `@close` by itself. Only a `datetime` param carries one (atFits).
 */
export type AtTime = { kind: "clock"; hour: number; minute: number } | { kind: "open" } | { kind: "close" };
/**
 * One atom of the grammar: an anchor, its offsets, and the optional suffixes. `calendar` (v4, spec 2026-10-23) is
 * the text of a closing `(MIC)`, upper-cased and NOT validated here: an unknown one must be a visible error, never a
 * literal, so only the resolver may refuse it.
 */
export type Atom = { anchor: Anchor; offsets: Offset[]; at?: AtTime; calendar?: string };
/** `end` is present only for a range, which only a date_range param may hold. */
export type Expression = { start: Atom; end?: Atom };

/**
 * The grammar of the v5.3.0 design, §1:
 *
 *   value      := range | atom
 *   range      := atom ( "/" | ".." ) atom
 *   atom       := anchor ( sign offset )* at? cal?
 *   at         := "@" ( HH ":" MM | "open" | "close" )   -- port of bdobb-v2 v12.3.0
 *   cal        := "(" MIC ")"                              -- v4 calendar qualifier (2026-10-23)
 *   anchor     := "T" | "$currentDate" | "now" | "trade_date" | "prev_trade_date"
 *               | "session_open" | "session_close" | period signed_int
 *   period     := "W" | "M" | "Q" | "Y" | "FQ" | "FY"
 *   offset     := integer unit?
 *   unit       := "s" | "min" | "h" | "d" | "bd" | "w" | "m" | "mo" | "q" | "y" | "fq" | "fy"
 *
 * Case-insensitive since v5.3.4 (it was case-sensitive before; see NAMED
 * below), folded to one canonical spelling; whitespace is allowed between tokens and stripped before
 * anything is matched, so the regexes below see the compact form only. A bare
 * number is days, and `m` and `mo` are both MONTHS (minutes are `min`). The
 * alternations list the longer spellings first (`min`, `mo`, `bd`, `fq`, `fy`,
 * `FQ`, `FY`) because a regex alternation takes the first branch that
 * matches. The offset regex is sticky so that every character after the
 * anchor has to be consumed by an offset — `T-1x` and `TSLA` both fail
 * here and are literals, not half-read expressions (`Today` failed too until
 * v5.3.4 folded case; it is `T` now).
 *
 * The shorthand rule: the integer must follow the period letter DIRECTLY.
 * `Q-4` is the anchor Q with n = -4 (four quarters back); `Q0-4` is the anchor
 * Q0 followed by an ordinary offset of four days. PERIOD's `[+-]?\d{1,6}` is
 * what makes that split: it consumes a sign only when digits follow it at once.
 *
 * An offset amount is at most six digits. A day-stepping resolve walks its
 * amount, so `T-999999999999999999999d` would hang it; with the cap a longer
 * amount leaves a digit the sticky offset regex cannot consume, and the whole
 * value is a literal — sent as-is and logged once, like any other.
 *
 * A business-day (`bd`) amount is capped harder, at four digits. A bd step
 * walks the calendar one trading day at a time, and `T-999999bd` took about
 * 1.36 s per resolve — every card render, every refetch. The regex cannot
 * know the unit before it has read the amount, so parseAtom checks the
 * amount's length once the unit is known; a fifth digit (a leading zero
 * counts, as it does against the six-digit cap) fails the parse and the value
 * is a literal, the same way a seventh digit does.
 *
 * A period shorthand's integer is capped the same way, and for the same
 * reason. `W-9999999999` and `Q-9999999999` resolved synchronously in about
 * 25 s each, so a widgets.json default or hand-edited dashboard carrying one
 * would freeze the webview on every resolve. PERIOD takes at most six digits;
 * a seventh is left for the offset regex, which needs a sign first, so the
 * value is a literal.
 */
// v5.4.0 (OpenBB's dialect, spec §3.1): `today` is a third spelling of the
// `T` anchor, in any case since the whole grammar folds case (below), and a capital `M` in UNIT
// position is a month — `$currentDate-3M`, `T-3M`. It cannot be misread:
// OFFSET only ever sees what follows the anchor, and the `M0` / `M-1`
// anchors live in anchor position, which PERIOD reads first. `Today` used to
// fail here (NAMED took its `T`, and `oday` is no offset); since v5.3.4 it is
// `T`, like every other casing.
//
// v5.3.4 (user ruling 2026-10-01, back-port of main's 69789ec0 of 2026-09-21):
// CASE IS NOT PART OF THE GRAMMAR. It was, in every slot, so `t+fri`, `T-1W`
// and `today-1M` were "not a date" while `T+FRI`, `T-1w` and `today-1m` were.
// The slots -- anchor, unit, weekday -- are distinct positions, so folding
// case cannot make one read as another; and this parser only ever sees
// date-like parameter types (resolveValue's isPeriodType gate), so a symbol
// field's `t` is still a ticker. Every regex below is `i`, parseAtom and
// parseOffsets fold what they captured to the ONE canonical spelling, and
// stringify writes only that -- so what is stored never varies by how it was
// typed. `TSLA`/`tsla` (no offset reads `sla`), `T-1x` and a bare `Q` still
// fail. The one distinction left is about meaning, not case: `m`, `mo` and
// OpenBB's `M` are months, and minutes are `min`. The words come BEFORE the
// single letter: folded, `T` would otherwise take the `t` of `trade_date`.
const NAMED = /^(?:\$today|\$currentDate|today|trade_date|prev_trade_date|session_open|session_close|earliest|latest|now|T)/i;
// Three digits at most, so a four-digit year (`Q12024` from `Q1 2024`, `Y2024`) is not a shorthand count.
const PERIOD = /^(FQ|FY|W|M|Q|Y)([+-]?\d{1,3})/i;
/** Label spellings the shorthand would misread: `FY24` (not FY+24), `Q3-2025` (not Q+3 less 2025 days). */
const PERIOD_LABEL = /^(?:FY\d{2}|(?:FQ|Q|W|M)[1-9]\d?-\d{4})$/i;
/** `EXP`, `EXP-1`: the count is optional and bare means this contract's own. */
const EXPIRY = /^EXP([+-]?\d{1,6})?/i;
const OFFSET = /([+-])(\d{1,6})(min|mo|bd|fq|fy|s|h|d|w|m|q|y)?/iy;
// v4 calendar qualifier: `(MIC)` closes the atom and names the calendar for all of it. Whatever is between the
// parentheses is kept for the resolver to judge, in the catalogue's spelling when it names a calendar, else
// upper-cased (whitespace is already gone: parseExpression strips it), so `T(FOO)` reaches the resolver as "Unknown
// calendar FOO" rather than becoming a literal. An unclosed `T(XNYS` or an empty `T()` is no suffix at all, and the
// value stays a literal like any other text this grammar cannot read.
const CAL = /\(([^()]+)\)$/;
// The `@` suffix, taken off the end before the offsets are read so the sticky OFFSET loop still has to consume
// every character before it. Two digits each side of the colon; `i` like the rest of the grammar (v5.3.4), so
// `@Open` and `@CLOSE` read as `@open` and `@close`.
const AT = /@(?:(\d{2}):(\d{2})|(open)|(close))$/i;

/** The `@` suffix as an AtTime, or null when it matched but names no time (`@25:00`). */
function atOf(m: RegExpExecArray): AtTime | null {
  if (m[3]) return { kind: "open" };
  if (m[4]) return { kind: "close" };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour > 23 || minute > 59 ? null : { kind: "clock", hour, minute };
}
/**
 * A weekday step: `-SAT`, `+2SUN`. The count is optional and defaults to 1 --
 * `T-SAT` reads as "the Saturday on or before today", not "zero Saturdays
 * ago". ON OR BEFORE / ON OR AFTER (user ruling 2026-09-29, back-ported from
 * main's 8b50cc09 on 2026-10-01, replacing this line's "strictly"): on a
 * Monday `T-MON` is today, and `T-2MON` is the Monday a week before that.
 * See applyOffset for the arithmetic.
 *
 * Tried BEFORE OFFSET, and that order is load-bearing: `M` is a month and
 * `MON` begins with one, so the unit regex would take `2M` out of `2MON` and
 * leave a stray `ON` that nothing can consume -- turning `T-2MON` into a
 * literal rather than an error. Reading weekdays first keeps `T-2M` a month
 * and `T-2MON` a Monday.
 *
 * `i`, unlike the rest of this line's grammar (back-ported with the ruling
 * above, as main ships them together): upper case only made `T-Mon` -- what
 * was actually typed in the 2026-09-29 demo -- a literal. The capture folds
 * to the canonical `MON` in parseOffsets. Nothing it now admits was an
 * expression before: `-2mon` was a month with a stray `on`, and a weekday
 * name never follows a unit (`-1w` is a week, `-1wed` a Wednesday). The
 * other anchors and units stayed case-sensitive here until v5.3.4 folded
 * the whole grammar (see NAMED above).
 */
const WEEKDAY_OFFSET = /([+-])(\d{1,6})?(MON|TUE|WED|THU|FRI|SAT|SUN)/iy;
const WEEKDAY_INDEX: Record<Weekday, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 0 };
const isWeekday = (unit: Unit): unit is Weekday => unit in WEEKDAY_INDEX;

/** One atom: its `(MIC)` and `@` suffixes come off the end first, then the anchor and offsets are read as before. */
function parseAtom(input: string): Atom | null {
  const cal = CAL.exec(input);
  const rest = cal ? input.slice(0, cal.index) : input;
  const suffix = AT.exec(rest);
  const at = suffix ? atOf(suffix) : undefined;
  if (suffix && !at) return null;
  const core = parseCore(suffix ? rest.slice(0, suffix.index) : rest);
  if (!core) return null;
  // The keys are left off entirely when absent: an atom without a suffix is the object it has always been.
  // A catalogue calendar keeps its own spelling (`us_futures`, `24/7`) in any case (ruling P14); anything else is
  // upper-cased for the resolver's "Unknown calendar" message.
  const calendar = cal ? calendarSpelling(cal[1]) : undefined;
  return { ...core, ...(at ? { at } : {}), ...(calendar ? { calendar } : {}) };
}

/** An atom's anchor and offsets, with no suffix: the grammar as it stood before `@` and `(MIC)`. */
function parseCore(text: string): Atom | null {
  // v5.4.0: `FY2026` / `FY2026-Q3` are labels, not `FY+2026` — see unprefixLabel.
  if (unprefixLabel(text) !== text || PERIOD_LABEL.test(text)) return null;
  /**
   * The readings to try, best first. More than one exists only for a counted
   * anchor whose digits the greedy match took: `Q-4w` reads as the shorthand
   * `Q-4` with a stray `w`, and as `Q0` with a `-4w` offset. The first is
   * tried first, so `Q-4` keeps meaning four quarters back; the second is
   * reached only when the first cannot consume the whole atom, which is
   * exactly when the first is wrong.
   *
   * The fallback needs a sign after the anchor. Without that guard a bare
   * `Q`, `M` or `EXP` would start resolving as "start of this period" -- and
   * those are Macy's, a former ticker, and Eagle Materials.
   */
  const candidates: { anchor: Anchor; consumed: number }[] = [];
  const exp = EXPIRY.exec(text);
  const named = exp ? null : NAMED.exec(text);
  if (exp) {
    candidates.push({ anchor: { kind: "expiry", n: exp[1] === undefined ? 0 : Number(exp[1]) }, consumed: exp[0].length });
    if (exp[1] !== undefined) candidates.push({ anchor: { kind: "expiry", n: 0 }, consumed: 3 });
  } else if (named) {
    // `$currentDate` and `today` are spellings of T and still collapse into
    // it. `$today` deliberately does NOT: it is the one token that means the
    // START of the day rather than this instant, and collapsing it would
    // erase that.
    // Folded to the canonical spelling: `T` is a capital, every word lowercase
    // (`$today` included), so `TODAY`, `$CurrentDate` and `t` are all `T`.
    const word = named[0].toLowerCase();
    candidates.push({
      anchor: { kind: "named", name: word === "$currentdate" || word === "today" || word === "t" ? "T" : (word as AnchorName) },
      consumed: named[0].length,
    });
  } else {
    const p = PERIOD.exec(text);
    // A fourth digit is an over-long count, never "W0 less 1000 days": the whole value is a literal.
    if (!p || /^\d/.test(text.slice(p[0].length))) return null;
    const period = p[1].toUpperCase() as PeriodLetter;
    candidates.push({ anchor: { kind: "period", period, n: Number(p[2]) }, consumed: p[0].length });
    candidates.push({ anchor: { kind: "period", period, n: 0 }, consumed: p[1].length });
  }
  for (const candidate of candidates) {
    const offsets = parseOffsets(text, candidate.consumed);
    if (offsets !== null) return { anchor: candidate.anchor, offsets };
  }
  return null;
}

/** Every offset from `from` to the end, or null when any of it is unreadable. */
function parseOffsets(text: string, from: number): Offset[] | null {
  const offsets: Offset[] = [];
  let cursor = from;
  while (cursor < text.length) {
    const at = cursor;
    // Weekdays first -- see WEEKDAY_OFFSET on why the order matters.
    WEEKDAY_OFFSET.lastIndex = at;
    const wd = WEEKDAY_OFFSET.exec(text);
    if (wd && wd.index === at) {
      // No count means one: `T-SAT` is the nearest Saturday on or before today.
      // A written zero means nothing -- "zero Mondays back" -- and applyOffset's
      // `amount - 1` weeks would turn it round to point the other way, so
      // `T-0MON` is a failed parse, not the next Monday.
      if (wd[2] !== undefined && Number(wd[2]) === 0) return null;
      offsets.push({ sign: wd[1] === "-" ? -1 : 1, amount: wd[2] === undefined ? 1 : Number(wd[2]), unit: wd[3].toUpperCase() as Weekday });
      cursor = WEEKDAY_OFFSET.lastIndex;
      continue;
    }
    OFFSET.lastIndex = at;
    const m = OFFSET.exec(text);
    if (!m || m.index !== at) return null;
    // `mo` and OpenBB's capital `M` both fold to `m`, a month; `MIN` folds to `min`.
    const typed = m[3]?.toLowerCase();
    const unit: Unit = typed === undefined ? "d" : typed === "mo" ? "m" : (typed as Unit);
    if (unit === "bd" && m[2].length > 4) return null;
    offsets.push({ sign: m[1] === "-" ? -1 : 1, amount: Number(m[2]), unit });
    cursor = OFFSET.lastIndex;
  }
  return offsets;
}

export function parseExpression(value: string): Expression | null {
  const text = value.replace(/\s+/g, "");
  if (!isRange(text)) {
    const start = parseAtom(text);
    return start ? { start } : null;
  }
  const [a, b] = splitRange(text);
  const start = parseAtom(a);
  const end = parseAtom(b);
  return start && end ? { start, end } : null;
}

/**
 * The canonical (stored) form: compact, every unit written (`T-1` is `T-1d`),
 * a period anchor's n as the shorthand it was read from, `/` between the
 * halves of a range. Apply on the Relative tab writes this; nothing else
 * rewrites a stored value.
 */
export function stringifyAtom(atom: Atom): string {
  const { anchor } = atom;
  const signed = (n: number) => (n === 0 ? "0" : n > 0 ? `+${n}` : String(n));
  const head =
    anchor.kind === "named"
      ? anchor.name
      : anchor.kind === "expiry"
        ? `EXP${signed(anchor.n)}`
        : `${anchor.period}${signed(anchor.n)}`;
  return (
    head +
    atom.offsets.map((o) => `${o.sign < 0 ? "-" : "+"}${o.amount}${o.unit}`).join("") +
    stringifyAt(atom.at) +
    (atom.calendar === undefined ? "" : `(${atom.calendar})`)
  );
}

/** The `@` suffix, written back two-digit as the parser reads it. */
function stringifyAt(at: AtTime | undefined): string {
  if (at === undefined) return "";
  if (at.kind !== "clock") return `@${at.kind}`;
  return `@${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`;
}

export function stringifyExpression(expr: Expression): string {
  return expr.end ? `${stringifyAtom(expr.start)}/${stringifyAtom(expr.end)}` : stringifyAtom(expr.start);
}

/** OpenBB's `$currentDate` units, as OpenBB writes them: a month is a capital `M`. */
const OPENBB_UNIT: Partial<Record<Unit, string>> = { h: "h", d: "d", w: "w", m: "M", y: "y" };

/** One atom in OpenBB's form, or null when it needs the extended grammar. */
function openbbAtom(atom: Atom): string | null {
  // OpenBB's dialect has neither suffix; writing $currentDate would drop it silently.
  if (
    atom.anchor.kind !== "named" ||
    atom.anchor.name !== "T" ||
    atom.offsets.length > 1 ||
    atom.at !== undefined ||
    atom.calendar !== undefined
  )
    return null;
  const [offset] = atom.offsets;
  if (!offset) return "$currentDate";
  const unit = OPENBB_UNIT[offset.unit];
  return unit === undefined ? null : `$currentDate${offset.sign < 0 ? "-" : "+"}${offset.amount}${unit}`;
}

/**
 * v5.4.0's save format (spec §3.2), and the one serializer everything that
 * WRITES an expression goes through: the Relative tab's Apply and preset
 * save (both via expressionFromRows). An atom
 * anchored on `T` with at most one offset in `h`, `d`, `w`, months or `y` is
 * written as OpenBB writes it — `$currentDate-3M` — so a dashboard exported
 * to Workspace reads in its own dialect; a range takes that form only when
 * BOTH halves do. Everything else keeps the extended spelling
 * stringifyExpression has always written (`T-5bd`, `FQ-4`, `T-7d/trade_date`).
 * Nothing reads this back differently: `$currentDate` parses as `T`.
 */
export function serializeExpression(expr: Expression): string {
  const start = openbbAtom(expr.start);
  if (!expr.end) return start ?? stringifyAtom(expr.start);
  const end = openbbAtom(expr.end);
  return start !== null && end !== null ? `${start}/${end}` : stringifyExpression(expr);
}

/** Everything resolveValue reads besides the value: the clock, the zone, and the calendars an atom may resolve on. */
export type ResolveContext = {
  now?: Date;
  zone?: string;
  fiscalYearEnd?: number;
  /** The param's exchange (a MIC). Only the weekday table needs it when no calendar is given. */
  exchange?: string;
  calendar?: ExchangeCalendar;
  /** When given, filled in with the years consulted and whether a fallback answered. */
  trace?: CalendarTrace;
  /**
   * v5.3.0 §3 `data_bounds`, for `earliest` / `latest`: the first and last instant of
   * the data the widget has reported. Either may be missing -- a widget that has
   * loaded nothing yet has neither -- and the anchor that needs a missing one DEFERS:
   * resolveValue leaves the value out of the query, so the provider answers from its
   * own earliest (or to its own latest), which is what the word asked for.
   */
  bounds?: { min?: Date; max?: Date };
  /**
   * The card's symbol, for the `EXP` anchor. Only an OCC option symbol
   * answers it; anything else leaves `EXP` a literal.
   */
  symbol?: string;
  /** Every loaded calendar by key, for an atom's own `(MIC)` (spec precedence step 1). */
  calendars?: Record<string, ExchangeCalendar>;
  /**
   * Which precedence step chose `exchange` (calendarOf). A wall-clock `@HH:MM` reads the calendar's clock whatever
   * it is (ruling P13).
   */
  from?: CalendarFrom;
  /** An opted-in (calendarBinding) card: a calendar that is not loaded is an error, never the weekday table. */
  strict?: boolean;
  /**
   * Told why a value cannot resolve. The value is then "" -- never a literal, never XNYS -- and the caller shows why.
   * Without it, resolveValue rethrows the CalendarError, so a caller that wants the typed error keeps it (ruling P1).
   */
  onError?: (message: string) => void;
};

type CalendarContext = Pick<
  ResolveContext,
  "fiscalYearEnd" | "exchange" | "calendar" | "calendars" | "strict" | "trace" | "symbol" | "bounds"
>;

/** The first day of the period `at` falls in, as a calendar date in `at`'s zone. */
function periodStart(period: PeriodLetter, at: ZonedDateTime, fiscalYearEnd: number): CalendarDate {
  const date = new CalendarDate(at.year, at.month, at.day);
  switch (period) {
    case "W":
      return weekSpan(isoWeek(date)).start;
    case "M":
      return new CalendarDate(date.year, date.month, 1);
    case "Q":
      return new CalendarDate(date.year, Math.floor((date.month - 1) / 3) * 3 + 1, 1);
    case "Y":
      return new CalendarDate(date.year, 1, 1);
    case "FQ":
      return quarterSpan(fiscalPeriod(date, fiscalYearEnd), fiscalYearEnd).start;
    case "FY":
      return fiscalYearSpan(fiscalPeriod(date, fiscalYearEnd).fy, fiscalYearEnd).start;
  }
}

/** The period's own unit: `Q-4` means `Q0 - 4q` (spec §1). */
export const PERIOD_UNIT: Record<PeriodLetter, Unit> = { W: "w", M: "m", Q: "q", Y: "y", FQ: "fq", FY: "fy" };

// Weekdays are excluded with `bd`, and for the same reason: neither is a
// duration this table can add. Both are handled before it in applyOffset.
const UNIT_FIELD: Record<
  Exclude<Unit, "bd" | Weekday>,
  "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "years"
> = { s: "seconds", min: "minutes", h: "hours", d: "days", w: "weeks", m: "months", q: "months", y: "years", fq: "months", fy: "years" };

/**
 * One offset, by @internationalized/date arithmetic — which is what clamps
 * Jan 31 + 1 month to Feb 28/29 rather than rolling into March. Quarters
 * (`q`, `fq`) are three months, `fy` twelve; `fq`/`fy` are the same
 * arithmetic as `q`/`y` and read naturally after an FQ0/FY0 anchor, whose
 * START is what is fiscal-aligned. Subtraction goes through `subtract` rather
 * than a negative `add` so the clamping direction is the library's own for
 * both signs. `bd` is the one unit that is not arithmetic: it walks the
 * exchange calendar.
 */
function applyOffset(at: ZonedDateTime, o: Offset, cal: ExchangeCalendar, trace: CalendarTrace | undefined): ZonedDateTime {
  if (o.unit === "bd") return addBusinessDays(cal, at, o.sign * o.amount, trace);
  /**
   * A weekday step: the `amount`-th MON..SUN ON OR BEFORE / ON OR AFTER the
   * date we are on (user ruling 2026-09-29, back-ported from main's 8b50cc09;
   * this line was strict until 5.3.4). On a Monday `T-MON` and `T+MON` are
   * both today, and each further count is another week out: on Tuesday
   * 2026-09-29, `T-MON` is 09-28, `T-2MON` 09-21, `T+FRI` 10-02 and `T+2FRI`
   * 10-09.
   *
   * Arithmetic, not a walk. The distance to the nearest such weekday is the
   * difference mod 7 (0 when it is today), and each further one is another
   * seven days. A loop would be fine for `-2SAT` and ruinous for the six
   * digits the grammar admits.
   *
   * Pure calendar: no exchange is consulted, because a Saturday is a
   * Saturday whatever is trading. `bd` and `trade_date` are the trading
   * answers and already exist.
   */
  if (isWeekday(o.unit)) {
    const date = new CalendarDate(at.year, at.month, at.day);
    // 0 = Sunday, matching WEEKDAY_INDEX.
    const current = isoWeekday(date) % 7;
    const target = WEEKDAY_INDEX[o.unit];
    const raw = o.sign < 0 ? (current - target + 7) % 7 : (target - current + 7) % 7;
    const days = raw + 7 * (o.amount - 1);
    const moved = o.sign < 0 ? date.subtract({ days }) : date.add({ days });
    return at.set({ year: moved.year, month: moved.month, day: moved.day });
  }
  const amount = o.unit === "q" || o.unit === "fq" ? 3 * o.amount : o.amount;
  const duration = { [UNIT_FIELD[o.unit]]: amount };
  return o.sign < 0 ? at.subtract(duration) : at.add(duration);
}

/** Today's date on the exchange's own clock. */
function exchangeDate(cal: ExchangeCalendar, now: Date): CalendarDate {
  const at = fromDate(now, cal.timezone);
  return new CalendarDate(at.year, at.month, at.day);
}

/**
 * The most recent COMPLETED session: today's, once its close is at or before
 * now; otherwise the last open day before today. Both the date test and the
 * close instant are the exchange's, so a New York session that ended an hour
 * ago is "today's" to a user in Tokyo whose own date has already turned.
 */
function tradeDate(cal: ExchangeCalendar, now: Date, trace: CalendarTrace | undefined): CalendarDate {
  if (cal.sessionIndex)
    return parseDate(calendarValue(cal, lastCompleted(cal.sessionIndex, now.toISOString(), cal.calendarPolicy), trace));
  const date = exchangeDate(cal, now);
  if (isOpen(cal, date, trace) && sessionClose(cal, date, trace).toDate().getTime() <= now.getTime()) return date;
  return prevOpen(cal, date.subtract({ days: 1 }), trace);
}

/**
 * Every anchor as an instant (spec §1's table). `T` and `now` are the same
 * instant here — they differ only in which controls offer them. The trading
 * anchors live in the exchange's zone: a `date` param then projects them to
 * the exchange-local date (projectValue reads the instant's own y/m/d), and a
 * `datetime` param carries that zone's offset on the wire.
 */
function resolveAnchor(
  anchor: Anchor,
  now: Date,
  zone: string,
  fiscalYearEnd: number,
  cal: ExchangeCalendar,
  trace: CalendarTrace | undefined,
  symbol: string | undefined,
  bounds: { min?: Date; max?: Date } | undefined,
): ZonedDateTime | null {
  /**
   * An option contract's expiry, from the SYMBOL -- an OCC symbol carries it,
   * so nothing is looked up. Null when there is no symbol, when it is not an
   * option (an equity has no expiry; a future's is a per-root exchange rule
   * and wants the security master), or when stepping back from a contract
   * that is not a monthly. Every one of those is refused rather than guessed:
   * a plausible wrong expiry is worse than no answer, and the value stays a
   * literal the way any unparseable one does.
   */
  if (anchor.kind === "expiry") {
    const option = symbol === undefined ? null : parseOptionSymbol(symbol);
    if (!option) return null;
    /**
     * A dead contract has no expiry to name, so it refuses like every other
     * unanswerable case here.
     *
     * Live THROUGH its expiry date: an option trades to the close that day,
     * and cutting its last session off would be wrong. Dead from the next
     * day. The comparison is against the EXCHANGE's date, not the viewer's --
     * Saturday morning in Tokyo is still Friday where the contract trades.
     *
     * The cost, accepted deliberately: looking back at a contract that has
     * already expired now refuses too. `EXP` names a live contract's expiry.
     */
    if (option.expiry.compare(exchangeDate(cal, now)) < 0) return null;
    // Negated, not Math.abs: `EXP-1` is one back and `EXP+1` one forward
    // (expiryBack takes a signed count). Math.abs once read `EXP+1` as `EXP-1`.
    const date = expiryBack(cal, option.expiry, -anchor.n, trace);
    return date === null ? null : toZoned(toCalendarDateTime(date), cal.timezone);
  }
  if (anchor.kind === "period") {
    const start = toZoned(toCalendarDateTime(periodStart(anchor.period, fromDate(now, zone), fiscalYearEnd)), zone);
    if (anchor.n === 0) return start;
    return applyOffset(start, { sign: anchor.n < 0 ? -1 : 1, amount: Math.abs(anchor.n), unit: PERIOD_UNIT[anchor.period] }, cal, trace);
  }
  switch (anchor.name) {
    // v5.3.0 §2: data-driven, so unresolvable until the widget has reported some.
    case "earliest":
      return bounds?.min ? fromDate(bounds.min, zone) : null;
    case "latest":
      return bounds?.max ? fromDate(bounds.max, zone) : null;
    case "T":
    case "now":
      return fromDate(now, zone);
    /**
     * The START of today, where T is this instant. On a `date` param the two
     * are identical -- the projection throws the time away -- so this only
     * shows itself on a `datetime`, which is exactly where `T` surprises
     * people by carrying the current clock.
     *
     * The VIEWER's zone, like T, not the exchange's: "today" here is a
     * calendar notion, not a trading one. `session_open` is the trading
     * answer and already exists.
     *
     * A new token rather than a redefinition of `$currentDate`, which is what
     * serializeExpression WRITES for every T-anchored expression the user
     * applies or saves -- redefining it would have silently rewritten every
     * dashboard the app itself had written.
     */
    case "$today": {
      const at = fromDate(now, zone);
      return toZoned(toCalendarDateTime(new CalendarDate(at.year, at.month, at.day), new Time(0, 0, 0, 0)), at.timeZone);
    }
    case "trade_date":
      return sessionClose(cal, tradeDate(cal, now, trace), trace);
    case "prev_trade_date":
      return sessionClose(cal, prevOpen(cal, tradeDate(cal, now, trace).subtract({ days: 1 }), trace), trace);
    case "session_open":
      return sessionOpen(cal, nextOpen(cal, exchangeDate(cal, now), trace), trace);
    case "session_close":
      return sessionClose(cal, nextOpen(cal, exchangeDate(cal, now), trace), trace);
  }
}

/**
 * The `@` production, applied LAST -- after every offset -- onto the instant's date on `clockZone`'s clock. `@open`
 * and `@close` read that date's session from the calendar, and a closed date takes the NEXT session's (the spec's
 * "FQ0@open(XHKG): the first Hong Kong session open of the fiscal quarter"), as `session_open` already does.
 * No separate consult: nextOpen records the year on a legacy calendar, and consulting a bundle calendar would raise a
 * false fallback warning (ruling P3).
 */
function applyAt(
  instant: ZonedDateTime,
  at: AtTime,
  cal: ExchangeCalendar,
  clockZone: string,
  trace?: CalendarTrace,
): ZonedDateTime {
  if (at.kind === "clock") {
    const local = fromDate(instant.toDate(), clockZone);
    const date = new CalendarDate(local.year, local.month, local.day);
    return toZoned(toCalendarDateTime(date, new Time(at.hour, at.minute)), clockZone);
  }
  const local = fromDate(instant.toDate(), cal.timezone);
  const session = nextOpen(cal, new CalendarDate(local.year, local.month, local.day), trace);
  return at.kind === "open" ? sessionOpen(cal, session, trace) : sessionClose(cal, session, trace);
}

/**
 * `@` names a time of day, and only a `datetime` param carries one on the wire; anywhere else the suffix would be
 * silently meaningless, so the value is a literal instead (no preview, sent as stored).
 */
function atFits(type: PeriodType, expr: Expression): boolean {
  return type === "datetime" || (expr.start.at === undefined && expr.end?.at === undefined);
}

const TRADING_ANCHORS: ReadonlySet<string> = new Set([
  "trade_date",
  "prev_trade_date",
  "session_open",
  "session_close",
]);

/** Whether an atom reads a calendar at all: a `bd` step, a trading or expiry anchor, or an `@`. */
function needsCalendar(atom: Atom): boolean {
  return (
    atom.at !== undefined ||
    atom.anchor.kind === "expiry" ||
    (atom.anchor.kind === "named" && TRADING_ANCHORS.has(atom.anchor.name)) ||
    atom.offsets.some((o) => o.unit === "bd")
  );
}

/** A placeholder calendar refuses every atom that needs a calendar; any other atom only reads its zone. */
function usable(cal: ExchangeCalendar, atom: Atom): ExchangeCalendar {
  if (cal.unavailable !== undefined && needsCalendar(atom)) {
    throw new CalendarError("CALENDAR_UNAVAILABLE", cal.unavailable);
  }
  return cal;
}

/**
 * The calendar one atom resolves on: its own `(MIC)` first (spec step 1), else the field's (calendarOf, steps 2-6).
 * A field calendar the caller already chose answers first, whatever its key (ruling P1: a bundle calendar is keyed by
 * calendar id, not by MIC). An explicit unknown MIC is always an error (`T(XNYZ)`); a field-level unknown one only
 * where the atom needs a calendar, since `T-7d` on an XNAS widget runs on no exchange's hours. A widget's binding key
 * ("binding:{...}") is the one non-MIC key. On an opted-in card a calendar that is not loaded is an error, never the
 * weekday table. An overnight calendar (CMES, 24/7, …) is held to the same rule on every card.
 */
function atomCalendar(atom: Atom, ctx: CalendarContext): ExchangeCalendar {
  if (atom.calendar === undefined && ctx.calendar) return usable(ctx.calendar, atom);
  const mic = atom.calendar ?? ctx.exchange ?? DEFAULT_EXCHANGE;
  const known = isKnownCalendar(mic) || mic.startsWith("binding:");
  if (!known && (atom.calendar !== undefined || needsCalendar(atom))) {
    throw new CalendarError("UNKNOWN_CALENDAR", `Unknown calendar ${mic}`);
  }
  const cal = ctx.calendars?.[mic];
  if (cal) return usable(cal, atom);
  // Spec "Overnight calendars": a session crossing midnight cannot be worked out on weekdays, on any card.
  if ((ctx.strict || isOvernight(mic)) && needsCalendar(atom)) {
    throw new CalendarError("CALENDAR_UNAVAILABLE", `No ${mic} calendar loaded`);
  }
  // Calendar-free (ruling P2): a stand-in only its zone is read from, so `T-7d` on an unknown key never throws.
  return weekdayCalendar(isKnownCalendar(mic) ? mic : DEFAULT_EXCHANGE);
}

/**
 * One atom as an instant. A range value (two atoms) is not resolved here:
 * resolveValue splits it and resolves each half through this function, so a
 * range reaching this function directly answers null and is a literal.
 */
export function resolveExpression(
  value: string,
  now: Date,
  zone: string = getLocalTimeZone(),
  ctx: CalendarContext = {},
): ZonedDateTime | null {
  const expr = parseExpression(value);
  if (!expr || expr.end) return null;
  const atom = expr.start;
  const cal = atomCalendar(atom, ctx);
  let at = resolveAnchor(atom.anchor, now, zone, ctx.fiscalYearEnd ?? 12, cal, ctx.trace, ctx.symbol, ctx.bounds);
  if (at === null) return null;
  for (const offset of atom.offsets) at = applyOffset(at, offset, cal, ctx.trace);
  // Ruling P13: a wall clock is the calendar's, Default (XNYS) included -- the spec's "on the calendar's clock".
  if (atom.at) at = applyAt(at, atom.at, cal, cal.timezone, ctx.trace);
  // Past year 1 the calendar wraps into era BC; past 9999 it clamps to 9999-12-31. Either is a literal, not a date.
  if (at.era !== "AD" || (at.year === 9999 && at.month === 12 && at.day === 31)) return null;
  return at;
}

/**
 * `2026-09-14T09:30:15-04:00`: local time to the second with the UTC offset
 * and WITHOUT the `[America/New_York]` suffix ZonedDateTime.toString() adds.
 * The millisecond is zeroed first — toString() prints a fraction only when it
 * is non-zero — so a non-zero millisecond can never leak a fractional second
 * onto the wire. Zeroing goes through `subtract`, not `set({ millisecond: 0 })`:
 * `set` re-resolves the wall-clock time with 'compatible' disambiguation, which
 * during the DST fall-back repeated hour silently picks the earlier offset —
 * `subtract` keeps the offset the instant already had.
 */
export const wireDatetime = (at: ZonedDateTime): string =>
  at.subtract({ milliseconds: at.millisecond }).toString().replace(/\[.*\]$/, "");

export const wireTime = (t: Time): string => t.set({ millisecond: 0 }).toString();

const orNull = <T>(parse: () => T): T | null => {
  try {
    return parse();
  } catch {
    return null;
  }
};

/** A stored literal, or null when it is not one (an expression, junk, ""). */
export const parseWireDate = (value: string): CalendarDate | null => orNull(() => parseDate(value));

export const parseWireDatetime = (value: string, zone: string = getLocalTimeZone()): ZonedDateTime | null =>
  orNull(() => parseAbsolute(value, zone));

export const parseWireTime = (value: string): Time | null => orNull(() => parseTime(value));

/**
 * The instant, in the param's own vocabulary. A quarter param holding `T-1`
 * shows the quarter containing yesterday; `T-1q` the previous quarter. Units
 * below a day (`s`, `min`, `h`) were already applied by resolveExpression, so
 * `T-1h` at 00:30 projects to yesterday's date.
 */
export function projectValue(type: PeriodType, at: ZonedDateTime, fiscalYearEnd = 12): string {
  const date = new CalendarDate(at.year, at.month, at.day);
  switch (type) {
    case "date":
    case "date_range":
      return date.toString();
    case "datetime":
      return wireDatetime(at);
    case "week":
      return formatWeek(isoWeek(date));
    case "quarter":
    case "quarter_range":
      return formatQuarter(fiscalPeriod(date, fiscalYearEnd));
    case "fiscal_year":
      return String(fiscalPeriod(date, fiscalYearEnd).fy);
    case "time":
      return wireTime(new Time(at.hour, at.minute, at.second));
  }
}

/**
 * Something that was MEANT as a token but does not parse. Only these are
 * logged: a symbol like `TSLA` also starts with `T` and must not be reported
 * as a broken expression on every request. The non-period path below has
 * its own, narrower notion of "looks like a token" (`$currentDate` only; `T`
 * is never a token off a period type), and only a `$currentDate` value ever
 * reaches this test from there — which it always matches.
 */
const LOOKS_LIKE_TOKEN = /^(?:\$currentDate|today|T[+-]|now|trade_date|prev_trade_date|session_open|session_close|(?:FQ|FY|W|M|Q|Y)[+-]?\d)/i;

/**
 * The v3–v5.1 spelling of "today". Since v5.2.0 it is an alias of the `T`
 * anchor above and accepts the same offsets, so OpenBB's own
 * `$currentDate-1w` resolves without a special case. The one copy of the
 * constant: params.ts, which used to export its own, imports resolveValue
 * from this module instead.
 */
const CURRENT_DATE_TOKEN = "$currentDate";

/** Whether a value is an expression anchored on the data's own bounds. */
export function namesBounds(value: string): boolean {
  const expr = parseExpression(value);
  const bound = (atom: Atom): boolean =>
    atom.anchor.kind === "named" && (atom.anchor.name === "earliest" || atom.anchor.name === "latest");
  return expr !== null && (bound(expr.start) || (expr.end !== undefined && bound(expr.end)));
}

/**
 * One stored value as the wire carries it.
 *
 * `T` (and its offsets) resolves only when `type` is one of PERIOD_TYPES: a
 * date/datetime/date_range/quarter/fiscal_year/week/time param's control is
 * period-aware, so `T` unambiguously means "now" there. Every other type —
 * `text`, `undefined` (an untyped param, or a plain params-object key such as
 * a form field, none of which carry a declared type through this call).
 * Because a bare `T` is also a valid stock ticker (AT&T), resolving it off a
 * period type would silently rewrite that symbol on every request. On that
 * path only `$currentDate` (bare, or with an offset) resolves — the v5.0.0
 * rule, kept unconditionally because `$currentDate` was never a plausible
 * literal value for anything.
 *
 * A `date_range` resolves each half of `start/end` as a date and keeps the
 * slash (wireParams in params.ts is what splits it into two query params).
 */
export function resolveValue(type: string | undefined, value: string, ctx: ResolveContext = {}): string {
  const now = ctx.now ?? new Date();
  const zone = ctx.zone ?? getLocalTimeZone();

  const one = (k: PeriodType, v: string): string => {
    // The whole context, not a field-by-field copy: a field left out of a copy
    // is not a type error, it is an anchor that silently refuses.
    const expr = parseExpression(v);
    let at: ZonedDateTime | null = null;
    try {
      // Ruling R7a: an `@` on a param with no time of day is refused, never sent as the literal it used to be.
      if (expr !== null && !atFits(k, expr)) {
        throw new CalendarError("AT_NEEDS_DATETIME", "@ needs a date-and-time parameter");
      }
      if (expr !== null) at = resolveExpression(v, now, zone, ctx);
      // Review I2 (R7a): a qualified atom that resolves to nothing -- `EXP(XLON)` on a non-option symbol, an expired
      // contract, a date past 9999 -- is refused, never sent with its `(MIC)` or `@`. An unqualified one stays the
      // literal it always was, and a bound with no data defers (below).
      const qualified = (a?: Atom) => a !== undefined && (a.calendar !== undefined || a.at !== undefined);
      if (expr !== null && at === null && !namesBounds(v) && (qualified(expr.start) || qualified(expr.end))) {
        throw new CalendarError("UNRESOLVED_EXPRESSION", `Cannot resolve ${v}`);
      }
    } catch (e) {
      if (!(e instanceof CalendarError) || !ctx.onError) throw e;
      // Spec: never a literal and never XNYS. Empty is "not set" to every caller; onError says why, and the
      // sending path (sendParams) refuses the request.
      ctx.onError(e.message);
      return "";
    }
    if (at) return projectValue(k, at, ctx.fiscalYearEnd ?? 12);
    // v5.3.0 §5: "if the widget hasn't yet reported bounds, the resolver defers". An
    // `earliest` / `latest` there is no bound for is REFUSED -- empty, which every
    // caller already treats as "not set" (an empty value is left out of the query) --
    // rather than echoed: the "send it as-is" rule below is for a token this grammar
    // does not know, and these are words it does.
    if (namesBounds(v)) return "";
    // v5.4.0 (spec §4.9): a label in OpenBB's `FY` spelling is sent unprefixed.
    if (k === "quarter" || k === "fiscal_year") {
      const compact = v.replace(/\s+/g, "");
      const label = unprefixLabel(compact);
      if (label !== compact) return label;
    }
    if (LOOKS_LIKE_TOKEN.test(v)) {
      void logOnce(`param-token:${v}`, `unsupported date token, sent as-is: ${v}`);
    }
    return v;
  };

  if (isPeriodType(type)) {
    if (isRangeType(type) && isRange(value)) {
      const [start, end] = splitRange(value);
      // v5.4.0: a quarter_range's halves are quarters under the same year end.
      const half = type === "quarter_range" ? "quarter" : "date";
      return `${one(half, start)}/${one(half, end)}`;
    }
    return one(type, value);
  }

  // Non-period path: only $currentDate is a token here; T is left alone
  // (a symbol field's "T" is AT&T, not an anchor) and any other value passes
  // through untouched and unlogged.
  return value.startsWith(CURRENT_DATE_TOKEN) ? one("date", value) : value;
}

/**
 * resolveValue for a caller that only shows or keeps the value -- a control, the Date expression card, a table
 * filter, a form field. A value that cannot resolve comes back as typed instead of throwing during render (ruling
 * R9b); the senders go through sendParams, which refuses it.
 */
export function resolveForDisplay(type: string | undefined, value: string, ctx: ResolveContext = {}): string {
  let failed = false;
  const out = resolveValue(type, value, { ...ctx, onError: () => (failed = true) });
  return failed ? value : out;
}

/**
 * The Relative tab's line under its rows. `error` is why the expression cannot resolve (the text is then empty);
 * `provisional` marks a planning-v1 answer that rested on a provisional calendar day.
 */
export type Preview = { text: string; fallback: boolean; reason?: string; error?: string; provisional?: boolean };

/**
 * What the Relative tab shows under its rows: the expression resolved in the
 * param's own vocabulary right now, and whether a fallback calendar answered.
 * Null for a literal, so the caller can tell "not an expression" from "an
 * expression that resolves to this". A range shows its halves with a dash;
 * the wire form keeps the slash.
 */
export function previewExpression(type: PeriodType, value: string, ctx: Omit<ResolveContext, "trace"> = {}): Preview | null {
  if (!isExpression(type, value)) {
    // An `@` on a param with no time of day is not an expression here (it is refused, R7a): say so rather than "—".
    let refused: string | undefined;
    resolveValue(type, value, { ...ctx, onError: (m) => (refused ??= m) });
    return refused === undefined ? null : { text: "", fallback: false, error: refused };
  }
  const trace = newTrace();
  let error: string | undefined;
  const resolved = resolveValue(type, value, { ...ctx, trace, onError: (m) => (error ??= m) });
  const text = isRange(resolved) ? splitRange(resolved).join(" – ") : resolved;
  return {
    text,
    fallback: trace.fallback,
    reason: trace.reason,
    ...(error === undefined ? {} : { error }),
    ...(trace.provisional ? { provisional: true } : {}),
  };
}

/**
 * Does this stored value re-resolve on every refresh? True for an
 * expression on a period type — a range when either half is one — and false
 * for a literal or for any value off a period type, where nothing but
 * `$currentDate` is ever a token and that case has no badge. A range on a
 * single-value type is not an expression there (spec §1): it is sent as-is.
 */
export function isExpression(type: string | undefined, value: string): boolean {
  if (!isPeriodType(type)) return false;
  // An atom with `@` is an expression on `datetime` only (atFits); anywhere else the stored value is a literal.
  const half = (v: string): boolean => {
    const expr = parseExpression(v);
    return expr !== null && atFits(type, expr);
  };
  if (isRangeType(type)) {
    const [start, end] = splitRange(value);
    return half(start) || (end !== "" && half(end));
  }
  const expr = parseExpression(value);
  return expr !== null && expr.end === undefined && atFits(type, expr);
}
