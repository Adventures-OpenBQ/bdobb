// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import { useDashboardStore } from "../stores/dashboardStore";

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
 * `onOpenLibrary` and `onOpenHelp` are the App's own callbacks, which close
 * over its useState setters and are new functions on every render. They are
 * held in refs so the window listener can stay registered exactly once ([]
 * deps) while still calling the current closures -- the same idiom
 * SettingsDialog's activeRef uses.
 */
export function useDashboardShortcuts(onOpenLibrary: () => void, onOpenHelp: () => void): void {
  const openLibraryRef = useRef(onOpenLibrary);
  const openHelpRef = useRef(onOpenHelp);
  useEffect(() => {
    openLibraryRef.current = onOpenLibrary;
    openHelpRef.current = onOpenHelp;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      // An open modal covers the dashboard, so nothing here may act behind
      // it: ⌥N would switch the dashboard out of sight, and ⌘K would open
      // the library invisibly underneath, where its capture listener eats
      // the next Escape meant for the dialog. `dialog[open]`, as DropZone's
      // coveredByOverlay tests it. ⌘R refreshes nothing behind it either, but
      // keeps its preventDefault: that is what stops `vite --mode browser`
      // reloading away the dialog's unsaved draft. Same combination as the
      // ⌘R branch below, so ⌘⇧R still reaches the browser.
      if (document.querySelector("dialog[open]")) {
        if (
          event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.code === "KeyR"
        ) {
          event.preventDefault();
        }
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
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (event.code === "KeyK") {
          event.preventDefault();
          openLibraryRef.current();
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

      // event.code, not event.key: on macOS Option+1 produces "¡".
      // Single-digit capture is also what limits shortcuts to the first nine.
      const match = /^Digit([0-9])$/.exec(event.code);
      if (!match) return;

      const digit = Number(match[1]);
      const { dashboards, setActive, goToPrevious } = useDashboardStore.getState();

      if (digit === 0) {
        event.preventDefault();
        goToPrevious();
        return;
      }

      const target = dashboards[digit - 1];
      if (!target) return;

      event.preventDefault();
      setActive(target.id);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
