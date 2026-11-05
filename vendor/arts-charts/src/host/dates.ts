// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * The host's date grammar, as types only (spec 2026-11-04 §1, S4). Art's
 * Charts carries no grammar of its own: the host resolves expressions and the
 * chart asks it through `getHost().dates`.
 */
import type { ZonedDateTime } from "@internationalized/date";
import type { CalendarTrace, ExchangeCalendar } from "../lib/tradingCalendar";

export type PeriodType = "date" | "datetime" | "date_range" | "quarter" | "fiscal_year" | "week" | "time" | "quarter_range";
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

export type ResolveContext = {
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

export type CalendarContext = Pick<ResolveContext, "fiscalYearEnd" | "exchange" | "calendar" | "trace" | "start" | "end" | "session" | "bounds" | "symbol">;

export type Preview = { text: string; fallback: boolean; reason?: string };

export type HostDates = {
  parseExpression: (value: string) => Expression | null;
  isExpression: (type: string | undefined, value: string) => boolean;
  resolveExpression: (value: string, now: Date, zone?: string, ctx?: CalendarContext) => ZonedDateTime | null;
  resolveValue: (type: string | undefined, value: string, ctx?: ResolveContext) => string;
  previewExpression: (type: PeriodType, value: string, ctx?: Omit<ResolveContext, "trace">) => Preview | null;
  isRangeType: (type: string | undefined) => type is "date_range" | "quarter_range";
  splitRange: (value: string) => [string, string];
};
