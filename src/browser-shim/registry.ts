// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One window-global shared by the browser-mode shims so a Playwright spec can
 * inspect what the app did (files written, urls opened) without a Tauri
 * runtime. Created lazily: shim modules evaluate in whatever order the app's
 * import graph dictates, so none of them may assume another ran first.
 */
export type BdobbGlobal = {
  opened: string[];
  read?: (path: string) => string | undefined;
  list?: () => string[];
};

declare global {
  interface Window {
    __bdobbSeed?: Record<string, string | number[]>;
    /**
     * Set by the web preview's bootstrap (web/bootstrap.mjs) when it has a
     * gateway: same-origin sockets then open on the gateway with a ticket
     * (socket.ts). /ref/live_grid_ws and /news/ws/news are the sockets at this line.
     */
    __bdobbSocketTickets?: boolean;
    /**
     * Set by the web preview's bootstrap only when it READ the user's saved
     * state: fs.ts then mirrors the app's JSON stores to /state.
     */
    __bdobbPersist?: boolean;
    /** Set by the web preview's bootstrap: the server an empty News card falls back to (src/lib/news.ts). */
    __bdobbNewsServer?: string;
    /**
     * Paths memfs must fail every operation on, the driver's half of
     * `__failPath`. A seed can only describe files that ARE readable, and
     * some behaviour only exists for the ones that are not — the startup
     * banner names the loaders whose file could not be read at all, which a
     * merely corrupt file never triggers (it is quarantined and reseeded, and
     * the loader succeeds). Set it the same way as the seed, before any app
     * module evaluates.
     */
    __bdobbFail?: string[];
    __bdobb?: BdobbGlobal;
  }
}

export function bdobb(): BdobbGlobal {
  return (window.__bdobb ??= { opened: [] });
}
