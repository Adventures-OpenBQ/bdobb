// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `AbortSignal.any` needs WebKit 17.4, and macOS's WebKit before 17.4 (Macs
 * before macOS 14.4) lacks it -- this line ships no iOS target, so the Mac is
 * where it bites. pdf.js calls it unguarded -- PDFViewer's
 * #onePageRenderedOrForceFetch, on every document load, in 5.x and 6.x alike
 * -- and its legacy build, which polyfills Promise.withResolvers and URL.parse
 * through core-js, does not cover it: core-js has no AbortSignal.any. Without
 * this, a PDF card on such a Mac stays blank with "AbortSignal.any is not a
 * function". PdfView installs it before pdf.js loads. A native implementation
 * is left alone; drop this when the oldest supported WebKit reaches 17.4.
 */
export function installAbortSignalAny(): void {
  if (typeof AbortSignal.any === "function") return;
  AbortSignal.any = (signals: Iterable<AbortSignal>): AbortSignal => {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort(signal.reason);
        break;
      }
      // Removed with the combined signal's own abort, so a long-lived input
      // does not keep a listener per combination alive.
      signal.addEventListener("abort", () => controller.abort(signal.reason), {
        once: true,
        signal: controller.signal,
      });
    }
    return controller.signal;
  };
}
