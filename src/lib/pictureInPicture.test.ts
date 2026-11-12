// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";

const { tauri } = vi.hoisted(() => ({ tauri: { on: true } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => tauri.on }));

import { muteWhileHidden, pipPlatform, pipResizeHandles, pipSettings, sameRect } from "./pictureInPicture";

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

describe("pipResizeHandles", () => {
  it("adds the bottom edge to the grid's handles for this card only", () => {
    expect(pipResizeHandles("picture_in_picture", false)).toEqual({ resizeHandles: ["se", "s"] });
    expect(pipResizeHandles("picture_in_picture", true)).toEqual({ resizeHandles: ["nw", "ne", "sw", "se", "s"] });
    expect(pipResizeHandles("clock", true)).toEqual({});
  });
});

describe("sameRect", () => {
  it("ignores sub-pixel jitter and sees a whole-pixel move", () => {
    const a = { x: 10, y: 20, width: 300, height: 200 };
    expect(sameRect(a, { x: 10.2, y: 19.8, width: 300.4, height: 200 })).toBe(true);
    expect(sameRect(a, { ...a, x: 11 })).toBe(false);
  });
});
