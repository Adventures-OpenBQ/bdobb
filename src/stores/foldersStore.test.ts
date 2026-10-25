// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { makeEmptyFolders } from "../lib/foldersFile";
import { useFoldersStore } from "./foldersStore";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useFoldersStore.setState(makeEmptyFolders());
});

/** What is actually on disk right now. */
function onDisk() {
  return JSON.parse(__read("folders.json") ?? "null");
}

describe("load", () => {
  it("starts empty when there is no file", async () => {
    await useFoldersStore.getState().load();
    expect(useFoldersStore.getState().folders).toEqual([]);
    expect(useFoldersStore.getState().placement).toEqual({});
  });

  it("restores folders, order, placement and the collapsed set", async () => {
    __seed(
      "folders.json",
      JSON.stringify({
        folders: [{ id: "f1", name: "Macro", parentId: null }],
        folderOrder: ["f1"],
        placement: { d1: "f1" },
        collapsed: ["f1"],
      }),
    );

    await useFoldersStore.getState().load();

    const s = useFoldersStore.getState();
    expect(s.folders).toEqual([{ id: "f1", name: "Macro", parentId: null }]);
    expect(s.folderOrder).toEqual(["f1"]);
    expect(s.placement).toEqual({ d1: "f1" });
    expect(s.collapsed).toEqual(["f1"]);
  });
});

describe("addFolder", () => {
  it("appends a top-level folder, records it in folderOrder, and writes the file", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);

    const s = useFoldersStore.getState();
    expect(s.folders).toEqual([{ id, name: "Macro", parentId: null }]);
    expect(s.folderOrder).toEqual([id]);
    expect(onDisk().folders).toEqual([{ id, name: "Macro", parentId: null }]);
  });

  it("nests under the named parent", async () => {
    const parent = await useFoldersStore.getState().addFolder("Macro", null);
    const child = await useFoldersStore.getState().addFolder("Rates", parent);

    expect(useFoldersStore.getState().folders.find((f) => f.id === child)?.parentId).toBe(parent);
    expect(useFoldersStore.getState().folderOrder).toEqual([parent, child]);
  });
});

describe("renameFolder", () => {
  it("renames and persists", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);
    await useFoldersStore.getState().renameFolder(id, "Macro & Rates");

    expect(useFoldersStore.getState().folders[0].name).toBe("Macro & Rates");
    expect(onDisk().folders[0].name).toBe("Macro & Rates");
  });

  it("is a no-op for an unknown id, and writes nothing", async () => {
    await useFoldersStore.getState().renameFolder("gone", "x");
    expect(__read("folders.json")).toBeUndefined();
  });
});

describe("deleteFolder", () => {
  it("moves its subfolders and its dashboards up to its parent", async () => {
    const outer = await useFoldersStore.getState().addFolder("Macro", null);
    const middle = await useFoldersStore.getState().addFolder("Rates", outer);
    const inner = await useFoldersStore.getState().addFolder("Curves", middle);
    await useFoldersStore.getState().moveDashboard("d1", middle);

    await useFoldersStore.getState().deleteFolder(middle);

    const s = useFoldersStore.getState();
    expect(s.folders.map((f) => f.id)).toEqual([outer, inner]);
    expect(s.folders.find((f) => f.id === inner)?.parentId).toBe(outer);
    expect(s.placement).toEqual({ d1: outer });
    expect(s.folderOrder).toEqual([outer, inner]);
  });

  it("moves a top-level folder's dashboards to the top level, as an ABSENT placement key", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);
    await useFoldersStore.getState().moveDashboard("d1", id);

    await useFoldersStore.getState().deleteFolder(id);

    expect(useFoldersStore.getState().placement).toEqual({});
    expect(onDisk().placement).toEqual({});
  });

  it("drops the folder from the collapsed set too", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);
    await useFoldersStore.getState().toggleCollapsed(id);

    await useFoldersStore.getState().deleteFolder(id);

    expect(useFoldersStore.getState().collapsed).toEqual([]);
  });

  it("is a no-op for an unknown id", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);
    await useFoldersStore.getState().deleteFolder("gone");
    expect(useFoldersStore.getState().folders.map((f) => f.id)).toEqual([id]);
  });
});

describe("moveDashboard", () => {
  it("records the placement and persists it", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);
    await useFoldersStore.getState().moveDashboard("d1", id);

    expect(useFoldersStore.getState().placement).toEqual({ d1: id });
    expect(onDisk().placement).toEqual({ d1: id });
  });

  it("moving to the top level DELETES the key rather than storing null", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);
    await useFoldersStore.getState().moveDashboard("d1", id);

    await useFoldersStore.getState().moveDashboard("d1", null);

    expect(useFoldersStore.getState().placement).toEqual({});
    expect(Object.keys(onDisk().placement)).toEqual([]);
  });

  it("refuses a folder that does not exist", async () => {
    await useFoldersStore.getState().moveDashboard("d1", "gone");
    expect(useFoldersStore.getState().placement).toEqual({});
  });
});

describe("toggleCollapsed", () => {
  it("collapses, then expands, persisting each time", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);

    await useFoldersStore.getState().toggleCollapsed(id);
    expect(onDisk().collapsed).toEqual([id]);

    await useFoldersStore.getState().toggleCollapsed(id);
    expect(onDisk().collapsed).toEqual([]);
  });
});

describe("concurrent actions", () => {
  it("keeps both mutations when two calls are fired without awaiting the first", async () => {
    const id = await useFoldersStore.getState().addFolder("Macro", null);

    // Neither call is awaited individually — this is what a drop handler or
    // a rename-then-collapse UI gesture does in practice. Without the
    // action queue, the second commit would read a stale snapshot taken
    // before the first commit's write landed, and silently revert it.
    const renamed = useFoldersStore.getState().renameFolder(id, "Renamed");
    const collapsed = useFoldersStore.getState().toggleCollapsed(id);
    await Promise.all([renamed, collapsed]);

    const s = useFoldersStore.getState();
    expect(s.folders[0].name).toBe("Renamed");
    expect(s.collapsed).toEqual([id]);
    expect(onDisk().folders[0].name).toBe("Renamed");
    expect(onDisk().collapsed).toEqual([id]);
  });
});

describe("replaceAll", () => {
  it("swaps the whole tree and persists it", async () => {
    const store = useFoldersStore.getState();
    await store.addFolder("Old", null);
    expect(useFoldersStore.getState().folders).toHaveLength(1);

    const next = {
      folders: [
        { id: "f1", name: "Macro", parentId: null },
        { id: "f2", name: "Rates", parentId: "f1" },
      ],
      folderOrder: ["f1", "f2"],
      placement: { "dash-1": "f1" },
      collapsed: ["f1"],
    };
    await useFoldersStore.getState().replaceAll(next);

    const after = useFoldersStore.getState();
    expect(after.folders).toHaveLength(2);
    expect(after.folderOrder).toEqual(["f1", "f2"]);
    expect(after.placement).toEqual({ "dash-1": "f1" });
    expect(after.collapsed).toEqual(["f1"]);
    // Replaced, not merged: the folder that was here is gone.
    expect(after.folders.map((f) => f.name)).not.toContain("Old");
    expect(JSON.parse(__read("folders.json") ?? "").folderOrder).toEqual(["f1", "f2"]);
  });
});
