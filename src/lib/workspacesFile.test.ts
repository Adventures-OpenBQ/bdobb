// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "./jsonStore";
import { __resetLoggerForTests } from "./logger";
import {
  arrangementOf,
  deleteWorkspace,
  isWorkspace,
  loadWorkspaces,
  makeWorkspace,
  saveWorkspace,
} from "./workspacesFile";
import { PRESETS, isPresetId } from "./workspacePresets";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

describe("PRESETS", () => {
  it("ships exactly Full Screen and Laptop", () => {
    expect(Object.keys(PRESETS)).toEqual(["full-screen", "laptop"]);
  });

  it("rejects a preset id it does not know", () => {
    expect(isPresetId("laptop")).toBe(true);
    expect(isPresetId("ipad")).toBe(false);
    expect(isPresetId(7)).toBe(false);
  });
});

describe("isWorkspace", () => {
  const valid = {
    id: "w1",
    name: "Trading",
    preset: "laptop",
    slots: [{ slot: "a", dashboardId: "d1" }],
  };

  it("accepts the minimal shape", () => {
    expect(isWorkspace(valid)).toBe(true);
  });

  it("accepts the optional fields", () => {
    expect(isWorkspace({ ...valid, activeTabIds: { d1: "t1" }, railsOpen: { left: true } })).toBe(
      true,
    );
  });

  it("rejects an unknown preset, so a v7 file does not half-load here", () => {
    expect(isWorkspace({ ...valid, preset: "ipad" })).toBe(false);
  });

  it("rejects a malformed slot", () => {
    expect(isWorkspace({ ...valid, slots: [{ slot: "a" }] })).toBe(false);
  });

  // Two entries under one slot id (a hand edit) show only the first, and the
  // next re-seat would drop the other without a word; refused whole instead,
  // as isArrangement refuses a repeated tile.
  it("rejects two slots with one id", () => {
    expect(
      isWorkspace({
        ...valid,
        slots: [
          { slot: "a", dashboardId: "d1" },
          { slot: "a", dashboardId: "d2" },
        ],
      }),
    ).toBe(false);
  });

  // layout (spec 2026-10-01 §2): absent means the preset's own tiles, which
  // the minimal-shape test above covers. A layout that is not an arrangement
  // refuses the file whole.
  it("accepts a valid layout", () => {
    const layout = [
      { slot: "a", x: 0, y: 0, w: 4, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ];
    expect(isWorkspace({ ...valid, layout })).toBe(true);
  });

  it("refuses an overlapping layout", () => {
    const layout = [
      { slot: "a", x: 0, y: 0, w: 7, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ];
    expect(isWorkspace({ ...valid, layout })).toBe(false);
  });

  it("refuses an off-grid layout", () => {
    expect(isWorkspace({ ...valid, layout: [{ slot: "a", x: 0, y: 6, w: 12, h: 12 }] })).toBe(false);
  });

  // showTileNames (spec 2026-09-30 "Tile names"): absent means shown, which
  // the minimal-shape test above already covers. Both booleans load; anything
  // else refuses the whole file, like every other malformed field here.
  it("accepts showTileNames as an optional boolean, either way", () => {
    expect(isWorkspace({ ...valid, showTileNames: false })).toBe(true);
    expect(isWorkspace({ ...valid, showTileNames: true })).toBe(true);
  });

  it("rejects a showTileNames that is not a boolean", () => {
    expect(isWorkspace({ ...valid, showTileNames: "no" })).toBe(false);
    expect(isWorkspace({ ...valid, showTileNames: 0 })).toBe(false);
  });

  // minResolution and openAtLaunch (spec 2026-10-12 §2).
  it("accepts a minimum resolution inside the limits", () => {
    expect(isWorkspace({ ...valid, minResolution: { width: 3840, height: 2160 } })).toBe(true);
    expect(isWorkspace({ ...valid, minResolution: { width: 640, height: 480 } })).toBe(true);
  });

  it("refuses a malformed or out-of-range minimum resolution", () => {
    expect(isWorkspace({ ...valid, minResolution: "4k" })).toBe(false);
    expect(isWorkspace({ ...valid, minResolution: null })).toBe(false);
    expect(isWorkspace({ ...valid, minResolution: { width: 3840 } })).toBe(false);
    expect(isWorkspace({ ...valid, minResolution: { width: 100, height: 100 } })).toBe(false);
    expect(isWorkspace({ ...valid, minResolution: { width: 1920.5, height: 1080 } })).toBe(false);
  });

  it("accepts openAtLaunch only as true", () => {
    expect(isWorkspace({ ...valid, openAtLaunch: true })).toBe(true);
    expect(isWorkspace({ ...valid, openAtLaunch: false })).toBe(false);
    expect(isWorkspace({ ...valid, openAtLaunch: "yes" })).toBe(false);
  });

  it("ignores the first revision's defaultFor, which was never released", () => {
    expect(isWorkspace({ ...valid, defaultFor: "uhd" })).toBe(true);
  });
});

describe("makeWorkspace", () => {
  it("starts on Full Screen with no slots filled", () => {
    const w = makeWorkspace("Macro");
    expect(w.name).toBe("Macro");
    expect(w.preset).toBe("full-screen");
    expect(w.slots).toEqual([]);
    expect(w.id).not.toBe("");
  });
});

describe("load and save", () => {
  it("is empty when the directory does not exist", async () => {
    expect(await loadWorkspaces()).toEqual([]);
  });

  it("round-trips a workspace to its own file", async () => {
    const w = { ...makeWorkspace("Trading"), id: "w1" };
    await saveWorkspace(w);
    expect(JSON.parse(__read("workspaces/w1.json") ?? "null")).toEqual(w);
    expect(await loadWorkspaces()).toEqual([w]);
  });

  it("keeps the good files when one is unreadable", async () => {
    await saveWorkspace({ ...makeWorkspace("Good"), id: "w1" });
    __seed("workspaces/w2.json", "{ not json");
    const loaded = await loadWorkspaces();
    expect(loaded.map((w) => w.name)).toEqual(["Good"]);
  });

  it("keeps a slot whose dashboard is unknown, rather than dropping it", async () => {
    const w = {
      ...makeWorkspace("Trading"),
      id: "w1",
      slots: [{ slot: "a", dashboardId: "gone" }],
    };
    await saveWorkspace(w);
    expect((await loadWorkspaces())[0]?.slots).toEqual([{ slot: "a", dashboardId: "gone" }]);
  });

  it("deletes a workspace's file", async () => {
    await saveWorkspace({ ...makeWorkspace("Trading"), id: "w1" });
    await deleteWorkspace("w1");
    expect(__read("workspaces/w1.json")).toBeUndefined();
    expect(await loadWorkspaces()).toEqual([]);
  });
});

describe("arrangementOf", () => {
  it("is the preset's tiles when there is no layout", () => {
    expect(arrangementOf({ preset: "laptop" })).toBe(PRESETS.laptop.tiles);
    expect(arrangementOf({ preset: "laptop", layout: null })).toBe(PRESETS.laptop.tiles);
  });

  it("is the layout when there is one", () => {
    const layout = [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }];
    expect(arrangementOf({ preset: "laptop", layout })).toBe(layout);
  });
});
it('rejects the same dashboard assigned to visible or hidden slots', () => {
  const base = { id: 'w', name: 'Duplicate', preset: 'laptop' };
  expect(isWorkspace({ ...base, slots: [{slot:'a',dashboardId:'d'}, {slot:'b',dashboardId:'d'}] })).toBe(false);
  expect(isWorkspace({ ...base, slots: [{slot:'a',dashboardId:'d'}, {slot:'hidden',dashboardId:'d'}] })).toBe(false);
});
