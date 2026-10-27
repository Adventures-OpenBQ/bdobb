// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useState } from "react";
import { fetchWidgetPath } from "../lib/dataClient";
import { logOnce } from "../lib/logger";
import type { CatalogEntry } from "../lib/chart/studyExpression";
import { sessionCache } from "../lib/sessionCache";
import type { BackendConfig } from "../lib/types";

/**
 * Keyed by backend id -- one `ta_registry` fetch per backend for the app's
 * lifetime (see sessionCache), the same discipline as useTradingCalendar and
 * useFiscalYearEnd. The cache's negative hit remembers a failed or unusable
 * fetch ("unavailable"); an array is a landed catalog; unasked is "loading".
 */
const cache = sessionCache<CatalogEntry[]>();

export const __resetTaRegistryCacheForTests = cache.reset;

export type TaRegistry = {
  catalog: CatalogEntry[];
  lookup: (name: string) => CatalogEntry | undefined;
  status: "loading" | "ready" | "unavailable";
  /**
   * Forget this backend's catalog and fetch it again (docs/custom-studies.md,
   * Refetch): the picker's "Refresh studies" control, for the operator who
   * has just uploaded a study. Every chart on the backend shares the cache,
   * so one refresh updates them all; each re-renders on its own next tick.
   */
  refresh: () => void;
};

/**
 * ponytail: trusts the shape rather than validating every field of every
 * entry -- `/ta_registry` is this app's own backend (openbb-docker's
 * live-grid), not third-party input, and a malformed entry would surface
 * downstream as a catalog lookup or a render that finds nothing useful on
 * it, not as a crash. Upgrade path: a per-field validator if a bad registry
 * response ever ships in practice.
 */
function parseCatalog(payload: unknown): CatalogEntry[] | null {
  if (!Array.isArray(payload)) return null;
  // v12.3.0 (slice 4): `windows` is the one field this app cannot do without
  // -- parseStudyExpression asks whether a param is in it for every `bd` arg
  // -- so an older backend that does not project it gets an empty list here
  // rather than an `undefined.includes` at the first typed window. The
  // per-param `window` flag is optional in the type, so absent already reads
  // as false and needs no filling in. Same for v12.3.1's presentation
  // fields (`group`, `full`/`title`, `desc`, `description`, `wiki`, and the
  // per-param `label`/`step`): absent is the whole
  // signal, and catalogGroup/catalogTitle supply the degraded reading at the
  // point of use rather than inventing one here.
  return (payload as CatalogEntry[]).map((entry) => ({ ...entry, windows: entry.windows ?? [] }));
}

/**
 * The `/ta_registry` catalog for `backend` (studies addendum §3: the
 * registry is the single source of truth for every indicator's params,
 * pane and defaults). Fetched once and cached for the session; best-effort
 * -- a network failure or an unusable body lands as "unavailable" with an
 * empty catalog, logged once, never thrown, so a card with no studies (or
 * one whose backend serves none) still renders its `indicators`/`macro`
 * params exactly as before.
 */
export function useTaRegistry(backend: BackendConfig | undefined): TaRegistry {
  const [, setTick] = useState(0);
  const key = backend?.id ?? "";

  useEffect(() => {
    if (!backend) return;
    if (cache.get(backend.id) !== undefined) return;
    let cancelled = false;
    void load(backend).then(() => {
      if (!cancelled) setTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // `backend` is read above; `key` is its dependency-safe stand-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const hit = backend ? cache.get(backend.id) : undefined;
  const catalog = hit ?? [];
  const status: TaRegistry["status"] = !backend ? "unavailable" : hit === undefined ? "loading" : hit === null ? "unavailable" : "ready";
  const lookup = (name: string): CatalogEntry | undefined =>
    catalog.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  // The first tick shows "loading" (the key is gone); the second lands the
  // answer. Not routed through the effect, whose dependency is the backend
  // id and so does not fire for a refetch of the same backend.
  const refresh = () => {
    if (!backend) return;
    cache.drop(backend.id);
    setTick((n) => n + 1);
    void load(backend).then(() => setTick((n) => n + 1));
  };

  return { catalog, lookup, status, refresh };
}

/** One `ta_registry` fetch for `backend`, joined or served from the cache. */
function load(backend: BackendConfig): Promise<CatalogEntry[] | null> {
  return cache.getOrFetch(backend.id, () =>
    fetchWidgetPath(backend, "ta_registry", {}).then(
      (payload) => {
        const entries = parseCatalog(payload);
        if (entries === null) {
          void logOnce(`ta-registry:${backend.id}`, `unusable ta_registry from ${backend.name}`);
        }
        return entries;
      },
      (err: unknown) => {
        void logOnce(
          `ta-registry:${backend.id}`,
          `ta_registry unavailable from ${backend.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      },
    ),
  );
}
