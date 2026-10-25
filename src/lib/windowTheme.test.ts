// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `theme` on a window in tauri.conf.json is applied as that window's
 * NSAppearance, and a pinned appearance is what WKWebView reports for
 * `prefers-color-scheme` — permanently, with no `change` event when macOS
 * flips. Pinning the main window to Dark therefore made the Theme: System
 * setting inert: useResolvedTheme subscribed to a query that could never
 * change. The window must inherit the OS appearance and be steered at
 * runtime instead (App.tsx calls setTheme), so nothing may re-add the key.
 *
 * No other gate reads this file's window list, so this pins it.
 */
describe("main window appearance", () => {
  it("is not pinned in tauri.conf.json, so the window follows the OS", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
      app?: { windows?: Array<Record<string, unknown>> };
    };
    const main = conf.app?.windows?.find((w) => w.label === "main");
    expect(main).toBeDefined();
    expect(main).not.toHaveProperty("theme");
  });

  it("grants the permission App.tsx's setTheme call needs", () => {
    const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8")) as {
      permissions?: unknown[];
    };
    expect(capability.permissions).toContain("core:window:allow-set-theme");
  });
});
