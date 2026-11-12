// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";

const { tauri } = vi.hoisted(() => ({ tauri: { on: true } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => tauri.on }));

import { portalPlatform, portalSettings, sameRect } from "./windowPortal";

afterEach(() => {
  vi.unstubAllEnvs();
  tauri.on = true;
});

describe("portalPlatform", () => {
  it.each([
    ["darwin", "macos"],
    ["ios", "ipad"],
    ["windows", "other"],
    ["linux", "other"],
  ])("reads TAURI_ENV_PLATFORM %s as %s", (platform, expected) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    expect(portalPlatform()).toBe(expected);
  });

  it("is other in the browser build, whatever the env says", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    tauri.on = false;
    expect(portalPlatform()).toBe("other");
  });
});

describe("portalSettings", () => {
  it("falls back to CNBC and Volume Level for missing or blank values", () => {
    expect(portalSettings({})).toEqual({ source: "CNBC", label: "Volume Level" });
    expect(portalSettings({ source: "  ", volumeLabel: "" })).toEqual({ source: "CNBC", label: "Volume Level" });
    expect(portalSettings({ source: " Bloomberg ", volumeLabel: "Volume" })).toEqual({ source: "Bloomberg", label: "Volume" });
  });
});

describe("sameRect", () => {
  it("ignores sub-pixel jitter and sees a whole-pixel move", () => {
    const a = { x: 10, y: 20, width: 300, height: 200 };
    expect(sameRect(a, { x: 10.2, y: 19.8, width: 300.4, height: 200 })).toBe(true);
    expect(sameRect(a, { ...a, x: 11 })).toBe(false);
  });
});
