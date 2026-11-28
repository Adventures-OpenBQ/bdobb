// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { fetchWidgetData } from "../lib/dataClient";
import { logError } from "../lib/logger";
import { annualPeriodValue, correctStatementRows, inferYearEnds, isStatementPeriodParam, knownYearEnds } from "../lib/statementFiscal";
import { tableRows } from "../lib/tableColumns";
import type { BackendConfig, WidgetDef } from "../lib/types";
import { __resetFiscalYearEndCacheForTests, lookupFiscalYearEnd } from "./useFiscalYearEnd";

// No cache of its own: the answers live in useFiscalYearEnd's lookupCache (one
// lookup per backend + symbol per session, a failure remembered as null and
// logged once), so a card whose date param already asked a symbol does not
// make the row correction ask it again.
export function __resetStatementYearEndsForTests(): void { __resetFiscalYearEndCacheForTests(); annualCache.clear(); }

// A company's year end read from one annual row, for a quarterly card whose
// backend has no lookup and whose rows name no fiscal quarter. One request per
// backend, widget and symbol per session; a failure is remembered as null and
// logged once, as the lookup's is.
const annualCache = new Map<string, number | null>();

/** The fiscal-year-end month of `symbol` from the newest annual row this statement widget serves; null when it cannot say. */
export async function annualYearEnd(backend: BackendConfig, widget: WidgetDef, params: Record<string, string>, symbol: string): Promise<number | null> {
  const key = `${backend.id}\n${backend.baseUrl}|${widget.id}|${symbol.toUpperCase()}`;
  if (annualCache.has(key)) return annualCache.get(key) ?? null;
  const annual = annualPeriodValue(widget.params.find((p) => p.paramName === "period")?.options);
  let month: number | null = null;
  if (annual !== undefined) {
    try {
      const rows = tableRows(await fetchWidgetData(backend, widget, { ...params, symbol, period: annual, limit: "1" }));
      month = rows === null ? null : (inferYearEnds(rows, annual, [symbol])[symbol.toUpperCase()] ?? null);
    } catch (err) {
      void logError(`fiscal year end from annual rows failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  annualCache.set(key, month);
  return month;
}

/** annualYearEnd for each of `symbols`, keyed by the upper-cased symbol. No backend, widget or symbols: nothing is asked. */
export function useAnnualYearEnds(backend: BackendConfig | undefined, widget: WidgetDef | undefined, params: Record<string, string>, symbols: string[]) {
  const key = backend && widget && symbols.length > 0 ? `${backend.id}|${widget.id}|${symbols.join(",")}` : "";
  const [state, setState] = useState<{ key: string; months: Record<string, number | null> }>({ key: "", months: {} });
  useEffect(() => {
    if (!backend || !widget || key === "") return;
    let live = true;
    void Promise.all(symbols.map((s) => annualYearEnd(backend, widget, params, s))).then((months) => {
      if (live) setState({ key, months: Object.fromEntries(symbols.map((s, i) => [s.toUpperCase(), months[i]])) });
    });
    return () => { live = false; };
    // `key` stands for backend, widget and symbols; params only shape the request the first time a symbol is asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { months: key === "" ? NONE : state.months, pending: key !== "" && state.key !== key };
}

const NONE: Record<string, number | null> = {};

/** The symbols a statement card asked for: its `symbol` value, split on commas, blanks dropped. */
export function statementSymbolsOf(params: Record<string, string>): string[] {
  return (params.symbol ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Each symbol's fiscal-year-end month, keyed by the upper-cased symbol; null for no answer. */
export async function statementYearEnds(backend: BackendConfig, symbols: string[]): Promise<Record<string, number | null>> {
  const upper = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const months = await Promise.all(upper.map((s) => lookupFiscalYearEnd(backend, s)));
  return Object.fromEntries(upper.map((s, i) => [s, months[i]]));
}

/**
 * A statement widget's fetched rows with the card's fiscal relabel, for the
 * fetch that has no card: Rita's (dev 191610b01). Anything that is not a
 * statement widget, has no symbol, or is not a list of rows comes back untouched.
 */
export async function correctStatementData(backend: BackendConfig, widget: WidgetDef, params: Record<string, string>, data: unknown): Promise<unknown> {
  const period = widget.params.find((p) => p.paramName === "period");
  const rows = period !== undefined && isStatementPeriodParam(period) ? tableRows(data) : null;
  const symbols = statementSymbolsOf(params);
  if (rows === null || symbols.length === 0) return data;
  const asked = params.period ?? "";
  return correctStatementRows(rows, asked, knownYearEnds(await statementYearEnds(backend, symbols), inferYearEnds(rows, asked, symbols)), symbols).rows;
}

/** Each symbol's fiscal-year-end month (1..12), or null when the lookup has no answer. */
export function useStatementYearEnds(backend: BackendConfig | undefined, symbols: string[]) {
  const key = symbols.map((s) => s.toUpperCase()).join(",");
  const [state, setState] = useState<{ key: string; months: Record<string, number | null> }>({ key: "", months: {} });
  useEffect(() => {
    if (!backend || key === "") return;
    let live = true;
    void statementYearEnds(backend, key.split(",")).then((months) => { if (live) setState({ key, months }); });
    return () => { live = false; };
  }, [backend, key]);
  // An emptied list must not keep applying the last answer: no key, no months.
  return { months: key === "" ? NONE : state.months, pending: key !== "" && state.key !== key };
}
