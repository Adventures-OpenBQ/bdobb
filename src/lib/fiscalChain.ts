// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isFiscalType, monthLabel, parseFyEndMonth } from "./periods";
import type { FiscalFields, WidgetDef, WidgetParam } from "./types";

/**
 * v5.4.0's fiscal year end chain (spec §1), as pure functions. periods.ts
 * knows what a fiscal period IS and nothing about widgets; this file is the
 * other half — which of a widget's params take a year end, where each one's
 * comes from, and when the built-in per-ticker lookup is the answer.
 * useFiscalYearEnd supplies the asynchronous answers (endpoints, the lookup)
 * and the card's override; everything decided here is decided from them.
 */
export type FiscalSource = "card" | "parameter" | "widget" | "lookup" | "default";

/**
 * A resolved month and where it came from; "this param reached the lookup";
 * or "a declared endpoint the chain reached is still in flight", when
 * nothing after it may decide yet.
 */
export type ChainStep = { month: number; source: FiscalSource } | { lookup: true } | { pending: true };

/**
 * One `fiscalYearEndEndpoint`'s state as the caller knows it: its month once
 * it answered, `"pending"` while in flight, `undefined` when none is declared
 * or it settled with no usable answer — the two cases the chain treats alike.
 */
export type EndpointAnswer = number | "pending" | undefined;

/**
 * Spec §1.1: the types the per-param map covers — the three whose labels
 * depend on a year end, and the two date types, whose `FQ0` / `FY-1` / `T-1fq`
 * values resolve against one.
 */
export function takesFiscalYearEnd(type: string | undefined): boolean {
  return isFiscalType(type) || type === "date" || type === "date_range";
}

// Case-insensitive, as the grammar is since v5.3.4: `T-1Fq` is a fiscal quarter.
const FISCAL_TOKEN = /fq|fy/i;

/**
 * Does this param's CURRENT value need a year end? A fiscal type always
 * does; a date only when its value names a fiscal anchor or unit. The one
 * test behind three decisions: whether the card consults the lookup, whether
 * it waits for it, and whether the ⚠ reason shows (spec §1.3; ruling 11).
 */
export function consultsFiscal(type: string | undefined, value: string): boolean {
  return isFiscalType(type) || ((type === "date" || type === "date_range") && FISCAL_TOKEN.test(value));
}

/** Spec §1.2 and §4.1: `type` `ticker` or `symbol`, or the long-standing `paramName` `symbol` convention. */
export function isTickerParam(param: Pick<WidgetParam, "paramName" | "type">): boolean {
  return param.type === "ticker" || param.type === "symbol" || param.paramName === "symbol";
}

/**
 * The one ticker the built-in lookup may ask about: exactly one ticker
 * param, not multiSelect, whose effective value holds one symbol. Several
 * tickers or none is undefined — the widget then gets its declared fields or
 * December, with no ⚠, because nothing failed (spec §1.2). Upper-cased: the
 * lookup's cache is per upper-cased ticker, and so is the request.
 */
export function singleTicker(widget: WidgetDef, values: Record<string, string>): string | undefined {
  const tickers = widget.params.filter(isTickerParam);
  if (tickers.length !== 1 || tickers[0].multiSelect === true) return undefined;
  const value = (values[tickers[0].paramName] ?? "").trim();
  return value === "" || value.includes(",") ? undefined : value.toUpperCase();
}

/**
 * One field set's answer, v5.2.0's order: the endpoint's answer, the
 * sibling's value, the static month. An endpoint in flight stops here as
 * "pending" — the sibling and the static month come after it, so they may
 * not decide while it might still answer.
 */
function declared(fields: FiscalFields, values: Record<string, string>, endpoint: EndpointAnswer): EndpointAnswer {
  if (endpoint !== undefined) return endpoint;
  const sibling = fields.fiscalYearEndParam ? parseFyEndMonth(values[fields.fiscalYearEndParam]) : undefined;
  return sibling ?? fields.fiscalYearEnd;
}

/**
 * Spec §1.2's chain for one param, first answer wins: the card's override;
 * the param's own fields; the widget's; then `{ lookup: true }` — the caller
 * decides from the single ticker and the lookup's cache — and December is
 * the caller's last rung. `fiscal_year_start_month` never appears here:
 * widgetsJson.ts folded it into `fiscalYearEnd`, which is its place in the
 * order anyway.
 *
 * A declared endpoint is one rung like the others (spec §1.2, which the
 * controller ruled binding over the plan's ruling 7): answered, its month
 * wins; settled with nothing usable, the chain falls through — to the
 * lookup too; in flight, the chain stops at `{ pending: true }`, so neither a
 * later rung nor the lookup is consulted until it settles.
 */
export function fiscalChain(
  param: FiscalFields,
  widget: FiscalFields,
  values: Record<string, string>,
  answers: { override?: number; param?: EndpointAnswer; widget?: EndpointAnswer },
): ChainStep {
  if (answers.override !== undefined) return { month: answers.override, source: "card" };
  for (const [fields, endpoint, source] of [
    [param, answers.param, "parameter"],
    [widget, answers.widget, "widget"],
  ] as const) {
    const month = declared(fields, values, endpoint);
    if (month === "pending") return { pending: true };
    if (month !== undefined) return { month, source };
  }
  return { lookup: true };
}

/**
 * The params that ARE a month control: every name some `fiscalYearEndParam`,
 * on a param or on the widget, points at. fiscalControlParam uses it to stand
 * the per-card control down; Task 9 reuses it rather than rebuilding the set.
 */
export function monthControlParams(widget: WidgetDef): Set<string> {
  const names = [widget.fiscalYearEndParam, ...widget.params.map((p) => p.fiscalYearEndParam)];
  return new Set(names.filter((n): n is string => !!n));
}

/**
 * The param whose resolution the per-card "FY ends" control shows (spec
 * §1.5; ruling 2): the first, in manifest order, that consults a year end.
 * None when nothing consults, and none when the widget already has its own
 * month control — a param that some `fiscalYearEndParam`, on a param or on
 * the widget, names.
 */
export function fiscalControlParam(widget: WidgetDef, values: Record<string, string>): WidgetParam | undefined {
  const named = monthControlParams(widget);
  if (widget.params.some((p) => named.has(p.paramName))) return undefined;
  return widget.params.find((p) => consultsFiscal(p.type, values[p.paramName] ?? ""));
}

/** `Sep · AAPL`, `Jun · widget`, `Mar · parameter`, `Dec · default` (spec §1.5). */
export function fiscalLabel(month: number, source: FiscalSource, ticker?: string): string {
  return `${monthLabel(month)} · ${source === "lookup" && ticker ? ticker : source}`;
}

/** The ⚠ text for a failed lookup (spec §1.4). */
export function fiscalReason(ticker: string): string {
  return `Fiscal year end: no fiscal data for ${ticker} on this backend; using December`;
}
