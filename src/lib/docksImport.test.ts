// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, test, vi } from "vitest";

const confirm = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: (...a: unknown[]) => confirm(...a) }));

const importDocks = vi.fn(async () => {});
let existingDocks = { id: "docks", name: "Locked widgets", hidden: true as const, tabs: [{ id: "top", name: "T", cards: [] as unknown[] }, { id: "bottom", name: "B", cards: [] as unknown[] }] };
let dockEdit: unknown = null;
let viewer = false;
vi.mock("../stores/dashboardStore", () => ({
  useDashboardStore: { getState: () => ({ docks: existingDocks, importDocks, dockEdit, viewer }) },
}));

import { resolveDocksImport, docksNotice } from "./docksImport";

const incoming = { id: "docks", name: "Locked widgets", hidden: true as const, tabs: [] };

beforeEach(() => {
  confirm.mockReset();
  importDocks.mockClear();
  dockEdit = null;
  viewer = false;
  existingDocks = { id: "docks", name: "Locked widgets", hidden: true, tabs: [{ id: "top", name: "T", cards: [] }, { id: "bottom", name: "B", cards: [] }] };
});

test("no incoming docks does nothing", async () => {
  expect(await resolveDocksImport(undefined)).toBe("none");
  expect(importDocks).not.toHaveBeenCalled();
});

test("an empty existing docks is replaced silently — no prompt", async () => {
  expect(await resolveDocksImport(incoming as never)).toBe("replaced");
  expect(confirm).not.toHaveBeenCalled();
  expect(importDocks).toHaveBeenCalledOnce();
});

test("a populated existing docks prompts; Replace imports, Keep does not", async () => {
  existingDocks.tabs[0].cards.push({});
  confirm.mockResolvedValueOnce(true);
  expect(await resolveDocksImport(incoming as never)).toBe("replaced");
  expect(importDocks).toHaveBeenCalledOnce();
  confirm.mockResolvedValueOnce(false);
  expect(await resolveDocksImport(incoming as never)).toBe("kept");
  expect(importDocks).toHaveBeenCalledOnce();
});

test("an import while the Locked Widgets editor is open, or in the viewer, leaves the docks alone and says so", async () => {
  existingDocks.tabs[0].cards.push({});
  dockEdit = { edge: "top", snapshot: existingDocks };
  expect(await resolveDocksImport(incoming as never)).toBe("editing");
  expect(docksNotice("editing")).toBe(", and left your locked widgets alone: the Locked Widgets editor is open");
  dockEdit = null;
  viewer = true;
  expect(await resolveDocksImport(incoming as never)).toBe("viewer");
  expect(docksNotice("viewer")).not.toMatch(/replaced/);
  // Refused before the prompt: nothing to confirm, nothing written.
  expect(confirm).not.toHaveBeenCalled();
  expect(importDocks).not.toHaveBeenCalled();
});

test("docksNotice describes each outcome", () => {
  expect(docksNotice("none")).toBe("");
  expect(docksNotice("replaced")).toMatch(/locked widgets/i);
  expect(docksNotice("kept")).toMatch(/kept/i);
});

// The donor's last case ("the composed notice names locked widgets exactly
// once") built its line from planAppsImport's own notice and the plain
// `dock` field; clean builds the whole line in runAppsImport and carries the
// docks in the v8 envelope, so runAppsImport.test.ts pins the exact lines,
// replaced and kept, instead.
