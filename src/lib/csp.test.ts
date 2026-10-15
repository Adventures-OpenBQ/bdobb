// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The app document must never be framable: a cross-origin widget frame given
 * `allow-same-origin` could otherwise navigate itself onto the app's own http
 * origin (dev, browser mode, Tauri on Windows) and reach the parent. The Vite
 * server's copy is asserted end to end, against the header it really sends,
 * by e2e/iframe.spec.ts. The packaged app gets its copy from tauri.conf.json,
 * which no other gate reads — so this pins that one.
 */
describe("packaged-app CSP", () => {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
    app?: { security?: { csp?: unknown; dangerousDisableAssetCspModification?: unknown } };
  };

  /**
   * Scripts only from the app itself (WebAssembly compile allowed for pdf.js,
   * no JS eval), no plugins, no <base> rewrite, and connections only to the
   * app, its IPC and WebSockets (the live grid's; backend HTTP goes through the
   * HTTP plugin over IPC, not the webview). Frames, images and styles stay
   * open for the website, image and chart cards.
   */
  it("is set for the packaged app", () => {
    expect(conf.app?.security?.csp).toBe(
      "frame-ancestors 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
        "connect-src 'self' ipc: http://ipc.localhost ws: wss:; object-src 'none'; base-uri 'none'",
    );
  });

  // Tauri stamps a nonce into style-src, and a nonce cancels 'unsafe-inline':
  // every style a library injects (Plotly, lightweight-charts) would be refused.
  it("keeps Tauri from adding a style nonce", () => {
    expect(conf.app?.security?.dangerousDisableAssetCspModification).toEqual(["style-src"]);
  });
});
