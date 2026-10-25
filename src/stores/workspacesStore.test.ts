// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";

import { __failPath, __read, __reset, __writes } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import type { Workspace } from "../lib/workspacesFile";
import { writeSavedLayout } from "../lib/layoutsFile";
import { PRESETS } from "../lib/workspacePresets";
import {
  assignDraftSlot,
  effectiveWorkspace,
  layoutNameKey,
  nextLayoutName,
  useWorkspacesStore,
  type WorkspaceDraft,
} from "./workspacesStore";

/**
 * A seam to hold a workspace write open: while `hold` is set, saveWorkspace
 * waits on it before writing, and `entered` says a write has reached it. memfs
 * has no hook for this, and the real saveWorkspace runs unchanged after it.
 */
const gate = vi.hoisted(() => ({ hold: null as Promise<void> | null, entered: 0 }));
vi.mock("../lib/workspacesFile", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/workspacesFile")>();
  return {
    ...real,
    saveWorkspace: async (workspace: Workspace) => {
      gate.entered += 1;
      if (gate.hold) await gate.hold;
      return real.saveWorkspace(workspace);
    },
  };
});

beforeEach(() => {
  gate.hold = null;
  gate.entered = 0;
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useWorkspacesStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    previousWorkspaceId: null,
    focusedSlot: null,
    draft: null,
    arrangingId: null,
    layouts: [],
  });
});

const store = () => useWorkspacesStore.getState();

function onDisk(id: string) {
  return JSON.parse(__read(`workspaces/${id}.json`) ?? "null");
}

/**
 * Creates a workspace the way the dialog does -- through the draft -- since
 * that is the only creation path once the instant create is gone. It writes the
 * file for real, which the `load` tests below depend on.
 */
async function seed(name: string): Promise<string> {
  store().beginDraft(null, name);
  const result = await store().commitDraft();
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

/**
 * Writes under workspaces/. saveJson writes a temp file and renames it into
 * place, and memfs records only the write, so one save counts as one here.
 */
const workspaceWrites = () => __writes().filter((path) => path.startsWith("workspaces/")).length;

/** A saved workspace carrying the fields Arrange mode must not lose. */
const TRADING: Workspace = {
  id: "w1",
  name: "Trading",
  preset: "laptop",
  slots: [{ slot: "a", dashboardId: "d1" }],
  activeTabIds: { d1: "t9" },
  railsOpen: { left: true },
};

describe("assignSlot", () => {
  it("puts a dashboard in a slot", async () => {
    const id = await seed("Trading");
    await store().assignSlot(id, "a", "d1");
    expect(onDisk(id).slots).toEqual([{ slot: "a", dashboardId: "d1" }]);
  });

  it("replaces whatever was in that slot, without touching the others", async () => {
    const id = await seed("Trading");
    await store().assignSlot(id, "a", "d1");
    await store().assignSlot(id, "b", "d2");
    await store().assignSlot(id, "a", "d3");
    expect(onDisk(id).slots).toEqual([
      { slot: "a", dashboardId: "d3" },
      { slot: "b", dashboardId: "d2" },
    ]);
  });

  // A dashboard in two tiles of one workspace mirrors its tab and maximize
  // across both and repeats its cards' DOM ids, so assigning MOVES it.
  it("moves a dashboard out of any other slot of the same workspace", async () => {
    const id = await seed("Trading");
    await store().assignSlot(id, "a", "d1");
    await store().assignSlot(id, "b", "d2");
    await store().assignSlot(id, "b", "d1");
    expect(onDisk(id).slots).toEqual([{ slot: "b", dashboardId: "d1" }]);
  });

  it("lets the same dashboard sit in two workspaces", async () => {
    const a = await seed("Trading");
    const b = await seed("Macro");
    await store().assignSlot(a, "a", "d1");
    await store().assignSlot(b, "a", "d1");
    expect(onDisk(a).slots[0].dashboardId).toBe("d1");
    expect(onDisk(b).slots[0].dashboardId).toBe("d1");
  });
});

// Spec 2026-10-01 §4: applying a preset re-seats, in reading order, and
// removes the workspace's own layout. This supersedes v5.6.0's "switching
// back restores slot b" (the plan's ruling R7).
describe("applyPreset", () => {
  const known = new Set(["d1", "d2"]);

  it("re-seats a dashboard into the preset's tile in reading order", async () => {
    useWorkspacesStore.setState({
      workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "b", dashboardId: "d2" }] }],
    });
    await store().applyPreset("w1", "full-screen", known);
    expect(onDisk("w1")).toEqual({
      id: "w1",
      name: "Trading",
      preset: "full-screen",
      slots: [{ slot: "a", dashboardId: "d2" }],
    });
  });

  it("keeps the dashboards that do not fit hidden, under an id the preset does not use", async () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          id: "w1",
          name: "Trading",
          preset: "laptop",
          slots: [
            { slot: "a", dashboardId: "d1" },
            { slot: "b", dashboardId: "d2" },
          ],
        },
      ],
    });
    await store().applyPreset("w1", "full-screen", known);
    // Full Screen has one tile: d1 reads first and takes it, d2 is kept.
    expect(onDisk("w1").slots).toEqual([
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ]);
    expect(PRESETS["full-screen"].tiles.map((t) => t.slot)).not.toContain("b");
  });

  // `known` is what says a slot's dashboard still exists. A deleted
  // dashboard is not seated -- it must not take a tile from a live one -- but
  // is kept hidden, not dropped.
  it("does not seat a dashboard that is not in `known`, and keeps it under an unused id", async () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          id: "w1",
          name: "Trading",
          preset: "laptop",
          slots: [
            { slot: "a", dashboardId: "gone" },
            { slot: "b", dashboardId: "d2" },
          ],
        },
      ],
    });
    await store().applyPreset("w1", "full-screen", known);
    expect(onDisk("w1").slots).toEqual([
      { slot: "a", dashboardId: "d2" },
      { slot: "b", dashboardId: "gone" },
    ]);
  });

  it("removes the workspace's own layout, and re-seats out of it", async () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          id: "w1",
          name: "Trading",
          preset: "laptop",
          layout: [
            { slot: "b", x: 0, y: 0, w: 6, h: 12 },
            { slot: "a", x: 6, y: 0, w: 6, h: 12 },
          ],
          slots: [
            { slot: "a", dashboardId: "d1" },
            { slot: "b", dashboardId: "d2" },
          ],
        },
      ],
    });
    await store().applyPreset("w1", "laptop", known);
    expect(onDisk("w1")).not.toHaveProperty("layout");
    // b was on the left, so its dashboard reads first.
    expect(onDisk("w1").slots).toEqual([
      { slot: "a", dashboardId: "d2" },
      { slot: "b", dashboardId: "d1" },
    ]);
  });
});

describe("clearSlot", () => {
  it("empties one slot and leaves the rest", async () => {
    const id = await seed("Trading");
    await store().applyPreset(id, "laptop", new Set());
    await store().assignSlot(id, "a", "d1");
    await store().assignSlot(id, "b", "d2");
    await store().clearSlot(id, "a");
    expect(onDisk(id).slots).toEqual([{ slot: "b", dashboardId: "d2" }]);
  });
});

describe("removeWorkspace", () => {
  it("deletes the file and clears the active id when it was active", async () => {
    const id = await seed("Trading");
    store().setActiveWorkspace(id);
    await store().removeWorkspace(id);
    expect(__read(`workspaces/${id}.json`)).toBeUndefined();
    expect(store().workspaces).toEqual([]);
    expect(store().activeWorkspaceId).toBeNull();
  });

  // A slot id, a draft and Arrange mode all mean nothing once their
  // workspace is gone.
  it("drops the focused slot, the draft and Arrange mode that were its", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().startArranging("w1");
    store().setFocusedSlot("a");
    await store().removeWorkspace("w1");
    expect(store().focusedSlot).toBeNull();
    expect(store().draft).toBeNull();
    expect(store().arrangingId).toBeNull();
  });

  it("leaves another workspace's draft and Arrange mode alone", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING, { ...TRADING, id: "w2", name: "Macro" }] });
    store().startArranging("w1");
    await store().removeWorkspace("w2");
    expect(store().draft?.id).toBe("w1");
    expect(store().arrangingId).toBe("w1");
  });
});

describe("duplicateWorkspace", () => {
  it("copies the slots under a new id and name", async () => {
    const id = await seed("Trading");
    await store().assignSlot(id, "a", "d1");
    const copyId = await store().duplicateWorkspace(id);
    expect(copyId).not.toBeNull();
    expect(copyId).not.toBe(id);
    const copy = onDisk(copyId as string);
    expect(copy.name).toBe("Trading copy");
    // A reference, not a copy of the dashboard: both name the same id.
    expect(copy.slots).toEqual([{ slot: "a", dashboardId: "d1" }]);
  });
});

describe("setOpenAtLaunch (spec 2026-10-12 §8)", () => {
  it("marks a workspace on disk and in memory, written as true", async () => {
    const id = await seed("Trading");
    await store().setOpenAtLaunch(id, true);
    expect(onDisk(id).openAtLaunch).toBe(true);
    expect(store().workspaces.find((w) => w.id === id)?.openAtLaunch).toBe(true);
  });

  it("lets several workspaces be marked: the launch rule chooses among them", async () => {
    const a = await seed("Trading");
    const b = await seed("Macro");
    await store().setOpenAtLaunch(a, true);
    await store().setOpenAtLaunch(b, true);
    expect(onDisk(a).openAtLaunch).toBe(true);
    expect(onDisk(b).openAtLaunch).toBe(true);
  });

  it("clears by writing the key as absent", async () => {
    const a = await seed("Trading");
    await store().setOpenAtLaunch(a, true);
    await store().setOpenAtLaunch(a, false);
    expect("openAtLaunch" in onDisk(a)).toBe(false);
  });

  it("writes nothing for an unknown id or when nothing changes", async () => {
    const a = await seed("Trading");
    const before = workspaceWrites();
    await store().setOpenAtLaunch("nope", true);
    await store().setOpenAtLaunch(a, false);
    expect(workspaceWrites()).toBe(before);
  });
});

describe("minimum resolution and launch through the draft (spec 2026-10-12 §2, §7)", () => {
  it("begins a draft with the saved values, Any size and unmarked by default", async () => {
    const a = await seed("Trading");
    store().beginDraft(a);
    expect(store().draft).toMatchObject({ minResolution: null, openAtLaunch: false });
    store().beginDraft(null, "New");
    expect(store().draft).toMatchObject({ minResolution: null, openAtLaunch: false });
  });

  it("commits both, and writes neither when unset", async () => {
    const a = await seed("Trading");
    store().beginDraft(a);
    store().stageDraft({ minResolution: { width: 3840, height: 2160 }, openAtLaunch: true });
    await store().commitDraft();
    expect(onDisk(a)).toMatchObject({ minResolution: { width: 3840, height: 2160 }, openAtLaunch: true });
    store().beginDraft(a);
    expect(store().draft).toMatchObject({ minResolution: { width: 3840, height: 2160 }, openAtLaunch: true });
    store().stageDraft({ minResolution: null, openAtLaunch: false });
    await store().commitDraft();
    expect("minResolution" in onDisk(a)).toBe(false);
    expect("openAtLaunch" in onDisk(a)).toBe(false);
  });

  it("creates a new workspace with them", async () => {
    store().beginDraft(null, "Wide");
    store().stageDraft({ minResolution: { width: 3440, height: 1440 }, openAtLaunch: true });
    const result = await store().commitDraft();
    expect(result.ok).toBe(true);
    if (result.ok) expect(onDisk(result.id)).toMatchObject({ minResolution: { width: 3440, height: 1440 }, openAtLaunch: true });
  });

  it("lays the draft's minimum over the saved workspace for the live grid", async () => {
    const a = await seed("Trading");
    store().beginDraft(a);
    store().stageDraft({ minResolution: { width: 3840, height: 2160 } });
    const saved = store().workspaces.find((w) => w.id === a);
    expect(effectiveWorkspace(saved, store().draft)?.minResolution).toEqual({ width: 3840, height: 2160 });
  });

  it("Duplicate copies the minimum and drops the launch mark", async () => {
    const a = await seed("Trading");
    store().beginDraft(a);
    store().stageDraft({ minResolution: { width: 3840, height: 2160 }, openAtLaunch: true });
    await store().commitDraft();
    const copyId = (await store().duplicateWorkspace(a)) as string;
    expect(onDisk(copyId).minResolution).toEqual({ width: 3840, height: 2160 });
    expect("openAtLaunch" in onDisk(copyId)).toBe(false);
  });
});

describe("setActiveWorkspace and goToPreviousWorkspace", () => {
  it("remembers where you came from", async () => {
    const a = await seed("Trading");
    const b = await seed("Macro");
    store().setActiveWorkspace(a);
    store().setActiveWorkspace(b);
    expect(store().activeWorkspaceId).toBe(b);
    store().goToPreviousWorkspace();
    expect(store().activeWorkspaceId).toBe(a);
  });

  it("takes null, which is single-dashboard mode", async () => {
    const a = await seed("Trading");
    store().setActiveWorkspace(a);
    store().setActiveWorkspace(null);
    expect(store().activeWorkspaceId).toBeNull();
  });

  it("re-selecting the active one is not a switch", async () => {
    const a = await seed("Trading");
    const b = await seed("Macro");
    store().setActiveWorkspace(a);
    store().setActiveWorkspace(b);
    store().setActiveWorkspace(b);
    store().goToPreviousWorkspace();
    expect(store().activeWorkspaceId).toBe(a);
  });
});

describe("setWorkspaceTab and setRailsOpen", () => {
  it("records a tile's tab against its dashboard", async () => {
    const id = await seed("Trading");
    await store().setWorkspaceTab(id, "d1", "t2");
    expect(onDisk(id).activeTabIds).toEqual({ d1: "t2" });
  });

  it("records the left rail's pinned state", async () => {
    const id = await seed("Trading");
    await store().setRailsOpen(id, true);
    expect(onDisk(id).railsOpen).toEqual({ left: true });
  });
});

describe("focusedSlot", () => {
  it("is set by setFocusedSlot and cleared by setActiveWorkspace", async () => {
    const id = await seed("Trading");
    store().setFocusedSlot("b");
    expect(store().focusedSlot).toBe("b");

    store().setActiveWorkspace(id);
    expect(store().focusedSlot).toBeNull();
  });

  // A slot id means nothing outside the workspace it came from -- the same
  // reason setActiveWorkspace clears it. goToPreviousWorkspace is a second
  // way to change which workspace is active, and had been left without the
  // same guard: carrying a slot id from workspace A into workspace B (whose
  // current preset may not even have a slot by that name) is exactly the
  // stale-slot case focusDashboardInWorkspace's preset check exists to catch.
  it("is also cleared by goToPreviousWorkspace", async () => {
    const a = await seed("Trading");
    const b = await seed("Macro");
    store().setActiveWorkspace(a);
    store().setActiveWorkspace(b);
    store().setFocusedSlot("b");

    store().goToPreviousWorkspace();

    expect(store().activeWorkspaceId).toBe(a);
    expect(store().focusedSlot).toBeNull();
  });

  it("never reaches the persisted workspace file", async () => {
    const id = await seed("Trading");
    store().setFocusedSlot("b");
    await store().assignSlot(id, "a", "d1");
    expect(onDisk(id)).not.toHaveProperty("focusedSlot");
    expect(Object.keys(onDisk(id))).not.toContain("focusedSlot");
  });
});

describe("load", () => {
  it("orders by the given id list, and puts unlisted ones last", async () => {
    const a = await seed("Alpha");
    const b = await seed("Beta");
    useWorkspacesStore.setState({ workspaces: [] });
    await store().load([b, a]);
    expect(store().workspaces.map((w) => w.id)).toEqual([b, a]);
  });

  it("sorts by name when no order is given", async () => {
    await seed("Zulu");
    await seed("Alpha");
    useWorkspacesStore.setState({ workspaces: [] });
    await store().load();
    expect(store().workspaces.map((w) => w.name)).toEqual(["Alpha", "Zulu"]);
  });
});

describe("Arrange mode", () => {
  it("startArranging makes the workspace active, begins its draft and turns the mode on", () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().startArranging("w1");
    expect(store().activeWorkspaceId).toBe("w1");
    expect(store().draft?.id).toBe("w1");
    expect(store().arrangingId).toBe("w1");
  });

  it("startArranging does nothing for an id it does not know", () => {
    store().startArranging("nope");
    expect(store().arrangingId).toBeNull();
    expect(store().draft).toBeNull();
  });

  it("endArranging turns the mode off and drops the draft, writing nothing", () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().startArranging("w1");
    store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }] });
    store().endArranging();
    expect(store().arrangingId).toBeNull();
    expect(store().draft).toBeNull();
    expect(workspaceWrites()).toBe(0);
  });
});

describe("beginDraft", () => {
  it("starts a new workspace on Full Screen, empty, names shown, under the name it is given", () => {
    store().beginDraft(null, "Untitled 2");
    expect(store().draft).toEqual({
      id: null,
      name: "Untitled 2",
      preset: "full-screen",
      slots: [],
      showTileNames: true,
      layout: null,
      minResolution: null,
      openAtLaunch: false,
    });
  });

  it("copies a saved workspace for an edit, and ignores the name argument", () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().beginDraft("w1", "Ignored");
    expect(store().draft).toEqual({
      id: "w1",
      name: "Trading",
      preset: "laptop",
      slots: [{ slot: "a", dashboardId: "d1" }],
      showTileNames: true,
      layout: null,
      minResolution: null,
      openAtLaunch: false,
    });
    // A copy, so staging into the draft can never reach the saved workspace.
    expect(store().draft?.slots).not.toBe(TRADING.slots);
  });

  it("reads a saved showTileNames: false as hidden", () => {
    useWorkspacesStore.setState({ workspaces: [{ ...TRADING, showTileNames: false }] });
    store().beginDraft("w1");
    expect(store().draft?.showTileNames).toBe(false);
  });

  it("copies a saved layout, so staging can never reach it", () => {
    const layout = [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }];
    useWorkspacesStore.setState({ workspaces: [{ ...TRADING, layout }] });
    store().beginDraft("w1");
    expect(store().draft?.layout).toEqual(layout);
    expect(store().draft?.layout).not.toBe(layout);
  });

  it("does nothing for an id it does not know", () => {
    store().beginDraft("nope");
    expect(store().draft).toBeNull();
  });
});

describe("stageDraft and discardDraft", () => {
  it("merges each patch into the draft", () => {
    store().beginDraft(null, "Desk");
    store().stageDraft({ preset: "laptop" });
    store().stageDraft({ showTileNames: false });
    expect(store().draft).toMatchObject({ name: "Desk", preset: "laptop", showTileNames: false });
  });

  it("stageDraft is a no-op with no draft open", () => {
    store().stageDraft({ name: "Desk" });
    expect(store().draft).toBeNull();
  });

  it("discardDraft drops the draft and writes nothing", () => {
    store().beginDraft(null, "Desk");
    store().discardDraft();
    expect(store().draft).toBeNull();
    expect(workspaceWrites()).toBe(0);
  });
});

describe("commitDraft", () => {
  it("writes the draft's slots and layout once over the saved workspace, keeping its other fields, and clears the draft", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().beginDraft("w1");
    store().stageDraft({
      slots: [{ slot: "b", dashboardId: "d1" }],
      layout: [
        { slot: "a", x: 0, y: 0, w: 4, h: 12 },
        { slot: "b", x: 6, y: 0, w: 6, h: 12 },
      ],
    });
    const result = await store().commitDraft();

    expect(result).toEqual({ ok: true, id: "w1" });
    expect(workspaceWrites()).toBe(1);
    expect(onDisk("w1")).toEqual({
      ...TRADING,
      slots: [{ slot: "b", dashboardId: "d1" }],
      layout: [
        { slot: "a", x: 0, y: 0, w: 4, h: 12 },
        { slot: "b", x: 6, y: 0, w: 6, h: 12 },
      ],
    });
    expect(store().workspaces).toEqual([onDisk("w1")]);
    expect(store().draft).toBeNull();
  });

  it("leaves the layout key out when the draft has none", async () => {
    useWorkspacesStore.setState({ workspaces: [{ ...TRADING, layout: [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }] }] });
    store().beginDraft("w1");
    store().stageDraft({ layout: null });
    await store().commitDraft();
    expect(onDisk("w1")).not.toHaveProperty("layout");
    expect(store().workspaces[0]).not.toHaveProperty("layout");
  });

  it("keeps the draft and changes nothing in memory when the write fails", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().beginDraft("w1");
    store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 12, h: 12 }] });
    // saveJson mkdirs the directory first, so failing it fails every workspace write.
    __failPath("workspaces");

    const result = await store().commitDraft();

    expect(result).toEqual({ ok: false, error: expect.stringContaining("EIO") });
    expect(store().draft?.layout).toEqual([{ slot: "a", x: 0, y: 0, w: 12, h: 12 }]);
    expect(store().workspaces).toEqual([TRADING]);
  });

  // commitDraft writes the draft it held when it was CALLED, and clears
  // `draft` only if that same object is still the open one: Escape and
  // Arrange… again during the write begin a new draft that must survive.
  it("leaves a draft begun during the write alone, and saves the one it was called with", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().beginDraft("w1");
    store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 12, h: 12 }] });
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => (release = resolve));
    const pending = store().commitDraft();
    await vi.waitFor(() => expect(gate.entered).toBe(1));

    store().endArranging();
    store().beginDraft("w1");
    const second = store().draft;
    release();
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(onDisk("w1").layout).toEqual([{ slot: "a", x: 0, y: 0, w: 12, h: 12 }]);
    expect(store().draft).toBe(second);
  });

  it("creates a new workspace with exactly one file write, clears the draft, and does not switch to it", async () => {
    store().beginDraft(null, "Desk");
    store().stageDraft({ preset: "laptop", slots: [{ slot: "b", dashboardId: "d2" }] });
    const result = await store().commitDraft();
    if (!result.ok) throw new Error(result.error);

    expect(workspaceWrites()).toBe(1);
    // showTileNames is absent: shown is written as absence.
    expect(onDisk(result.id)).toEqual({
      id: result.id,
      name: "Desk",
      preset: "laptop",
      slots: [{ slot: "b", dashboardId: "d2" }],
    });
    expect(store().workspaces.map((w) => w.id)).toEqual([result.id]);
    expect(store().draft).toBeNull();
    // Switching in is the dialog's call (spec §4 step 3), not the store's.
    expect(store().activeWorkspaceId).toBeNull();
  });

  it("saves the name trimmed", async () => {
    store().beginDraft(null, "  Desk  ");
    const result = await store().commitDraft();
    if (!result.ok) throw new Error(result.error);
    expect(onDisk(result.id).name).toBe("Desk");
  });

  it("updates an edit with exactly one file write, keeping activeTabIds and railsOpen", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    store().beginDraft("w1");
    store().stageDraft({ name: "Macro", preset: "full-screen", slots: [{ slot: "a", dashboardId: "d2" }] });
    const result = await store().commitDraft();

    expect(result).toEqual({ ok: true, id: "w1" });
    expect(workspaceWrites()).toBe(1);
    expect(onDisk("w1")).toEqual({
      ...TRADING,
      name: "Macro",
      preset: "full-screen",
      slots: [{ slot: "a", dashboardId: "d2" }],
    });
    expect(store().workspaces).toEqual([onDisk("w1")]);
    expect(store().draft).toBeNull();
  });

  it("writes showTileNames: false when hidden, and leaves the key out once shown again", async () => {
    store().beginDraft(null, "Hidden");
    store().stageDraft({ showTileNames: false });
    const hidden = await store().commitDraft();
    if (!hidden.ok) throw new Error(hidden.error);
    expect(onDisk(hidden.id).showTileNames).toBe(false);

    store().beginDraft(hidden.id);
    store().stageDraft({ showTileNames: true });
    await store().commitDraft();
    expect(onDisk(hidden.id)).not.toHaveProperty("showTileNames");
    expect(store().workspaces[0]).not.toHaveProperty("showTileNames");
  });

  it("refuses a draft that still holds a New dashboard placeholder, writing nothing", async () => {
    store().beginDraft(null, "Desk");
    store().stageDraft({ slots: [{ slot: "a", newDashboard: true }] });

    const result = await store().commitDraft();

    expect(result.ok).toBe(false);
    expect(workspaceWrites()).toBe(0);
    expect(store().draft?.slots).toEqual([{ slot: "a", newDashboard: true }]);
  });
});

describe("effectiveWorkspace", () => {
  const draft = (over: Partial<WorkspaceDraft> = {}): WorkspaceDraft => ({
    id: "w1",
    name: "Draft",
    preset: "full-screen",
    slots: [{ slot: "a", dashboardId: "d2" }],
    showTileNames: false,
    layout: null,
    minResolution: null,
    openAtLaunch: false,
    ...over,
  });

  it("lays the draft's name, preset, slots and showTileNames over the saved workspace it is for", () => {
    expect(effectiveWorkspace(TRADING, draft())).toEqual({
      ...TRADING,
      name: "Draft",
      preset: "full-screen",
      slots: [{ slot: "a", dashboardId: "d2" }],
      showTileNames: false,
    });
  });

  it("drops New dashboard placeholders", () => {
    const over = draft({
      slots: [
        { slot: "a", newDashboard: true },
        { slot: "b", dashboardId: "d2" },
      ],
    });
    expect(effectiveWorkspace(TRADING, over)?.slots).toEqual([{ slot: "b", dashboardId: "d2" }]);
  });

  it("lays the draft's layout over, or removes the saved one when the draft has none", () => {
    const layout = [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }];
    expect(effectiveWorkspace(TRADING, draft({ layout }))?.layout).toBe(layout);
    expect(effectiveWorkspace({ ...TRADING, layout }, draft({ layout: null }))).not.toHaveProperty("layout");
  });

  it("answers the saved workspace itself with no draft, or a draft for another or a new workspace", () => {
    expect(effectiveWorkspace(TRADING, null)).toBe(TRADING);
    expect(effectiveWorkspace(TRADING, draft({ id: "w2" }))).toBe(TRADING);
    expect(effectiveWorkspace(TRADING, draft({ id: null }))).toBe(TRADING);
  });

  it("answers undefined when there is no saved workspace", () => {
    expect(effectiveWorkspace(undefined, draft())).toBeUndefined();
  });
});

// The dialog's Cancel and reopen, as v5.6.1's commitDraft test pins Arrange
// mode's Escape and Arrange… again: commitDraft writes the draft it held when
// it was CALLED, and clears `draft` only if that same object is still open.
describe("commitDraft against a draft begun since", () => {
  /** Holds every workspace write until `release` is called. */
  function holdWrites() {
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => (release = resolve));
    return release;
  }

  it("leaves a dialog draft begun during the write alone, and saves the one it was called with", async () => {
    store().beginDraft(null, "First");
    store().stageDraft({ slots: [{ slot: "a", dashboardId: "d1" }] });
    const release = holdWrites();
    const pending = store().commitDraft();
    await vi.waitFor(() => expect(gate.entered).toBe(1));

    store().discardDraft();
    store().beginDraft(null, "Second");
    const second = store().draft;
    release();
    const result = await pending;
    if (!result.ok) throw new Error(result.error);

    expect(onDisk(result.id)).toMatchObject({ name: "First", slots: [{ slot: "a", dashboardId: "d1" }] });
    expect(store().draft).toBe(second);
    expect(store().draft?.name).toBe("Second");
  });

  it("writes the draft held at call time even when it waited in the queue and a new one began first", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    const release = holdWrites();
    // Ahead of the commit in the store's queue, its write held open.
    const ahead = store().renameWorkspace("w1", "Renamed");
    await vi.waitFor(() => expect(gate.entered).toBe(1));
    store().beginDraft(null, "First");
    const pending = store().commitDraft();

    store().discardDraft();
    store().beginDraft(null, "Second");
    const second = store().draft;
    release();
    await ahead;
    const result = await pending;
    if (!result.ok) throw new Error(result.error);

    expect(onDisk(result.id).name).toBe("First");
    expect(store().draft).toBe(second);
  });

  it("still keeps the draft when its write fails", async () => {
    store().beginDraft(null, "First");
    const before = store().draft;
    __failPath("workspaces");
    const result = await store().commitDraft();
    expect(result.ok).toBe(false);
    expect(store().draft).toBe(before);
  });
});

describe("duplicateWorkspace and showTileNames", () => {
  it("keeps the setting on the copy", async () => {
    useWorkspacesStore.setState({ workspaces: [{ ...TRADING, showTileNames: false }] });
    const copyId = await store().duplicateWorkspace("w1");
    expect(onDisk(copyId as string).showTileNames).toBe(false);
  });
});

describe("assignDraftSlot", () => {
  it("puts a dashboard in an empty slot, keeping slot order", () => {
    expect(assignDraftSlot([{ slot: "b", dashboardId: "d2" }], "a", { dashboardId: "d1" })).toEqual([
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ]);
  });

  it("replaces whatever the slot held", () => {
    expect(assignDraftSlot([{ slot: "a", dashboardId: "d1" }], "a", { dashboardId: "d2" })).toEqual([
      { slot: "a", dashboardId: "d2" },
    ]);
  });

  it("moves a dashboard out of the slot it was in", () => {
    const slots = [
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ];
    expect(assignDraftSlot(slots, "b", { dashboardId: "d1" })).toEqual([{ slot: "b", dashboardId: "d1" }]);
  });

  it("moves it out of a slot the current arrangement does not show, too", () => {
    // On Full Screen only "a" shows; "b" is kept hidden from a Laptop past.
    const slots = [
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ];
    expect(assignDraftSlot(slots, "a", { dashboardId: "d2" })).toEqual([{ slot: "a", dashboardId: "d2" }]);
  });

  it("lets several slots hold a New dashboard placeholder", () => {
    const once = assignDraftSlot([], "a", { newDashboard: true });
    expect(assignDraftSlot(once, "b", { newDashboard: true })).toEqual([
      { slot: "a", newDashboard: true },
      { slot: "b", newDashboard: true },
    ]);
  });

  it("does not mutate the slots it is given", () => {
    const slots = [{ slot: "a", dashboardId: "d1" }];
    assignDraftSlot(slots, "a", { dashboardId: "d2" });
    expect(slots).toEqual([{ slot: "a", dashboardId: "d1" }]);
  });
});
// Spec 2026-10-01 §6: saved layouts.
const onDiskLayout = (id: string) => JSON.parse(__read(`layouts/${id}.json`) ?? "null");
// Tiles WITH slot ids, as Arrange mode's draft has them: saveLayout must drop
// them. A variable, not an inline literal, because a fresh literal carrying
// `slot` fails the excess-property check against `readonly TileRect[]`.
const NARROW_TILES = [
  { slot: "a", x: 0, y: 0, w: 4, h: 12 },
  { slot: "b", x: 6, y: 0, w: 6, h: 12 },
];

describe("the layout name rule", () => {
  it("compares trimmed and case-insensitively", () => {
    expect(layoutNameKey("  Narrow ")).toBe(layoutNameKey("narrow"));
  });

  it("pre-fills the next free Untitled layout, free by that rule", () => {
    expect(nextLayoutName([])).toBe("Untitled layout");
    expect(nextLayoutName([{ id: "l1", name: "untitled LAYOUT", tiles: [] }])).toBe("Untitled layout 2");
  });
});

describe("saved layouts", () => {
  it("saveLayout writes the tiles without slot ids, and lists layouts by name", async () => {
    await store().saveLayout("Wide", [{ x: 0, y: 0, w: 12, h: 12 }]);
    await store().saveLayout("  Narrow ", NARROW_TILES);
    expect(store().layouts.map((l) => l.name)).toEqual(["Narrow", "Wide"]);
    const narrow = store().layouts[0];
    expect(onDiskLayout(narrow.id)).toEqual({
      id: narrow.id,
      name: "Narrow",
      tiles: [
        { x: 0, y: 0, w: 4, h: 12 },
        { x: 6, y: 0, w: 6, h: 12 },
      ],
    });
  });

  it("saveLayout under a taken name, in any case, replaces that layout: same id, the new spelling", async () => {
    await store().saveLayout("Narrow", NARROW_TILES);
    const id = store().layouts[0].id;
    await store().saveLayout("NARROW", [{ x: 0, y: 0, w: 12, h: 12 }]);
    expect(store().layouts).toEqual([{ id, name: "NARROW", tiles: [{ x: 0, y: 0, w: 12, h: 12 }] }]);
  });

  it("saveLayout refuses an empty name", async () => {
    await expect(store().saveLayout("   ", NARROW_TILES)).rejects.toThrow();
    expect(store().layouts).toEqual([]);
  });

  // The three preset names are the Layout submenu's built-in entries: a saved
  // layout under one would list two of the same name.
  it.each(Object.values(PRESETS).map((p) => p.name))(
    "saveLayout refuses the preset name %s, in any case and padded, writing nothing",
    async (preset) => {
      for (const name of [preset, preset.toUpperCase(), `  ${preset.toLowerCase()} `]) {
        await expect(store().saveLayout(name, NARROW_TILES)).rejects.toThrow(
          `"${preset}" is a built-in layout. Choose another name.`,
        );
      }
      expect(store().layouts).toEqual([]);
      expect(__writes().filter((w) => w.startsWith("layouts/"))).toEqual([]);
    },
  );

  it.each(Object.values(PRESETS).map((p) => p.name))(
    "renameLayout refuses the preset name %s, in any case and padded, leaving the name",
    async (preset) => {
      await store().saveLayout("Narrow", NARROW_TILES);
      const narrow = store().layouts[0];
      for (const name of [preset, preset.toUpperCase(), `  ${preset.toLowerCase()} `]) {
        expect(await store().renameLayout(narrow.id, name)).toBe(false);
      }
      expect(store().layouts[0].name).toBe("Narrow");
      expect(onDiskLayout(narrow.id).name).toBe("Narrow");
    },
  );

  // "Custom" is the dialog strip's entry for a workspace's own arrangement:
  // a saved layout under it would put two "Custom" thumbnails in the strip.
  it("saveLayout and renameLayout refuse Custom by the same rule, in any case and padded", async () => {
    for (const name of ["Custom", "CUSTOM", "  custom "]) {
      await expect(store().saveLayout(name, NARROW_TILES)).rejects.toThrow(
        '"Custom" is a built-in layout. Choose another name.',
      );
    }
    expect(store().layouts).toEqual([]);
    expect(__writes().filter((w) => w.startsWith("layouts/"))).toEqual([]);

    await store().saveLayout("Narrow", NARROW_TILES);
    const narrow = store().layouts[0];
    for (const name of ["Custom", "CUSTOM", "  custom "]) {
      expect(await store().renameLayout(narrow.id, name)).toBe(false);
    }
    expect(onDiskLayout(narrow.id).name).toBe("Narrow");
  });

  it("a layouts file already on disk under a preset's name still loads, lists and is left alone", async () => {
    await writeSavedLayout({ id: "old", name: "Laptop", tiles: [{ x: 0, y: 0, w: 12, h: 12 }] });
    await store().loadLayouts();
    expect(store().layouts.map((l) => l.name)).toEqual(["Laptop"]);
    expect(onDiskLayout("old").name).toBe("Laptop");
  });

  it("renameLayout refuses a taken or blank name, and accepts its own name in a new case", async () => {
    await store().saveLayout("Narrow", NARROW_TILES);
    await store().saveLayout("Wide", [{ x: 0, y: 0, w: 12, h: 12 }]);
    const narrow = store().layouts.find((l) => l.name === "Narrow")!;
    expect(await store().renameLayout(narrow.id, " wide ")).toBe(false);
    expect(await store().renameLayout(narrow.id, "  ")).toBe(false);
    expect(await store().renameLayout(narrow.id, "NARROW")).toBe(true);
    expect(onDiskLayout(narrow.id).name).toBe("NARROW");
  });

  it("deleteLayout removes the file and changes no workspace", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    await store().saveLayout("Narrow", NARROW_TILES);
    const id = store().layouts[0].id;
    await store().deleteLayout(id);
    expect(__read(`layouts/${id}.json`)).toBeUndefined();
    expect(store().layouts).toEqual([]);
    expect(workspaceWrites()).toBe(0);
  });

  it("applySavedLayout copies the tiles, slot ids a, b … in reading order, re-seats, and keeps the preset", async () => {
    useWorkspacesStore.setState({
      workspaces: [{ id: "w1", name: "Trading", preset: "full-screen", slots: [{ slot: "a", dashboardId: "d1" }] }],
    });
    // Saved right-hand tile first: applying hands out ids by reading order.
    await store().saveLayout("Swapped", [
      { x: 6, y: 0, w: 6, h: 12 },
      { x: 0, y: 0, w: 4, h: 12 },
    ]);
    await store().applySavedLayout("w1", store().layouts[0].id, new Set(["d1"]));
    expect(onDisk("w1")).toEqual({
      id: "w1",
      name: "Trading",
      preset: "full-screen",
      layout: [
        { slot: "a", x: 0, y: 0, w: 4, h: 12 },
        { slot: "b", x: 6, y: 0, w: 6, h: 12 },
      ],
      slots: [{ slot: "a", dashboardId: "d1" }],
    });
  });

  it("applySavedLayout does nothing for a layout it does not know", async () => {
    useWorkspacesStore.setState({ workspaces: [TRADING] });
    await store().applySavedLayout("w1", "nope", new Set());
    expect(workspaceWrites()).toBe(0);
  });

  it("loadLayouts reads the directory, by name", async () => {
    await store().saveLayout("Wide", [{ x: 0, y: 0, w: 12, h: 12 }]);
    await store().saveLayout("Narrow", NARROW_TILES);
    useWorkspacesStore.setState({ layouts: [] });
    await store().loadLayouts();
    expect(store().layouts.map((l) => l.name)).toEqual(["Narrow", "Wide"]);
  });
});
