// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describeCalendar, isKnownCalendar, newTrace, type CalendarChoice, type ExchangeCalendar } from "../../lib/calendar";
import { isExpression, parseExpression, resolveValue, splitRange } from "../../lib/dateExpressions";
import { fieldContext } from "../../lib/params";
import type { WidgetDef } from "../../lib/types";

type Props = {
  /** The card's widget: its own exchange comes before the dashboard's. */
  widget?: WidgetDef;
  /** The card's effective params: `expr`, and optionally `fy_end` and `as_of`. */
  params: Record<string, string>;
  /** Injectable so the tests are about the grammar rather than about today. */
  now?: Date;
  zone?: string;
  /** By MIC, as useTradingCalendar loads them. */
  calendars?: Record<string, ExchangeCalendar>;
  /** The dashboard's exchange, as every other card reads it. */
  exchange?: string;
};

/** What the app tells the user about where a calendar came from. */
const SOURCE_LABEL: Record<ExchangeCalendar["source"], string> = {
  backend: "served by this card's backend",
  bundled: "the bundled NYSE file",
  weekdays: "weekdays only — no holidays",
};

/**
 * A scratchpad for the date language: type an expression, see what it
 * resolves to.
 *
 * Both projections at once, because that is the thing the rest of the app
 * cannot show you. The SAME expression answers differently depending on the
 * parameter type it lands in -- `T` is a date in one control and an instant
 * in another -- and everywhere else you only ever see the one your parameter
 * happens to be.
 *
 * Resolution is deliberately the CLIENT's, through `resolveValue`, the very
 * function a fetching card's parameters go through. That is what makes this
 * card worth having: it exercises the path production uses. Asking a backend
 * to resolve the expression would answer a different question.
 *
 * What a backend does supply is the CALENDAR -- holidays, early closes --
 * which is why the source is on the card's face. A `bd` step or a trading
 * anchor is only as good as the calendar behind it, and "weekdays only" is a
 * materially different answer from a real one.
 */
export function DateProbeRenderer({ widget, params, now, zone, calendars, exchange }: Props) {
  const expr = (params.expr ?? "").trim();
  if (expr === "") {
    return <p className="empty-state" data-testid="probe-empty">Enter a date expression — try <code>T-1bd</code>, <code>Q-4</code> or <code>FY0</code>.</p>;
  }

  // The card's own calendar, by the same precedence every field uses (calendarOf): widget, dashboard, XNYS.
  const field = fieldContext(widget, undefined, { exchange, calendars }, params);
  const errors: string[] = [];
  const onError = (m: string) => {
    if (!errors.includes(m)) errors.push(m);
  };
  // A fiscal year end only matters to FQ/FY; December is the app's own
  // default everywhere else, so the card agrees with the rest of the app
  // rather than inventing a different one.
  const parsed = Number(params.fy_end);
  const fiscalYearEnd = Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : 12;

  // One trace per projection: `resolveValue` records the fallback on the
  // trace it is given, and a shared one would attribute the date's fallback
  // to the datetime as well.
  const asDate = newTrace();
  const asDatetime = newTrace();
  // As of is itself an expression, resolved against the real now; its
  // instant then stands in for "now" in `expr`. Unparseable -> real now.
  const asOfText = resolveValue("datetime", (params.as_of ?? "").trim() || "T", { now, zone, fiscalYearEnd, ...field, onError });
  const asOf = new Date(asOfText);
  const ctx = { now: Number.isNaN(asOf.getTime()) ? now : asOf, zone, fiscalYearEnd, ...field, onError };
  const datetime = resolveValue("datetime", expr, { ...ctx, trace: asDatetime });

  const atoms = splitRange(expr).flatMap((half) => {
    const e = parseExpression(half);
    return e ? (e.end ? [e.start, e.end] : [e.start]) : [];
  });
  // Display only (ruling R13a): a real `date` parameter refuses `@` (R7a), but this card exists to show the answer, so
  // an `@` expression's date row is the date part of its datetime. Everything else resolves as a `date`.
  const date = atoms.some((a) => a.at !== undefined) && datetime !== ""
    ? datetime.slice(0, 10)
    : resolveValue("date", expr, { ...ctx, trace: asDate });

  const choices: CalendarChoice[] = [];
  const add = (c: CalendarChoice) => {
    if (!choices.some((x) => x.mic === c.mic && x.from === c.from)) choices.push(c);
  };
  if (atoms.length === 0 || atoms.some((a) => a.calendar === undefined)) add(field.choice);
  for (const a of atoms) if (a.calendar !== undefined) add({ mic: a.calendar, from: "expression" });
  const calendarFor = (c: CalendarChoice): ExchangeCalendar | undefined => (c.from === "expression" ? calendars?.[c.mic] : field.calendar);
  const sourceNote = (c: CalendarChoice): string => {
    if (!isKnownCalendar(c.mic) && !c.mic.startsWith("binding:")) return " — unknown calendar";
    const cal = calendarFor(c);
    if (cal === undefined) return " — none loaded";
    return cal.unavailable ? ` — ${cal.unavailable}` : ` — ${SOURCE_LABEL[cal.source]}`;
  };

  // Asked of the `datetime` type: it is the permissive one, so an expression
  // that reads as an expression anywhere reads as one here.
  const isExpr = isExpression("datetime", expr);

  // The warning is driven by the calendar's SOURCE, not by the trace's
  // boolean. `trace.fallback` is true for the bundled file as well, because
  // bundled is a fallback from a backend-served calendar -- but the bundled
  // NYSE data is real, holidays and early closes included, so warning about
  // it on every XNYS card would be furniture. The one genuinely degraded
  // state is a weekday table: right opens and closes, no holidays at all.
  const degraded = choices.some((c) => isKnownCalendar(c.mic) && (calendarFor(c) === undefined || calendarFor(c)?.source === "weekdays"));
  const reason = asDate.reason ?? asDatetime.reason;
  const provisional = asDate.provisional === true || asDatetime.provisional === true;

  return (
    <div className="date-probe">
      <dl className="param-echo">
        {/* The instant `T` means below, so the result can be checked by hand. */}
        <div className="param-echo-row">
          <dt>as of</dt>
          <dd aria-label="as of">{asOfText}</dd>
        </div>
        <div className="param-echo-row">
          <dt>date</dt>
          <dd aria-label="date">{date}</dd>
        </div>
        <div className="param-echo-row">
          <dt>datetime</dt>
          <dd aria-label="datetime">{datetime}</dd>
        </div>
      </dl>

      {/* An unparseable value is NOT an error in this grammar: it is sent
          as-is. Saying so is the difference between "my expression did
          nothing" and "I typed it wrong". */}
      <p className="date-probe-note" data-testid="probe-parse">
        {isExpr
          ? "Read as an expression."
          : "Not an expression — a literal, sent unchanged."}
      </p>

      <p className="date-probe-note" data-testid="probe-calendar">
        Calendar: {choices.map((c) => `${describeCalendar(c)}${sourceNote(c)}`).join(" · ")}
      </p>

      {errors.length > 0 ? (
        <p className="date-probe-warn" data-testid="probe-error">⚠ {errors.join("; ")}</p>
      ) : null}

      {provisional ? (
        <p className="date-probe-note" data-testid="probe-provisional">Provisional — planning-v1 accepted a provisional calendar day.</p>
      ) : null}

      {/* Only when something actually fell back. A permanent caveat is
          furniture; one that appears when it applies is information. */}
      {degraded ? (
        <p className="date-probe-warn" data-testid="probe-fallback">⚠ {reason ?? `No trading calendar for ${field.choice.mic}; weekdays only, so holidays are not counted.`}</p>
      ) : null}
    </div>
  );
}
