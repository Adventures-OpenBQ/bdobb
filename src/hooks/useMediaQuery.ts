// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useSyncExternalStore } from "react";

function list(query: string | null): MediaQueryList | null {
  return query && typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query) : null;
}

/**
 * `matchMedia(query).matches`, re-read on every `change`. Null where the host
 * has no matchMedia at all (jsdom, bare Node) -- each caller picks its own
 * fallback -- and for a null `query`, which is how a caller declines to
 * subscribe at all.
 */
export function useMediaQuery(query: string | null): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = list(query);
      if (mql === null) return () => {};
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => list(query)?.matches ?? null);
}
