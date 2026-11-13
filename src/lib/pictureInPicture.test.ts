// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";

const { tauri } = vi.hoisted(() => ({ tauri: { on: true } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => tauri.on }));

import { muteWhileHidden, PLAYER_MAX, pipPlatform, pipSettings, rowsForPlayer, sameRect } from "./pictureInPicture";

afterEach(() => {
  vi.unstubAllEnvs();
  tauri.on = true;
});

describe("pipPlatform", () => {
  it.each([
    ["darwin", "macos"],
    ["ios", "ipad"],
    ["windows", "other"],
    ["linux", "other"],
  ])("reads TAURI_ENV_PLATFORM %s as %s", (platform, expected) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    expect(pipPlatform()).toBe(expected);
  });

  it("is other in the browser build, whatever the env says", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    tauri.on = false;
    expect(pipPlatform()).toBe("other");
  });
});

describe("pipSettings", () => {
  it("leaves a missing or blank source empty and falls back to Volume Level", () => {
    expect(pipSettings({})).toEqual({ source: "", label: "Volume Level" });
    expect(pipSettings({ source: "  ", volumeLabel: "" })).toEqual({ source: "", label: "Volume Level" });
    expect(pipSettings({ source: " Live TV ", volumeLabel: "Volume" })).toEqual({ source: "Live TV", label: "Volume" });
  });
});

describe("muteWhileHidden", () => {
  it("is off unless the card says on", () => {
    expect(muteWhileHidden({})).toBe(false);
    expect(muteWhileHidden({ muteWhileHidden: "off" })).toBe(false);
    expect(muteWhileHidden({ muteWhileHidden: "" })).toBe(false);
    expect(muteWhileHidden({ muteWhileHidden: "on" })).toBe(true);
  });
});

describe("sameRect", () => {
  it("ignores sub-pixel jitter and sees a whole-pixel move", () => {
    const a = { x: 10, y: 20, width: 300, height: 200 };
    expect(sameRect(a, { x: 10.2, y: 19.8, width: 300.4, height: 200 })).toBe(true);
    expect(sameRect(a, { ...a, x: 11 })).toBe(false);
  });
});

describe("rowsForPlayer", () => {
  // A 20 px row and a 10 px gap: h rows are 30h - 10 px tall. The card adds 50 px of header and padding around the body.
  const base = { overhead: 50, rowHeight: 20, gap: 10 };
  // 640 wide -> a 360 high player; 50 + 360 = 410 px of card -> 30h - 10 >= 410 -> 14 rows.
  it("is the fewest rows that hold the player, exact fit included", () => {
    expect(rowsForPlayer({ ...base, bodyWidth: 640 })).toBe(14);
  });
  it("needs one more row when the player is one pixel over", () => {
    // 30h - 10 >= overhead + 360 exactly at 410 (h = 14); a 1 px larger overhead tips it over.
    expect(rowsForPlayer({ ...base, bodyWidth: 640, overhead: 51 })).toBe(15);
  });
  it("limits the player to its largest size", () => {
    expect(rowsForPlayer({ ...base, bodyWidth: 5000 })).toBe(rowsForPlayer({ ...base, bodyWidth: PLAYER_MAX.width }));
    expect(rowsForPlayer({ ...base, bodyWidth: 5000 })).toBe(Math.ceil((50 + 781 + 10) / 30));
  });
  it("holds the smallest player when the body is narrower", () => {
    expect(rowsForPlayer({ ...base, bodyWidth: 100 })).toBe(Math.ceil((50 + 160 + 10) / 30));
  });
  it("knows nothing without measurements", () => {
    expect(rowsForPlayer({ ...base, bodyWidth: 0 })).toBeNull();
    expect(rowsForPlayer({ ...base, bodyWidth: 640, overhead: -1 })).toBeNull();
    expect(rowsForPlayer({ ...base, bodyWidth: Number.NaN })).toBeNull();
    expect(rowsForPlayer({ ...base, bodyWidth: 640, rowHeight: 0 })).toBeNull();
  });
});
