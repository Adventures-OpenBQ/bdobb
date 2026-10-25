// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="vitest" />
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";
import { ensurePivotWasm } from "./scripts/build-pivot-wasm.mjs";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Where PdfView asks pdf.js to fetch them from; see standardFontDataUrl there. */
const STANDARD_FONTS_PATH = "/standard_fonts/";

/**
 * Ships pdfjs-dist/standard_fonts/ with the app, at a STABLE path.
 *
 * pdf.js needs these 14 Foxit/Liberation faces to draw a document that leans
 * on a base-14 font (Helvetica, Times, Courier, Symbol, ZapfDingbats) -- the
 * overwhelming majority of report PDFs. Without them it logs "Ensure that the
 * `standardFontDataUrl` API parameter is provided" and substitutes whatever
 * the system has, at the wrong metrics.
 *
 * They cannot ride along the way the worker file does. `new URL("pdfjs-dist/
 * standard_fonts/", import.meta.url)` names a DIRECTORY, and Vite only rewrites
 * that idiom for a FILE it can emit: measured, it warns "doesn't exist at build
 * time, it will remain unchanged to be resolved at runtime", emits nothing, and
 * leaves the app fetching a 404 -- strictly worse than the warning. Per-file
 * `?url` imports do not help either: Vite hashes each name into assets/, and
 * pdf.js needs ONE directory it can append a bare filename to.
 *
 * So the files are emitted by hand. `fileName` (not `name`) is what keeps them
 * unhashed and together. This lives in the Vite config rather than in a copy
 * script wired into package.json because EVERY entry point goes through the
 * config by construction -- `vite`, `vite build`, `vite --mode browser`
 * (scripts/browser.mjs, which is also Playwright's webServer), `tauri dev` and
 * `tauri build` -- while only three of those run a package script.
 *
 * A new dependency (vite-plugin-static-copy and friends) is deliberately not
 * taken for ~800 KB of file copying.
 */
function portablePivotWasm(): Plugin {
  return {name: "bdobb:portable-pivot-wasm", async configResolved(config) {
    // Unit tests consume the already-built artifact; all app dev/build entry points ensure it.
    if (config.command !== "serve" || !process.env.VITEST) await ensurePivotWasm();
  }};
}

function pdfStandardFonts(): Plugin {
  const dir = join(
    dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
    "standard_fonts",
  );
  // Read once, at config time: it is also the allow-list the dev middleware
  // checks a request against, which is what makes that middleware incapable of
  // serving anything outside this directory.
  const files = new Set(readdirSync(dir));

  return {
    name: "bdobb:pdf-standard-fonts",

    // Dev and `--mode browser` serve no dist/, so the same path is served
    // straight off disk. Vite has already stripped the base from req.url here.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!path.startsWith(STANDARD_FONTS_PATH)) return next();
        let name: string;
        try {
          name = decodeURIComponent(path.slice(STANDARD_FONTS_PATH.length));
        } catch {
          return next();
        }
        if (!files.has(name)) {
          // A miss under this prefix must not fall through to the SPA html
          // fallback: pdf.js would parse index.html as font data.
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(readFileSync(join(dir, name)));
      });
    },

    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: "asset",
          fileName: `${STANDARD_FONTS_PATH.slice(1)}${name}`,
          source: readFileSync(join(dir, name)),
        });
      }
    },
  };
}

/**
 * `vite --mode browser` runs the app in a plain browser with no Tauri runtime:
 * the seven Tauri modules the app imports are swapped for src/browser-shim/.
 * Nothing else passes this mode -- `vite build`, `tauri dev`, `tauri build`
 * and `pnpm smoke` all get the real modules -- so the shims cannot reach a
 * production bundle by construction. See scripts/browser.mjs.
 */
const browserShims = {
  "@tauri-apps/plugin-dialog": here("./src/browser-shim/dialog.ts"),
  "@tauri-apps/plugin-fs": here("./src/browser-shim/fs.ts"),
  "@tauri-apps/plugin-http": here("./src/browser-shim/http.ts"),
  "@tauri-apps/plugin-opener": here("./src/browser-shim/opener.ts"),
  "@tauri-apps/api/path": here("./src/browser-shim/path.ts"),
  "@tauri-apps/api/core": here("./src/browser-shim/core.ts"),
  "@tauri-apps/api/webviewWindow": here("./src/browser-shim/webviewWindow.ts"),
};

export default defineConfig(({ mode }) => ({
  // Exposes TAURI_ENV_PLATFORM to the bundle: "ios" in an iOS build, so the
  // iOS-only paths (saveTextFile, the rail's Save…, screenFit's monitor
  // guard) are decided at build time rather than by sniffing the user agent.
  // A plain prefix: Vite matches envPrefix with startsWith, so the
  // "TAURI_ENV_*" glob in Tauri's templates matched nothing (envPrefix.test.ts).
  envPrefix: ["VITE_", "TAURI_ENV_"],
  /**
   * plotly.js pulls in has-hover, which evaluates `typeof global.matchMedia`
   * at module scope. `global` is a Node-ism: in a browser that throws a
   * ReferenceError on import, the module graph dies, and React never mounts —
   * a completely blank window.
   *
   * Nothing else caught it. Every other gate runs under Node or jsdom, where
   * `global` exists, so 640 unit tests passed against an app that could not
   * boot. `pnpm smoke` is the gate that does catch it.
   */
  define: { global: "globalThis" },

  plugins: [portablePivotWasm(), react(), pdfStandardFonts()],
  clearScreen: false,
  /**
   * A widget frame with a real `src` is granted `allow-same-origin` so it can
   * name an origin the openbb-auth rule can match. That grant survives the
   * frame navigating ITSELF, and this app's document is reachable over plain
   * http — localhost:1420 here, tauri.localhost for Tauri on Windows — so
   * without this header a framed page could point itself at the app and read
   * the app's own DOM and stores from inside a card. `frame-ancestors 'none'`
   * makes the app document unframeable, so that navigation renders nothing.
   *
   * Only that one directive, deliberately: adding default-src or script-src
   * here would change what the app itself is allowed to load. The same value
   * is set for the packaged app in src-tauri/tauri.conf.json (app.security.csp)
   * and asserted in e2e/iframe.spec.ts.
   */
  server: {
    port: 1420,
    strictPort: true,
    // `tauri ios dev` / `tauri android dev` rewrite the dev URL to the Mac's
    // LAN address so the DEVICE can reach this server, and set
    // TAURI_DEV_HOST to tell it what to bind to. Binding 0.0.0.0
    // unconditionally would put this dev server on the LAN for every desktop
    // session too -- `pnpm dev`, `pnpm e2e`, CI -- which is exposure nothing
    // asked for. Gating on the env var keeps that exposure scoped to the one
    // case that needs it; `false` is Vite's own default (localhost only), so
    // every other path is unchanged. See src/lib/devHost.test.ts.
    host: process.env.TAURI_DEV_HOST || false,
    headers: { "Content-Security-Policy": "frame-ancestors 'none'" },
  },
  resolve: {
    alias: {
      // plotly.js/src/registry.js requires this stylesheet inside a branch
      // guarded by `basePlotModule.name === 'map'`, a trace family this
      // partial bundle (src/lib/plotly.ts) never registers. Rollup still
      // hoists the CSS import out of that dead branch, so without this
      // alias the real ~65 KB maplibre-gl stylesheet ships unused. Stubbed
      // to an empty file rather than suppressed more broadly — only this
      // exact specifier is affected.
      "maplibre-gl/dist/maplibre-gl.css": here("./src/lib/vendor-stubs/maplibre-gl.css"),
      ...(mode === "browser" ? browserShims : {}),
    },
  },
  // The module table worker lazily loads the file parser as a separate chunk.
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // e2e/ holds Playwright specs (playwright.config.ts is their runner);
    // vitest's default include glob would otherwise also collect them and
    // fail on Playwright's test() outside its own runner.
    // .reference-backend/ is a CLONED repo with a python venv in it, and
    // vitest's glob walks dot-directories: a *.test.js shipped by any
    // transitive dependency in site-packages would be collected and IMPORTED
    // by a plain `pnpm test:run`. Measured -- a canary there did run.
    // web/**: Node's test runner owns the server/auth tests (pnpm test:web).
    exclude: [...configDefaults.exclude, "e2e/**", ".reference-backend/**", ".worktrees/**", ".codegraph/**", "web/**", "scripts/vendor-calendar-contract.test.mjs", "scripts/pivot-packaging.test.mjs", "scripts/matched-executors.test.mjs", "scripts/matched-executors-driver-utils.test.mjs"],
  },
}));
