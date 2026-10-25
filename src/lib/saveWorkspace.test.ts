// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { exportApp, exportCompatibleApp } from "./appsJson";
import { WORKSPACE_FORMATS, pickWorkspaceFile, workspaceApp } from "./saveWorkspace";
import type { Dashboard } from "./types";

const dashboard = (table?: Record<string, unknown>): Dashboard => ({
  id: "d1",
  name: "Macro",
  tabs: [{
    id: "t1",
    name: "Main",
    cards: [{ id: "c1", widgetId: "prices", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 20, h: 9 }, ...(table ? { table } : {}) }],
  }],
} as Dashboard);

describe("the Save… formats", () => {
  it("lists Strict OpenBB Workspace first, then BDOBB Workspace", () => {
    expect(WORKSPACE_FORMATS.map((f) => [f.id, f.label])).toEqual([
      ["strict", "Strict OpenBB Workspace"],
      ["bdobb", "BDOBB Workspace"],
    ]);
  });

  it("maps Strict OpenBB Workspace to the plain OpenBB exporter", () => {
    const d = dashboard({ pinned: { close: null } });
    expect(workspaceApp(d, "strict")).toEqual({ ok: true, value: exportApp(d) });
  });

  it("maps BDOBB Workspace to the compatible exporter, refusals included", () => {
    const d = dashboard({ pinned: { close: null } });
    expect(workspaceApp(d, "bdobb")).toEqual(exportCompatibleApp(d));
    const bad = dashboard({ widths: { close: -1 } });
    expect(workspaceApp(bad, "bdobb")).toMatchObject({ ok: false, issue: { code: "INVALID_EXTENSION" } });
  });
});

describe("pickWorkspaceFile", () => {
  it("asks the native panel with the default name and returns its path and format", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: "/x/Macro.apps.json", format: "bdobb" });
    await expect(pickWorkspaceFile("Macro.apps.json")).resolves.toEqual({ path: "/x/Macro.apps.json", format: "bdobb" });
    expect(invoke).toHaveBeenCalledWith("save_workspace_panel", { defaultName: "Macro.apps.json" });
  });

  it("passes a cancel through as null", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(pickWorkspaceFile("Macro.apps.json")).resolves.toBeNull();
  });
});
