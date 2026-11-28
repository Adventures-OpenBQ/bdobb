// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { fetchWidgetData } from "./dataClient";
import { isStatementPeriodParam } from "./statementFiscal";
import { tableRows } from "./tableRowValues";
import type { Row } from "./tableColumns";
import type { WidgetDef } from "./types";

/**
 * A statement card that names several symbols, on a backend that answers one
 * symbol per request (OpenBB's statement routes: Libre Terminal, or any
 * openbb-api). The list is asked whole first, so a backend that takes a list
 * keeps answering it in one request, exactly as before. Only when that fails,
 * or comes back with no rows, is each symbol asked for by itself and the rows
 * put together, each stamped with the company it belongs to -- which is what
 * the fiscal relabelling (statementFiscal.ts) needs to tell them apart.
 */
export const STATEMENT_SYMBOL_LIMIT = 8;

type FetchOne = typeof fetchWidgetData;

/** The card's symbols when this is a statement widget asked for more than one; else null. */
export function statementSymbolList(widget: WidgetDef, params: Record<string, string>): string[] | null {
  const period = widget.params.find((p) => p.paramName === "period");
  if (period === undefined || !isStatementPeriodParam(period)) return null;
  const ticker = widget.params.find((p) => p.paramName === "symbol");
  // A multi-select ticker is the backend saying it takes the list itself.
  if (ticker === undefined || ticker.multiSelect === true) return null;
  const symbols = [...new Set((params.symbol ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  return symbols.length > 1 ? symbols : null;
}

/**
 * One company's rows as the merged table carries them: `symbol` first (kept if
 * the backend sent one), and the period kind that was asked for, since rows
 * from different requests no longer share a request to read it from.
 */
export function stampStatementRows(rows: Row[], symbol: string, period: string | undefined): Row[] {
  return rows.map((row) => {
    const own = typeof row.symbol === "string" && row.symbol !== "";
    const stamped: Row = own ? { ...row } : { symbol, ...row };
    if (period !== undefined && period !== "" && !Object.hasOwn(stamped, "period_kind")) stamped.period_kind = period;
    return stamped;
  });
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * fetchWidgetData for a statement card. Not a statement widget, or one symbol:
 * the one request, untouched. Several symbols: see the note at the top.
 *
 * A symbol that fails is named in the card's notices and the rest still
 * render; when every one fails the first failure is thrown, so the card shows
 * its ordinary error. Over STATEMENT_SYMBOL_LIMIT nothing is asked one by one.
 */
export async function fetchStatementData(fetchOne: FetchOne, ...args: Parameters<FetchOne>): Promise<unknown> {
  const [backend, widget, params, ctx, signal, onWarnings, onAcquisition, onRequest] = args;
  const symbols = statementSymbolList(widget, params);
  if (symbols === null) return fetchOne(...args);

  let wholeError: unknown;
  try {
    const whole = await fetchOne(backend, widget, params, ctx, signal, onWarnings, onAcquisition, onRequest);
    const rows = tableRows(whole);
    // Rows are the backend's answer to the list. So is anything that is not a row list.
    if (rows === null || rows.length > 0) return whole;
  } catch (error) {
    if (signal?.aborted) throw error;
    wholeError = error;
  }

  if (symbols.length > STATEMENT_SYMBOL_LIMIT) {
    throw new Error(`This backend answers one symbol per request, and a statement card asks for at most ${STATEMENT_SYMBOL_LIMIT} that way (${symbols.length} were named).`);
  }

  const merged: Row[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];
  let firstError: unknown;
  let acquisition: Parameters<NonNullable<typeof onAcquisition>>[0] | undefined;
  for (const symbol of symbols) {
    try {
      const one = await fetchOne(backend, widget, { ...params, symbol }, ctx, signal, (w) => warnings.push(...w), (a) => { acquisition ??= a; });
      const rows = tableRows(one);
      if (rows === null || rows.length === 0) throw new Error("no rows");
      merged.push(...stampStatementRows(rows, symbol, params.period));
    } catch (error) {
      if (signal?.aborted) throw error;
      firstError ??= error;
      missing.push(`${symbol}: ${messageOf(error)}`);
    }
  }
  if (merged.length === 0) throw firstError ?? wholeError;

  onWarnings?.([...new Set(warnings), ...missing.map((m) => `No statement for ${m}`)]);
  if (acquisition && onAcquisition) {
    // One request's evidence cannot stand for rows from several. What was acquired is the list.
    const { endpoint, parameters, retrievedAt } = acquisition;
    onAcquisition({ endpoint, parameters: { ...parameters, symbol: symbols.join(",") }, retrievedAt });
  }
  return merged;
}
