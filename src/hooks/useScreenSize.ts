// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

import { readCurrentScreen, type ScreenSize, windowScreen } from "../lib/screenFit";

const read = (): ScreenSize => windowScreen() ?? { width: 0, height: 0 };

/** `moved` fires continuously during a drag; read once it settles. */
const SETTLE_MS = 150;

/**
 * The screen the window is on, in logical pixels, for the workspace zoom
 * (spec 2026-10-12 §4.1). Starts from window.screen (CSS pixels, so logical)
 * and re-reads it on `resize`.
 *
 * `resize` misses one case: a drag between two monitors with the same scale
 * factor but different sizes changes neither the viewport nor the pixel
 * ratio, and window.screen may lag. So in Tauri the hook also listens to the
 * window's moved and scale-changed events, and on mount, on resize and once
 * those settle it asks Tauri for the current monitor, falling back to
 * window.screen when that is unknown (Wayland). A read that finishes after a
 * newer one began is dropped; the same object is kept when nothing changed,
 * so a memo on it holds.
 */
export function useScreenSize(): ScreenSize {
  const [size, setSize] = useState(read);
  useEffect(() => {
    let alive = true;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = (next: ScreenSize) =>
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));

    const tauri = isTauri();
    const refresh = () => {
      if (!tauri) {
        apply(read());
        return;
      }
      const mine = ++seq;
      void readCurrentScreen().then((monitor) => {
        if (alive && mine === seq) apply(monitor ?? read());
      });
    };
    const settle = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, SETTLE_MS);
    };

    window.addEventListener("resize", refresh);
    const unlisten: Array<() => void> = [];
    if (tauri) {
      refresh();
      const win = getCurrentWindow();
      const keep = (p: Promise<() => void>) =>
        p.then(
          (off) => (alive ? unlisten.push(off) : off()),
          () => undefined,
        );
      void keep(win.onMoved(settle));
      void keep(win.onScaleChanged(settle));
    }
    return () => {
      alive = false;
      window.removeEventListener("resize", refresh);
      if (timer !== undefined) clearTimeout(timer);
      for (const off of unlisten) off();
    };
  }, []);
  return size;
}
