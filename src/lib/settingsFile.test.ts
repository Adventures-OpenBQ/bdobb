// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __read, __reset, __seed } from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import { __resetJsonStoreForTests } from "./jsonStore";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  saveSettings,
} from "./settingsFile";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

describe("loadSettings", () => {
  it("seeds and writes defaults when absent", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(__read("settings.json") ?? "")).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a partial file over the defaults", async () => {
    __seed("settings.json", JSON.stringify({}));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("passes unrecognized keys through unchanged", async () => {
    __seed("settings.json", JSON.stringify({ theme: "dark", futureFlag: 42 }));
    const loaded = await loadSettings();
    // Forward compatibility is a RUNTIME guarantee -- withDefaults' spread --
    // not a typed one: the Settings type deliberately admits no unknown keys,
    // so reading one back is a cast, as it would be for any caller.
    expect((loaded as Record<string, unknown>).futureFlag).toBe(42);
  });

  it("preserves unknown keys across a rewrite", async () => {
    __seed("settings.json", JSON.stringify({ theme: "dark", futureFlag: 42 }));
    await saveSettings(await loadSettings());
    expect(JSON.parse(__read("settings.json") ?? "").futureFlag).toBe(42);
  });

  it("downgrades a known field of the wrong type instead of quarantining the file", async () => {
    // Everything AROUND the bad field has to survive it: the two known
    // fields by their own coercion, `futureFlag` only by withDefaults'
    // `...loaded` spread.
    const seeded = { theme: 7, fontSize: "large", defaultTicker: "AAPL", futureFlag: 42 };
    __seed("settings.json", JSON.stringify(seeded));

    const loaded = await loadSettings();

    expect(loaded.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(loaded.fontSize).toBe("large");
    expect(loaded.defaultTicker).toBe("AAPL");
    expect((loaded as Record<string, unknown>).futureFlag).toBe(42);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it.each([["a bare string", '"dark"'], ["an array", "[1,2,3]"], ["a number", "7"]])(
    "quarantines %s at the top level",
    async (_label, text) => {
      // Not a downgrade: there are no fields to keep, so the file is moved
      // aside intact and the defaults are written fresh.
      __seed("settings.json", text);

      expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);

      expect(__read("settings.json.corrupt")).toBe(text);
      expect(JSON.parse(__read("settings.json") ?? "")).toEqual(DEFAULT_SETTINGS);
    },
  );

  it.each([
    ["fontSize", 7],
    ["defaultTicker", 7],
    ["matchDashboardSymbol", "yes"],
    ["maxDecimalPlaces", "2"],
    ["minimizeButton", 1],
    ["collapseWidgetControls", "no"],
    ["cornerDragHandles", 0],
    ["quickAddToolbar", "true"],
  ])("downgrades a wrong-typed %s without losing the rest of the file", async (field, value) => {
    // "the rest of the file" is these two companions, neither of which is a
    // field this table parametrizes: a known enum, and an unknown key that
    // only the `...loaded` spread carries through.
    const seeded = { theme: "light", futureFlag: 42, [field]: value };
    __seed("settings.json", JSON.stringify(seeded));
    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "light",
      futureFlag: 42,
    });
    expect(__read("settings.json.corrupt")).toBeUndefined();
    expect(__read("settings.json")).toBe(JSON.stringify(seeded));
  });

  it("accepts light theme and large font size", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light", fontSize: "large" }));
    const loaded = await loadSettings();
    expect(loaded.theme).toBe("light");
    expect(loaded.fontSize).toBe("large");
  });

  it("accepts a default ticker and matchDashboardSymbol", async () => {
    __seed("settings.json", JSON.stringify({ defaultTicker: "AAPL", matchDashboardSymbol: true }));
    const loaded = await loadSettings();
    expect(loaded.defaultTicker).toBe("AAPL");
    expect(loaded.matchDashboardSymbol).toBe(true);
  });

  it("downgrades an unrecognized theme value to the default instead of quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ theme: "blue" }));
    const loaded = await loadSettings();
    expect(loaded.theme).toBe("dark");
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("downgrades an unrecognized font size value to the default instead of quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ fontSize: "huge" }));
    const loaded = await loadSettings();
    expect(loaded.fontSize).toBe("medium");
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("accepts the widget/layout settings and dashboard order", async () => {
    __seed(
      "settings.json",
      JSON.stringify({
        maxDecimalPlaces: 4,
        minimizeButton: true,
        collapseWidgetControls: true,
        cornerDragHandles: true,
        quickAddToolbar: false,
        dashboardOrder: ["d1", "d2"],
      }),
    );
    const loaded = await loadSettings();
    expect(loaded.maxDecimalPlaces).toBe(4);
    expect(loaded.minimizeButton).toBe(true);
    expect(loaded.collapseWidgetControls).toBe(true);
    expect(loaded.cornerDragHandles).toBe(true);
    expect(loaded.quickAddToolbar).toBe(false);
    expect(loaded.dashboardOrder).toEqual(["d1", "d2"]);
  });

  it("defaults maxDecimalPlaces to 2 and quickAddToolbar to true when absent", async () => {
    const loaded = await loadSettings();
    expect(loaded.maxDecimalPlaces).toBe(2);
    expect(loaded.quickAddToolbar).toBe(true);
  });

  it("downgrades an out-of-range maxDecimalPlaces to the default instead of quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ maxDecimalPlaces: 9 }));
    const loaded = await loadSettings();
    expect(loaded.maxDecimalPlaces).toBe(2);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("drops a dashboardOrder that is not an array of strings, keeping the file", async () => {
    __seed("settings.json", JSON.stringify({ dashboardOrder: [1, 2] }));
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("loads settings storage as Local by default", async () => {
    expect((await loadSettings()).settingsStorage).toBeUndefined();
  });

  it("keeps a connection id and drops a malformed one, without quarantining", async () => {
    __seed("settings.json", JSON.stringify({ settingsStorage: "conn-1" }));
    expect((await loadSettings()).settingsStorage).toBe("conn-1");
    for (const bad of [7, "", null]) {
      __seed("settings.json", JSON.stringify({ settingsStorage: bad }));
      expect((await loadSettings()).settingsStorage).toBeUndefined();
    }
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });
});

describe("autoRefreshMinutes", () => {
  it("is absent by default — Off", () => {
    expect(DEFAULT_SETTINGS.autoRefreshMinutes).toBeUndefined();
  });

  it("accepts each of the five offered values", async () => {
    for (const minutes of [1, 5, 15, 30, 60]) {
      __reset();
      __resetJsonStoreForTests();
      __seed("settings.json", JSON.stringify({ autoRefreshMinutes: minutes }));
      expect((await loadSettings()).autoRefreshMinutes).toBe(minutes);
    }
  });

  it("downgrades an unrecognised value to Off rather than quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ autoRefreshMinutes: 7, theme: "light" }));
    const loaded = await loadSettings();
    expect(loaded.autoRefreshMinutes).toBeUndefined();
    // The rest of a well-formed file survives one bad enum value.
    expect(loaded.theme).toBe("light");
  });

  it("downgrades a non-number to Off rather than quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ autoRefreshMinutes: "5" }));
    expect((await loadSettings()).autoRefreshMinutes).toBeUndefined();
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("round-trips Off as an absent key, never as null", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, autoRefreshMinutes: undefined });
    expect(JSON.parse(__read("settings.json") ?? "")).not.toHaveProperty("autoRefreshMinutes");
  });
});

describe("railWidth", () => {
  it("defaults to 48, between the exported bounds", () => {
    expect(DEFAULT_SETTINGS.railWidth).toBe(48);
    expect(RAIL_WIDTH_MIN).toBe(24);
    expect(RAIL_WIDTH_MAX).toBe(120);
  });

  it.each([
    [10, 24],
    [23, 24],
    [80, 80],
    // Rounded too: the settings importer refuses a fractional width, so an
    // unrounded 50.5 would export a bundle this app then cannot import.
    [50.5, 51],
    [121, 120],
    [500, 120],
  ])("clamps a stored %spx into range as %ipx", async (stored, expected) => {
    __seed("settings.json", JSON.stringify({ railWidth: stored }));
    expect((await loadSettings()).railWidth).toBe(expected);
    // In range or out of it, the file is well formed and survives intact.
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });

  it("falls back to 48 when the key is absent", async () => {
    __seed("settings.json", JSON.stringify({ theme: "light" }));
    const loaded = await loadSettings();
    expect(loaded.railWidth).toBe(48);
    expect(loaded.theme).toBe("light");
  });

  it("falls back to 48 for a non-number rather than quarantining the file", async () => {
    __seed("settings.json", JSON.stringify({ railWidth: "48" }));
    expect((await loadSettings()).railWidth).toBe(48);
    expect(__read("settings.json.corrupt")).toBeUndefined();
  });
});
