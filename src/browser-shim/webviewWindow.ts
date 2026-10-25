// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { bdobb } from "./registry";

/**
 * Stands in for @tauri-apps/api/webviewWindow under `vite --mode browser`. A
 * browser has no second native window; `window.open` with the label as the
 * target name is the closest equivalent, and it lands on the same
 * `/?viewer=<id>` route the real window would — which is exactly what the
 * e2e viewer spec drives.
 *
 * getByLabel always answers null: a page cannot enumerate popups it opened
 * before a reload, so "focus the existing one" degrades to opening it again —
 * and window.open's named target already collapses that onto one tab.
 */
export class WebviewWindow {
  label: string;

  constructor(label: string, options?: { url?: string }) {
    this.label = label;
    const url = options?.url ?? "/";
    bdobb().opened.push(url);
    window.open(url, label);
  }

  static getByLabel(_label: string): Promise<WebviewWindow | null> {
    return Promise.resolve(null);
  }

  setFocus(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * A browser window raises no tauri://error, so nothing ever fires; this
   * exists because LeftRail subscribes on every open, and without it that
   * call threw after the tab had already opened.
   */
  once<T>(_event: string, _handler: (event: { payload: T }) => void): Promise<() => void> {
    return Promise.resolve(() => {});
  }
}
