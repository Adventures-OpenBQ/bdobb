// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { calendarOf, isKnownCalendar, newTrace, type CalendarChoice, type CalendarTrace, type ExchangeCalendar } from "./calendar";
import { CalendarError } from "./calendars/contracts";
import {
  isExpression,
  isPeriodType,
  isRangeType,
  parseExpression,
  resolveForDisplay,
  resolveValue,
  splitRange,
  type Atom,
  type ResolveContext,
} from "./dateExpressions";
import { logOnce } from "./logger";
import type {
  DashboardCard,
  FormInput,
  Settings,
  WidgetDef,
  WidgetForm,
  WidgetParam,
} from "./types";

/**
 * The untyped projection of the expression resolver: `$currentDate` and its
 * offsets become a local YYYY-MM-DD, and everything else — including a bare
 * `T`, which resolves only on a declared period type — passes through
 * unchanged. This function does not know the calling param's type (it is
 * also used for form-field keys and other untyped values), so `T` is always
 * a literal here; on a symbol field it is AT&T's own ticker. Local time, not
 * UTC, because `$currentDate` means "today" to the person looking at the
 * screen, and a UTC date reads as yesterday for most of the US evening.
 * Every caller that predates period types — the form body, options
 * templating — keeps calling this and keeps its behaviour; a period-typed
 * param goes through wireParams instead.
 */
export function resolveParamValue(value: string, today: Date = new Date()): string {
  return resolveForDisplay(undefined, value, { now: today });
}

/**
 * What `wireParams` needs beyond the params: the clock (tests pin it), each
 * quarter / fiscal-year param's resolved year-end month by paramName
 * (useFiscalYearEnd builds it; absent means December), and the trading
 * calendars by MIC (useTradingCalendar builds them; a MIC with no entry
 * resolves on the weekday table). `trace`, when given, is filled in per
 * storage key with what that param's resolution consulted — the years, for
 * the hook to fetch, and whether a fallback answered, for the ⚠ badge.
 */
export type WireContext = {
  /**
   * v5.3.0 §3 `data_bounds`, for `earliest` / `latest`: the first and last instant of
   * the data the card has loaded (useWidgetData). Absent until it has loaded some, and
   * the value then DEFERS -- left out of the query, so the provider's own bound applies.
   */
  bounds?: { min?: Date; max?: Date };
  now?: Date;
  fiscalYearEnd?: Record<string, number>;
  calendars?: Record<string, ExchangeCalendar>;
  trace?: Record<string, CalendarTrace>;
  /** v5.4.0: the dashboard's default exchange, consulted after the param's and the widget's (calendarOf). */
  exchange?: string;
  /** Filled per storage key with the reason a value could not resolve; that value is "" (spec: never a literal). */
  errors?: Record<string, string>;
};

/**
 * The calendar half of one field's ResolveContext: calendarOf's choice (spec steps 2-6), the loaded calendars for an
 * atom's own `(MIC)`, and strictness for an opted-in card. Every path that resolves a field builds it here -- the
 * wire, the control's display, the Relative tab's preview, the Date expression card -- so they cannot disagree.
 */
export function fieldContext(
  widget: WidgetDef | undefined,
  param: WidgetParam | undefined,
  ctx: Pick<WireContext, "exchange" | "calendars">,
  values: Record<string, string>,
): Pick<ResolveContext, "exchange" | "calendar" | "calendars" | "from" | "strict"> & { choice: CalendarChoice } {
  const choice = calendarOf(widget, param, ctx.exchange, values);
  return {
    choice,
    exchange: choice.mic,
    from: choice.from,
    calendar: ctx.calendars?.[choice.mic],
    calendars: ctx.calendars,
    strict: widget?.calendarBinding !== undefined,
  };
}

/** Every atom a value parses to, across both halves of a range: what `(MIC)` and `@` checks walk. */
export function atomsOf(value: string): Atom[] {
  const out: Atom[] = [];
  for (const half of splitRange(value)) {
    const expr = parseExpression(half);
    if (expr) out.push(...(expr.end ? [expr.start, expr.end] : [expr.start]));
  }
  return out;
}

/** The known calendars a value's atoms name with `(MIC)`. */
function atomCalendars(value: string): string[] {
  return atomsOf(value).flatMap((atom) => (atom.calendar !== undefined && isKnownCalendar(atom.calendar) ? [atom.calendar] : []));
}

/** Every calendar one field resolves on: its own (calendarOf, steps 2-6) and each atom's `(MIC)` (step 1). */
export function paramCalendarIds(
  widget: WidgetDef,
  param: WidgetParam | undefined,
  values: Record<string, string>,
  exchange?: string,
  value: string = param ? (values[param.paramName] ?? "") : "",
): string[] {
  return [...new Set([calendarOf(widget, param, exchange, values).mic, ...atomCalendars(value)])];
}

/**
 * Every calendar a card's period params use, sorted. `expressionsOnly` leaves out a field holding a literal: those
 * are the calendars a request must WAIT for, which a literal never does. The Date expression card resolves out of
 * plain text params (#148), so its `expr` and `as_of` are read as well. A form's date fields resolve on the same
 * calendars when it POSTs (formSubmitBody), so one holding an expression is loaded too; never under `expressionsOnly`, since a form is
 * submit-driven and must not hold the card's GET (final rereview I-A).
 */
export function calendarIdsOf(widget: WidgetDef, values: Record<string, string>, exchange?: string, expressionsOnly = false): string[] {
  const ids = new Set<string>();
  if (!expressionsOnly) {
    for (const v of formDateExpressions(widget, values)) {
      for (const id of paramCalendarIds(widget, undefined, values, exchange, v)) ids.add(id);
    }
  }
  for (const p of widget.params) {
    if (!isPeriodType(p.type) || (expressionsOnly && !isExpression(p.type, values[p.paramName] ?? ""))) continue;
    for (const id of paramCalendarIds(widget, p, values, exchange)) ids.add(id);
  }
  if (widget.type === "date_probe") {
    for (const v of [values.expr ?? "", values.as_of ?? ""]) {
      if (expressionsOnly && !isExpression("datetime", v)) continue;
      for (const id of paramCalendarIds(widget, undefined, values, exchange, v)) ids.add(id);
    }
  }
  return [...ids].sort();
}

/** The value of every form `date` field holding an expression: what a form's POST resolves on a calendar. */
export function formDateExpressions(widget: WidgetDef, values: Record<string, string>): string[] {
  const out: string[] = [];
  for (const p of widget.params) {
    for (const f of p.form?.inputs ?? []) {
      const v = values[formFieldKey(p.paramName, f.paramName)] ?? "";
      if (f.type === "date" && isExpression("date", v)) out.push(v);
    }
  }
  return out;
}

/**
 * What a form's submit resolves with: the card's wire context and widget, plus (legacy cards) the calendars still
 * being fetched, so a refusal can say "still loading" rather than "not loaded".
 */
export type FormContext = WireContext & { widget?: WidgetDef; loading?: string[] };

/**
 * The card's params as the request carries them. This is the ONE place a
 * stored value becomes a wire value: buildWidgetUrl, postForm's URL query and
 * the echo renderer all call it, so an expression cannot resolve one way on
 * the GET and another on the POST.
 *
 * For every entry: the expression is resolved per the param's type (an entry
 * with no matching param — a stale key, a form field's `<form>.field` key —
 * is treated as UNTYPED, which is what resolveParamValue has always done: only
 * `$currentDate` and its offsets resolve there, never a bare `T`, since `T`
 * is also a valid ticker off a period type), then a `date_range` is split
 * into its own key and its `rangeEnd` key and the composite is dropped.
 * `widget` may be undefined for a caller that has none (postForm without
 * one); every entry is then untyped.
 *
 * The range expansion is collected during the loop and written to `out`
 * AFTER it finishes, rather than inline: a stale card key whose name equals
 * some range param's `rangeEnd` (an `end_date` left over from before the
 * widget declared the range) must not win or lose depending on whether that
 * key came before or after the range's own key in `params`' iteration
 * order. Writing the expansions last makes the declared range's end always
 * the one that survives, regardless of key order.
 */
export function wireParams(
  widget: WidgetDef | undefined,
  params: Record<string, string>,
  ctx: WireContext = {},
): Record<string, string> {
  const byName = new Map<string, WidgetParam>();
  for (const p of widget?.params ?? []) byName.set(p.paramName, p);
  const out: Record<string, string> = {};
  const rangeEnds: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    const param = byName.get(key);
    // The field's calendar by precedence (fieldContext), and an atom's own `(MIC)` from the loaded calendars. An
    // entry with no matching param is untyped and never consults a calendar, but it still gets a trace entry (an
    // empty one) so a caller reading `trace[key]` never has to guard. A value that cannot resolve is "" and its
    // reason lands in `ctx.errors`, so this function never throws a CalendarError.
    const trace = ctx.trace ? (ctx.trace[key] = newTrace()) : undefined;
    const resolved = resolveValue(param?.type, value, {
        bounds: ctx.bounds,
        now: ctx.now,
        fiscalYearEnd: ctx.fiscalYearEnd?.[key],
        trace,
        ...fieldContext(widget, param, ctx, params),
        onError: (message) => {
          if (ctx.errors) ctx.errors[key] = message;
        },
      });
    if (param && isRangeType(param.type) && param.rangeEnd) {
      const [start, end] = splitRange(resolved);
      out[key] = start;
      rangeEnds.push([param.rangeEnd, end]);
      continue;
    }
    out[key] = resolved;
  }
  for (const [key, value] of rangeEnds) out[key] = value;
  return out;
}

/**
 * wireParams for a request about to be SENT. A value that could not resolve refuses the whole request, naming each
 * field -- "Partial failure prevents submitting a dependent parameter set" (parent design). buildWidgetUrl, postForm
 * and the SSRM provider send through this; display paths call wireParams and show `errors` themselves.
 */
export function sendParams(
  widget: WidgetDef | undefined,
  params: Record<string, string>,
  ctx: WireContext = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  const out = wireParams(widget, params, { ...ctx, errors });
  const failed = Object.entries(errors);
  if (failed.length) {
    throw new CalendarError("CALENDAR_UNAVAILABLE", failed.map(([key, m]) => `${key}: ${m}`).join("; "));
  }
  return out;
}

/**
 * A deterministic, order-independent fingerprint of a params object's
 * values. useWidgetData depends on this string rather than on the params
 * object's identity: effectiveParams (src/lib/paramGroups.ts) returns a
 * fresh object on every call, so any upstream identity churn would otherwise
 * refetch even when nothing a request cares about actually changed.
 *
 * Sorting keys before encoding makes {a:"1",b:"2"} and {b:"2",a:"1"} produce
 * the same string. Encoding through JSON.stringify (rather than joining
 * "key:value" pairs by hand) keeps a value's own separator characters from
 * forging a collision with a different split across keys, and keeps a key
 * that is absent distinct from one present with an empty string.
 */
export function paramsKey(params: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  );
}

export type ControlKind =
  | "select"
  | "endpoint"
  | "multi"
  | "suggest"
  | "date"
  | "datetime"
  | "range"
  | "quarterRange"
  | "quarter"
  | "fiscalYear"
  | "week"
  | "time"
  | "number"
  | "boolean"
  | "text"
  | "tabs"
  | "form"
  | "unsupported";

/**
 * Order is load-bearing, twice over:
 *
 * 1. 21 params in the live manifest declare BOTH `type: "endpoint"` and an
 *    `optionsEndpoint`; classifying by `type` first would land them on a
 *    control kind with no data behind it.
 * 2. `optionsEndpoint` is checked BEFORE static `options`, so static options
 *    on an endpoint param are ignored — the endpoint is authoritative. The
 *    one live case that declares both (Chamber) declares identical content,
 *    so this costs nothing and keeps a single source of truth.
 */
export function controlKind(param: WidgetParam): ControlKind {
  // Both render in the card body rather than in the parameter panel, and both
  // are only usable once they carry what they need: a tabs param is a
  // dropdown at the wire and needs the list to segment, a form needs the
  // endpoint-and-button contract widgetsJson.ts checked. Without it, each is
  // what it has always been — hidden, and named once in the log by the guard
  // immediately below, which is unchanged.
  if (param.type === "tabs" && (param.options?.length ?? 0) > 0) return "tabs";
  if (param.form) return "form";
  if (param.type === "form" || param.type === "tabs") {
    void logOnce(`param-type:${param.type}`, `unsupported param type: ${param.type}`);
    return "unsupported";
  }
  // v5.4.0 (spec §4.7): OpenBB's `multiple` — a dropdown that also takes
  // typed values — is a text field with its options as suggestions; with
  // multiSelect the same field holds the comma-joined list. Checked before
  // `multi` and the lists below, which would otherwise claim it.
  if (param.multiple === true && (param.optionsEndpoint || (param.options?.length ?? 0) > 0)) return "suggest";
  // A multi-select needs a list to select FROM; either source will do.
  if (param.multiSelect === true && (param.optionsEndpoint || (param.options?.length ?? 0) > 0)) {
    return "multi";
  }
  if (param.optionsEndpoint) return "endpoint";
  if (param.options && param.options.length > 0) return "select";
  if (param.type === "date") return "date";
  // The period kinds, each reached only when the param declares no list —
  // the checks above still win, so a quarter with static options is a select.
  // v5.4.0: a quarter range needs its rangeEnd for exactly the same reason.
  if (param.type === "date_range" || param.type === "quarter_range") {
    if (param.rangeEnd) return param.type === "date_range" ? "range" : "quarterRange";
    // Nowhere to send the end: unsupported, exactly as a form without a
    // button is — hidden, and named once in the log.
    void logOnce(
      `param-range:${param.paramName}`,
      `${param.type} param ${param.paramName} declares no rangeEnd; hidden`,
    );
    return "unsupported";
  }
  if (param.type === "datetime") return "datetime";
  if (param.type === "quarter") return "quarter";
  if (param.type === "fiscal_year") return "fiscalYear";
  if (param.type === "week") return "week";
  if (param.type === "time") return "time";
  if (param.type === "number") return "number";
  if (param.type === "boolean") return "boolean";
  return "text";
}

/**
 * Exported so WidgetCard's decision to mount the controls row and the row's
 * own contents can never disagree. Tabs and forms are excluded along with the
 * unsupported: both render in the card body, above the renderer, and a
 * control that is already on screen must not also appear in the header.
 */
export function visibleParams(widget: WidgetDef): WidgetParam[] {
  return widget.params.filter((p) => {
    if (p.show === false) return false;
    const kind = controlKind(p);
    return kind !== "unsupported" && kind !== "tabs" && kind !== "form";
  });
}

/**
 * The params WidgetCard renders in the body rather than in the panel. One
 * function over both kinds so the two lists cannot drift apart on the `show`
 * rule they share.
 */
export function bodyParams(widget: WidgetDef, kind: "tabs" | "form"): WidgetParam[] {
  return widget.params.filter((p) => p.show !== false && controlKind(p) === kind);
}

/**
 * The flat key a form field's value is stored under in `card.params`. Flat and
 * dotted rather than nested so a field persists, exports and groups exactly
 * like every other parameter — DashboardCard.params is Record<string, string>
 * and nothing about it has to learn that forms exist.
 */
export function formFieldKey(formParamName: string, fieldName: string): string {
  return `${formParamName}.${fieldName}`;
}

/**
 * Every params KEY this widget can carry, mapped to the name a ParamGroup
 * binds it by. A declared param maps to itself; a form field stored under
 * `report.symbol` maps to `symbol`, which is what lets a form's `symbol`
 * field join the dashboard's `symbol` group alongside the cards that declare
 * `symbol` directly. The form param itself is absent: it holds no value.
 */
export function bindableKeys(widget: WidgetDef): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of widget.params) {
    if (p.form) {
      for (const f of p.form.inputs) {
        if (f.type !== "button") out.set(formFieldKey(p.paramName, f.paramName), f.paramName);
      }
      continue;
    }
    out.set(p.paramName, p.paramName);
  }
  return out;
}

/**
 * The card's params with every form entry removed — the params that go on the
 * widget's GET. A form is not a query parameter: its fields are card state
 * the user fills in before pressing a button, so leaving them in would put
 * `report.symbol=AAPL` in the query string AND refetch the card on every
 * keystroke (useWidgetData keys its fetch on paramsKey of exactly this
 * object).
 *
 * Returns the SAME object when the widget declares no form, so the memo that
 * feeds useWidgetData keeps its identity for every other card in the app.
 */
export function queryParams(
  widget: WidgetDef,
  params: Record<string, string>,
): Record<string, string> {
  const drop = new Set<string>();
  for (const p of widget.params) {
    if (!p.form) continue;
    drop.add(p.paramName);
    for (const f of p.form.inputs) drop.add(formFieldKey(p.paramName, f.paramName));
  }
  if (drop.size === 0) return params;
  return Object.fromEntries(Object.entries(params).filter(([key]) => !drop.has(key)));
}

/** The control a form field renders as, in controlKind's own vocabulary. */
export function formInputKind(input: FormInput): ControlKind {
  if (input.type === "dropdown") return input.multiSelect === true ? "multi" : "select";
  if (input.type === "number") return "number";
  if (input.type === "date") return "date";
  return "text";
}

/**
 * The JSON body a form submit POSTs. Every non-button field goes under its
 * own bare `paramName` (the `${form}.` prefix is storage, not wire), typed as
 * the field declares it: a multiSelect field as the array its comma-joined
 * storage encodes, a number field as a number — a string would earn a 422
 * from a schema expecting one — and everything else as the string on screen.
 * An empty number is `null` rather than NaN, which JSON cannot carry.
 *
 * The pressed button contributes its own value, or `true` when it declares
 * none: that is how an endpoint with two buttons knows which one was pressed.
 *
 * A number field that is empty, or whose text does not parse to a finite
 * number, is sent as `null` rather than as the `NaN` `Number(raw)` would
 * otherwise produce -- `NaN` is not valid JSON and would silently become
 * `null` on the wire anyway, so this makes that deliberate instead of an
 * accident of serialization.
 *
 * Every value is resolved untyped first, exactly as resolveParamValue and
 * the query path do (dataClient's postForm resolves the URL params,
 * buildWidgetUrl the GET's): a field whose manifest default is `$currentDate`
 * must POST today's date, not the token, or the endpoint sees a value no
 * schema accepts. Same resolveValue, so the paths cannot resolve differently.
 *
 * The one exception is a field DECLARED `type: "date"`: it resolves as a date
 * control does (resolveValue with "date"), so a manifest default of `T` POSTs
 * today rather than a literal the endpoint would 422. Every other field stays
 * untyped, where `T` is a ticker (AT&T) and only `$currentDate` is a token.
 *
 * This is a send path, so it refuses like sendParams (R7a): a field that cannot resolve -- an unknown `(MIC)`, an `@`
 * on a date field -- throws a CalendarError naming each field ("<field>: <reason>; ..."), and nothing is POSTed.
 * WidgetFormPanel builds the body inside its try, so the form shows that message.
 *
 * `ctx` is the panel's `wire` (final review I-A): each field resolves on fieldContext's calendar, the loaded calendars
 * and strictness, exactly as the card's GET and preview do, so a bound card's `bd` resolves and a legacy card's `T-1bd`
 * POSTs the date it shows.
 *
 * Ruling RF5: a field whose resolution stepped on plain weekdays (its calendar absent, refused or missing a year) is
 * refused, naming the calendar -- "XLON calendar still loading" while `ctx.loading` lists it, else "XLON calendar not
 * loaded" -- never POSTed as a weekday date. Calendar-free values and literals consult no calendar and still submit.
 */
export function formSubmitBody(
  formParamName: string,
  form: WidgetForm,
  params: Record<string, string>,
  button: FormInput,
  ctx: FormContext = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const f of form.inputs) {
    if (f.type === "button") continue;
    const stored = params[formFieldKey(formParamName, f.paramName)] ?? "";
    const trace = newTrace();
    const raw = resolveValue(f.type === "date" ? "date" : undefined, stored, {
      now: ctx.now,
      ...fieldContext(ctx.widget, undefined, ctx, params),
      trace,
      onError: (message) => errors.push(`${f.paramName}: ${message}`),
    });
    const weekdays = trace.weekdays;
    if (weekdays) {
      const which = weekdays.year === undefined ? weekdays.calendar : `${weekdays.calendar} ${weekdays.year}`;
      const state = ctx.loading?.includes(weekdays.calendar) ? "still loading" : "not loaded";
      errors.push(`${f.paramName}: ${which} calendar ${state}`);
    }
    if (f.multiSelect === true) body[f.paramName] = raw === "" ? [] : raw.split(",");
    else if (f.type === "number") {
      const n = Number(raw);
      body[f.paramName] = raw !== "" && Number.isFinite(n) ? n : null;
    } else body[f.paramName] = raw;
  }
  if (errors.length) throw new CalendarError("CALENDAR_UNAVAILABLE", errors.join("; "));
  body[button.paramName] = button.value ?? true;
  return body;
}

/**
 * A widget's own default param values, as a plain params object. Used both
 * to seed a new card (dashboardStore) and to probe a provider's key status
 * (providerKeysStore) — the latter only ever selects a widget whose every
 * param already carries a default (see pickProbeWidget), so dropping them
 * would turn a well-formed request into a validation error.
 */
export function seedParams(widget: WidgetDef): Record<string, string> {
  const params: Record<string, string> = {};
  for (const p of widget.params) {
    // A form holds no value of its own; its FIELDS do, each under its flat
    // key, so a new card opens with the defaults the manifest declared.
    if (p.form) {
      for (const f of p.form.inputs) {
        if (f.type === "button") continue;
        if (typeof f.value === "string" && f.value !== "") {
          params[formFieldKey(p.paramName, f.paramName)] = f.value;
        }
      }
      continue;
    }
    if (typeof p.value === "string" && p.value !== "") params[p.paramName] = p.value;
  }
  return params;
}

/**
 * The symbol override to seed a new card's params with, beyond the widget's
 * own defaults: a linked-symbol match against the tab it's being added to
 * (when enabled), falling back to the settings' default ticker. A widget
 * with no `symbol` param is left alone either way -- there is nothing on it
 * to override.
 */
export function resolveSymbolOverride(
  widget: WidgetDef,
  siblingCards: DashboardCard[],
  settings: Settings,
): Record<string, string> {
  if (!widget.params.some((p) => p.paramName === "symbol")) return {};

  if (settings.matchDashboardSymbol) {
    const sibling = [...siblingCards].reverse().find((c) => c.params.symbol);
    if (sibling) return { symbol: sibling.params.symbol };
  }
  if (settings.defaultTicker) return { symbol: settings.defaultTicker };
  return {};
}
