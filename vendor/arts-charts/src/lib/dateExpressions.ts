// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

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
import { EXCHANGE_HOURS, DEFAULT_EXCHANGE, addBusinessDays, bundledCalendar, isOpen, newTrace, nextOpen, prevOpen, sessionClose, sessionOpen, weekdayCalendar, type CalendarTrace, type ExchangeCalendar } from "./tradingCalendar";
import { expiryBack, parseOptionSymbol } from "./optionSymbol";
import { logOnce } from "./logger";
import {
  fiscalPeriod,
  fiscalYearSpan,
  formatQuarter,
  formatWeek,
  isoWeek,
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
const PERIOD_TYPES: ReadonlySet<string> = new Set([
  "date",
  "datetime",
  "date_range",
  "quarter",
  "fiscal_year",
  "week",
  "time",
  "quarter_range",
]);

export type PeriodType = "date" | "datetime" | "date_range" | "quarter" | "fiscal_year" | "week" | "time" | "quarter_range";

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
 * A composite `start/end` as its two halves; `..` is accepted as the typed
 * spelling of the same range (spec §1) and a value with neither is all start.
 */
export function splitRange(value: string): [string, string] {
  const slash = value.indexOf("/");
  if (slash !== -1) return [value.slice(0, slash), value.slice(slash + 1)];
  const dots = value.indexOf("..");
  if (dots !== -1) return [value.slice(0, dots), value.slice(dots + 2)];
  return [value, ""];
}

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type Unit = "s" | "min" | "h" | "d" | "bd" | "w" | "m" | "q" | "y" | "fq" | "fy" | Weekday;
export type Offset = { sign: 1 | -1; amount: number; unit: Unit };
export type PeriodLetter = "W" | "M" | "Q" | "Y" | "FQ" | "FY";
export type AnchorName = "T" | "$today" | "now" | "trade_date" | "prev_trade_date" | "session_open" | "session_close" | "S" | "E"
  // v5.3.0 §2: the data-driven bounds. Resolved from `bounds` in the context; see resolveAnchor.
  | "earliest" | "latest";
export type Anchor =
  | { kind: "named"; name: AnchorName }
  | { kind: "period"; period: PeriodLetter; n: number }
  // v12.4.2: the n-th most recent TRADE. A fact about the data, so only the
  // server resolves it (live-grid, kdb-ws); the client carries it raw.
  | { kind: "obs"; n: number }
  /**
   * An option contract's expiry, `n` monthlies back. Its own shorthand like
   * a period anchor's, and for the same reason: `EXP-1` has to mean one
   * EXPIRY earlier, and a named anchor would read the `-1` as a day.
   */
  | { kind: "expiry"; n: number };
/**
 * v12.3.0 (slice 4): the `@` production — a time of day pinned onto whatever
 * date the anchor and its offsets land on. `clock` is a wall time in the
 * EXCHANGE's zone; `open` and `close` are that date's session hours from the
 * calendar, so the bundled file's early closes shorten `@close` by
 * themselves. Only a `datetime` param (and the chart's own anchors, which are
 * untyped) carries one — see atFits below.
 */
type AtTime =
  | { kind: "clock"; hour: number; minute: number }
  | { kind: "open" }
  | { kind: "close" }
  /**
   * v12.4.0: the day's BOUNDS, read through the card's Session choice —
   * `sod` is its start, `eod` its last instant.
   *
   * Not aliases for open/close, which are always the regular session. These
   * answer "the whole day as THIS CARD sees it": the regular session on a
   * regular-hours card, and the extended day on an extended-hours one, using
   * the calendar's real pre/after hours where a backend has served them and
   * the plain calendar day where it has not. Nothing invents an extended
   * window that is not in the data.
   *
   * They are the only production whose meaning depends on card state rather
   * than on the clock and the calendar alone, which is why a missing session
   * REFUSES here instead of assuming one — see applyAt.
   */
  | { kind: "sod"; venue?: string }
  | { kind: "eod"; venue?: string };
export type Atom = { anchor: Anchor; offsets: Offset[]; at?: AtTime };
/** `end` is present only for a range, which only a date_range param may hold. */
export type Expression = { start: Atom; end?: Atom };

/**
 * The grammar of the v5.3.0 design, §1:
 *
 *   value      := range | atom
 *   range      := atom ( "/" | ".." ) atom
 *   atom       := anchor ( sign offset )* at?
 *   anchor     := "T" | "$currentDate" | "now" | "trade_date" | "prev_trade_date"
 *               | "session_open" | "session_close" | "S" | "E" | period signed_int
 *   period     := "W" | "M" | "Q" | "Y" | "FQ" | "FY"
 *   offset     := integer unit?
 *   unit       := "s" | "min" | "h" | "d" | "bd" | "w" | "m" | "mo" | "q" | "y" | "fq" | "fy"
 *   at         := "@" ( HH ":" MM | "open" | "close"          -- v12.3.0
 *                     | "SOD" | "EOD" )                       -- v12.4.0
 *
 * Case-sensitive; whitespace is allowed between tokens and stripped before
 * anything is matched, so the regexes below see the compact form only. A bare
 * number is days, and `m` and `mo` are both MONTHS (minutes are `min`). The
 * alternations list the longer spellings first (`min`, `mo`, `bd`, `fq`, `fy`,
 * `FQ`, `FY`) because a regex alternation takes the first branch that
 * matches. The offset regex is sticky so that every character after the
 * anchor has to be consumed by an offset — `T-1x`, `TSLA` and `Today` all fail
 * here and are literals, not half-read expressions.
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
// `T` anchor, case-sensitive like the rest, and a capital `M` in UNIT
// position is a month — `$currentDate-3M`, `T-3M`. It cannot be misread:
// OFFSET only ever sees what follows the anchor, and the `M0` / `M-1`
// anchors live in anchor position, which PERIOD reads first. `Today` still
// fails (NAMED takes its `T`, and `oday` is no offset), so it is a literal.
// v12.4.0: `S` and `E` are the widget's own start/end anchors (a panel's
// series, spec: Art's Charts panels and series). They take offsets and `@`
// exactly like `T` — see resolveAnchor — and are single letters, so `SE`
// still fails (NAMED reads only the `S`, and `E` is no offset) and `TSLA`
// still fails the same way `T` always has.
// 2026-09-21: CASE IS NOT PART OF THE GRAMMAR. It was, in every slot, so of
// `t-1w@open`, `T-1W@OPEN` and `T-1w@open` only the last was an expression and
// the other two were "not a date". The three slots -- anchor, unit, `@` suffix --
// are distinct positions, so folding case cannot make one read as another; and
// this parser only ever sees date-like parameter types (resolveValue's
// isPeriodType gate), so a symbol field's `t` is still a ticker. Every regex
// below is `i`, parseAtom folds what it captured to the ONE canonical spelling,
// and stringify writes only that -- so what is stored never varies by how it was
// typed. Everything the notes above and below say "still fails" still does:
// `TSLA`/`tsla` (no offset reads `sla`), `SE`, `T-1x`. `Today` no longer does,
// which is the point. The one distinction left is about meaning, not case:
// `m`, `mo` and OpenBB's `M` are months, and minutes are `min`.
// The words come BEFORE the single letters: folded, `T` would otherwise take the
// `t` of `trade_date` and `S` the `s` of `session_open`.
// `$today` (v5.3.2, carried at v12.4.16) is its own anchor, the START of the
// day; it folds to itself, so it is never mistaken for `today` or `$currentDate`.
const NAMED = /^(?:\$today|\$currentDate|today|trade_date|prev_trade_date|session_open|session_close|earliest|latest|now|T|S|E)/i;
const PERIOD = /^(FQ|FY|W|M|Q|Y)([+-]?\d{1,6})/i;
/** `EXP`, `EXP-1`: the count is optional and bare means this contract's own. `i`
 * like the rest; tried BEFORE NAMED, whose single-letter `E` would otherwise take it. */
const EXPIRY = /^EXP([+-]?\d{1,6})?/i;
const OFFSET = /([+-])(\d{1,6})(min|mo|bd|fq|fy|s|h|d|w|m|q|y)?/iy;
// v12.3.0: the `@` suffix, taken off the END of the atom before the offsets
// are read, so the sticky OFFSET loop still has to consume every character
// between the anchor and it. Strict two digits each side of the colon: `T@9:5`
// leaves an `@` no offset can consume, so the whole value stays a literal.
// v12.4.2: OBS-n on its own, no offsets and no `@` -- the whole value must be
// this token, so a trailing offset or suffix leaves it unmatched and the rest
// of parseAtom sees a literal (NAMED and PERIOD both reject "OBS").
const OBS = /^OBS-(\d{1,7})$/i;
const AT = /@(?:(\d{2}):(\d{2})|(open)|(close)|(SOD)(?:\(([A-Z0-9]{4})\))?|(EOD)(?:\(([A-Z0-9]{4})\))?)$/i;
/**
 * A weekday step: `-SAT`, `+2SUN` (spec 2026-09-14; built on the release chain
 * as 1b751ea1, ported to main 2026-09-29). The count is optional and defaults
 * to 1. ON OR BEFORE / ON OR AFTER (user ruling 2026-09-29, replacing the
 * chain's "strictly"): on a Monday `T-MON` is today, and `T-2MON` is the Monday
 * a week before that. See applyOffset for the arithmetic.
 *
 * Tried BEFORE OFFSET, and that order is load-bearing: `M` is a month and
 * `MON` begins with one, so the unit regex would take `2M` out of `2MON` and
 * leave a stray `ON` that nothing can consume -- turning `T-2MON` into a
 * literal rather than an error. Reading weekdays first keeps `T-2M` a month
 * and `T-2MON` a Monday.
 *
 * `i`, like every other regex here since 2026-09-21: the chain's copy was
 * upper case only, so `T-Mon` -- what was actually typed in the 2026-09-29
 * demo -- was a literal even where the feature existed. The capture folds to
 * the canonical `MON` in parseAtom. Nothing it now admits was an expression
 * before: `-2mon` was a month with a stray `n`, and a weekday name never
 * follows a unit (`-1w` is a week, `-1wed` a Wednesday).
 */
const WEEKDAY_OFFSET = /([+-])(\d{1,6})?(MON|TUE|WED|THU|FRI|SAT|SUN)/iy;
const WEEKDAY_INDEX: Record<Weekday, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 0 };
const isWeekday = (unit: Unit): unit is Weekday => unit in WEEKDAY_INDEX;

/** The `@` suffix as an AtTime, or null when it matched but names no time (`@25:00`). */
function atOf(m: RegExpExecArray): AtTime | null {
  if (m[3]) return { kind: "open" };
  if (m[4]) return { kind: "close" };
  // The venue is optional and, when present, is a four-character MIC --
  // `([A-Z0-9]{4})`. A malformed one (`SOD(nyse)`, `SOD()`) does not match
  // the suffix at all, so the whole value stays a literal rather than
  // quietly falling back to the card's own exchange.
  if (m[5]) return { kind: "sod", venue: m[6]?.toUpperCase() };
  if (m[7]) return { kind: "eod", venue: m[8]?.toUpperCase() };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour > 23 || minute > 59 ? null : { kind: "clock", hour, minute };
}

function parseAtom(input: string): Atom | null {
  // v12.4.2: OBS-n is checked whole, against the raw input, before anything
  // else touches it -- it takes no `@` and no offsets, so a suffix or offset
  // after the count leaves this unmatched and the rest of the function is
  // free to treat the value as an ordinary (and here, invalid) literal.
  const obs = OBS.exec(input);
  if (obs) {
    const n = Number(obs[1]);
    return n > 0 ? { anchor: { kind: "obs", n }, offsets: [] } : null;
  }
  // v5.4.0: `FY2026` / `FY2026-Q3` are labels, not `FY+2026` — see unprefixLabel.
  if (unprefixLabel(input) !== input) return null;
  const suffix = AT.exec(input);
  const at = suffix ? atOf(suffix) : undefined;
  if (suffix && !at) return null;
  const text = suffix ? input.slice(0, suffix.index) : input;
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
    // erase that (it folds to "$today", itself).
    // Folded to the canonical spelling: the single letters are capitals, the words lowercase.
    const word = named[0].toLowerCase();
    const name = word === "$currentdate" || word === "today" || word === "t" ? "T" : word === "s" || word === "e" ? word.toUpperCase() : word;
    candidates.push({ anchor: { kind: "named", name: name as AnchorName }, consumed: named[0].length });
  } else {
    const p = PERIOD.exec(text);
    if (!p) return null;
    const period = p[1].toUpperCase() as PeriodLetter;
    candidates.push({ anchor: { kind: "period", period, n: Number(p[2]) }, consumed: p[0].length });
    candidates.push({ anchor: { kind: "period", period, n: 0 }, consumed: p[1].length });
  }
  for (const candidate of candidates) {
    const offsets = parseOffsets(text, candidate.consumed);
    // The key is left off entirely when there is no suffix: an Atom without an
    // `@` is the object it has always been.
    if (offsets !== null) return at ? { anchor: candidate.anchor, offsets, at } : { anchor: candidate.anchor, offsets };
  }
  return null;
}

/** Every offset from `from` to the end, or null when any of it is unreadable. */
function parseOffsets(text: string, from: number): Offset[] | null {
  const offsets: Offset[] = [];
  let cursor = from;
  while (cursor < text.length) {
    const pos = cursor;
    // Weekdays first -- see WEEKDAY_OFFSET on why the order matters.
    WEEKDAY_OFFSET.lastIndex = pos;
    const wd = WEEKDAY_OFFSET.exec(text);
    if (wd && wd.index === pos) {
      // No count means one: `T-SAT` is the nearest Saturday on or before today.
      offsets.push({ sign: wd[1] === "-" ? -1 : 1, amount: wd[2] === undefined ? 1 : Number(wd[2]), unit: wd[3].toUpperCase() as Unit });
      cursor = WEEKDAY_OFFSET.lastIndex;
      continue;
    }
    OFFSET.lastIndex = pos;
    const m = OFFSET.exec(text);
    if (!m || m.index !== pos) return null;
    // `mo` and OpenBB's capital `M` both fold to `m`, a month; `MIN` folds to `min`.
    const typed = m[3]?.toLowerCase();
    const unit: Unit = typed === undefined ? "d" : typed === "mo" ? "m" : (typed as Unit);
    if (unit === "bd" && m[2].length > 4) return null;
    offsets.push({ sign: m[1] === "-" ? -1 : 1, amount: Number(m[2]), unit });
    cursor = OFFSET.lastIndex;
  }
  return offsets;
}

const RANGE_SEPARATOR = /\/|\.\./;

export function parseExpression(value: string): Expression | null {
  const text = value.replace(/\s+/g, "");
  const sep = RANGE_SEPARATOR.exec(text);
  if (!sep) {
    const start = parseAtom(text);
    return start ? { start } : null;
  }
  const start = parseAtom(text.slice(0, sep.index));
  const end = parseAtom(text.slice(sep.index + sep[0].length));
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
  // v12.4.2: OBS-n round-trips as itself -- it carries no offsets and no `@`
  // (parseAtom never produces either for it), so the tail below is always empty.
  if (anchor.kind === "obs") return `OBS-${anchor.n}`;
  const signed = (n: number) => (n === 0 ? "0" : n > 0 ? `+${n}` : String(n));
  const head =
    anchor.kind === "named"
      ? anchor.name
      : anchor.kind === "expiry"
        ? `EXP${signed(anchor.n)}`
        : `${anchor.period}${signed(anchor.n)}`;
  return head + atom.offsets.map((o) => `${o.sign < 0 ? "-" : "+"}${o.amount}${o.unit}`).join("") + stringifyAt(atom.at);
}

/** v12.3.0: the `@` suffix, written back two-digit as the parser reads it. */
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

/**
 * One atom in OpenBB's form, or null when it needs the extended grammar.
 * v12.3.0: OpenBB's dialect has no `@`, so an atom carrying one is never
 * written as `$currentDate` — the time of day would be lost silently.
 */
function openbbAtom(atom: Atom): string | null {
  if (atom.anchor.kind !== "named" || atom.anchor.name !== "T" || atom.offsets.length > 1 || atom.at) return null;
  const [offset] = atom.offsets;
  if (!offset) return "$currentDate";
  const unit = OPENBB_UNIT[offset.unit];
  return unit === undefined ? null : `$currentDate${offset.sign < 0 ? "-" : "+"}${offset.amount}${unit}`;
}

/**
 * v5.4.0's save format (spec §3.2), and the one serializer everything that
 * WRITES an expression goes through: the Relative tab's Apply and preset
 * save (both via expressionFromRows) and canonicalExpression. An atom
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

export function canonicalExpression(value: string): string | null {
  const expr = parseExpression(value);
  return expr ? serializeExpression(expr) : null;
}

type ResolveContext = {
  now?: Date;
  zone?: string;
  fiscalYearEnd?: number;
  /** The param's exchange (a MIC). Only the weekday table needs it when no calendar is given. */
  exchange?: string;
  calendar?: ExchangeCalendar;
  /** When given, filled in with the years consulted and whether a fallback answered. */
  trace?: CalendarTrace;
  /** v12.4.0: the widget's start/end instants, for the `S`/`E` anchors. */
  start?: Date;
  end?: Date;
  /**
   * v5.3.0 §3 `data_bounds`, for `earliest` / `latest`: the first and last instant of
   * the data the widget has reported. Either may be missing -- a widget that has
   * loaded nothing yet has neither -- and the anchor that needs a missing one DEFERS:
   * resolveValue leaves the value out of the query, so the provider answers from its
   * own earliest (or to its own latest), which is what the word asked for.
   */
  bounds?: { min?: Date; max?: Date };
  /**
   * A `datetime` goes on the wire as naive UTC (`YYYY-MM-DD HH:MM:SS`, no
   * offset) instead of zoned ISO -- the Delta store's grammar admits neither
   * `Z` nor an offset. Set from the param's `naive` field (WidgetParam).
   */
  naive?: boolean;
  /**
   * v12.4.0: the card's Session choice, for the `@SOD` / `@EOD` productions.
   *
   * The only piece of CARD state the resolver reads. Optional, because every
   * other production is answered by the clock and the calendar alone -- and
   * absent, `@SOD` / `@EOD` refuse rather than assume, so a call site that
   * does not have a session to give leaves the value a literal instead of
   * quietly resolving it on regular hours.
   */
  session?: "extended" | "regular" | "24hr";
  /**
   * The card's symbol, for the `EXP` anchor. Only an OCC option symbol
   * answers it; anything else leaves `EXP` a literal.
   */
  symbol?: string;
};

type CalendarContext = Pick<ResolveContext, "fiscalYearEnd" | "exchange" | "calendar" | "trace" | "start" | "end" | "session" | "bounds" | "symbol">;

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
   * date we are on (user ruling 2026-09-29; the chain's 1b751ea1 was strict).
   * On a Monday `T-MON` and `T+MON` are both today, and each further count is
   * another week out: on Tuesday 2026-09-29, `T-MON` is 09-28, `T-2MON` 09-21,
   * `T+FRI` 10-02 and `T+2FRI` 10-09.
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
    // 0 = Sunday, matching WEEKDAY_INDEX. Built in UTC so the day-of-week is
    // the calendar date's own, never shifted by the zone's offset.
    const current = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
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

/**
 * v12.3.0: the `@` production, applied LAST — after every offset — onto the
 * instant's date, and always on the EXCHANGE'S CLOCK. `T@14:00` from Tokyo is
 * 14:00 in New York on New York's date, not 14:00 Tokyo and not Tokyo's date.
 *
 * WHICH date, though, depends on what the anchor named. A real instant (`T`,
 * `now`, `trade_date`, …) is a moment in time, so its date is read on the
 * exchange's clock. A period anchor (`W0`, `M0`, `Q0`, `Y0`, `FQ0`, `FY0`) is
 * DATE-ONLY: resolveAnchor gives it midnight in the viewer's zone, an artefact
 * instant whose exchange-local date is the day BEFORE for any viewer east of
 * the exchange. `dateOnly` reads the fields it already carries instead, so
 * `FQ0@open` is the same session open in Tokyo, Berlin and New York.
 *
 * `@open` / `@close` roll forward to the next OPEN day first — the spec's
 * "the fiscal quarter's first SESSION open", and what the `session_open` /
 * `session_close` anchors already do — so Q1, whose Jan 1 is a holiday every
 * year, answers Jan 2's open rather than an instant the exchange was shut.
 * An early close shortens `@close` on its own, and nextOpen's consult is what
 * puts `fallback: true` in the trace when the hours came from the weekday
 * table rather than from a real calendar.
 *
 * ponytail: `@HH:MM` takes toZoned's default 'compatible' disambiguation, so a
 * wall time that does not exist on a spring-forward date slides forward an
 * hour (`T@02:30` on 2026-03-08 is 03:30-04:00) — harmless for session hours,
 * name a policy here if anyone ever types the missing hour on purpose.
 */
function applyAt(
  instant: ZonedDateTime,
  at: AtTime,
  cal: ExchangeCalendar,
  trace: CalendarTrace | undefined,
  dateOnly: boolean,
  session: "extended" | "regular" | "24hr" | undefined,
): ZonedDateTime | null {
  // An explicit venue -- `@SOD(XNYS)` -- names whose trading day this is,
  // instead of inheriting the card's exchange. It picks the CALENDAR only;
  // the date is settled by the anchor and its offsets, before this runs.
  //
  // Swapped before anything reads the calendar, so the day, the zone and any
  // fallback recorded on the trace are all the named venue's. Doing it after
  // `nextOpen` left the trace naming the CARD's exchange, because a trace
  // reason is first-wins.
  //
  // A named venue can only ever get the app's own tables: the card's
  // backend-served calendar belongs to the card's exchange, not to this one.
  // XNYS gets the bundled file; anything else gets weekday hours and no
  // holidays -- right opens and closes, wrong around a local closure -- which
  // is marked on the trace rather than answered quietly.
  if (at.kind !== "clock" && at.kind !== "open" && at.kind !== "close"
      && at.venue !== undefined && at.venue !== cal.code) {
    const named = bundledCalendar(at.venue);
    // A venue the app has never heard of is REFUSED, not answered on the default
    // exchange's hours: weekdayCalendar falls back to those for an unknown code, so
    // `@SOD(NOPE)` used to resolve, quietly, to New York's open. (The test that was
    // meant to pin this only ever passed because its example was lowercase, which
    // the case-sensitive suffix regex did not match at all -- found 2026-09-21 when
    // case stopped being part of the grammar.)
    if (named === null && !Object.hasOwn(EXCHANGE_HOURS, at.venue)) return null;
    if (named === null && trace) {
      trace.fallback = true;
      trace.reason ??= `No trading calendar for ${at.venue} on this backend; weekdays only`;
    }
    cal = named ?? weekdayCalendar(at.venue);
  }

  const local = dateOnly ? instant : fromDate(instant.toDate(), cal.timezone);
  const date = new CalendarDate(local.year, local.month, local.day);
  if (at.kind === "clock") return toZoned(toCalendarDateTime(date, new Time(at.hour, at.minute)), cal.timezone);
  const day = nextOpen(cal, date, trace);
  if (at.kind === "open") return sessionOpen(cal, day);
  if (at.kind === "close") return sessionClose(cal, day);

  // SOD / EOD. No session in the context means the caller never had one to
  // give: refuse, so the value stays a literal and the mistake is visible.
  // Defaulting to "regular" here would read as a correct instant on every
  // extended-hours card while being an hour or six wrong.
  if (session === undefined) return null;

  // 24hr: the day itself, and only this session means that. Crypto and FX
  // are the cases -- a session window there is the wrong reading rather than
  // a narrower one -- and it is the whole day even on a venue whose extended
  // window IS known, because 24hr is not "extended plus a bit".
  //
  // Everything below is on `day`, not `date`: it rolls to the next open
  // session exactly as @open/@close do, so a Sunday reads as Monday's day
  // rather than as a Sunday no market has bars for. Built like
  // tradingCalendar's own session readings -- a wall time on that date in
  // the exchange's zone.
  if (session === "24hr") {
    const time = at.kind === "sod" ? new Time(0, 0, 0, 0) : new Time(23, 59, 59, 999);
    return toZoned(toCalendarDateTime(day, time), cal.timezone);
  }

  if (session === "regular") return at.kind === "sod" ? sessionOpen(cal, day) : sessionClose(cal, day);

  // Extended: the real pre/after hours when the calendar carries them. The
  // bundled NYSE file does -- 04:00 to 20:00 -- and normalizeCalendar fills
  // the same fields from any backend that serves them.
  //
  // With none, the REGULAR session answers. Narrower than the truth, but
  // always a real trading window, and never silently the whole day: a whole
  // day is what 24hr means, and having two different Session settings resolve
  // to the same instants would make the control a lie.
  const pre = cal.session.preMarket?.open;
  const post = cal.session.afterHours?.close;
  if (at.kind === "sod") {
    return pre ? toZoned(toCalendarDateTime(day, parseTime(pre)), cal.timezone) : sessionOpen(cal, day);
  }
  return post ? toZoned(toCalendarDateTime(day, parseTime(post)), cal.timezone) : sessionClose(cal, day);
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
  const date = exchangeDate(cal, now);
  if (isOpen(cal, date, trace) && sessionClose(cal, date).toDate().getTime() <= now.getTime()) return date;
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
  start: Date | undefined,
  end: Date | undefined,
  bounds: { min?: Date; max?: Date } | undefined,
  symbol: string | undefined,
): ZonedDateTime | null {
  // v12.4.2: OBS-n is a fact about the trade data (which trade was n-th most
  // recent), not the clock or the calendar -- the client has no way to answer
  // it, so it refuses before the `named` switch below would need `.name`.
  if (anchor.kind === "obs") return null;
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
    const date = expiryBack(cal, option.expiry, Math.abs(anchor.n), trace);
    return date === null ? null : toZoned(toCalendarDateTime(date), cal.timezone);
  }
  if (anchor.kind === "period") {
    const periodAt = toZoned(toCalendarDateTime(periodStart(anchor.period, fromDate(now, zone), fiscalYearEnd)), zone);
    if (anchor.n === 0) return periodAt;
    return applyOffset(periodAt, { sign: anchor.n < 0 ? -1 : 1, amount: Math.abs(anchor.n), unit: PERIOD_UNIT[anchor.period] }, cal, trace);
  }
  switch (anchor.name) {
    case "T":
    case "now":
      return fromDate(now, zone);
    // v12.4.0: the widget's own start/end (spec: Art's Charts panels and
    // series). Unresolvable without one in the context — resolveExpression
    // treats that as the value being a literal, same as any other failure.
    case "S":
      return start ? fromDate(start, zone) : null;
    case "E":
      return end ? fromDate(end, zone) : null;
    // v5.3.0 §2: data-driven, so unresolvable until the widget has reported some.
    case "earliest":
      return bounds?.min ? fromDate(bounds.min, zone) : null;
    case "latest":
      return bounds?.max ? fromDate(bounds.max, zone) : null;
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
      return sessionClose(cal, tradeDate(cal, now, trace));
    case "prev_trade_date":
      return sessionClose(cal, prevOpen(cal, tradeDate(cal, now, trace).subtract({ days: 1 }), trace));
    case "session_open":
      return sessionOpen(cal, nextOpen(cal, exchangeDate(cal, now), trace));
    case "session_close":
      return sessionClose(cal, nextOpen(cal, exchangeDate(cal, now), trace));
  }
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
  const cal = ctx.calendar ?? weekdayCalendar(ctx.exchange ?? DEFAULT_EXCHANGE);
  let at = resolveAnchor(expr.start.anchor, now, zone, ctx.fiscalYearEnd ?? 12, cal, ctx.trace, ctx.start, ctx.end, ctx.bounds, ctx.symbol);
  if (!at) return null;
  for (const offset of expr.start.offsets) at = applyOffset(at, offset, cal, ctx.trace);
  return expr.start.at
    ? applyAt(at, expr.start.at, cal, ctx.trace, expr.start.anchor.kind === "period", ctx.session)
    : at;
}

/**
 * v12.3.0: `@` names a time of day, and only a `datetime` param carries one
 * on the wire — every other period type projects the time away, so `T@14:00`
 * on a `date` would resolve to the same value as `T` and the suffix would be
 * silently meaningless. There it is a literal instead: not an expression, no
 * preview, sent as stored. The chart's own anchors go through
 * resolveExpression, which has no type and always applies the suffix.
 *
 * v12.4.2: `OBS-n` is the same story for a whole ANCHOR rather than a suffix
 * -- it names a trade-data fact no period type but `datetime` can carry (a
 * `date` param has no room for "the n-th trade", only the day it fell on), so
 * off `datetime` it is a literal too: not an expression, no preview, no badge.
 */
function atFits(type: PeriodType, expr: Expression): boolean {
  if (type === "datetime") return true;
  const isObs = (atom: Atom): boolean => atom.anchor.kind === "obs";
  if (isObs(expr.start) || (expr.end !== undefined && isObs(expr.end))) return false;
  return expr.start.at === undefined && expr.end?.at === undefined;
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

/** The same instant as naive UTC to the second: what a `naive` datetime param sends (ResolveContext.naive). */
export const naiveUtc = (at: ZonedDateTime): string => at.toDate().toISOString().slice(0, 19).replace("T", " ");

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
export function projectValue(type: PeriodType, at: ZonedDateTime, fiscalYearEnd = 12, naive = false): string {
  const date = new CalendarDate(at.year, at.month, at.day);
  switch (type) {
    case "date":
    case "date_range":
      return date.toString();
    case "datetime":
      return naive ? naiveUtc(at) : wireDatetime(at);
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
const LOOKS_LIKE_TOKEN = /^(?:\$currentDate|today|T[+-]|now|trade_date|prev_trade_date|session_open|session_close|(?:FQ|FY|W|M|Q|Y)[+-]?\d)/;

/**
 * The v3–v5.1 spelling of "today". Since v5.2.0 it is an alias of the `T`
 * anchor above and accepts the same offsets, so OpenBB's own
 * `$currentDate-1w` resolves without a special case. The one copy of the
 * constant: params.ts, which used to export its own, imports resolveValue
 * from this module instead.
 */
const CURRENT_DATE_TOKEN = "$currentDate";

/** Whether either end of an expression anchors on the WIDGET's own window. */
function namesWindow(expr: Expression): boolean {
  const window = (atom: Atom): boolean =>
    atom.anchor.kind === "named" && ["S", "E", "earliest", "latest"].includes(atom.anchor.name);
  return window(expr.start) || (expr.end !== undefined && window(expr.end));
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
    // v12.3.0: an `@` suffix off a datetime param is a literal (atFits).
    const expr = parseExpression(v);
    const at = expr !== null && atFits(k, expr)
      ? resolveExpression(v, now, zone, {
          fiscalYearEnd: ctx.fiscalYearEnd,
          exchange: ctx.exchange,
          calendar: ctx.calendar,
          trace: ctx.trace,
          start: ctx.start,
          end: ctx.end,
          bounds: ctx.bounds,
          // v12.4.0: `@SOD` / `@EOD` read it. Forwarded explicitly because
          // this context is built field by field -- a field left out here is
          // not a type error, it is a production that silently refuses.
          session: ctx.session,
          // `EXP` reads it, forwarded for the same reason.
          symbol: ctx.symbol,
        })
      : null;
    if (at) return projectValue(k, at, ctx.fiscalYearEnd ?? 12, ctx.naive);
    // v12.4.0 (the branch-end round, finding 6): an `S`/`E` expression the
    // context has no window for is REFUSED -- empty, which every caller
    // already treats as "not set" (buildWidgetUrl leaves an empty value out
    // of the query entirely) -- rather than echoed. The "send it as-is" rule
    // below is for a token this grammar does not know; the letters `S` and
    // `E` are ones it does, and sending them raw put the literal `S` on the
    // wire and in the control.
    if (expr !== null && namesWindow(expr)) return "";
    // v5.4.0 (spec §4.9): a label in OpenBB's `FY` spelling is sent unprefixed.
    if (k === "quarter" || k === "fiscal_year") {
      const label = unprefixLabel(v);
      if (label !== v) return label;
    }
    if (LOOKS_LIKE_TOKEN.test(v)) {
      void logOnce(`param-token:${v}`, `unsupported date token, sent as-is: ${v}`);
    }
    return v;
  };

  if (isPeriodType(type)) {
    if (isRangeType(type) && (value.includes("/") || value.includes(".."))) {
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

export type Preview = { text: string; fallback: boolean; reason?: string };

/**
 * What the Relative tab shows under its rows: the expression resolved in the
 * param's own vocabulary right now, and whether a fallback calendar answered.
 * Null for a literal, so the caller can tell "not an expression" from "an
 * expression that resolves to this". A range shows its halves with a dash;
 * the wire form keeps the slash.
 */
export function previewExpression(type: PeriodType, value: string, ctx: Omit<ResolveContext, "trace"> = {}): Preview | null {
  if (!isExpression(type, value)) return null;
  // An anchor that cannot resolve -- `S`/`E` on a card whose window is not
  // loaded yet -- is not a literal to echo back (T9 report). `resolveValue`'s
  // "send it as-is" rule is the WIRE's: a preview line reading `S` claims the
  // expression resolved to the letter S. Null instead, exactly as
  // `resolveInstant` and `resolveRange` already answer for the same value.
  const now = ctx.now ?? new Date();
  const zone = ctx.zone ?? getLocalTimeZone();
  // `session` and `bounds` were missing from this hand-built copy (2026-09-29),
  // so the pre-check below refused every `@SOD`/`@EOD` (no session) and every
  // `earliest`/`latest` (no bounds) -- values `resolveValue` answers perfectly
  // well -- and the preview under a field read null for them. Every key the
  // resolver reads from its calendar context is listed, not a chosen few.
  const cal = { fiscalYearEnd: ctx.fiscalYearEnd, exchange: ctx.exchange, calendar: ctx.calendar, start: ctx.start, end: ctx.end, session: ctx.session, bounds: ctx.bounds };
  const atoms = isRangeType(type) ? splitRange(value).filter((half) => half !== "") : [value];
  if (atoms.some((atom) => parseExpression(atom) !== null && resolveExpression(atom, now, zone, cal) === null)) return null;
  const trace = newTrace();
  const text = resolveValue(type, value, { ...ctx, trace }).replace("/", " – ");
  return { text, fallback: trace.fallback, reason: trace.reason };
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
  // v12.3.0: an atom with an `@` suffix is an expression on `datetime` only
  // (atFits); anywhere else the stored value is a literal and has no badge.
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
