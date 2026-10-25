// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { type App, UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { BUILTIN_BACKEND_ID, BUILTIN_WIDGETS } from "../lib/builtins";
import type { DiscoveryResult } from "../lib/discovery";
import type { WidgetDef } from "../lib/types";

/** One backend's app, tagged with the backend that served it — an app has no
 * id of its own, so nothing else says where it came from or which registry
 * its cards resolve against. */
export type RegistryApp = { backendId: string; app: App };

type RegistryState = {
  widgets: WidgetDef[];
  apps: RegistryApp[];
  applyDiscovery: (results: DiscoveryResult[]) => void;
  dropBackend: (backendId: string) => void;
  find: (backendId: string, widgetId: string) => WidgetDef | undefined;
  seedBuiltins: () => void;
};

export const useWidgetRegistryStore = create<RegistryState>((set, get) => ({
  widgets: [],
  apps: [],

  applyDiscovery: (results) => {
    // Only an online result replaces a backend's widgets. An offline result
    // leaves that backend's last-known widgets in place: its cards stay
    // resolved, so useWidgetData's own fetch fails and ErrorState+Retry
    // shows, instead of the widget disappearing and cards falling back to
    // the unresolved placeholder. This also means pressing Refresh on a
    // dead backend cannot wipe a library that was previously populated.
    const online = results.filter((r) => r.status === "online");
    const replaced = new Set(online.map((r) => r.backendId));
    set((state) => ({
      widgets: [
        ...state.widgets.filter((w) => !replaced.has(w.backendId)),
        ...online.flatMap((r) => r.widgets),
      ],
      // Apps follow the same rule, for the same reason: an offline backend
      // keeps its last-known apps rather than vanishing from the Apps view
      // because one Refresh could not reach it.
      apps: [
        ...state.apps.filter((a) => !replaced.has(a.backendId)),
        ...online.flatMap((r) => (r.apps ?? []).map((app) => ({ backendId: r.backendId, app }))),
      ],
    }));
  },

  dropBackend: (backendId) => {
    set((state) => ({
      widgets: state.widgets.filter((w) => w.backendId !== backendId),
      apps: state.apps.filter((a) => a.backendId !== backendId),
    }));
  },

  // An imported card that no connected backend served at import time carries
  // the sentinel instead of a backend id. Searching every backend for the id
  // is what lets such a card come alive on its own once a backend that serves
  // it connects; dashboardStore's pinResolvedBackends then writes that
  // backendId onto the card on the dashboard's next save, so the answer
  // cannot differ between sessions once it has been given.
  find: (backendId, widgetId) =>
    backendId === UNRESOLVED_BACKEND_ID
      ? get().widgets.find((w) => w.id === widgetId)
      : get().widgets.find((w) => w.backendId === backendId && w.id === widgetId),

  /** Idempotent: App's effect can run twice under StrictMode in dev. */
  seedBuiltins: () => {
    set((state) => ({
      widgets: [
        ...state.widgets.filter((w) => w.backendId !== BUILTIN_BACKEND_ID),
        ...BUILTIN_WIDGETS,
      ],
    }));
  },
}));
