// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom: importing vite.config.ts pulls in node:fs / node:path, and
// under jsdom import.meta.url is an http:// URL those refuse.
import { afterEach, describe, expect, it } from "vitest";
import type { UserConfig } from "vite";
import configFn from "../../vite.config";

/**
 * `tauri ios dev` rewrites the dev URL to the Mac's LAN address so a device
 * can reach this server, and sets TAURI_DEV_HOST to say what to bind to.
 * That is the ONLY case allowed to put this server on the network: an
 * unconditional `0.0.0.0` would expose it for every desktop `pnpm dev`,
 * `pnpm e2e` and CI run too. This test pins the guard in vite.config.ts's
 * `server.host`, not just the symptom from the ios:dev bug report.
 */
describe("dev server host binding", () => {
  const ORIGINAL = process.env.TAURI_DEV_HOST;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TAURI_DEV_HOST;
    else process.env.TAURI_DEV_HOST = ORIGINAL;
  });

  async function resolvedHost() {
    const cfg = await (configFn as (env: { mode: string; command: "serve" | "build" }) => UserConfig)({
      mode: "development",
      command: "serve",
    });
    return cfg.server?.host;
  }

  it("does not bind a public address when TAURI_DEV_HOST is unset", async () => {
    delete process.env.TAURI_DEV_HOST;
    const host = await resolvedHost();
    // Vite's own default: false means localhost-only, no LAN exposure.
    expect(host).toBe(false);
  });

  it("honours TAURI_DEV_HOST when Tauri sets it for device development", async () => {
    process.env.TAURI_DEV_HOST = "203.0.113.1";
    const host = await resolvedHost();
    expect(host).toBe("203.0.113.1");
  });

  it("treats empty TAURI_DEV_HOST as unset (localhost-only)", async () => {
    // Regression guard: the host line in vite.config.ts uses ||, which treats ""
    // as falsy and returns false (localhost-only). If || were ever changed to ??
    // (a plausible stylistic edit), "" would pass through as-is, exposing the dev
    // server on the LAN unintentionally. This test catches that regression.
    process.env.TAURI_DEV_HOST = "";
    const host = await resolvedHost();
    expect(host).toBe(false);
  });
});
