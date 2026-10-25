// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * jsdom implements no matchMedia at all -- the property is simply
 * absent -- so anything that follows the OS appearance (`theme: "system"`,
 * see src/hooks/useResolvedTheme.ts) has nothing to read in a test. This
 * installs a controllable stand-in for one test and takes it away again.
 *
 * The stub is deliberately NOT a full MediaQueryList: it answers `matches`
 * for whatever query it is handed and supports addEventListener/
 * removeEventListener("change", ...), which is all the app uses. Every list
 * it hands out shares one listener set, so `listenerCount()` is a direct
 * assertion that a hook unsubscribed on unmount.
 */
type Listener = (event: MediaQueryListEvent) => void;

export type MatchMediaStub = {
  /** Flip the query's value and fire `change`, as an OS appearance switch does. */
  set(matches: boolean): void;
  /** Live `change` listeners; 0 after a subscriber has unmounted. */
  listenerCount(): number;
  /** Every query string passed to matchMedia, in call order. */
  queries: string[];
  /** Restores whatever window.matchMedia was before (usually: absent). */
  restore(): void;
};

export function stubMatchMedia(matches: boolean): MatchMediaStub {
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  let current = matches;

  // globalThis, not window: some test files run on vitest's node
  // environment, where there is no window to hang this on -- and in jsdom
  // the two are the same object anyway.
  const host = globalThis as unknown as { matchMedia?: (query: string) => MediaQueryList };
  const had = Object.prototype.hasOwnProperty.call(host, "matchMedia");
  const previous = host.matchMedia;

  const matchMedia = (query: string) => {
    queries.push(query);
    return {
      media: query,
      get matches() {
        return current;
      },
      addEventListener: (type: string, listener: Listener) => {
        if (type === "change") listeners.add(listener);
      },
      removeEventListener: (type: string, listener: Listener) => {
        if (type === "change") listeners.delete(listener);
      },
      // Present so the stub is usable by code written against the legacy
      // API, but the app uses addEventListener; deliberately inert.
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    } as unknown as MediaQueryList;
  };

  host.matchMedia = matchMedia;

  return {
    set(next: boolean) {
      current = next;
      const event = { matches: next } as MediaQueryListEvent;
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
    queries,
    restore() {
      listeners.clear();
      if (had) host.matchMedia = previous;
      else delete host.matchMedia;
    },
  };
}
