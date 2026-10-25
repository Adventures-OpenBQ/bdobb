// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useState } from "react";
import { bundleScope, forgetWidgetRefusals, loadWidgetCalendars, peekWidgetCalendars } from "../lib/calendars/bundles";
import { fetchCalendarBundle } from "../lib/dataClient";
import { paramsKey } from "../lib/params";
import type { BackendConfig, WidgetDef } from "../lib/types";
import type { TradingCalendars } from "./useTradingCalendar";

const NONE: TradingCalendars = { calendars: {}, pending: false, key: "" };

/**
 * A legacy card's calendars with its overnight ones from bundles (spec "Overnight calendars"): the per-year loader's
 * map with each overnight calendar -- loaded, still loading, or its refusal -- laid over it, and the card waits while
 * one an expression needs is loading. `legacy` itself when the card names none, so its identity and key never move.
 */
export function withOvernight(legacy: TradingCalendars, overnight: TradingCalendars): TradingCalendars {
  if (Object.keys(overnight.calendars).length === 0) return legacy;
  return {
    ...legacy,
    calendars: { ...legacy.calendars, ...overnight.calendars },
    pending: legacy.pending || overnight.pending,
    key: `${legacy.key}|${overnight.key}`,
    retry: overnight.retry,
  };
}

/**
 * A card's bundle calendars -- all of an opted-in (calendarBinding) card's, the overnight ones of any other -- for every path that resolves its params -- the controls, the
 * Relative tab, the echo, SSRM, the Run check and the GET -- so none of them falls back to weekdays (review C1).
 * Render reads the shared cache synchronously; an effect loads what it lacks and re-renders when that lands. The
 * credential is in the scope, so an edit re-asks under the new one. A card that unmounts stops listening, but the
 * shared fetch finishes for whoever asks next. `retry` forgets the card's standing refusals and asks again.
 */
export function useBundleCalendars(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  backend: BackendConfig | undefined,
  dashboardExchange?: string,
  now: Date = new Date(),
): TradingCalendars {
  // Bumped by Retry: it moves the effect's dependencies, so a transient failure the cache never remembered is asked
  // again even when the key has not moved (review I1).
  const [attempt, setAttempt] = useState(0);
  // The last load's failures, tagged with what it loaded: they apply only while scope, attempt and key are the same.
  const [failed, setFailed] = useState<{ tag: string; errors: Record<string, string> }>();
  // Every card: bundleIdsOf (bundles.ts) picks which of `widget`'s calendars come from bundles -- all on an opted-in
  // card, only the overnight ones on any other. A card with none peeks nothing and loads nothing.
  const scope = backend ? bundleScope(backend) : "";
  // Value-derived stand-ins, as useTradingCalendar's are: callers rebuild `values` and `now` on every render.
  const valuesKey = paramsKey(values);
  const year = now.getUTCFullYear();
  const state = useMemo(() => {
    if (!widget || !backend) return { ...NONE, loading: "" };
    const base = peekWidgetCalendars(backend, widget, values, dashboardExchange, now);
    const tag = `${scope}\n${attempt}\n${base.key}`;
    const shown = failed?.tag === tag ? peekWidgetCalendars(backend, widget, values, dashboardExchange, now, failed.errors) : base;
    // Loading while a bundle is missing that no failure of this load explains. A load that succeeded but whose bundle
    // the shared cache has since evicted (its FIFO bound) is missing again, so it reloads (final review I-B).
    return { ...shown, loading: shown.key.includes(":?") ? tag : "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget, scope, valuesKey, dashboardExchange, year, attempt, failed]);
  useEffect(() => {
    // Nothing missing: done. A failure is shown (not missing), so it waits for Retry or an edit.
    if (!widget || !backend || !state.loading) return;
    const tag = state.loading;
    let cancelled = false;
    const controller = new AbortController();
    void loadWidgetCalendars(backend, widget, values, dashboardExchange, now, (id, window) => fetchCalendarBundle(backend, id, window), controller.signal)
      .then(
        (r) => r.failed,
        () => ({}),
      )
      .then((errors) => {
        if (!cancelled) setFailed({ tag, errors });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // `failed` moves on every completed load, so a bundle evicted before the re-render is asked for again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loading, failed]);
  // Ruling R10a: a refusal stands for REFUSAL_MS, so Retry forgets it; the new attempt then re-peeks and reloads.
  const retry = useCallback(() => {
    if (!widget || !backend) return;
    forgetWidgetRefusals(backend, widget, values, dashboardExchange, now);
    setAttempt((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget, scope, valuesKey, dashboardExchange, year]);
  return useMemo(() => ({ calendars: state.calendars, pending: state.pending, key: state.key, retry }), [state, retry]);
}
