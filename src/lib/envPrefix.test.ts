// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node, not jsdom, for the same reason as devHost.test.ts: vite.config.ts
// pulls in node:fs / node:path.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv, type UserConfig } from "vite";
import configFn from "../../vite.config";

/**
 * Every iOS-only path (saveTextFile, chatExportFile, the rail's Save…, the
 * monitor guard in screenFit) is decided by import.meta.env.TAURI_ENV_PLATFORM
 * at build time. Vite matches envPrefix with a plain startsWith, so a glob
 * like "TAURI_ENV_*" matched nothing: real iPad builds baked in no platform,
 * every `=== "ios"` branch folded to false, and the iPad app called
 * current_monitor and aborted. Unit tests stub the variable, so only the
 * prefix itself, run through Vite's own loadEnv, can pin this.
 */
describe("envPrefix", () => {
  const saved = process.env.TAURI_ENV_PLATFORM;
  afterEach(() => {
    if (saved === undefined) delete process.env.TAURI_ENV_PLATFORM;
    else process.env.TAURI_ENV_PLATFORM = saved;
  });

  it("exposes the TAURI_ENV_PLATFORM the Tauri CLI sets for an iOS build", () => {
    const config = (configFn as (env: { mode: string; command: "build" }) => UserConfig)({ mode: "production", command: "build" });
    process.env.TAURI_ENV_PLATFORM = "ios";
    const env = loadEnv("production", mkdtempSync(join(tmpdir(), "bdobb-env-")), config.envPrefix as string[]);
    expect(env.TAURI_ENV_PLATFORM).toBe("ios");
  });
});
