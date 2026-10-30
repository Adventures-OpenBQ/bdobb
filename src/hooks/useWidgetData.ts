// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchesData } from "../lib/builtins";
import { fetchWidgetData } from "../lib/dataClient";
import { cronMatches, cronNext, parseCron, type Cron } from "../lib/cron";
import { logError } from "../lib/logger";
import { paramsKey } from "../lib/params";
import type { DashboardCard, WidgetDef } from "../lib/types";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { msToNextMinute } from "./useMinuteTick";

type Status = "loading" | "ready" | "error" | "unresolved" | "incomplete";

/**
 * Params the endpoint refuses to answer without (`optional: false`) that
 * have no value yet. Fetching with one empty only earns a 422 per refresh —
 * the intrinio reported-financials widget logged 26 in one session — so the
 * card waits for the user instead. Hidden params carry their own values.
 */
export function missingRequiredParams(
  widget: { params: Array<{ paramName: string; label?: string; optional?: boolean; show?: boolean }> },
  params: Record<string, string>,
): string[] {
  return widget.params
    .filter((p) => p.optional === false && p.show !== false && (params[p.paramName] ?? "") === "")
    .map((p) => p.label ?? p.paramName);
}

/**
 * setTimeout stores its delay in a signed 32-bit int: anything above this
 * overflows and fires immediately, so "every 35 days" would become a hot
 * loop. Clamping is the safe direction — the card refreshes sooner than the
 * manifest asked, never in a spin.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * How long between automatic refreshes, in milliseconds, or undefined for
 * "do not poll". The widget's own `refetchInterval` wins whenever it is a
 * positive number — only 1 of the 287 widgets on the reference backend
 * declares one, and 26 declare `false`. `false` is a boolean, so the
 * `typeof === "number"` test rejects it outright and it falls through to the
 * setting; nothing here ever sees a NaN.
 */
export function refreshIntervalMs(
  widget: WidgetDef,
  autoRefreshMinutes: number | undefined,
): number | undefined {
  // A cron schedule replaces the interval outright: neither the manifest's
  // number nor the user's setting applies (see the cron timer below).
  if (widget.refetchCron !== undefined) return undefined;
  if (typeof widget.refetchInterval === "number" && widget.refetchInterval > 0) {
    return Math.min(widget.refetchInterval, MAX_TIMEOUT_MS);
  }
  // An explicit `false` is the manifest's only way to say "do not poll this":
  // it opts the widget out of the user's interval too. Manual Refresh and
  // refresh-all are unaffected.
  if (widget.refetchInterval === false) return undefined;
  if (autoRefreshMinutes === undefined) return undefined;
  return Math.min(autoRefreshMinutes * 60_000, MAX_TIMEOUT_MS);
}

/**
 * Ephemeral per-card state. Never persisted, never in a store.
 *
 * `runButton` is the widget manifest's own flag, passed straight through: with
 * it, the hook stops keying the fetch on the live params and keys it on the
 * ones the user last ran. `=== true` because the manifest is untrusted JSON
 * and only a literal `true` opts a widget out of automatic execution.
 */
export function useWidgetData(
  card: DashboardCard,
  params: Record<string, string>,
  runButtonOpt?: boolean,
) {
  const runButton = runButtonOpt === true;
  const widget = useWidgetRegistryStore((s) => s.find(card.backendId, card.widgetId));
  // The RESOLVED widget's backend, not the card's stored one. They differ for
  // exactly one card: an imported one still carrying UNRESOLVED_BACKEND_ID,
  // which names no BackendConfig at all — without this it would resolve its
  // widget and then fail with "Backend not configured" forever.
  const backend = useBackendsStore((s) =>
    s.backends.find((b) => b.id === (widget?.backendId ?? card.backendId)),
  );
  const backendStatus = useBackendsStore((s) => s.statuses[card.backendId]);
  const autoRefreshMinutes = useSettingsStore((s) => s.settings.autoRefreshMinutes);
  // Listed in the fetch effect's deps below: one bump refetches every card
  // that is currently MOUNTED, which is exactly the active tab's cards.
  const refreshEpoch = useDashboardStore((s) => s.refreshEpoch);
  const intervalMs = widget ? refreshIntervalMs(widget, autoRefreshMinutes) : undefined;

  const [status, setStatus] = useState<Status>("unresolved");
  const [data, setData] = useState<unknown>(null);
  // OBBject warnings from the last successful fetch (e.g. a truncated result).
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  /**
   * runButton only: the params the fetch is keyed on. `null` means "nothing
   * armed yet", and the line below arms it on the first render where the
   * widget has RESOLVED — deliberately not on mount.
   *
   * The distinction decides what a grouped card asks on load. The registry
   * starts empty and is filled by an async discovery sweep, so every card's
   * first renders have no widget; effectiveParams cannot let a group's value
   * win without the widget's declared param list, so `params` on those renders
   * is the card's own stored value — which paramGroups.ts itself calls stale by
   * definition for a grouped param. Arming that would spend the one
   * fetch-on-load on the wrong question and show the card stale before the
   * user had touched anything.
   */
  const [armedParams, setArmedParams] = useState<Record<string, string> | null>(null);
  // Adjusting state during render, deliberately: React discards this pass and
  // re-renders with the value set BEFORE committing, so the fetch effect below
  // never runs against the unarmed params. Arming from an effect instead would
  // let the fetch effect — declared after it, and running in the same flush
  // with the old closure — issue one request against them first, which is
  // exactly the request a run button exists to prevent. Until then the effect
  // returns early on `!widget` and nothing has been requested at all.
  if (runButton && armedParams === null && widget) setArmedParams(params);

  const retry = useCallback(() => {
    // An unresolved widget cannot be fixed by re-running the same fetch —
    // there is no fetch to re-run. Kick a discovery sweep so a backend the
    // user just brought back online has a chance to populate the registry;
    // once it does, the effect below picks up the newly resolved widget.
    // A resolved widget whose fetch merely failed skips this: that case
    // just needs `attempt` bumped to refetch the one card.
    if (!widget) {
      void useBackendsStore.getState().refresh().catch(() => {});
    }
    setAttempt((n) => n + 1);
  }, [widget]);

  /**
   * What this card actually fetches. Without a run button it IS `params` — the
   * same object — so every path below behaves exactly as it did before this
   * option existed. With one it is the params the user last ran (or, for the
   * renders before the widget resolves and arms them, the live ones, which
   * nothing fetches).
   */
  const fetchParams = runButton ? (armedParams ?? params) : params;

  // Depending on this string rather than on `params` itself is the point:
  // effectiveParams (src/lib/paramGroups.ts) returns a fresh object on every
  // call, and WidgetCard's memo can recompute for reasons unrelated to this
  // card's own params (see the comment above that memo). Object identity
  // would refetch on every such churn; a value-derived key does not.
  const key = paramsKey(fetchParams);

  /**
   * Are there parameter edits the card has not run? Compared through
   * paramsKey, not a separate shallow compare, so the marker and the fetch key
   * can never disagree about whether the question moved. The `runButton &&`
   * short-circuits: a card without one never builds the second key and never
   * reports anything but false.
   */
  const stale = runButton && key !== paramsKey(params);

  /**
   * Press Run: arm the live params, so the effect below re-keys and fetches
   * them. When they are already armed there is no new key to move to — Run on
   * unchanged parameters is the same question asked again — so it falls
   * through to `retry`, which bumps `attempt` AND kicks a discovery sweep for
   * an unresolved widget. Ctrl/Cmd-click reaches `retry` directly.
   */
  const run = useCallback(() => {
    if (stale) {
      setArmedParams(params);
      return;
    }
    retry();
  }, [stale, params, retry]);

  /**
   * The `key` the payload currently in `data` was fetched under. WidgetCard
   * keeps its renderer mounted through a "loading" pass whenever `data` is
   * non-null — deliberately, so a refetch does not throw away a chart's zoom
   * or a table's scroll. That is only ever right when the SAME question is
   * being asked again. A param or group change makes the held payload an
   * answer to a different question, and leaving it up would put one symbol's
   * numbers under another symbol's parameters.
   */
  const lastKeyRef = useRef(key);

  useEffect(() => {
    if (!widget) {
      // A discovery sweep already ran and came back offline for this card's
      // backend: the widget will never resolve until the backend is fixed,
      // so this is a retryable error, not a silent, permanent placeholder.
      // Discovery that simply hasn't run yet ("unknown", or the backend
      // isn't even loaded) stays unresolved.
      if (backendStatus === "offline") {
        setStatus("error");
        setError("Backend is offline");
        return;
      }
      setStatus("unresolved");
      return;
    }

    // Nothing to fetch: an iframe widget's endpoint IS the URL, a built-in
    // has no backend behind it, and a keys card only shows a moved-to-
    // Settings notice. See fetchesData.
    if (!fetchesData(widget)) {
      setStatus("ready");
      setData(null);
      setError(undefined);
      return;
    }

    const missing = missingRequiredParams(widget, fetchParams);
    if (missing.length > 0) {
      setStatus("incomplete");
      setData(null);
      setError(`Enter ${missing.join(", ")} to load this widget.`);
      return;
    }

    let cancelled = false;
    /** The one timer this card ever has in flight. */
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Date.now() of the last COMPLETED request; 0 while the first is in flight. */
    let completedAt = 0;
    /** The widget's cron refetchInterval; null for every other widget. */
    const cron = widget.refetchCron === undefined ? null : parseCron(widget.refetchCron);

    function clearTimer() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    }

    function arm(delay: number) {
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        // The same counter a manual Refresh bumps, so the effect re-runs and
        // this whole block (cleanup included) starts over.
        setAttempt((n) => n + 1);
      }, delay);
    }

    // useMinuteTick's scheduling: wake on every minute boundary and refetch
    // on the ones the expression matches. Waking each minute rather than
    // sleeping until the next match keeps every delay far below setTimeout's
    // ceiling, however rare the schedule (a monthly one is ~31 days).
    function armCron(schedule: Cron) {
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (cronMatches(schedule, new Date())) setAttempt((n) => n + 1);
        else armCron(schedule);
      }, msToNextMinute());
    }

    // Armed only once a request has FINISHED — success or failure — so the
    // TIMER path can never have two requests for one card in flight: the next
    // one is not scheduled until the last has landed.
    //
    // The guarantee is deliberately that narrow. A manual Refresh, a ⌘R
    // refresh-all, or a change to the resolved interval re-runs the effect
    // immediately, and an older request may still be in flight when it does.
    // That request is not aborted — its `cancelled` flag is set by the
    // cleanup below, so its result is discarded and it can never overwrite
    // the newer answer.
    function armAfterCompletion() {
      completedAt = Date.now();
      if (document.hidden) return;
      if (cron) armCron(cron);
      else if (intervalMs !== undefined) arm(intervalMs);
    }

    function onVisibilityChange() {
      if (cancelled || (intervalMs === undefined && cron === null)) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      // Still waiting on the first answer: armAfterCompletion will arm it.
      if (completedAt === 0) return;
      if (cron) {
        // A boundary that matched while hidden is caught up once, as an
        // elapsed interval is below.
        const due = cronNext(cron, new Date(completedAt));
        if (due !== null && due.getTime() <= Date.now()) setAttempt((n) => n + 1);
        else armCron(cron);
        return;
      }
      if (intervalMs === undefined) return;
      const elapsed = Date.now() - completedAt;
      if (elapsed >= intervalMs) setAttempt((n) => n + 1);
      else arm(intervalMs - elapsed);
    }

    // Only a genuine change of question clears the payload. An `attempt`,
    // `refreshEpoch` or `intervalMs` re-run leaves `key` untouched, so a
    // manual Refresh, a ⌘R and an auto-refresh tick all keep their stale
    // rows on screen; a param change falls back to "Loading…".
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      setData(null);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    setStatus("loading");

    void (async () => {
      if (!backend) {
        if (cancelled) return;
        setStatus("error");
        setError("Backend not configured");
        // Deliberately NOT armed: no request was ever issued, and a card
        // naming a backend that does not exist cannot be fixed by asking
        // again on a timer — it would only log once per interval, forever.
        await logError(`card ${card.id} names missing backend ${card.backendId}`);
        return;
      }

      try {
        let received: string[] = [];
        const result = await fetchWidgetData(backend, widget, fetchParams, (w) => { received = w; });
        if (cancelled) return;
        setWarnings(received);
        setData(result);
        setError(undefined);
        setStatus("ready");
        armAfterCompletion();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setWarnings([]);
        setStatus("error");
        // Before the await, so a slow log write cannot delay the next arm.
        armAfterCompletion();
        // Name, id and backend: the id alone cannot tell two backends'
        // same-named widgets apart when triaging the log.
        await logError(
          `widget "${widget.name}" (${card.widgetId}) on ${backend.name} fetch failed: ${message}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // Fetch on mount, on param change, on explicit retry, when the resolved
    // auto-refresh interval changes, and on a refreshAll bump. `key`, not
    // `params`, is the dependency: see the comment above `key`. With a run
    // button `key` is derived from the ARMED params, so "on param change"
    // becomes "on Run" — and every other trigger listed here (the interval
    // timer, refreshEpoch, retry) refetches what was last run, never an
    // un-run edit. Nothing in this list changed to make that true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    widget,
    backend,
    backendStatus,
    card.id,
    card.backendId,
    card.widgetId,
    key,
    attempt,
    intervalMs,
    refreshEpoch,
  ]);

  // `attempt` is returned, not just used, so a renderer that fetches its own
  // data can be told a Refresh happened. A multi_file_viewer has no request
  // here to repeat (fetchesData is false), so without this its Refresh button
  // would be the only one on a card that does nothing at all.
  // `run` IS `retry` without a run button — the same identity, not a wrapper —
  // so a caller can wire the header button to `run` unconditionally and get
  // exactly today's Refresh on every other card.
  //
  // `intervalMs` is returned for the same family of renderers, and for the
  // same reason: an rss card polls its own feed, and it must poll on exactly
  // the interval every other card uses. Returning the value already computed
  // above is what makes a second, drifting call site impossible.
  return { status, data, error, warnings, retry, attempt, run: runButton ? run : retry, stale, intervalMs };
}
