// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useSyncExternalStore } from "react";

/**
 * `matchMedia(query).matches`, re-read on every `change`. Null where the host
 * has no matchMedia at all (jsdom, bare Node) -- each caller picks its own
 * fallback -- and for a null `query`, which is how a caller declines to
 * subscribe at all.
 */
export function useMediaQuery(query: string | null): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = query && typeof window !== "undefined" && "matchMedia" in window
        ? window.matchMedia(query) : null;
      if (media === null) return () => {};
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    const media = query && typeof window !== "undefined" && "matchMedia" in window
      ? window.matchMedia(query) : null;
    return media?.matches ?? null;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
