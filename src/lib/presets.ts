// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  PERIOD_UNIT,
  isRangeType,
  parseExpression,
  serializeExpression,
  type Anchor,
  type Atom,
  type Offset,
  type PeriodLetter,
  type PeriodType,
  type Unit,
  type Weekday,
} from "./dateExpressions";
import { isRecord } from "./isRecord";
import type { Preset } from "./types";

export type { Preset };

/**
 * The six period types that get a Relative tab. `time` is inline with no
 * popover (spec §4) and so has no rows.
 */
// v5.4.0: quarter_range makes it seven.
export type RelativeType = Exclude<PeriodType, "time">;

export function isRelativeType(type: string | undefined): type is RelativeType {
  return type !== undefined && Object.hasOwn(RELATIVE_OPTIONS, type);
}

/**
 * The units the Relative tab can offer. Weekdays are not among them: they
 * carry a weekday name rather than a duration, so there is no sensible row
 * for `-2MON` in an "amount / unit" pair. A typed weekday expression opens
 * the Absolute tab instead -- `expressible` declines it.
 */
export type DropdownUnit = Exclude<Unit, Weekday>;

/**
 * An anchor as the dropdown names it. A period anchor is its P0 form: the
 * rows carry the shorthand's count as an offset in the period's own unit,
 * and expressionFromRows folds it back.
 */
export type AnchorKey =
  | "T" | "$today" | "now" | "trade_date" | "prev_trade_date" | "session_open" | "session_close"
  | "W0" | "M0" | "Q0" | "Y0" | "FQ0" | "FY0";

const DATE_OPTIONS: { anchors: AnchorKey[]; units: DropdownUnit[] } = {
  anchors: ["T", "trade_date", "prev_trade_date", "W0", "M0", "Q0", "Y0", "FQ0", "FY0"],
  units: ["d", "bd", "w", "m", "q", "y", "fq", "fy"],
};

/** Spec §4's table, verbatim: which anchors and units each type's rows offer. */
export const RELATIVE_OPTIONS: Record<RelativeType, { anchors: AnchorKey[]; units: DropdownUnit[] }> = {
  date: DATE_OPTIONS,
  date_range: DATE_OPTIONS,
  datetime: {
    anchors: ["now", "T", "$today", "session_open", "session_close", "trade_date", "prev_trade_date"],
    units: ["s", "min", "h", "d", "bd", "w", "m"],
  },
  week: { anchors: ["T", "W0", "trade_date"], units: ["w", "d", "bd", "m", "q", "y"] },
  quarter: { anchors: ["T", "Q0", "FQ0"], units: ["q", "fq", "y", "fy"] },
  fiscal_year: { anchors: ["T", "FY0"], units: ["fy", "y"] },
  // v5.4.0 (spec §4.2): start and end anchors on quarters and years, calendar
  // or fiscal. No `bd`: a quarter is never a count of trading days.
  quarter_range: { anchors: ["T", "Q0", "FQ0", "Y0", "FY0"], units: ["q", "fq", "y", "fy"] },
};

export const ANCHOR_LABELS: Record<AnchorKey, string> = {
  T: "Today",
  // Joins the "Start of …" family deliberately: it is the same kind of thing
  // as Start of week or Start of month, one scale down. Offered on datetime
  // only -- on a date param the projection makes it identical to Today, and
  // two entries meaning one thing is the confusion it exists to remove.
  $today: "Start of today",
  now: "Now",
  trade_date: "Last trading day",
  prev_trade_date: "Prior session",
  session_open: "Session open",
  session_close: "Session close",
  W0: "Start of week",
  M0: "Start of month",
  Q0: "Start of quarter",
  Y0: "Start of year",
  FQ0: "Start of fiscal quarter",
  FY0: "Start of fiscal year",
};

/**
 * The Relative tab's unit vocabulary. Weekdays are deliberately absent: no
 * type offers them in RELATIVE_OPTIONS, so this map is never asked for one,
 * and `expressible` already declines an expression carrying one -- a typed
 * `T-2MON` opens the Absolute tab rather than rendering a row whose unit the
 * dropdown could not show.
 */
export const UNIT_LABELS: Record<DropdownUnit, string> = {
  s: "seconds",
  min: "minutes",
  h: "hours",
  d: "days",
  bd: "trading days",
  w: "weeks",
  m: "months",
  q: "quarters",
  y: "years",
  fq: "fiscal quarters",
  fy: "fiscal years",
};

/** One atom as the builder shows it: an anchor and its offset rows. */
export type AtomRows = { anchor: AnchorKey; offsets: Offset[] };
/** `end` only on a date_range. */
export type Rows = { start: AtomRows; end?: AtomRows };

/**
 * The dropdown key for an anchor, or null when it has none. `EXP` has none:
 * it is a contract's expiry, not one of the tab's offerable anchors, so an
 * expression using it is not expressible as rows and opens on Absolute.
 */
// 5.3.3: `earliest` / `latest` have none either -- they are typed, not picked: what
// they resolve to is the card's own loaded data, which the tab has no way to preview
// as a row. An expression using one opens on Absolute, as an `EXP` one does.
const anchorKeyOf = (anchor: Anchor): AnchorKey | null =>
  anchor.kind === "named" ? (anchor.name === "earliest" || anchor.name === "latest" ? null : anchor.name)
    : anchor.kind === "expiry" ? null
      : (`${anchor.period}0` as AnchorKey);

function anchorFromKey(key: AnchorKey): Anchor {
  if (key.endsWith("0")) return { kind: "period", period: key.slice(0, -1) as PeriodLetter, n: 0 };
  return { kind: "named", name: key as Exclude<AnchorKey, "W0" | "M0" | "Q0" | "Y0" | "FQ0" | "FY0"> };
}

/**
 * A shorthand `Q-4` becomes anchor Q0 with a leading `-4q` row. Null for an
 * anchor the dropdown does not offer -- today only `EXP` -- which makes the
 * whole expression inexpressible and opens the popover on Absolute.
 */
function rowsFromAtom(atom: Atom): AtomRows | null {
  const offsets =
    atom.anchor.kind === "period" && atom.anchor.n !== 0
      ? [{ sign: atom.anchor.n < 0 ? -1 : 1, amount: Math.abs(atom.anchor.n), unit: PERIOD_UNIT[atom.anchor.period] } as Offset, ...atom.offsets]
      : atom.offsets;
  const anchor = anchorKeyOf(atom.anchor);
  return anchor === null ? null : { anchor, offsets };
}

function expressible(type: RelativeType, rows: AtomRows): boolean {
  const options = RELATIVE_OPTIONS[type];
  // The cast is the point of the check, not a hole in it: `o.unit` is any
  // Unit, including a weekday, and asking whether the dropdown offers it is
  // exactly how a weekday expression gets declined here and opens on the
  // Absolute tab instead.
  const offered = (unit: Unit): boolean => (options.units as readonly Unit[]).includes(unit);
  return options.anchors.includes(rows.anchor) && rows.offsets.every((o) => offered(o.unit));
}

/**
 * The rows for a stored expression on this type, or null when the rows
 * cannot express it: a range on a single-value type, a single atom on a
 * date_range, an anchor or unit the type does not offer, or a literal. The
 * Relative tab shows a read-only preview for a null, so nothing is ever
 * silently rewritten into something the rows CAN say.
 */
export function rowsFromExpression(type: RelativeType, value: string): Rows | null {
  const expr = parseExpression(value);
  if (!expr) return null;
  // The rows have no `@` or calendar control, so an expression carrying either cannot be shown by them: null, and the
  // tab shows its read-only preview. Without this, Apply would write the atom back with the suffix gone.
  const suffixed = (a: Atom | undefined) => a !== undefined && (a.at !== undefined || a.calendar !== undefined);
  if (suffixed(expr.start) || suffixed(expr.end)) return null;
  if ((expr.end !== undefined) !== isRangeType(type)) return null;
  const start = rowsFromAtom(expr.start);
  if (start === null || !expressible(type, start)) return null;
  if (!expr.end) return { start };
  const end = rowsFromAtom(expr.end);
  return end !== null && expressible(type, end) ? { start, end } : null;
}

/**
 * Rows back to an atom. A period anchor whose ONLY offset is one of its own
 * unit folds into the shorthand (`Q0` with `-4q` is `Q-4`), so a preset
 * loaded into the rows and applied unchanged is written back as it was.
 */
function atomFromRows(rows: AtomRows): Atom {
  const anchor = anchorFromKey(rows.anchor);
  if (anchor.kind === "period" && rows.offsets.length === 1 && rows.offsets[0].unit === PERIOD_UNIT[anchor.period]) {
    const [o] = rows.offsets;
    return { anchor: { kind: "period", period: anchor.period, n: o.sign * o.amount }, offsets: [] };
  }
  return { anchor, offsets: rows.offsets };
}

/** Through serializeExpression (v5.4.0): what Apply and Save as preset write. */
export function expressionFromRows(rows: Rows): string {
  return serializeExpression({ start: atomFromRows(rows.start), end: rows.end ? atomFromRows(rows.end) : undefined });
}

/** Can this type's rows express `expr`? What filters a saved preset per control. */
export function appliesTo(type: RelativeType, expr: string): boolean {
  return rowsFromExpression(type, expr) !== null;
}

export type BuiltinPreset = Preset & { group: string; types: RelativeType[] };

const preset = (group: string, name: string, expr: string, ...types: RelativeType[]): BuiltinPreset => ({ group, name, expr, types });

/**
 * Spec §4's catalog, in its order. No datetime-range type exists, so the
 * addendum's intraday RANGES are single values here (spec §8 puts that type
 * out of scope). The trailing-quarter ranges are real ranges: see the
 * quarter_range rows at the end.
 */
export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  preset("Dates", "Today", "T", "date"),
  preset("Dates", "Yesterday", "T-1d", "date"),
  preset("Dates", "Last 7 days", "T-7d/T", "date_range"),
  preset("Dates", "Last 30 days", "T-30d/T", "date_range"),
  preset("Dates", "MTD", "M0/T", "date_range"),
  preset("Dates", "QTD", "Q0/T", "date_range"),
  preset("Dates", "YTD", "Y0/T", "date_range"),
  preset("Dates", "Last 12 months", "T-12m/T", "date_range"),
  preset("Trading", "Last trading day", "trade_date", "date"),
  preset("Trading", "Prior session", "prev_trade_date", "date"),
  preset("Trading", "Last 5 trading days", "trade_date-5bd/trade_date", "date_range"),
  preset("Intraday", "Now", "now", "datetime"),
  preset("Intraday", "One hour ago", "now-1h", "datetime"),
  preset("Intraday", "Five minutes ago", "now-5min", "datetime"),
  preset("Intraday", "Session open", "session_open", "datetime"),
  preset("Intraday", "Prior close", "session_close-1bd", "datetime"),
  preset("Weeks", "This week", "W0", "week"),
  preset("Weeks", "Last week", "W-1", "week"),
  preset("Calendar quarters", "This quarter", "Q0", "quarter"),
  preset("Calendar quarters", "Last quarter", "Q-1", "quarter"),
  preset("Calendar quarters", "Same quarter last year", "Q-4", "quarter"),
  preset("Fiscal quarters", "Current", "FQ0", "quarter"),
  preset("Fiscal quarters", "Prior", "FQ-1", "quarter"),
  preset("Fiscal quarters", "Fiscal YoY", "FQ-4", "quarter"),
  preset("Fiscal years", "Current", "FY0", "fiscal_year"),
  preset("Fiscal years", "Prior", "FY-1", "fiscal_year"),
  // v5.4.0 added the quarter_range type (spec §4.2), so the trailing-quarter
  // ranges the comment above set aside now exist. "Last 4 fiscal quarters"
  // is the inclusive FQ-4/FQ0 — five quarters counting the current one, the
  // notes' own example (spec §10, decision 11).
  preset("Quarter ranges", "Last 4 quarters", "Q-4/Q-1", "quarter_range"),
  preset("Quarter ranges", "Last 4 fiscal quarters", "FQ-4/FQ0", "quarter_range"),
  preset("Quarter ranges", "Fiscal year to date", "FY0/FQ0", "quarter_range"),
  preset("Quarter ranges", "Year ago to now", "Q-4/Q0", "quarter_range"),
];

export type OfferedPreset = Preset & { group: string; saved: boolean };

/** The chips for one control: the built-ins declared for its type, then the dashboard's saved presets its rows can express. */
export function presetsFor(type: RelativeType, saved: Preset[] | undefined): OfferedPreset[] {
  const builtins = BUILTIN_PRESETS.filter((p) => p.types.includes(type)).map((p) => ({ group: p.group, name: p.name, expr: p.expr, saved: false }));
  const own = (saved ?? []).filter((p) => appliesTo(type, p.expr)).map((p) => ({ group: "Saved", name: p.name, expr: p.expr, saved: true }));
  return [...builtins, ...own];
}

/**
 * The persisted list, read leniently (spec §5): an entry that is not an
 * object with a non-empty string name and a string expr is dropped, and
 * anything that is not an array at all reads as "no presets".
 */
export function parsePresets(value: unknown): Preset[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Preset[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.name !== "string" || entry.name === "" || typeof entry.expr !== "string") continue;
    out.push({ name: entry.name, expr: entry.expr });
  }
  return out;
}
