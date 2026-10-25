// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { buildTree, railDashboardsWithPath } from "./folderTree";
import type { Folder } from "./foldersFile";
import type { Dashboard } from "./types";

const dash = (id: string, name: string): Dashboard => ({
  id,
  name,
  tabs: [{ id: `t-${id}`, name: "Main", cards: [] }],
});

const folder = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  name,
  parentId,
});

describe("buildTree", () => {
  it("puts every dashboard at the top level when there are no folders", () => {
    const tree = buildTree([], [], {}, [dash("d1", "One"), dash("d2", "Two")]);
    expect(tree.folders).toEqual([]);
    expect(tree.dashboards.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("orders sibling folders by folderOrder, not by name or insertion", () => {
    const tree = buildTree(
      [folder("fa", "Alpha"), folder("fb", "Beta")],
      ["fb", "fa"],
      {},
      [],
    );
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["fb", "fa"]);
  });

  it("nests a folder under its parent and keeps the parent's own children ordered", () => {
    const tree = buildTree(
      [folder("f1", "Macro"), folder("f3", "Credit", "f1"), folder("f2", "Rates", "f1")],
      ["f1", "f2", "f3"],
      {},
      [],
    );
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0].folder.id).toBe("f1");
    expect(tree.folders[0].children.map((n) => n.folder.id)).toEqual(["f2", "f3"]);
  });

  it("places a dashboard inside the folder its placement names", () => {
    const tree = buildTree(
      [folder("f1", "Macro")],
      ["f1"],
      { d2: "f1" },
      [dash("d1", "One"), dash("d2", "Two")],
    );
    expect(tree.dashboards.map((d) => d.id)).toEqual(["d1"]);
    expect(tree.folders[0].dashboards.map((d) => d.id)).toEqual(["d2"]);
  });

  it("keeps the incoming dashboard order inside a folder — that order IS dashboardOrder", () => {
    const tree = buildTree(
      [folder("f1", "Macro")],
      ["f1"],
      { d2: "f1", d1: "f1" },
      [dash("d2", "Two"), dash("d1", "One")],
    );
    expect(tree.folders[0].dashboards.map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("treats a dashboard absent from placement as top level", () => {
    const tree = buildTree([folder("f1", "Macro")], ["f1"], {}, [dash("d1", "One")]);
    expect(tree.dashboards.map((d) => d.id)).toEqual(["d1"]);
    expect(tree.folders[0].dashboards).toEqual([]);
  });

  it("treats a dashboard placed in a folder that no longer exists as top level", () => {
    const tree = buildTree([], [], { d1: "gone" }, [dash("d1", "One")]);
    expect(tree.dashboards.map((d) => d.id)).toEqual(["d1"]);
  });

  it("shows a folder whose parent no longer exists at the top level rather than dropping it", () => {
    const tree = buildTree([folder("f2", "Rates", "gone")], ["f2"], {}, []);
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["f2"]);
  });

  it("sorts a folder missing from folderOrder after every listed sibling", () => {
    const tree = buildTree([folder("fa", "Alpha"), folder("fb", "Beta")], ["fb"], {}, []);
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["fb", "fa"]);
  });

  it("ignores an inherited Object.prototype key rather than treating it as a placement", () => {
    // `placement["constructor"]` is a function on any plain object; a naive
    // index lookup would read it and place a dashboard named "constructor"
    // into a folder that was never named.
    const tree = buildTree([], [], {}, [dash("constructor", "Odd")]);
    expect(tree.dashboards.map((d) => d.id)).toEqual(["constructor"]);
  });

  it("does not loop forever on a parent cycle", () => {
    const tree = buildTree(
      [folder("f1", "A", "f2"), folder("f2", "B", "f1")],
      ["f1", "f2"],
      {},
      [dash("d1", "One")],
    );
    // The walk terminates, and -- since a cycle reaches no root -- each
    // folder on it is shown at the top level, as an orphan is.
    expect(tree.folders.map((n) => n.folder.id)).toEqual(["f1", "f2"]);
    expect(tree.dashboards.map((d) => d.id)).toEqual(["d1"]);
  });

  // Unreachable from a root, the folders on a cycle were never drawn, and
  // neither was any dashboard placed in them: gone from the rail entirely.
  it("still draws a dashboard placed in a folder on a parent cycle, and that folder's own child", () => {
    const tree = buildTree(
      [folder("f1", "A", "f2"), folder("f2", "B", "f1"), folder("f3", "C", "f1")],
      ["f1", "f2", "f3"],
      { d1: "f1" },
      [dash("d1", "One")],
    );
    const f1 = tree.folders.find((n) => n.folder.id === "f1");
    expect(f1?.dashboards.map((d) => d.id)).toEqual(["d1"]);
    expect(f1?.children.map((n) => n.folder.id)).toEqual(["f3"]);
  });
});

describe("railDashboardsWithPath order", () => {
  it("reads the tree in the rail's own order: folders depth-first, then top-level dashboards", () => {
    const tree = buildTree(
      [folder("f1", "Macro"), folder("f2", "Rates", "f1")],
      ["f1", "f2"],
      { d2: "f1", d3: "f2" },
      [dash("d1", "One"), dash("d2", "Two"), dash("d3", "Three")],
    );
    // LeftRail renders a folder's child folders BEFORE its own dashboards,
    // and every folder before the top-level dashboards.
    expect(railDashboardsWithPath(tree).map((e) => e.dashboard.id)).toEqual(["d3", "d2", "d1"]);
  });

  it("keeps dashboards of one folder in the order buildTree gave them", () => {
    const tree = buildTree(
      [folder("f1", "Macro")],
      ["f1"],
      { d1: "f1", d2: "f1" },
      [dash("d2", "Two"), dash("d1", "One")],
    );
    expect(railDashboardsWithPath(tree).map((e) => e.dashboard.id)).toEqual(["d2", "d1"]);
  });

  it("includes the dashboards of a collapsed folder — order is not visibility", () => {
    // buildTree knows nothing of `collapsed`; this pins that the flattening
    // does not acquire that knowledge either.
    const tree = buildTree([folder("f1", "Macro")], ["f1"], { d1: "f1" }, [dash("d1", "One")]);
    expect(railDashboardsWithPath(tree).map((e) => e.dashboard.id)).toEqual(["d1"]);
  });
});

describe("railDashboardsWithPath paths", () => {
  it("carries each dashboard's folder path, outermost folder first", () => {
    const tree = buildTree(
      [folder("f1", "Macro"), folder("f2", "Rates", "f1")],
      ["f1", "f2"],
      { d2: "f1", d3: "f2" },
      [dash("d1", "One"), dash("d2", "Two"), dash("d3", "Three")],
    );
    expect(railDashboardsWithPath(tree).map((e) => [e.dashboard.id, e.path])).toEqual([
      ["d3", ["Macro", "Rates"]],
      ["d2", ["Macro"]],
      ["d1", []],
    ]);
  });
});
