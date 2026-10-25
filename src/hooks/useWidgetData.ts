// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchesData } from "../lib/builtins";
import { peekWidgetCalendars } from "../lib/calendars/bundles";
import { fetchWidgetData, THEMED_TYPES } from "../lib/dataClient";
import { logError } from "../lib/logger";
import { paramsKey, wireParams } from "../lib/params";
import { dataBounds } from "../lib/dataBounds";
import { isPeriodType, namesBounds } from "../lib/dateExpressions";
import type { DashboardCard, WidgetDef } from "../lib/types";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useMinuteTick } from "./useMinuteTick";
import { useResolvedTheme } from "./useResolvedTheme";
import type { TradingCalendars } from "./useTradingCalendar";

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
  fiscalYearEnd?: Record<string, number>,
  calendars?: TradingCalendars & { intent?: string },
  /** v5.4.0: the dashboard's exchange, carried into every wireParams this hook runs. */
  exchange?: string,
) {
  // The explicit descriptor owns acquisition, even when imported card metadata
  // still names a backend widget. Derived cards only signal their runtime here.
  const linked = card.linkedSource !== undefined;
  const runButton = !linked && runButtonOpt === true;
  const widget = useWidgetRegistryStore((s) => linked ? undefined : s.find(card.backendId, card.widgetId));
  // The RESOLVED widget's backend, not the card's stored one. They differ for
  // exactly one card: an imported one still carrying UNRESOLVED_BACKEND_ID,
  // which names no BackendConfig at all — without this it would resolve its
  // widget and then fail with "Backend not configured" forever.
  const backend = useBackendsStore((s) =>
    linked ? undefined : s.backends.find((b) => b.id === (widget?.backendId ?? card.backendId)),
  );
  const backendStatus = useBackendsStore((s) => linked ? undefined : s.statuses[card.backendId]);
  const autoRefreshMinutes = useSettingsStore((s) => s.settings.autoRefreshMinutes);
  // Listed in the fetch effect's deps below: one bump refetches every card
  // that is currently MOUNTED, which is exactly the active tab's cards.
  const refreshEpoch = useDashboardStore((s) => s.refreshEpoch);
  const intervalMs = widget ? refreshIntervalMs(widget, autoRefreshMinutes) : undefined;
  /**
   * A themed widget's answer depends on the theme: buildWidgetUrl puts the
   * RESOLVED theme on the query string for exactly the types in THEMED_TYPES,
   * so the backend draws that fragment or that chart for dark or for light.
   * Nothing re-asked when the OS flipped, and the card kept the old rendering
   * until something unrelated happened to refetch it.
   *
   * Read here rather than passed down from WidgetCard: the hook is the only
   * thing that needs it, and threading it through a prop would put a value
   * with no other purpose on every renderer's path.
   *
   * "" for every other type, so this is a constant in their dependency list
   * and a flip costs them nothing: their request carries no theme, and
   * refetching would ask exactly the same question twice.
   */
  const resolved = useResolvedTheme();
  const themeKey = widget && THEMED_TYPES.has(widget.type) ? resolved : "";

  const [status, setStatus] = useState<Status>("unresolved");
  const [data, setData] = useState<unknown>(null);
  /** The bounds of the last answer to a request sent WITHOUT bounds. See `bounds`. */
  const [heldBounds, setHeldBounds] = useState<{ min: Date; max: Date } | undefined>(undefined);
  // OBBject warnings from the last successful fetch (e.g. a truncated result).
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  /**
   * Date.now() of the last COMPLETED request, success or error — the effect
   * below already tracks this privately to re-arm its timer; it is lifted
   * into state so the header's timer control can colour itself and say how
   * long ago. null until the first completion.
   */
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  /**
   * A once-a-minute tick, only so `stalePastInterval` and the "ago" text are
   * re-read while nothing else about the card changes. On the minute
   * boundary (useMinuteTick), so every card's "ago" moves at the same
   * instant. Every card keeps it, auto-refreshing or not: the timer's
   * "Last refresh … ago" tooltip is on all of them.
   */
  const minuteTick = useMinuteTick();
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
   *
   * The fiscal map is armed WITH the params, in the same places and never
   * apart. WidgetCard derives the map from the live params (a `fy_end`
   * sibling, or a year end templated on the live symbol), so a map that
   * followed the live values would, on its own, refetch the armed params
   * under a year end computed for an un-run edit: a request nobody ran, whose
   * params and map disagree. Armed together, a live map change sends nothing
   * until Run, and what Run sends always pairs the params with the map
   * computed for them. Meaningful only while `armedParams` is non-null.
   *
   * One exception: a send held on a pending fiscal lookup re-arms the map
   * alone when it is released — see the release effect below the fetch
   * effect.
   */
  // v5.4.0 fix round 2: that release now re-arms the params and the map
  // together, so the rule above holds without the exception.
  const [armedParams, setArmedParams] = useState<Record<string, string> | null>(null);
  const [armedFiscalYearEnd, setArmedFiscalYearEnd] = useState<Record<string, number> | undefined>(
    undefined,
  );
  /**
   * v5.4.0 fix round 2: the intent a send was armed under, recorded wherever
   * one is armed (the first arm, Run) and compared when a held send is
   * released — see the release effect. WidgetCard passes it on the hold
   * object; a caller that passes none gets the live params' key, which is
   * the comparison round 1 made and is exact for any card whose params the
   * fiscal map never relabels.
   */
  const intent = calendars?.intent ?? paramsKey(params);
  const [armedIntent, setArmedIntent] = useState<string | undefined>(undefined);
  /**
   * runButton only: the WIRE values the last fetch sent, as a fingerprint,
   * and whether a refresh trigger found them moved. An expression (`T`, a
   * `bd` offset) re-resolves on every trigger; when the resolution differs
   * from what was armed, the card goes stale and sends nothing until Run
   * (spec §5) — the extension of v5.2.0's "never send an un-run request" to
   * requests the clock, not the user, would have changed. A ref, not state:
   * it is written inside the fetch effect and must not re-run it.
   *
   * It is recorded from exactly what the effect sends — the armed params, the
   * armed fiscal map and the calendars in hand at that moment — so the
   * fingerprint is the resolved wire of the request that went out, never of
   * a live edit.
   */
  const armedWireRef = useRef<string | null>(null);
  const [wireStale, setWireStale] = useState(false);
  /**
   * The calendars are not armed with the params: a calendar only ever
   * ARRIVES, and an arrival that changes the resolution is exactly what the
   * armed-wire comparison above catches. The dependency is useTradingCalendar's
   * `key`, not a fingerprint of every calendar: it moves only when a year the
   * card's resolution CONSULTED changes state (or the calendar it resolved
   * on changes source), or when `pending` flips. So a year landing that the
   * card never read — the up-front years under a literal date or a bare `T`,
   * 2025 under a `T-1bd` already released by 2026 — asks nothing again. A
   * change refetches a card without a run button.
   *
   * On a card WITH a run button the key is never a trigger by itself.
   * WidgetCard hands useTradingCalendar the LIVE params, so the consulted set
   * — and the key — follows edits the user has not run (`T-1bd` to `T`, a
   * literal to `T-1bd`). Keyed on it, such an edit re-ran the fetch effect,
   * the armed wire still compared equal, and the armed request went out
   * again with no trigger behind it. So a run-button card depends on
   * `released` instead: bumped only when a send that a real trigger (Run,
   * ⌘R, ↻, the interval, focus, the first arm) HELD on a pending year can go
   * — the year landed or failed. Without a held send, a calendar change on a
   * run-button card sends nothing and shows no loading; the next real trigger
   * re-resolves on whatever calendars are then in hand.
   */
  const calendarMap = calendars?.calendars;
  const calendarRetry = calendars?.retry;
  const calendarsPending = calendars?.pending === true;
  const calendarsKey = calendars?.key ?? "";
  const calendarTrigger = runButton ? "" : calendarsKey;
  /** runButton only: a real trigger found a consulted year pending and sent nothing yet. */
  const heldRef = useRef(false);
  const [released, setReleased] = useState(0);
  // Adjusting state during render, deliberately: React discards this pass and
  // re-renders with the value set BEFORE committing, so the fetch effect below
  // never runs against the unarmed params. Arming from an effect instead would
  // let the fetch effect — declared after it, and running in the same flush
  // with the old closure — issue one request against them first, which is
  // exactly the request a run button exists to prevent. Until then the effect
  // returns early on `!widget` and nothing has been requested at all.
  if (runButton && armedParams === null && widget) {
    setArmedParams(params);
    setArmedFiscalYearEnd(fiscalYearEnd);
    setArmedIntent(intent);
  }

  const retry = useCallback(() => {
    // An unresolved widget cannot be fixed by re-running the same fetch —
    // there is no fetch to re-run. Kick a discovery sweep so a backend the
    // user just brought back online has a chance to populate the registry;
    // once it does, the effect below picks up the newly resolved widget.
    // A resolved widget whose fetch merely failed skips this: that case
    // just needs `attempt` bumped to refetch the one card.
    if (!linked && !widget) {
      void useBackendsStore.getState().refresh().catch(() => {});
    }
    // A bound card's calendar refusal stands for a minute; Retry asks the provider again (ruling R10a).
    calendarRetry?.();
    setAttempt((n) => n + 1);
  }, [linked, widget, calendarRetry]);

  /**
   * What this card actually fetches. Without a run button it IS `params` — the
   * same object — so every path below behaves exactly as it did before this
   * option existed. With one it is the params the user last ran (or, for the
   * renders before the widget resolves and arms them, the live ones, which
   * nothing fetches).
   */
  const fetchParams = runButton ? (armedParams ?? params) : params;
  /** The map sent with `fetchParams`, chosen by exactly the same rule. */
  const fetchFiscal = runButton && armedParams !== null ? armedFiscalYearEnd : fiscalYearEnd;

  // Depending on this string rather than on `params` itself is the point:
  // effectiveParams (src/lib/paramGroups.ts) returns a fresh object on every
  // call, and WidgetCard's memo can recompute for reasons unrelated to this
  // card's own params (see the comment above that memo). Object identity
  // would refetch on every such churn; a value-derived key does not.
  const key = paramsKey(fetchParams);
  /**
   * The fiscal map is not part of the params — a quarter's label under a
   * new year end is the same stored value asked differently — but it IS part
   * of the question the wire asks, so a change to it refetches. Fingerprinted
   * like `key`, and for the same reason: useFiscalYearEnd keeps identity
   * while content holds, but a string is safer in a dependency list.
   *
   * Derived from `fetchFiscal`, like `key` from `fetchParams`: on a run-button
   * card that is the ARMED map, so a live map change moves nothing until Run.
   */
  const fiscalKey = JSON.stringify(fetchFiscal ?? {});
  // v5.3.0 §3 `data_bounds`, for `earliest` / `latest`: the bounds of what this card
  // has loaded. Only a card that ASKS for them computes them, so no other card pays
  // a pass over its rows or gains a trigger. They work like the fiscal map: part of
  // the question the wire asks, so a change refetches (`boundsKey` below) without
  // clearing the rows. The first request has none and the value DEFERS -- left out
  // of the query, so the provider answers from its own earliest / to its own latest.
  // The answer reports the bounds, and only THAT answer: the refetch that follows
  // asks with them, and a provider that honours an offset ("earliest + 1y") answers
  // a narrower range. Taking bounds from that answer would ask again, narrower
  // still, until the rows ran out and the cycle restarted. So they are held from
  // the deferred request (`heldBounds`), and cleared only with the rows on a new `key`.
  // Only a period-typed param resolves `earliest` / `latest`; a text "latest" (a sort order) is just a word.
  const wantsBounds = Object.entries(fetchParams).some(([key, value]) =>
    isPeriodType(widget?.params.find((p) => p.paramName === key)?.type) && namesBounds(value));
  const bounds = wantsBounds ? heldBounds : undefined;
  const boundsKey = bounds ? `${bounds.min.getTime()}|${bounds.max.getTime()}` : "";

  /**
   * Are there parameter edits the card has not run? Compared through
   * paramsKey, not a separate shallow compare, so the marker and the fetch key
   * can never disagree about whether the question moved. The `runButton &&`
   * short-circuits: a card without one never builds the second key and never
   * reports anything but false.
   *
   * The map counts too, for the same reason: it is part of the question the
   * wire asks, and a map that moved with the params untouched (an endpoint-
   * sourced year end landing) is an answer Run would change. Without it Run
   * would fall through to `retry` and re-send the armed map.
   *
   * `wireStale` is the third way: nothing the user did moved, but the armed
   * params now RESOLVE to different wire values (a `T` that crossed
   * midnight, a calendar that landed). The fetch effect sets it and sends
   * nothing; only Run clears it.
   */
  const stale =
    runButton &&
    (key !== paramsKey(params) || fiscalKey !== JSON.stringify(fiscalYearEnd ?? {}) || wireStale);

  /**
   * Press Run: arm the live params (and the map computed for them), so the
   * effect below re-keys and fetches them. When they are already armed there is no new key to move to — Run on
   * unchanged parameters is the same question asked again — so it falls
   * through to `retry`, which bumps `attempt` AND kicks a discovery sweep for
   * an unresolved widget. Ctrl/Cmd-click reaches `retry` directly — which,
   * on a card whose wire values moved, re-runs the comparison and still sends
   * nothing: only Run adopts a new resolution.
   */
  const run = useCallback(() => {
    if (stale) {
      // Forget the armed wire so the next effect run records what Run sends,
      // and bump `attempt` too: when only the CLOCK moved, the params key is
      // unchanged and nothing else would make the effect re-run.
      armedWireRef.current = null;
      setWireStale(false);
      setArmedParams(params);
      setArmedFiscalYearEnd(fiscalYearEnd);
      setArmedIntent(intent);
      setAttempt((n) => n + 1);
      return;
    }
    retry();
  }, [stale, params, fiscalYearEnd, intent, retry]);

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

  // v5.4.0 final-review fix: the one way out of "loading" for a run-button
  // card that sends nothing — the release effect's dropped hold and the fetch
  // effect's "wire moved" branch both end here. Nothing is in flight, so the
  // card must not spin: the payload it holds, else the ask for Run. The stale
  // mark either path set stays until Run.
  function settleUnsent() {
    if (data !== null) {
      setStatus("ready");
    } else {
      setStatus("incomplete");
      setError("Parameters changed — press Run to load this widget.");
    }
  }

  useEffect(() => {
    if (linked) {
      setStatus("ready");
      setData(null);
      setError(undefined);
      return;
    }
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

    // Only a change of the params (`key`) clears the payload. An `attempt`,
    // `refreshEpoch` or `intervalMs` re-run leaves `key` untouched, so a
    // manual Refresh, a ⌘R and an auto-refresh tick all keep their stale
    // rows on screen; a param change falls back to "Loading…". A change to
    // the fiscal map alone (`fiscalKey`) refetches — it is part of the
    // question the wire asks — but leaves `key` untouched too, so the old
    // rows stay up while the new answer loads.
    //
    // It sits BEFORE the calendar hold below: a render that moves the key and
    // makes a needed year pending at once (a group setting symbol and `d`, a
    // `d` becoming `T-400bd`, Run arming such a key) must not hold the old
    // question's rows up under the new parameters for the whole round trip.
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      setData(null);
      setHeldBounds(undefined);
      // `bounds` is still the cleared rows' -- this render computed it before
      // the clear. Sending now would ask the new question with the old data's
      // bounds, an answer thrown away the moment the clear moves `boundsKey`
      // to "" and re-runs this effect. So send nothing here: that re-run is
      // the first request, deferred like any other. With no bounds held,
      // `boundsKey` does not move and nothing would re-run, so this one sends.
      if (bounds !== undefined) {
        setStatus("loading");
        return;
      }
    }

    // A year this card's resolution needs is still loading: hold the request
    // (the card shows loading) rather than send a value resolved on a
    // calendar about to arrive. The effect re-runs when calendarsKey moves —
    // or, with a run button, when the release effect below bumps `released`.
    if (calendarsPending) {
      setStatus("loading");
      if (runButton) heldRef.current = true;
      return;
    }
    heldRef.current = false;

    // Review I2: after an un-run edit a card's bundle calendars are the EDIT's (useBundleCalendars reads the live
    // params), so the armed params it re-sends resolve on their own, from the shared cache, as preview showed them:
    // all of a bound card's, and a legacy card's overnight ones laid over its per-year map (2026-10-24).
    const armed =
      backend && key !== paramsKey(params)
        ? peekWidgetCalendars(backend, widget, fetchParams, exchange, new Date()).calendars
        : undefined;
    const sendMap = !armed ? calendarMap : widget.calendarBinding ? armed : { ...calendarMap, ...armed };

    // runButton: re-resolve, and refuse to send a resolution the user has not
    // run. The comparison is on the WIRE values — what wireParams would put on
    // the query string right now — so a `T` that crossed midnight and a
    // calendar that just landed are both caught, and a literal never is.
    if (runButton) {
      const live = paramsKey(
        wireParams(widget, fetchParams, { fiscalYearEnd: fetchFiscal, calendars: sendMap, exchange, bounds }),
      );
      if (armedWireRef.current !== null && armedWireRef.current !== live) {
        setWireStale(true);
        // v5.4.0 final-review fix: a HELD trigger released here (a ⌘R held on
        // a pending lookup after a dropped hold left the " dropped" sentinel,
        // or a clock move while a lookup was pending) arrives with the hold's
        // "loading" still set, and nothing is sent — so leave it, exactly as
        // the drop does. Only from "loading": a ready or error card whose wire
        // moved keeps what it shows, as it always has.
        if (status === "loading") settleUnsent();
        return;
      }
      armedWireRef.current = live;
    }

    let cancelled = false;
    /** The one timer this card ever has in flight. */
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Date.now() of the last COMPLETED request; 0 while the first is in flight. */
    let completedAt = 0;

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
      if (!cancelled) setCompletedAt(completedAt);
      if (intervalMs === undefined || document.hidden) return;
      arm(intervalMs);
    }

    function onVisibilityChange() {
      if (cancelled || intervalMs === undefined) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      // Still waiting on the first answer: armAfterCompletion will arm it.
      if (completedAt === 0) return;
      const elapsed = Date.now() - completedAt;
      if (elapsed >= intervalMs) setAttempt((n) => n + 1);
      else arm(intervalMs - elapsed);
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
        const result = await fetchWidgetData(backend, widget, fetchParams, {
          fiscalYearEnd: fetchFiscal,
          // A bound card's map is useBundleCalendars' (useCardRequest), so the GET resolves on what preview showed.
          calendars: sendMap,
          exchange,
          bounds,
        }, (w) => { received = w; });
        if (cancelled) return;
        setWarnings(received);
        setData(result);
        if (wantsBounds && bounds === undefined) setHeldBounds(dataBounds(result));
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
    // un-run edit. Nothing in this list changed to make that true. Since
    // v5.3.0 each of those triggers also re-resolves the armed params, and a
    // resolution that moved (see `armedWireRef`) marks the card stale and
    // sends nothing — what was last run is the WIRE values, not just the
    // stored ones.
    //
    // `themeKey` is the one dependency that is not a question the user asked:
    // a themed widget's ANSWER changes with the theme, so a flip has to be
    // refetched. It is "" for every other type, which is what keeps a flip
    // free for them. It does not clear the payload either — `key` is
    // untouched — so a themed card keeps its current rendering on screen
    // while the new one is fetched, exactly as a manual Refresh does.
    //
    // `fiscalKey` for the reason on its declaration; with a run button it is
    // the armed map's, so it too refetches only on Run.
    //
    // `calendarsKey` for the reason on its declaration: a calendar arriving
    // that a resolution consulted is part of the question the wire asks; one
    // it did not consult is not a trigger at all. With a run button it is ""
    // (`calendarTrigger`): the key follows un-run edits there, so it is never
    // a trigger by itself, and `released` only lets a HELD send go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    linked,
    widget,
    backend,
    backendStatus,
    card.id,
    card.backendId,
    card.widgetId,
    key,
    fiscalKey,
    boundsKey,
    calendarTrigger,
    released,
    attempt,
    intervalMs,
    refreshEpoch,
    themeKey,
  ]);

  // runButton: release a send a real trigger held while a consulted year was
  // pending, once it is not — landed or failed. Declared after the fetch
  // effect, so a trigger that sent in the same flush has already cleared
  // `heldRef` and this sends nothing twice.
  //
  // v5.4.0 (spec §1.3): WidgetCard folds a pending fiscal lookup into the same
  // hold, and until the lookup lands the map it passes is the PROVISIONAL one
  // (December). Whatever armed the held send — the first arm, or Run — armed
  // that provisional map, and a calendar never had this problem only because
  // calendars are read live (`calendarMap`), never armed. So the release
  // re-arms the map from the live one first: the send a trigger held goes
  // out under the year end that landed. Only while the armed params still
  // ARE the live params, though — the live map is computed for the live
  // params, so after an un-run edit it belongs to the edit, and pairing it
  // with the armed params is the very mismatch `armedFiscalYearEnd` exists
  // to prevent. Then nothing is released: the card stays stale and sends
  // nothing until Run, as it would for any other un-run edit.
  //
  // v5.4.0 fix round 2: the premise above is wrong for a grouped quarter or
  // fiscal_year. effectiveParams relabels a group's value under the map, so
  // the lookup landing moves the live params with no edit at all; comparing
  // them dropped the very send the hold existed to release, and the card
  // hung on "Loading…" until Run. What is compared now is the INTENT the
  // send was armed under (see `armedIntent`): the params before any relabel
  // plus the FY ends override, a card field no params check sees. Only for
  // a send ARMED and never sent (`armedWireRef` null: the first arm or Run);
  // a held ⌘R, ↻ or interval tick is released as before and meets its own
  // armed-wire check.
  //   Unchanged: the live params and map ARE the armed intent under the
  //   landed year end — re-arm both together and release once.
  //   Changed: an un-run edit or override. Nothing is sent. The card is
  //   marked stale (`wireStale`, which only Run clears, so an override that
  //   happens to leave the map equal still shows it) and leaves "loading",
  //   since nothing is in flight: the payload it holds, else the ask for Run.
  useEffect(() => {
    if (!heldRef.current || calendarsPending) return;
    if (armedWireRef.current === null) {
      if (armedIntent !== intent) {
        heldRef.current = false;
        setWireStale(true);
        // v5.4.0 fix round 3: leaving the ref null let any OTHER trigger
        // (⌘R, ↻, a backendStatus change, a theme flip — none of them Run)
        // run the fetch effect's armed-wire check at `armedWireRef.current
        // !== null` above, find it null, and quietly arm-and-send the
        // params still armed under the provisional (December) map — the
        // very send this branch just dropped. paramsKey (src/lib/params.ts)
        // always returns a JSON.stringify object, so this sentinel can never
        // equal a live wire fingerprint: every such trigger now takes the
        // "wire moved" path instead and sends nothing. Run already nulls the
        // ref itself (`run`, above) before re-arming, so Run is unaffected.
        armedWireRef.current = " dropped";
        settleUnsent();
        return;
      }
      setArmedParams(params);
      setArmedFiscalYearEnd(fiscalYearEnd);
    }
    setReleased((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarsPending]);

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
  //
  // Read on every render (the minute tick forces one): stale means the
  // widget has an interval and more than that has passed since the answer.
  void minuteTick;
  const stalePastInterval =
    intervalMs !== undefined && completedAt !== null && Date.now() - completedAt > intervalMs;
  return {
    status,
    data,
    error,
    warnings,
    retry,
    attempt,
    run: runButton ? run : retry,
    stale,
    intervalMs,
    completedAt,
    stalePastInterval,
  };
}
