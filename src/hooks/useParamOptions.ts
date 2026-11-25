// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useState } from "react";
import { fetchParamOptions } from "../lib/dataClient";
import { optionsRequestParams } from "../lib/paramOptions";
import { paramsKey } from "../lib/params";
import type { BackendConfig, ParamOption, WidgetDef, WidgetParam } from "../lib/types";

/**
 * Every variant carries the `key` it belongs to — backend id + endpoint + the
 * request params' fingerprint, the same string the cache is keyed by. A
 * consumer can therefore tell "the list for the upstream value the strip
 * opened on" from "the list for a different one" without comparing arrays,
 * which is what the params strip's cascade clearing turns on: a list that
 * arrives under a key the strip did not open with means an upstream param
 * moved, even if the first list for the old key never arrived.
 */
export type OptionsState =
  | { status: "loading"; options?: ParamOption[]; key: string }
  | { status: "ready"; options: ParamOption[]; key: string }
  | { status: "error"; error: string; key: string };

/**
 * Module-level, so every strip in the app shares them and a strip closed and
 * reopened costs nothing. Keyed by backend id AND base URL + endpoint + the
 * request params' fingerprint, which is exactly what varies: two cards asking
 * the same backend the same question of the same endpoint get one request
 * between them.
 *
 * The backend is part of the key because endpoint NAMES are not unique across
 * backends — two configured OpenBB instances both expose `chambers` — and a
 * shared list would then be served for the wrong backend for the app's whole
 * lifetime. Its base URL is in there with its id because an id can be
 * re-pointed at a different host (editing a connection) while keeping its id,
 * which is the same collision wearing the same name. The credential is never
 * part of the key.
 *
 * There is no invalidation. A backend restart that changes a choice list
 * needs an app restart to be seen — acceptable for choice lists.
 */
const cache = new Map<string, ParamOption[]>();
type PendingOptions = {
  controller: AbortController;
  promise: Promise<ParamOption[]>;
  consumers: number;
};
const inFlight = new Map<string, PendingOptions>();

/** Both maps outlive any one test; every test starts from empty. */
export function __resetParamOptionsCacheForTests(): void {
  for (const pending of inFlight.values()) pending.controller.abort();
  cache.clear();
  inFlight.clear();
}

export type EndpointRequest = {
  paramName: string;
  endpoint: string;
  requestParams: Record<string, string>;
  key: string;
};

/**
 * One request per param of `params` that `endpointOf` names an endpoint for,
 * templated from its `optionsParams` over `values` and keyed by backend id +
 * base URL + endpoint + the request params' fingerprint — the key this
 * module's cache and useFiscalYearEnd's are both keyed by. Shared by
 * useParamOptions (`optionsEndpoint`) and useFiscalYearEnd
 * (`fiscalYearEndEndpoint`), which differ only in the field.
 */
/** One endpoint request's cache key: the backend, the endpoint and its params. */
export const endpointRequestKey = (backendKey: string, endpoint: string, requestParams: Record<string, string>): string =>
  `${backendKey}|${endpoint}?${paramsKey(requestParams)}`;

export function useEndpointRequests(
  params: WidgetParam[],
  endpointOf: (p: WidgetParam) => string | undefined,
  values: Record<string, string>,
  backend: BackendConfig | undefined,
): { requests: EndpointRequest[]; backendKey: string; keys: string } {
  // Fingerprinted, not depended on by identity: ParamControls builds
  // `{ ...effective, ...draft }` inline, so `values` is a new object on every
  // keystroke anywhere in the strip. Same reasoning as useWidgetData's `key`.
  const valuesKey = paramsKey(values);

  // Fingerprinted for the same reason as `values`: callers build a
  // BackendConfig inline, so identity churns on every render while the backend
  // it names does not — and an effect that re-runs per render, then sets state,
  // never stops. id + baseUrl is what a fetch is actually addressed by; the
  // credential is deliberately not part of any key.
  const backendKey = backend ? `${backend.id}\n${backend.baseUrl}` : "";

  const requests = useMemo<EndpointRequest[]>(() => {
    const out: EndpointRequest[] = [];
    for (const p of params) {
      const endpoint = endpointOf(p);
      if (!endpoint) continue;
      const requestParams = optionsRequestParams(p.optionsParams, values);
      out.push({
        paramName: p.paramName,
        endpoint,
        requestParams,
        key: endpointRequestKey(backendKey, endpoint, requestParams),
      });
    }
    return out;
    // `values` and `backend` are read above but deliberately not dependencies;
    // valuesKey and backendKey are their value-derived stand-ins (see the
    // comments above them). `endpointOf` only picks a field, and both callers
    // pass it inline, so it is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, valuesKey, backendKey]);

  // The effect's real dependency. A keystroke in an unrelated param leaves
  // every key alone, and so must refetch nothing.
  return { requests, backendKey, keys: requests.map((r) => r.key).join("\n") };
}

/**
 * The options for every param of `widget` that declares an `optionsEndpoint`,
 * keyed by paramName. A param without one gets no entry.
 *
 * `values` are the strip's CURRENT (draft-merged) values, so changing an
 * upstream param moves a dependent param's key and refetches it — that is the
 * cascade, and it happens live, before Apply.
 *
 * Nothing is fetched until this hook mounts, i.e. until a params strip opens.
 * Resolving options at widget-discovery time instead would fire one request
 * per endpoint param on every backend sweep and still could not serve a
 * templated param, which has no values to template from yet.
 */
export function useParamOptions(
  backend: BackendConfig | undefined,
  widget: WidgetDef,
  values: Record<string, string>,
): Record<string, OptionsState> {
  const { requests, backendKey, keys } = useEndpointRequests(widget.params, (p) => p.optionsEndpoint, values, backend);

  const [states, setStates] = useState<Record<string, OptionsState>>({});

  useEffect(() => {
    if (!backend) {
      setStates(
        Object.fromEntries(
          requests.map((r): [string, OptionsState] => [
            r.paramName,
            { status: "error", error: "Backend not configured", key: r.key },
          ]),
        ),
      );
      return;
    }

    setStates((prev) => {
      const next: Record<string, OptionsState> = {};
      for (const r of requests) {
        const cached = cache.get(r.key);
        if (cached) {
          next[r.paramName] = { status: "ready", options: cached, key: r.key };
          continue;
        }
        // Carry a previous ready list into the loading state, so a cascade
        // refetch leaves the control populated instead of blanking it.
        const before = prev[r.paramName];
        next[r.paramName] =
          before !== undefined && before.status === "ready"
            ? { status: "loading", options: before.options, key: r.key }
            : { status: "loading", key: r.key };
      }
      return next;
    });

    let cancelled = false;
    const subscriptions: Array<{ key: string; pending: PendingOptions }> = [];

    for (const r of requests) {
      if (cache.has(r.key)) continue;

      let pending = inFlight.get(r.key);
      if (!pending) {
        const controller = new AbortController();
        const promise = fetchParamOptions(backend, r.endpoint, r.requestParams, { signal: controller.signal });
        const entry = { controller, promise, consumers: 0 };
        inFlight.set(r.key, entry);
        pending = entry;
        void promise.then(
          (options) => {
            if (inFlight.get(r.key) !== entry) return;
            cache.set(r.key, options);
            inFlight.delete(r.key);
          },
          () => {
            if (inFlight.get(r.key) === entry) inFlight.delete(r.key);
          },
        );
      }
      pending.consumers++;
      subscriptions.push({ key: r.key, pending });

      // `cancelled` is the whole stale-response guard: a key moving is a
      // dependency change, so this run's cleanup has already flipped it before
      // the new run issues anything. A response for a key the param has moved
      // past (pick House, then Senate before House's committees land) can
      // therefore only arrive into a cancelled run, and is dropped here.
      void pending.promise.then(
        (options) => {
          if (cancelled) return;
          setStates((s) => ({ ...s, [r.paramName]: { status: "ready", options, key: r.key } }));
        },
        (err: unknown) => {
          if (cancelled) return;
          setStates((s) => ({
            ...s,
            [r.paramName]: {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              key: r.key,
            },
          }));
        },
      );
    }

    return () => {
      cancelled = true;
      for (const { key, pending } of subscriptions) {
        pending.consumers--;
        if (pending.consumers !== 0) continue;
        // A cascade or StrictMode can resubscribe to the same key in this turn.
        queueMicrotask(() => {
          if (pending.consumers !== 0 || inFlight.get(key) !== pending) return;
          inFlight.delete(key);
          pending.controller.abort();
        });
      }
    };
    // `requests` and `backend` are read above; `keys` and `backendKey` are
    // their dependency-safe stand-ins — a widget object rebuilt with the same
    // endpoints has nothing to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendKey, keys]);

  return states;
}
