// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { bundledCalendar, DEFAULT_EXCHANGE, type ExchangeCalendar } from "./calendar";
import { isRange, parseExpression, resolveForDisplay, type ResolveContext } from "./dateExpressions";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The resolve context a table's date filters use: the dashboard's exchange
 * and its calendar -- the one the card's params loaded, else the bundled one
 * -- so `bd` steps over the same holidays a date param does. `now` is left
 * out: each resolve reads the clock at the moment it filters.
 */
export function filterDateContext(
  exchange: string = DEFAULT_EXCHANGE,
  calendars?: Record<string, ExchangeCalendar>,
): ResolveContext {
  return { exchange, calendar: calendars?.[exchange] ?? bundledCalendar(exchange) ?? undefined };
}

/**
 * One end of a date filter as stored, as the day it names right now.
 * YYYY-MM-DD is a fixed day. A date expression (T-1bd, T-26w, FQ-4 ...) is
 * stored as its text and resolved here every time the table is filtered, so
 * a refresh tomorrow moves it. Blank, a range or anything else: no bound.
 */
export function resolveDateBound(text: string | undefined, ctx: ResolveContext = {}): string | undefined {
  if (!text) return undefined;
  if (ISO_DAY.test(text)) return text;
  if (isRange(text) || parseExpression(text) === null) return undefined;
  const day = resolveForDisplay("date", text, ctx);
  return ISO_DAY.test(day) ? day : undefined;
}

type Filter = { id: string; value: unknown };

/** A date filter's value: `{from, to}`, the only filter shape with those keys. */
function isDateRange(value: unknown): value is { from?: string; to?: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && ("from" in value || "to" in value);
}

/**
 * The filters as the table should apply them now: every date range's
 * expressions resolved to days, everything else as stored. The stored
 * filters -- what is saved, exported and shown in the boxes -- are not
 * touched.
 */
export function resolveDateFilters<T extends Filter>(filters: readonly T[], ctx: ResolveContext = {}): T[] {
  return filters.map((f) =>
    isDateRange(f.value)
      ? { ...f, value: { from: resolveDateBound(f.value.from, ctx), to: resolveDateBound(f.value.to, ctx) } }
      : f,
  );
}
