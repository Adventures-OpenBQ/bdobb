// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "./jsonStore";
import { __resetLoggerForTests } from "./logger";
import { isSavedLayout, loadSavedLayouts, removeSavedLayout, writeSavedLayout } from "./layoutsFile";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

const NARROW = {
  id: "l1",
  name: "Narrow",
  tiles: [
    { x: 0, y: 0, w: 4, h: 12 },
    { x: 6, y: 0, w: 6, h: 12 },
  ],
};

describe("isSavedLayout", () => {
  it("accepts a layout whose tiles make an arrangement", () => {
    expect(isSavedLayout(NARROW)).toBe(true);
  });

  it("refuses overlapping, off-grid or no tiles", () => {
    expect(isSavedLayout({ ...NARROW, tiles: [{ x: 0, y: 0, w: 7, h: 12 }, { x: 6, y: 0, w: 6, h: 12 }] })).toBe(false);
    expect(isSavedLayout({ ...NARROW, tiles: [{ x: 0, y: 6, w: 12, h: 12 }] })).toBe(false);
    expect(isSavedLayout({ ...NARROW, tiles: [] })).toBe(false);
    expect(isSavedLayout({ ...NARROW, tiles: [7] })).toBe(false);
  });

  it("refuses a missing id or name", () => {
    expect(isSavedLayout({ ...NARROW, id: 1 })).toBe(false);
    expect(isSavedLayout({ id: "l1", tiles: NARROW.tiles })).toBe(false);
  });
});

describe("load, save and delete", () => {
  it("is empty when the directory does not exist", async () => {
    expect(await loadSavedLayouts()).toEqual([]);
  });

  it("round-trips a layout to its own file under layouts/", async () => {
    await writeSavedLayout(NARROW);
    expect(JSON.parse(__read("layouts/l1.json") ?? "null")).toEqual(NARROW);
    expect(await loadSavedLayouts()).toEqual([NARROW]);
  });

  it("keeps the good files when one is unreadable or invalid", async () => {
    await writeSavedLayout(NARROW);
    __seed("layouts/l2.json", "{ not json");
    __seed("layouts/l3.json", JSON.stringify({ ...NARROW, id: "l3", tiles: [] }));
    expect((await loadSavedLayouts()).map((l) => l.id)).toEqual(["l1"]);
  });

  it("deletes a layout's file", async () => {
    await writeSavedLayout(NARROW);
    await removeSavedLayout("l1");
    expect(__read("layouts/l1.json")).toBeUndefined();
  });
});
