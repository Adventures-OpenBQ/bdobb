// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logError } from "../lib/logger";
import { useWorkspacesStore } from "../stores/workspacesStore";

/**
 * The desktop app's Window-menu pins. Each id and event is kept in sync by
 * hand with KEEP_*_ID / KEEP_*_EVENT in src-tauri/src/lib.rs -- a bare string
 * has no shared type across the two sides.
 */
export const SIDEBAR_PIN = { id: "window-keep-sidebar-open", event: "menu://toggle-sidebar-pin" } as const;

type PinState = { checked: boolean; enabled: boolean };

/** The ACTIVE workspace's rail pin. Outside a workspace there is nothing to pin. */
function sidebarPin(): PinState {
  const workspace = useWorkspacesStore.getState().activeWorkspace();
  return { checked: workspace?.railsOpen?.left ?? false, enabled: workspace !== undefined };
}

/** What the rail's "Pin the rail open" button does (LeftRail.tsx). */
export async function toggleSidebarPin(): Promise<void> {
  const workspace = useWorkspacesStore.getState().activeWorkspace();
  if (!workspace) return;
  await useWorkspacesStore.getState().setRailsOpen(workspace.id, !(workspace.railsOpen?.left ?? false));
}

/**
 * Keeps one native check item equal to `read()` whenever `subscribe` reports
 * a change, from any source, and runs `toggle` when the item is chosen. The
 * state is re-sent after every toggle, success or not: macOS flips the
 * checkmark itself on the click, so a write that fails must put it back.
 */
function bindPin(
  pin: { id: string; event: string },
  read: () => PinState,
  subscribe: (listener: () => void) => () => void,
  toggle: () => unknown,
): () => void {
  let sent = "";
  const push = (force = false) => {
    const state = read();
    const key = JSON.stringify(state);
    if (key === sent && !force) return;
    sent = key;
    void invoke("set_window_pin", { id: pin.id, ...state }).catch((err) =>
      logError(`failed to update the Window menu: ${err}`),
    );
  };
  push();
  const unsubscribe = subscribe(() => push());
  const listening = listen(pin.event, () => {
    void Promise.resolve()
      .then(toggle)
      .catch((err) => logError(`failed to toggle ${pin.id}: ${err}`))
      .finally(() => push(true));
  }).catch((err) => {
    void logError(`failed to subscribe to ${pin.event}: ${err}`);
    return null;
  });
  return () => {
    unsubscribe();
    void listening.then((unlisten) => unlisten?.());
  };
}

/**
 * Binds the Window menu's pins to the stores. `enabled` is false in a viewer
 * window, which has no rail and no Rita pane; the browser build has no
 * native menu, so the hook is inert there too.
 */
export function useWindowMenuPins(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    return bindPin(SIDEBAR_PIN, sidebarPin, useWorkspacesStore.subscribe, toggleSidebarPin);
  }, [enabled]);
}
