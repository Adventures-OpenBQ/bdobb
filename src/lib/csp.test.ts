// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The packaged app's Content-Security-Policy, and the dev server's — which are
 * deliberately NOT the same policy, so this file pins both.
 *
 * The packaged policy locks down what the source document's own gotcha ("a
 * tighter CSP breaks charts and user backends") found to be the safe pairing:
 * `script-src 'self' 'wasm-unsafe-eval'` and `object-src 'none'` are tight, while `connect-src`,
 * `style-src` and `img-src` stay loose on purpose --
 *
 *   - connect-src: backends are arbitrary hosts the user types into the
 *     Connections dialog, so they cannot be pinned to an allowlist.
 *   - style-src 'unsafe-inline': Plotly styles chart elements through the
 *     CSSOM at render time; without it charts render blank.
 *   - img-src https: http:: AppsDialog resolves each app's img_dark/img_light
 *     against its own backend's base URL -- the same argument as connect-src.
 *
 * `frame-src https: http:` keeps iframe widgets working; `frame-ancestors
 * 'none'` keeps the app document itself unframeable, which is what stops a
 * widget frame holding `allow-same-origin` from navigating onto the app's own
 * origin and reading the parent.
 *
 * `worker-src 'self' blob:` is the twelfth directive, and the one the source
 * document does not have. Workers have no fallback of their own here: with no
 * `worker-src` and no `child-src` they land on `default-src 'self'`. In a
 * PACKAGED app the document origin is `tauri://localhost`, whose URL origin is
 * the literal string "null" (`new URL("tauri://localhost/index.html").origin`),
 * and pdf.js's `PDFWorker._isSameOrigin` returns false on such an opaque origin
 * BEFORE it compares anything. So it wraps its own bundled, same-directory
 * worker through `_createCDNWrapper` into a `blob:` URL and constructs
 * `new Worker("blob:...")` -- which `'self'` refuses. pdf.js catches that and
 * falls back to `#setupFakeWorker()`, whose `#isWorkerDisabled` flag is
 * STATIC, so every pdf for the rest of the process would then parse on the
 * main thread. `blob:` is what admits the wrapper; the wrapper only ever
 * imports the same-origin worker `'self'` already allows.
 *
 * These assertions pin the approved source policies. The portable Pivot built
 * browser/native gates also exercise Wasm under this policy. Vite's header is observable end to end
 * (e2e/iframe.spec.ts asserts the header the dev server really sends).
 */

/** The exact object src-tauri/tauri.conf.json must carry (design D4/D5). */
const packagedCsp = {
  "default-src": "'self'",
  "script-src": "'self' 'wasm-unsafe-eval'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: blob: https: http:",
  "font-src": "'self' data:",
  "connect-src": "'self' ipc: http://ipc.localhost https: http: wss: ws:",
  "frame-src": "https: http:",
  "frame-ancestors": "'none'",
  "object-src": "'none'",
  "worker-src": "'self' blob:",
  "base-uri": "'self'",
  "form-action": "'none'",
};

describe("the packaged app's CSP", () => {
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
    app?: { security?: { csp?: unknown } };
  };

  it("is the full policy, directive for directive", () => {
    expect(conf.app?.security?.csp).toEqual(packagedCsp);
  });

  // Named individually so a failure says WHICH half of the pairing moved.
  it("locks down script-src and object-src", () => {
    const csp = conf.app?.security?.csp as Record<string, string>;
    expect(csp["script-src"]).toBe("'self' 'wasm-unsafe-eval'");
    expect(csp["script-src"].split(/\s+/)).not.toContain("'unsafe-eval'");
    expect(csp["object-src"]).toBe("'none'");
  });

  it("leaves connect-src and style-src loose, for backends and for Plotly", () => {
    const csp = conf.app?.security?.csp as Record<string, string>;
    expect(csp["connect-src"]).toContain("https:");
    expect(csp["connect-src"]).toContain("http:");
    expect(csp["style-src"]).toContain("'unsafe-inline'");
  });

  it("keeps Tauri's nonce off style-src, so its 'unsafe-inline' actually holds", () => {
    // Tauri stamps a nonce on every <style> in index.html and adds it to
    // style-src unless told not to -- and a policy that carries a nonce
    // IGNORES 'unsafe-inline'. Every stylesheet a library injects at runtime
    // (Plotly's, BlockNote's) would then be refused in the packaged app,
    // though the declared policy allows them. Scripts keep their nonces and
    // hashes.
    const security = conf.app?.security as Record<string, unknown> | undefined;
    expect(security?.dangerousDisableAssetCspModification).toEqual(["style-src"]);
  });

  // A scheme source of https: does NOT match a wss: URL (CSP3 §6.7.2.8 only
  // widens http→https and ws→wss, never http→ws), so without these two the
  // Live Grid widget's socket is blocked with no visible error.
  it("admits websockets on connect-src, for the Live Grid widget's wire", () => {
    const csp = conf.app?.security?.csp as Record<string, string>;
    expect(csp["connect-src"]).toContain("wss:");
    expect(csp["connect-src"]).toContain("ws:");
  });

  // pdf.js wraps its own worker into a blob: URL whenever the document origin
  // is opaque, which `tauri://localhost` is. Without blob: here the wrapper is
  // refused and pdf.js silently disables its worker process-wide.
  it("admits the pdf.js blob: worker wrapper", () => {
    const csp = conf.app?.security?.csp as Record<string, string>;
    expect(csp["worker-src"]).toBe("'self' blob:");
  });

  it("keeps the app document unframeable", () => {
    const csp = conf.app?.security?.csp as Record<string, string>;
    expect(csp["frame-ancestors"]).toBe("'none'");
  });
});

/**
 * The dev server keeps the NARROW header -- `frame-ancestors 'none'` and
 * nothing else -- and that difference is deliberate, not drift:
 *
 * Vite's HMR client and React Fast Refresh's preamble are injected as inline
 * script, and the dev transform pipeline evaluates code, so `script-src 'self'`
 * would break `vite` and `pnpm e2e` outright. The strict policy above is
 * therefore exercised ONLY in a packaged build (design D6), which is why a
 * `tauri build` is part of this version's verification rather than optional.
 *
 * These two assertions exist so neither side can quietly drift toward the
 * other: nobody may "make them consistent" by widening tauri.conf.json or by
 * tightening the dev header.
 */
describe("the dev server's CSP", () => {
  const viteConfig = readFileSync("vite.config.ts", "utf8");

  /** The header's VALUE, not the file -- the comment beside it names the
   *  directives it deliberately omits, and must stay free to say so. */
  function devHeader(): string {
    const header = viteConfig.match(/"Content-Security-Policy":\s*"([^"]*)"/);
    if (!header) throw new Error("vite.config.ts sets no Content-Security-Policy header");
    return header[1];
  }

  it("is still frame-ancestors and nothing else", () => {
    expect(devHeader()).toBe("frame-ancestors 'none'");
  });

  it("does not carry the packaged policy's tight directives", () => {
    expect(devHeader()).not.toContain("script-src");
    expect(devHeader()).not.toContain("object-src");
    expect(devHeader()).not.toContain("default-src");
  });
});
