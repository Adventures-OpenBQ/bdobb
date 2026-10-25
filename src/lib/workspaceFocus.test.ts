// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __reset } from "../test/memfs";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { focusDashboardInWorkspace } from "./workspaceFocus";

beforeEach(() => {
  __reset();
  useDashboardStore.setState({
    dashboards: [
      { id: "d1", name: "Main", tabs: [] },
      { id: "d2", name: "Second", tabs: [] },
    ],
    activeId: "d1",
    previousId: null,
  });
  useWorkspacesStore.setState({
    workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "a", dashboardId: "d1" }] }],
    activeWorkspaceId: "w1",
    previousWorkspaceId: null,
    focusedSlot: null,
  });
});

const slots = () => useWorkspacesStore.getState().workspaces[0]?.slots;

describe("focusDashboardInWorkspace with an explicit slot", () => {
  // The rail menu's Put in panel ▸ names its tile outright (issue #320), so
  // neither the hovered tile nor the one showing the focused dashboard may
  // redirect it -- here both of those say "a".
  it("puts the dashboard in that slot, whatever the hover and focus say", async () => {
    useWorkspacesStore.getState().setFocusedSlot("a");

    expect(focusDashboardInWorkspace("d2", "b")).toBe(true);

    await expect.poll(slots).toEqual([
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ]);
    expect(useDashboardStore.getState().activeId).toBe("d2");
  });

  // Issue #23: Put in panel used to reset the dashboard to its first tab for
  // the session, although the workspace records another (a restart showed it).
  it("shows the dashboard's recorded tab, not its first", async () => {
    const tabs = [{ id: "b1", name: "B1", cards: [] }, { id: "b2", name: "B2", cards: [] }];
    useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [] }, { id: "d2", name: "Beta", tabs }], activeTabIds: {} });
    useWorkspacesStore.setState({
      workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "a", dashboardId: "d1" }], activeTabIds: { d2: "b2" } }],
    });

    focusDashboardInWorkspace("d2", "b");

    await expect.poll(() => useDashboardStore.getState().activeTabIds.d2).toBe("b2");
    expect(useDashboardStore.getState().activeTabId).toBe("b2");
  });

  it("does nothing outside a workspace", () => {
    useWorkspacesStore.setState({ activeWorkspaceId: null });
    expect(focusDashboardInWorkspace("d2", "b")).toBe(false);
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });
});

// These three rode on a rail click until issue #320 made the click open a
// dashboard alone. The resolution itself stays -- a new, duplicated or
// imported dashboard still lands through it -- so they call it directly now.
describe("focusDashboardInWorkspace's slot resolution", () => {
  // Task 12b: slot "a" is filled, slot "b" is empty. Before this task, an
  // empty tile could not be focused by hovering it (WorkspaceTile's mouse
  // handler only fired setActive when a dashboard was present), so a rail
  // click always fell back to the dashboard-focused slot "a" — leaving "b"
  // unreachable except by drag. Hovering tile "b" now sets focusedSlot
  // directly (WorkspaceGrid/WorkspaceTile's own test covers the hover part);
  // this test is the other half — that the resolution honors it.
  it("puts the dashboard in the slot the pointer entered, even when that slot is empty", async () => {
    // Simulates the pointer entering the empty tile "b" — WorkspaceTile's own
    // handler is covered separately; here only its effect on the store matters.
    useWorkspacesStore.getState().setFocusedSlot("b");

    focusDashboardInWorkspace("d2");

    await expect.poll(slots).toEqual(
      expect.arrayContaining([
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
      ]),
    );
  });

  it("ignores a focused slot the workspace has no tile for, falling back to its first tile", async () => {
    // Reproduces a Laptop -> Full Screen switch: `slots` still carries the
    // {b, d2} entry from before the switch (applying Full Screen re-seats d1
    // into its one tile and keeps d2 hidden under "b" -- exactly this
    // fixture), and `activeId` is still "d2" --
    // the dashboard that was focused in tile b before the switch, and
    // nothing resets it either. A fixture whose `slots` had already dropped
    // that stale "b" entry (as this test used to) could never exercise the
    // bug: the dashboard-focused-slot fallback would land on "a" by luck
    // even unguarded, because there would be nothing else for it to find.
    useWorkspacesStore.setState({
      workspaces: [
        {
          id: "w1",
          name: "Trading",
          preset: "full-screen",
          slots: [
            { slot: "a", dashboardId: "d1" },
            { slot: "b", dashboardId: "d2" },
          ],
        },
      ],
    });
    useDashboardStore.setState({ activeId: "d2" });
    // Also stale, same reason: "b" is a Laptop slot, but this workspace is
    // Full Screen.
    useWorkspacesStore.getState().setFocusedSlot("b");

    focusDashboardInWorkspace("d2");

    // Full Screen has only slot "a" -- both the guarded hovered slot and the
    // (now guarded) dashboard-focused slot must be refused, falling back to
    // it, so slot "a" picks up d2. Before the fix, the unguarded fallback
    // resolved to "b" (already d2) and slot "a" was left untouched, at d1 --
    // the click visibly did nothing.
    //
    // A dashboard sits in at most one slot of a workspace, so d2 also leaves
    // the hidden "b" it was kept under rather than being shown twice once a
    // layout gives "b" a tile again.
    await expect.poll(slots).toEqual([{ slot: "a", dashboardId: "d2" }]);
  });

  // The fallback is the arrangement's first tile in READING order, not the
  // preset's first slot id: here slot b is the left-hand tile.
  it("falls back to the arrangement's first tile in reading order", async () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          id: "w1",
          name: "Trading",
          preset: "laptop",
          slots: [],
          layout: [
            { slot: "b", x: 0, y: 0, w: 6, h: 12 },
            { slot: "a", x: 6, y: 0, w: 6, h: 12 },
          ],
        },
      ],
    });

    focusDashboardInWorkspace("d2");

    await expect.poll(slots).toEqual([{ slot: "b", dashboardId: "d2" }]);
  });
});

describe("focusDashboardInWorkspace for a dashboard a tile already shows", () => {
  it("focuses that tile instead of moving it into the hovered one", async () => {
    useWorkspacesStore.setState({
      workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "a", dashboardId: "d1" }, { slot: "b", dashboardId: "d2" }] }],
      focusedSlot: "a",
    });

    expect(focusDashboardInWorkspace("d2")).toBe(true);

    await expect.poll(() => useDashboardStore.getState().activeId).toBe("d2");
    expect(slots()).toEqual([{ slot: "a", dashboardId: "d1" }, { slot: "b", dashboardId: "d2" }]);
  });
});
