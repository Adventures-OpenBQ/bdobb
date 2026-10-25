// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  isTauri: true,
  current: null as unknown,
  primary: null as unknown,
  all: [] as unknown,
}));

function answer(v: unknown) {
  return typeof v === "function" ? (v as () => unknown)() : Promise.resolve(v);
}

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: vi.fn(() => answer(tauri.current)),
  primaryMonitor: vi.fn(() => answer(tauri.primary)),
  availableMonitors: vi.fn(() => answer(tauri.all)),
}));

import {
  COMMON_SIZES,
  MIN_RES_LIMITS,
  describeMinResolution,
  fits,
  isMinResolution,
  listScreens,
  screenChoices,
  pickLaunchWorkspace,
  readCurrentScreen,
  readLaunchScreen,
  zoomFor,
} from "./screenFit";

/** A Monitor as @tauri-apps/api/window returns it, size in physical pixels. */
function monitor(width: number, height: number, scaleFactor: number, name: string | null = null) {
  return {
    name,
    scaleFactor,
    size: { width, height, toLogical: (f: number) => ({ width: width / f, height: height / f }) },
  };
}

function setScreen(width: number, height: number) {
  Object.defineProperty(window, "screen", { configurable: true, value: { width, height } });
}

const HD = { width: 1920, height: 1080 };
const UHD = { width: 3840, height: 2160 };
const UW = { width: 3440, height: 1440 };

describe("zoomFor and fits", () => {
  it("is 1 for Any size", () => {
    expect(zoomFor({ width: 800, height: 600 }, undefined)).toBe(1);
    expect(fits({ width: 800, height: 600 }, undefined)).toBe(true);
  });

  it("is 1 when the screen is at least the minimum", () => {
    expect(zoomFor(UHD, HD)).toBe(1);
    expect(zoomFor(HD, HD)).toBe(1);
  });

  it("shrinks by the tighter side, uniformly", () => {
    expect(zoomFor(HD, UHD)).toBe(0.5);
    // 1920/3440 = 0.558 is tighter than 1080/1440 = 0.75
    expect(zoomFor(HD, UW)).toBeCloseTo(1920 / 3440, 6);
    expect(fits(HD, UHD)).toBe(false);
  });

  it("rounds fractional logical sizes first (Windows 150%)", () => {
    expect(zoomFor({ width: 1920.0000001, height: 1079.9999999 }, HD)).toBe(1);
    expect(fits({ width: 1919.6, height: 1079.6 }, HD)).toBe(true);
  });

  it("is not orientation-free: portrait 1080p does not fit a landscape 1080p minimum", () => {
    expect(zoomFor({ width: 1080, height: 1920 }, HD)).toBeCloseTo(1080 / 1920, 6);
  });
});

describe("isMinResolution", () => {
  it("accepts whole sizes inside the limits", () => {
    expect(isMinResolution(HD)).toBe(true);
    expect(isMinResolution({ width: MIN_RES_LIMITS.minWidth, height: MIN_RES_LIMITS.minHeight })).toBe(true);
    expect(isMinResolution({ width: MIN_RES_LIMITS.maxWidth, height: MIN_RES_LIMITS.maxHeight })).toBe(true);
  });

  it.each([
    null,
    "1920x1080",
    { width: 1920 },
    { width: 1920.5, height: 1080 },
    { width: 639, height: 1080 },
    { width: 1920, height: 8641 },
    { width: Number.NaN, height: 1080 },
  ])("refuses %j", (v) => {
    expect(isMinResolution(v)).toBe(false);
  });
});

describe("describeMinResolution", () => {
  it("reads Any size or W × H", () => {
    expect(describeMinResolution(undefined)).toBe("Any size");
    expect(describeMinResolution(UHD)).toBe("3840 × 2160");
  });

  it("offers the common sizes the spec names", () => {
    expect(COMMON_SIZES.map((s) => `${s.width}x${s.height}`)).toEqual([
      "1920x1080",
      "2560x1440",
      "3440x1440",
      "3840x2160",
      "5120x2160",
    ]);
  });
});

describe("pickLaunchWorkspace", () => {
  const desk = { id: "desk", name: "Desk 1080", minResolution: HD, openAtLaunch: true as const };
  const trading = { id: "trading", name: "Trading 4K", minResolution: UHD, openAtLaunch: true as const };
  const wide = { id: "wide", name: "Ultrawide", minResolution: UW, openAtLaunch: true as const };
  const research = { id: "research", name: "Research", openAtLaunch: true as const };
  const all = [desk, trading, wide, research];

  it.each([
    [{ width: 3840, height: 2160 }, "trading"],
    [{ width: 3440, height: 1440 }, "wide"],
    [{ width: 1920, height: 1080 }, "desk"],
    [{ width: 2560, height: 1440 }, "desk"],
    [{ width: 1512, height: 982 }, "research"],
  ])("on %j opens %s", (screen, id) => {
    expect(pickLaunchWorkspace(all, screen)?.id).toBe(id);
  });

  it("ignores workspaces not marked to open at launch", () => {
    const unmarked = { id: "big", name: "Big", minResolution: UHD };
    expect(pickLaunchWorkspace([unmarked, desk], UHD)?.id).toBe("desk");
  });

  it("is undefined when nothing marked fits", () => {
    expect(pickLaunchWorkspace([trading, wide], HD)).toBeUndefined();
    expect(pickLaunchWorkspace([], HD)).toBeUndefined();
  });

  it("breaks an area tie by the closest aspect ratio", () => {
    // Same area (4,147,200): 2880x1440 (2:1) and 2560x1620 (1.58:1)
    const twoToOne = { id: "a", name: "A", minResolution: { width: 2880, height: 1440 }, openAtLaunch: true as const };
    const tall = { id: "b", name: "B", minResolution: { width: 2560, height: 1620 }, openAtLaunch: true as const };
    expect(pickLaunchWorkspace([twoToOne, tall], { width: 3440, height: 1440 })?.id).toBe("a");
    expect(pickLaunchWorkspace([twoToOne, tall], { width: 2880, height: 1800 })?.id).toBe("b");
  });

  it("breaks a full tie by rail order", () => {
    const first = { ...desk, id: "first" };
    const second = { ...desk, id: "second" };
    expect(pickLaunchWorkspace([first, second], UHD)?.id).toBe("first");
    const r1 = { ...research, id: "r1" };
    const r2 = { ...research, id: "r2" };
    expect(pickLaunchWorkspace([r1, r2], HD)?.id).toBe("r1");
  });
});

describe("screenChoices", () => {
  const screen = (name: string, width: number, height: number, current = false) => ({
    name, width, height, current,
  });

  it("merges screens with the same logical size into one choice naming them all", () => {
    expect(
      screenChoices([screen("LG", 1920, 1080, true), screen("DELL", 3440, 1440), screen("ASUS", 1920, 1080)]),
    ).toEqual([
      { width: 1920, height: 1080, names: ["LG", "ASUS"], current: true },
      { width: 3440, height: 1440, names: ["DELL"], current: false },
    ]);
  });

  it("rounds before merging", () => {
    expect(screenChoices([screen("A", 1706.6667, 960), screen("B", 1707, 960)])).toHaveLength(1);
  });
});

describe("listScreens", () => {
  beforeEach(() => {
    tauri.isTauri = true;
    tauri.current = null;
    tauri.all = [];
    setScreen(1440, 900);
  });

  it("lists every monitor in logical pixels and marks the current one", async () => {
    const lg = monitor(3840, 2160, 2, "LG 27UP850");
    const dell = monitor(3440, 1440, 1, "DELL U3423WE");
    tauri.all = [lg, dell];
    tauri.current = lg;
    expect(await listScreens()).toEqual([
      { name: "LG 27UP850", width: 1920, height: 1080, current: true },
      { name: "DELL U3423WE", width: 3440, height: 1440, current: false },
    ]);
  });

  it("names an unnamed monitor by its position", async () => {
    tauri.all = [monitor(1920, 1080, 1)];
    expect((await listScreens())[0].name).toBe("Display 1");
  });

  it("falls back to window.screen outside Tauri", async () => {
    tauri.isTauri = false;
    expect(await listScreens()).toEqual([
      { name: "This screen", width: 1440, height: 900, current: true },
    ]);
  });

  it("falls back to window.screen when the call rejects or finds nothing", async () => {
    tauri.all = () => Promise.reject(new Error("ipc"));
    expect((await listScreens())[0].name).toBe("This screen");
    tauri.all = [];
    expect((await listScreens())[0].name).toBe("This screen");
  });
});

describe("readLaunchScreen", () => {
  beforeEach(() => {
    tauri.isTauri = true;
    tauri.current = null;
    tauri.primary = null;
    setScreen(1440, 900);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("reads the window's monitor in logical pixels", async () => {
    tauri.current = monitor(3840, 2160, 2);
    expect(await readLaunchScreen()).toEqual({ width: 1920, height: 1080, source: "monitor" });
  });

  it("keeps a 4K monitor at 100% as 4K", async () => {
    tauri.current = monitor(3840, 2160, 1);
    expect(await readLaunchScreen()).toEqual({ width: 3840, height: 2160, source: "monitor" });
  });

  it("falls back to the primary monitor when the current one is unknown", async () => {
    tauri.primary = monitor(2560, 1440, 1);
    expect(await readLaunchScreen()).toEqual({ width: 2560, height: 1440, source: "monitor" });
  });

  it("falls back to window.screen when neither monitor is known (Wayland)", async () => {
    expect(await readLaunchScreen()).toEqual({ width: 1440, height: 900, source: "screen" });
  });

  it("falls back to window.screen when the monitor call rejects", async () => {
    tauri.current = () => Promise.reject(new Error("ipc"));
    expect(await readLaunchScreen()).toEqual({ width: 1440, height: 900, source: "screen" });
  });

  it("falls back to window.screen when a monitor reports no scale factor", async () => {
    tauri.current = monitor(3840, 2160, 0);
    expect(await readLaunchScreen()).toEqual({ width: 1440, height: 900, source: "screen" });
  });

  it("uses window.screen outside Tauri", async () => {
    tauri.isTauri = false;
    tauri.current = monitor(3840, 2160, 1);
    expect(await readLaunchScreen()).toEqual({ width: 1440, height: 900, source: "screen" });
  });

  it.each(["ios", "android"])("reads nothing on %s", async (platform) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    tauri.current = monitor(2360, 1640, 2);
    expect(await readLaunchScreen()).toBeNull();
  });

  it("gives up after the deadline rather than holding the launch", async () => {
    vi.useFakeTimers();
    tauri.current = () => new Promise(() => {});
    const read = readLaunchScreen();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await read).toBeNull();
  });

  it("is null when window.screen has no size", async () => {
    tauri.isTauri = false;
    setScreen(0, 0);
    expect(await readLaunchScreen()).toBeNull();
  });
});

describe("readCurrentScreen", () => {
  beforeEach(() => {
    tauri.isTauri = true;
    tauri.current = null;
    tauri.primary = null;
  });

  it("reads the monitor the window is on now, in logical pixels", async () => {
    tauri.current = monitor(2560, 1440, 1);
    expect(await readCurrentScreen()).toEqual({ width: 2560, height: 1440 });
  });

  it("converts a scaled monitor to its logical size", async () => {
    tauri.current = monitor(3840, 2160, 1.5);
    expect(await readCurrentScreen()).toEqual({ width: 2560, height: 1440 });
  });

  it("does not guess from the primary monitor: null when the current one is unknown", async () => {
    tauri.primary = monitor(3840, 2160, 1);
    expect(await readCurrentScreen()).toBeNull();
  });

  it("is null when the read fails, never rejects", async () => {
    tauri.current = () => Promise.reject(new Error("ipc"));
    expect(await readCurrentScreen()).toBeNull();
  });

  it("is null outside Tauri without calling the monitor API", async () => {
    tauri.isTauri = false;
    tauri.current = monitor(3840, 2160, 1);
    expect(await readCurrentScreen()).toBeNull();
  });
});
