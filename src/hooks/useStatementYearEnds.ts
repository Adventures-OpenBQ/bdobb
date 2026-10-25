// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import type { BackendConfig } from "../lib/types";
import { __resetFiscalYearEndCacheForTests, lookupFiscalYearEnd } from "./useFiscalYearEnd";

// No cache of its own: the answers live in useFiscalYearEnd's lookupCache (one
// lookup per backend + symbol per session, a failure remembered as null and
// logged once), so a card whose date param already asked a symbol does not
// make the row correction ask it again.
export function __resetStatementYearEndsForTests(): void { __resetFiscalYearEndCacheForTests(); }

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
