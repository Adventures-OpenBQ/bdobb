// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import { fetchEndpoint } from "../lib/dataClient";
import { failedDayTile, parseDayCharts, type DayTile } from "../lib/dayChart";
import type { BackendConfig } from "../lib/types";

/** Bounded snapshots, never a quote stream. Polls start after the prior pass finishes. */
export function useDayCharts(backend: BackendConfig, symbols: string[], nearby: string[], refreshKey = 0) {
  const backendKey = JSON.stringify(backend);
  const connection = useMemo(() => JSON.parse(backendKey) as BackendConfig, [backendKey]);
  const membership = JSON.stringify(symbols);
  const identity = `${backendKey}:${membership}`;
  const wanted = JSON.stringify([...new Set(nearby.filter((s) => symbols.includes(s)))]);
  const [state, setState] = useState<{identity:string; tiles:Record<string,DayTile>; fetchedAt:number|null}>({identity,tiles:{},fetchedAt:null});
  useEffect(() => {
    const entries = JSON.parse(wanted) as string[];
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const publish = (next: Record<string,DayTile>, succeeded = false) => {
      if (disposed) return;
      setState((old) => ({ identity, fetchedAt:succeeded ? Date.now() : old.identity === identity ? old.fetchedAt : null, tiles: { ...(old.identity === identity ? old.tiles : {}), ...next } }));
    };
    const poll = async () => {
      for (let i = 0; i < entries.length && !disposed; i += 20) {
        const batch = entries.slice(i, i + 20);
        controller = new AbortController();
        deadline = setTimeout(() => controller?.abort(), 30000);
        try {
          const parsed = parseDayCharts(await fetchEndpoint(connection, "day_charts", {symbol:batch.join(",")}, controller.signal));
          publish(Object.fromEntries(batch.map((symbol) => [symbol, parsed[symbol] ?? failedDayTile(symbol, "missing_response")])), true);
        } catch {
          publish(Object.fromEntries(batch.map((symbol) => [symbol, failedDayTile(symbol)])));
        } finally { clearTimeout(deadline); }
      }
      if (!disposed && entries.length) timer = setTimeout(() => { void poll(); }, 15000);
    };
    if (entries.length) void poll();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(deadline); controller?.abort(); };
  }, [connection, identity, wanted, refreshKey]);
  return { tiles: state.identity === identity ? state.tiles : {}, fetchedAt:state.identity === identity ? state.fetchedAt : null };
}
