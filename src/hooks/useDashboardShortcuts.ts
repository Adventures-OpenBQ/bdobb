// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { openDashboardAlone } from "../lib/workspaceFocus";

/** A field the press belongs to: no app-level shortcut may claim it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Option+1..9 select dashboards by position; Option+0 returns to the
 * previously active one. Command+K opens the widget library and Command+R
 * refreshes every mounted card. In the viewer window the two Option
 * dashboard-switching shortcuts are inert; Command+R still refreshes.
 *
 * Command+Shift+/ (⌘?) opens the Help dialog. It only OPENS: a toggle would
 * need this hook to know whether the dialog is open, which means threading
 * state into a hook that currently reads none.
 *
 * Option+N opens the New workspace dialog. Inert in a viewer window and while
 * typing, exactly like the switching shortcuts.
 *
 * `onOpenLibrary`, `onOpenHelp` and `onNewWorkspace` are the App's own
 * callbacks, which close over its useState setters and are new functions on
 * every render. They are held in refs so the window listener can stay
 * registered exactly once ([] deps) while still calling the current closures
 * -- the same idiom useModalDialog's closeRef uses.
 *
 * While a workspace is being arranged, ⌘K, ⌥N and the switching shortcuts
 * are inert until Done or Cancel (spec 2026-10-01 §3); ⌘R and ⌘? are not.
 */
export function useDashboardShortcuts(
  onOpenLibrary: () => void,
  onOpenHelp: () => void,
  onNewWorkspace: () => void = () => undefined,
): void {
  const openLibraryRef = useRef(onOpenLibrary);
  const openHelpRef = useRef(onOpenHelp);
  const newWorkspaceRef = useRef(onNewWorkspace);
  useEffect(() => {
    openLibraryRef.current = onOpenLibrary;
    openHelpRef.current = onOpenHelp;
    newWorkspaceRef.current = onNewWorkspace;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      // Command with no other modifier: ⌘K and ⌘R.
      const cmdOnly = event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

      // An open modal covers the dashboard, so nothing here may act behind
      // it: ⌥N would switch the dashboard out of sight, and ⌘K would open
      // the library invisibly underneath, where its capture listener eats
      // the next Escape meant for the dialog. `dialog[open]`, as DropZone's
      // coveredByOverlay tests it. ⌘R refreshes nothing behind it either, but
      // keeps its preventDefault: that is what stops `vite --mode browser`
      // reloading away the dialog's unsaved draft. Same combination as the
      // ⌘R branch below, so ⌘⇧R still reaches the browser.
      if (document.querySelector("dialog[open]")) {
        if (cmdOnly && event.code === "KeyR") event.preventDefault();
        return;
      }

      // ⌘⇧A / Ctrl+Shift+A pins the Rita pane. Repeat is ignored so a held
      // key does not flap the pin. In the desktop app the shortcut belongs to
      // Window ▸ Keep Rita Open, whose native accelerator toggles through the
      // menu event (useWindowMenuPins). wry's WKWebView hands ⌘-keys to JS
      // first and forwards only UNHANDLED ones to the main menu, so the event
      // is left alone there: preventDefault would stop the accelerator firing.
      // The browser build has no native menu, so the toggle stays here for it.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.code === "KeyA") {
        if (event.repeat) return;
        if (isTauri()) return;
        event.preventDefault();
        useChatStore.getState().togglePinned();
        return;
      }

      // ⌘? is ⌘⇧/ -- Shift is what makes the character, so this must be
      // tested ahead of the branch below, which refuses shiftKey outright
      // (⌘⇧R and ⌘⇧K belong to Chromium under `vite --mode browser`). ⌘⇧/ is
      // claimed by nothing there, so preventDefault takes nothing away.
      //
      // Deliberately outside the viewer gate, like ⌘R: Help is static bundled
      // content with no store writes, so it behaves identically in a viewer
      // window.
      if (
        event.metaKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.code === "Slash"
      ) {
        event.preventDefault();
        openHelpRef.current();
        return;
      }

      // Command first: the Option branch below refuses metaKey outright, so
      // these two could never be reached from inside it.
      //
      // shiftKey is excluded rather than ignored: ⌘⇧R is Chromium's hard
      // reload and ⌘⇧K its console, and `vite --mode browser` runs this same
      // handler there. Claiming the combination would preventDefault a
      // gesture the user meant for the browser.
      if (cmdOnly) {
        if (event.code === "KeyK") {
          event.preventDefault();
          // Inert while arranging: every tile is covered, so a widget would
          // land in a dashboard nobody can see.
          if (useWorkspacesStore.getState().arrangingId === null) openLibraryRef.current();
          return;
        }
        if (event.code === "KeyR") {
          // preventDefault is not for the Tauri build — wry binds no reload
          // accelerator and Tauri's default menu has no Reload item — it is
          // for `vite --mode browser`, where Command+R reloads Chromium and
          // discards the entire in-memory session.
          event.preventDefault();
          useDashboardStore.getState().refreshAll();
        }
        return;
      }

      if (!event.altKey || event.ctrlKey || event.metaKey) return;

      // The viewer window is pinned to the dashboard its URL named, so the
      // switching shortcuts are inert there — without this, ⌥2 would leave a
      // second window showing something other than what it was opened for.
      // Read off the store rather than taken as an argument: App sets the flag
      // in its bootstrap effect body, before this listener can fire. ⌘R above
      // is deliberately outside the gate.
      if (useDashboardStore.getState().viewer) return;

      // Arrange mode is modal for navigation: ⌥N and ⌥0–⌥9 wait for Done or
      // Cancel. Below the viewer gate, which already stops them there.
      if (useWorkspacesStore.getState().arrangingId !== null) return;

      // ⌥N: the New workspace dialog. event.code again, and here it is not
      // optional: Option+N is a dead key on macOS (it starts a ˜ composition),
      // so event.key is "Dead". Below the viewer gate on purpose -- a viewer
      // window shows one dashboard and has no rail for a workspace to land in.
      if (event.code === "KeyN") {
        event.preventDefault();
        newWorkspaceRef.current();
        return;
      }

      // event.code, not event.key: on macOS Option+1 produces "¡".
      // Single-digit capture is also what limits shortcuts to the first nine.
      const match = /^Digit([0-9])$/.exec(event.code);
      if (!match) return;

      const digit = Number(match[1]);
      // getState(), not a subscription: this listener is registered once with
      // [] deps, exactly as the dashboard store is read here.
      const target = useSettingsStore.getState().settings.numberShortcutTarget;

      if (target === "workspaces") {
        const { workspaces, setActiveWorkspace, goToPreviousWorkspace } =
          useWorkspacesStore.getState();
        if (digit === 0) {
          event.preventDefault();
          goToPreviousWorkspace();
          return;
        }
        const workspace = workspaces[digit - 1];
        if (!workspace) return;
        event.preventDefault();
        setActiveWorkspace(workspace.id);
        return;
      }

      const { dashboards, previousId } = useDashboardStore.getState();

      if (digit === 0) {
        event.preventDefault();
        // Swap back to the previous dashboard, opened ALONE as a rail click
        // opens one (issue #320): in a workspace that leaves the workspace,
        // untouched on disk; outside one it is just setActive. No previous,
        // or a previous that has since been deleted, is a no-op -- so a stale
        // previous never throws the user out of a workspace for nothing.
        if (previousId && dashboards.some((d) => d.id === previousId)) openDashboardAlone(previousId);
        return;
      }

      const dashboard = dashboards[digit - 1];
      if (!dashboard) return;

      event.preventDefault();
      // Spec §1: in a workspace, ⌥N behaves as a rail click on the Nth
      // dashboard -- fill the FOCUSED TILE, never move focus to a different
      // one -- rather than the plain setActive() below, which the plan
      // (silently, and the branch that implemented it) dropped this row for.
      // Without this, ⌥N can focus a dashboard that sits in no tile at all,
      // and ⌘K then adds a widget nobody can see.
      //
      // It still behaves as a rail click, but since issue #320 a rail click
      // leaves the workspace and opens the dashboard alone -- so the
      // dashboard is on screen by itself and ⌘K's destination is visible.
      // Outside a workspace openDashboardAlone is the plain setActive().
      openDashboardAlone(dashboard.id);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
