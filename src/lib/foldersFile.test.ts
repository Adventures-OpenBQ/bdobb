// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __list, __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "./jsonStore";
import { __resetLoggerForTests } from "./logger";
import { loadFolders, makeEmptyFolders, saveFolders } from "./foldersFile";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

const sample = {
  folders: [
    { id: "f1", name: "Macro", parentId: null },
    { id: "f2", name: "Rates", parentId: "f1" },
  ],
  folderOrder: ["f1", "f2"],
  placement: { d1: "f2" },
  collapsed: ["f1"],
};

describe("loadFolders", () => {
  it("returns an empty tree when the file is absent, and writes nothing", async () => {
    expect(await loadFolders()).toEqual({
      folders: [],
      folderOrder: [],
      placement: {},
      collapsed: [],
    });
    // Unlike settings.json and backends.json, an absent folders.json is not
    // seeded: an empty tree IS the absence of the file.
    expect(__list()).toEqual([]);
  });

  it("round-trips a saved tree", async () => {
    await saveFolders(sample);
    expect(await loadFolders()).toEqual(sample);
  });

  it("gives every caller its own empty tree, so a mutation cannot leak", () => {
    const a = makeEmptyFolders();
    const b = makeEmptyFolders();
    a.folderOrder.push("f1");
    expect(b.folderOrder).toEqual([]);
  });

  it.each([
    ["a non-object", '"nope"'],
    ["an array", "[]"],
    ["a missing folders array", '{"folderOrder":[],"placement":{},"collapsed":[]}'],
    ["a folder with no id", '{"folders":[{"name":"x","parentId":null}],"folderOrder":[],"placement":{},"collapsed":[]}'],
    ["a folder with a numeric parentId", '{"folders":[{"id":"f","name":"x","parentId":7}],"folderOrder":[],"placement":{},"collapsed":[]}'],
    ["a non-string folderOrder entry", '{"folders":[],"folderOrder":[7],"placement":{},"collapsed":[]}'],
    ["a non-string placement value", '{"folders":[],"folderOrder":[],"placement":{"d1":7},"collapsed":[]}'],
    ["a non-string collapsed entry", '{"folders":[],"folderOrder":[],"placement":{},"collapsed":[7]}'],
    ["outright garbage", "{not json"],
  ])("quarantines %s and reports an empty tree", async (_label, content) => {
    __seed("folders.json", content);

    expect(await loadFolders()).toEqual(makeEmptyFolders());

    // Preserved, never clobbered — the same contract every other file module
    // gets from jsonStore's quarantine().
    expect(__read("folders.json.corrupt")).toBe(content);
    expect(__read("folders.json")).toBeUndefined();
  });
});

describe("saveFolders", () => {
  it("writes the tree as JSON", async () => {
    await saveFolders(sample);
    expect(JSON.parse(__read("folders.json") ?? "")).toEqual(sample);
  });
});
