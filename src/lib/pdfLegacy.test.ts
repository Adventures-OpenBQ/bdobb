// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// pdfjs-dist 6's legacy build targets Safari 18 and its modern build calls
// Promise.withResolvers (17.4) and URL.parse (18) unguarded: on older WebKit a
// PDF card throws, or loads and paints no glyphs. 5.x's legacy build targets
// Safari 16.4; these hold PdfView to it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const pdfView = readFileSync(new URL("../components/renderers/PdfView.tsx", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("pdf.js on older WebKit", () => {
  it("loads pdf.js only through its legacy build", () => {
    const specifiers = [...pdfView.matchAll(/["'](pdfjs-dist[^"']*)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !s.startsWith("pdfjs-dist/legacy/"))).toEqual([]);
  });

  it("installs AbortSignal.any before pdf.js loads", () => {
    const install = pdfView.indexOf("installAbortSignalAny()");
    const load = pdfView.indexOf('await import("pdfjs-dist/legacy/build/pdf.mjs")');
    expect(install).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(install);
  });

  it("keeps pdfjs-dist pinned on major 5", () => {
    expect(pkg.dependencies["pdfjs-dist"]).toMatch(/^5\.\d+\.\d+$/);
  });
});
