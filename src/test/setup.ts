// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Every module the app reads or writes a file through imports
 * @tauri-apps/plugin-fs, and under jsdom there is no Tauri runtime behind
 * it -- so the in-memory stand-in is the only thing any test can run
 * against. Registering it here rather than in each test file is what keeps
 * a NEW test file from silently reaching for a plugin that cannot answer.
 * A file that wants a different fs still declares its own vi.mock: a mock
 * in the test file wins over this one.
 *
 * memfs's state lives in the mocked module, and vitest gives each test file
 * its own module registry, so nothing leaks between files. __reset() is
 * still each file's own job WITHIN a file.
 */
vi.mock("@tauri-apps/plugin-fs", () => import("./memfs"));
// There is no Tauri event bus under jsdom either. The browser shim is a
// real implementation on BroadcastChannel, so tests that care about the
// dashboard-changed event get working emit/listen rather than a no-op.
vi.mock("@tauri-apps/api/event", () => import("../browser-shim/event"));

// Pins the locale for any Intl.NumberFormat constructed with no explicit
// locale (undefined) to "en-US", so number formatting is deterministic
// regardless of the host machine/CI's LC_ALL (e.g. `LC_ALL=de_DE.UTF-8 pnpm
// vitest run` must still produce "2.3M", not "2,3M"). A caller that DOES
// pass an explicit locale (e.g. "de-DE" in the locale-specific tests) is
// untouched -- only the undefined case is redirected.
const RealNumberFormat = Intl.NumberFormat;
Intl.NumberFormat = new Proxy(RealNumberFormat, {
  construct(target, args) {
    const [locales, options] = args as [string | string[] | undefined, Intl.NumberFormatOptions | undefined];
    return new target(locales ?? "en-US", options);
  },
  // Intl.NumberFormat is also callable without `new` (it returns a new
  // instance either way per spec) -- without this trap a plain-call
  // `Intl.NumberFormat(undefined, ...)` bypasses the construct trap above
  // and falls through to the host locale, unpinned.
  apply(target, _thisArg, args) {
    const [locales, options] = args as [string | string[] | undefined, Intl.NumberFormatOptions | undefined];
    return Reflect.apply(target, undefined, [locales ?? "en-US", options]);
  },
}) as typeof Intl.NumberFormat;

/**
 * jsdom 25's Blob implements slice/size/type and nothing else: there is no
 * arrayBuffer() and no text(), both of which every browser WKWebView ships
 * on has had for years, and both of which a dropped File is read through
 * (src/lib/localFiles.ts, src/components/DropZone.tsx). FileReader IS
 * implemented, so the two are defined in terms of it here rather than the
 * app being written around a gap in the test environment.
 */
if (typeof Blob.prototype.arrayBuffer !== "function") {
  const read = (blob: Blob): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return read(this);
  };
  Blob.prototype.text = async function text(this: Blob) {
    return new TextDecoder().decode(await read(this));
  };
}

/**
 * jsdom shadows AbortController/AbortSignal but NOT fetch: `globalThis.fetch`
 * is Node's (undici), while every AbortSignal made under this environment
 * belongs to the jsdom realm. undici brand-checks the signal it is handed
 * against its OWN class and rejects the request outright — "RequestInit:
 * Expected signal to be an instance of AbortSignal" — so the app could not
 * put a deadline on a request in any test that talks to a real mock server
 * (src/lib/dataClient.ts's apps.json fetch does).
 *
 * The two realms are the same one in every runtime the app actually ships to
 * (WKWebView through the browser shim, reqwest through tauri-plugin-http), so
 * this is a gap in the test environment and not in the app. It is closed the
 * only way it can be: the request goes out WITHOUT the signal, and the
 * returned promise rejects the moment that signal aborts, carrying the
 * signal's own reason — which is exactly what the caller sees for real.
 *
 * The underlying request is genuinely not cancelled, since nothing here can
 * reach into undici to cancel it; startMockServer's close() destroys open
 * connections rather than waiting one out.
 */
const nativeFetch = globalThis.fetch;
globalThis.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit) {
  const signal = init?.signal;
  if (!signal) return nativeFetch(input, init);
  const { signal: _foreign, ...rest } = init as RequestInit;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  return Promise.race([nativeFetch(input, rest), aborted]);
} as typeof globalThis.fetch;

/**
 * jsdom 25 implements <dialog> as an ordinary element: the `open` property
 * exists, `showModal()`/`close()` do not. The app's dialogs are real modal
 * dialogs (Settings, Connections and its backend form, Help), so without
 * this every test that renders one throws on mount. Modelled on the spec's own steps,
 * minus the ones jsdom has no machinery for (the top layer, inertness, focus
 * trapping, and the Escape close request — which the app prevents anyway, so
 * that one is not behaviour a test could rely on).
 */
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.open) return;
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
  // A closed dialog is display: none in a browser, so nothing in it can take
  // focus: a focus() made before showModal() -- React's autoFocus runs at
  // commit, ahead of the effect that opens the dialog -- silently fails there.
  // jsdom has no layout, so the same call succeeded here and a test could
  // pass on focus a real browser never gives (Help's search field did).
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    const dialog = this.closest("dialog");
    if (dialog !== null && !dialog.open) return;
    focus.call(this, options);
  };
}

afterEach(() => {
  cleanup();
});
