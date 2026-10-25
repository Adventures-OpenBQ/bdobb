// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from "react";
import { fetchEndpoint, fetchFiscalYearEnd } from "../lib/dataClient";
import {
  consultsFiscal,
  fiscalChain,
  fiscalControlParam,
  fiscalReason,
  isTickerParam,
  singleTicker,
  takesFiscalYearEnd,
  type EndpointAnswer,
  type FiscalSource,
} from "../lib/fiscalChain";
import { logOnce } from "../lib/logger";
import { optionsRequestParams } from "../lib/paramOptions";
import { wireParams } from "../lib/params";
import { fiscalYearEndOf, parseFyEndMonth } from "../lib/periods";
import type { BackendConfig, WidgetDef, WidgetParam } from "../lib/types";
import { endpointRequestKey, useEndpointRequests } from "./useParamOptions";
import { joinInFlight } from "./joinInFlight";

/**
 * Module-level and keyed exactly as useParamOptions keys its option lists:
 * backend id + base URL + endpoint + the request params' fingerprint. Two
 * cards asking the same backend the same symbol's year end share one
 * request, and a card re-mounted costs nothing. Only an ANSWER is cached; an
 * error or an unreadable body is not, so the next mount asks again.
 */
const cache = new Map<string, number>();
const inFlight = new Map<string, Promise<number | undefined>>();

/**
 * v5.4.0's built-in lookup (spec §1.3), keyed by backend id + base URL + the
 * upper-cased ticker, shared by every card for the session. Unlike the
 * endpoint cache above, a failure IS remembered — `null` — whether a 404, an
 * HTTP error, a transport error or an unreadable body: the route is
 * openbb-docker's own, most backends answer 404, and asking again on every
 * card mount would cost a request per card for an answer that will not
 * change until the app restarts.
 */
const lookupCache = new Map<string, number | null>();
const lookupInFlight = new Map<string, Promise<void>>();

/** Both maps outlive any one test; every test starts from empty. */
export function __resetFiscalYearEndCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  // v5.4.0: and the lookup's two.
  lookupCache.clear();
  lookupInFlight.clear();
}

/**
 * The built-in lookup's answer for one ticker, through the shared lookupCache:
 * the month (1..12), or null for any failure (remembered, see above). Exported
 * so the statement-row correction (useStatementYearEnds) asks the same cache
 * under the same key -- a card whose date param already looked a symbol up does
 * not make the correction ask again.
 */
export function lookupFiscalYearEnd(backend: BackendConfig, ticker: string): Promise<number | null> {
  const key = `${backend.id}\n${backend.baseUrl}|${ticker}`;
  if (lookupCache.has(key)) return Promise.resolve(lookupCache.get(key) ?? null);
  const pending = joinInFlight(lookupInFlight, key, () =>
    fetchFiscalYearEnd(backend, ticker).then(
      (payload) => {
        // null is the 404: an answer ("no data"), and nothing worth a log line.
        const month = payload === null ? undefined : fiscalYearEndOf(payload);
        if (payload !== null && month === undefined) {
          void logOnce(
            `fiscal-lookup:${key}`,
            `unusable fiscal year end from ${backend.name} for ${ticker}: ${JSON.stringify(payload)}`,
          );
        }
        lookupCache.set(key, month ?? null);
      },
      (err: unknown) => {
        void logOnce(
          `fiscal-lookup:${key}`,
          `fiscal year end lookup failed for ${ticker}: ${err instanceof Error ? err.message : String(err)}`,
        );
        lookupCache.set(key, null);
      },
    ),
  );
  return pending.then(() => lookupCache.get(key) ?? null);
}

/**
 * The request slot a widget-level `fiscalYearEndEndpoint` rides in among the
 * params' own. The parentheses keep it off any plausible paramName.
 */
const WIDGET_SLOT = "(widget)";

/**
 * What the hook returns since v5.4.0. `months` is the map it used to return;
 * the rest is the lookup's: the ⚠ text per consulting param whose lookup
 * failed, whether a consulted lookup is still in flight (WidgetCard holds
 * the send on it, as on a pending calendar year), and what the "FY ends"
 * control shows — fiscalControlParam's resolution WITHOUT the card's
 * override, so its Automatic option can say what Automatic would give.
 */
/**
 * The widget's own endpoint, in WIDGET_SLOT, templated with the single ticker
 * param as `symbol` — the lookup's own shape — when the widget declares
 * exactly one (ruling 8).
 */
function widgetSlot(widget: WidgetDef): WidgetParam | undefined {
  if (!widget.fiscalYearEndEndpoint) return undefined;
  const tickers = widget.params.filter(isTickerParam);
  return {
    paramName: WIDGET_SLOT,
    fiscalYearEndEndpoint: widget.fiscalYearEndEndpoint,
    ...(tickers.length === 1 ? { optionsParams: { symbol: `$${tickers[0].paramName}` } } : {}),
  };
}

export type FiscalYearEnds = {
  months: Record<string, number>;
  reasons: Record<string, string>;
  pending: boolean;
  control?: { month: number; source: FiscalSource; ticker?: string };
};

/**
 * The resolved year-end month of every `quarter` / `fiscal_year` param of
 * `widget`, by paramName, first hit wins:
 *
 *   1. `fiscalYearEndEndpoint`, templated from `optionsParams` as an options
 *      endpoint is, once it has answered something readable;
 *   2. `fiscalYearEndParam`: the sibling's EFFECTIVE value in `values`, parsed;
 *   3. `fiscalYearEnd`: the static field;
 *   4. December.
 *
 * While an endpoint is in flight — or has failed — the entry is the next
 * source down, and the map re-renders when the answer lands. `values` are
 * the card's effective params so a grouped sibling is read as the group
 * holds it; changing the templated symbol moves the request key and
 * refetches, which is the cascade.
 *
 * The returned object keeps its identity while its contents do not change,
 * so WidgetCard can list it in a memo's dependencies without refetching
 * every card on every render.
 *
 * v5.4.0 (spec §1): the map covers every `quarter`, `fiscal_year`,
 * `quarter_range`, `date` and `date_range` param, and the order is
 * fiscalChain's — the card's `override`, the param's own fields, the
 * widget's, the built-in per-ticker lookup (a single ticker only), then
 * December. The lookup is asked only for a param that CONSULTS a year end;
 * while it is in flight `pending` is true; a failed lookup is remembered and
 * each consulting param carries a ⚠ reason. A declared endpoint that failed
 * falls through like any other rung, to the lookup too; one still in flight
 * shows the synchronous rungs past it meanwhile — never the lookup, never a
 * hold, never a ⚠ — as v5.2.0 did.
 */
export function useFiscalYearEnd(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  backend: BackendConfig | undefined,
  override?: number,
): FiscalYearEnds {
  const covered = useMemo(() => (widget?.params ?? []).filter((p) => takesFiscalYearEnd(p.type)), [widget]);

  // The endpoints to ask: every covered param's own, and the widget's.
  const endpointParams = useMemo<WidgetParam[]>(() => {
    const own = covered.filter((p) => p.fiscalYearEndEndpoint);
    const slot = widget && widgetSlot(widget);
    return slot ? [...own, slot] : own;
  }, [widget, covered]);

  // Fingerprinted inside useEndpointRequests, not depended on by identity,
  // for the same reasons as in useParamOptions: WidgetCard rebuilds `values`
  // on renders that change nothing a request cares about, and a
  // BackendConfig is built inline.
  // v5.4.0 (spec §6): a `$param` in the fiscal endpoint's params is that
  // param's wire value too — resolved on its type only, with no calendars
  // and no year end, because both are built FROM this hook's answer (ruling
  // 6). In practice the referenced param is a ticker, sent as stored.
  const { requests, backendKey, keys } = useEndpointRequests(
    endpointParams,
    (p) => p.fiscalYearEndEndpoint,
    widget ? wireParams(widget, values) : values,
    backend,
  );

  /** Answers that landed while this hook was mounted, by request key. */
  // v5.4.0: `null` records a request of this mount that settled with no
  // usable answer, so the chain can tell "failed" (fall through) from "still
  // in flight" (controller ruling PF4) without the module cache remembering
  // a failure it was built not to.
  const [landed, setLanded] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!backend) {
      for (const r of requests) {
        void logOnce(
          `fiscal-year-end:${r.key}`,
          `fiscal year end lookup skipped for ${r.paramName}: backend not configured`,
        );
      }
      return;
    }
    let cancelled = false;
    for (const r of requests) {
      if (cache.has(r.key)) continue;
      const pending = joinInFlight(inFlight, r.key, () =>
        fetchEndpoint(backend, r.endpoint, r.requestParams).then(
          (payload) => {
            const month = fiscalYearEndOf(payload);
            if (month === undefined) {
              void logOnce(
                `fiscal-year-end:${r.key}`,
                `unusable fiscal year end from ${r.endpoint} for ${r.paramName}: ${JSON.stringify(payload)}`,
              );
              return undefined;
            }
            cache.set(r.key, month);
            return month;
          },
          (err: unknown) => {
            void logOnce(
              `fiscal-year-end:${r.key}`,
              `fiscal year end lookup failed for ${r.paramName}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return undefined;
          },
        ),
      );
      // `cancelled` is the stale-response guard: a key moving is a dependency
      // change, so this run's cleanup flips it before the new run issues
      // anything, and an answer for a symbol the card has left is dropped.
      // v5.4.0: a failure lands too, as null — the chain then falls through.
      void pending.then((month) => {
        if (cancelled) return;
        setLanded((s) => ({ ...s, [r.key]: month ?? null }));
      });
    }
    return () => {
      cancelled = true;
    };
    // `requests` and `backend` are read above; `keys` and `backendKey` are
    // their dependency-safe stand-ins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendKey, keys]);

  const ticker = widget && backend ? singleTicker(widget, values) : undefined;
  const lookupKey = ticker ? `${backendKey}|${ticker}` : "";
  const overrideMonth = parseFyEndMonth(override);
  /** Bumped when a lookup lands, so the next render re-reads lookupCache. */
  const [, setLookupLanded] = useState(0);
  const hit = lookupKey ? lookupCache.get(lookupKey) : undefined;
  const hitSeen = hit !== undefined;

  // Controller ruling PF4: "pending" only for a DECLARED endpoint whose
  // request is in flight, a number only for one that answered, undefined
  // otherwise (none declared, it failed, or there is no backend to ask) —
  // fiscalChain trusts the caller on this.
  const answer = (paramName: string): EndpointAnswer => {
    const request = requests.find((r) => r.paramName === paramName);
    if (!request) return undefined;
    const got = cache.get(request.key) ?? landed[request.key];
    if (got !== undefined) return got ?? undefined;
    return backend ? "pending" : undefined;
  };
  const settled = (a: EndpointAnswer): EndpointAnswer => (a === "pending" ? undefined : a);

  const months: Record<string, number> = {};
  const reasons: Record<string, string> = {};
  let control: FiscalYearEnds["control"];
  let consults = false;
  if (widget) {
    const controlParam = fiscalControlParam(widget, values);
    const fromWidget = answer(WIDGET_SLOT);
    // Sources 2–4 live in nonEndpointFiscalYearEnd, shared with deleteGroup.
    // v5.4.0: for this hook they now live in fiscalChain, which reads the
    // same fields in the same order; deleteGroup still uses
    // nonEndpointFiscalYearEnd.
    // v5.4.0 Task 10: deleteGroup now uses fiscalChain too (card override first).
    for (const p of covered) {
      const own = answer(p.paramName);
      let step = fiscalChain(p, widget, values, { param: own, widget: fromWidget });
      // Controller ruling 2: while a declared endpoint the chain reached is
      // in flight, show the chain continued past it on the synchronous rungs
      // alone — the lookup is not asked for this, the card does not hold for
      // it and no ⚠ shows; December if nothing synchronous answers. v5.2.0
      // behaved so, and the endpoint's answer re-renders the map.
      const provisional = "pending" in step;
      if (provisional) step = fiscalChain(p, widget, values, { param: settled(own), widget: settled(fromWidget) });
      let month = 12;
      let source: FiscalSource = "default";
      if ("month" in step) {
        ({ month, source } = step);
      } else if (provisional || !ticker) {
        // December: nothing synchronous answered, and the lookup is out.
      } else if (typeof hit === "number") {
        month = hit;
        source = "lookup";
      } else if (overrideMonth === undefined && consultsFiscal(p.type, values[p.paramName] ?? "")) {
        // Ruling 10: with an override set nothing consults — no fetch, no
        // hold, no ⚠ — since the override is the answer for every param.
        consults = true;
        if (hit === null) reasons[p.paramName] = fiscalReason(ticker);
      }
      if (p === controlParam) control = source === "lookup" ? { month, source, ticker } : { month, source };
      months[p.paramName] = overrideMonth ?? month;
    }
  }
  const pending = consults && !hitSeen;

  useEffect(() => {
    if (!consults || !backend || !ticker) return;
    // Another card's lookup can land between this render and this effect:
    // re-read the cache then rather than wait on a fetch there is nothing to
    // join (useTradingCalendar's `missing` guards the same race).
    if (lookupCache.has(lookupKey)) {
      if (!hitSeen) setLookupLanded((n) => n + 1);
      return;
    }
    let cancelled = false;
    void lookupFiscalYearEnd(backend, ticker).then(() => {
      if (!cancelled) setLookupLanded((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // `backend` and `ticker` are read above; lookupKey is their
    // dependency-safe stand-in, and `hit` matters only as seen-or-not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupKey, consults, hitSeen]);

  // Identity follows content: a fresh object per render would put every
  // consumer's memo on a treadmill.
  const json = JSON.stringify({ months, reasons, pending, control });
  return useMemo(() => JSON.parse(json) as FiscalYearEnds, [json]);
}

/** Test seam: seed what a mounted card would have resolved (lookup by backend+ticker, endpoint by request key). */
export function __primeFiscalYearEndCachesForTests(p: { lookup?: Record<string, number | null>; endpoint?: Record<string, number> }): void {
  for (const [k, v] of Object.entries(p.lookup ?? {})) lookupCache.set(k, v);
  for (const [k, v] of Object.entries(p.endpoint ?? {})) cache.set(k, v);
}

/**
 * useFiscalYearEnd's map, read synchronously from the module caches that
 * mounted cards fill: same chain, same keys, but it never fetches. For callers
 * with no React tree (Rita's get_widget_data) that must send the month the
 * card shows.
 * ponytail: a month no card has resolved yet (nothing cached, or still in
 * flight) reads as December here. Fire the same requests when Rita must
 * resolve a card that was never mounted.
 */
export function fiscalYearEndSync(
  widget: WidgetDef | undefined,
  values: Record<string, string>,
  backend: BackendConfig | undefined,
  override?: number,
): Record<string, number> {
  const months: Record<string, number> = {};
  if (!widget) return months;
  const backendKey = backend ? `${backend.id}\n${backend.baseUrl}` : "";
  const wire = wireParams(widget, values);
  const keyOf = (p: WidgetParam): string | undefined =>
    p.fiscalYearEndEndpoint ? endpointRequestKey(backendKey, p.fiscalYearEndEndpoint, optionsRequestParams(p.optionsParams, wire)) : undefined;
  const slot = widgetSlot(widget);
  const answer = (p: WidgetParam | undefined): EndpointAnswer => {
    const key = p && keyOf(p);
    if (!key) return undefined;
    const got = cache.get(key);
    if (got !== undefined) return got;
    return backend && inFlight.has(key) ? "pending" : undefined;
  };
  const settled = (a: EndpointAnswer): EndpointAnswer => (a === "pending" ? undefined : a);
  const ticker = backend ? singleTicker(widget, values) : undefined;
  const hit = ticker ? lookupCache.get(`${backendKey}|${ticker}`) : undefined;
  const overrideMonth = parseFyEndMonth(override);
  for (const p of widget.params.filter((q) => takesFiscalYearEnd(q.type))) {
    const own = answer(p);
    const fromWidget = answer(slot);
    let step = fiscalChain(p, widget, values, { param: own, widget: fromWidget });
    const provisional = "pending" in step;
    if (provisional) step = fiscalChain(p, widget, values, { param: settled(own), widget: settled(fromWidget) });
    let month = 12;
    if ("month" in step) month = step.month;
    else if (!provisional && typeof hit === "number") month = hit;
    months[p.paramName] = overrideMonth ?? month;
  }
  return months;
}
