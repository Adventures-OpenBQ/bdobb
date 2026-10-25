// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { confirm } from "@tauri-apps/plugin-dialog";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __failPath, __read, __reset } from "../../test/memfs";
import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { DASHBOARD_REORDER_DRAG_TYPE } from "../../lib/dragDrop";
import { makeEmptyFolders } from "../../lib/foldersFile";
import { __resetLoggerForTests } from "../../lib/logger";
import type { Workspace } from "../../lib/workspacesFile";
import { PRESETS } from "../../lib/workspacePresets";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useFoldersStore } from "../../stores/foldersStore";
import { useWorkspacesStore } from "../../stores/workspacesStore";
import { WorkspaceDialog } from "./WorkspaceDialog";

// Deleting a saved layout asks through the native dialog, mocked as LeftRail.test mocks it.
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));

/** A dashboard with one empty tab: the dialog reads only ids and names. */
const dashboard = (id: string, name: string) => ({
  id,
  name,
  tabs: [{ id: `t-${id}`, name: "Main", cards: [] }],
});

// Some tests swap a store action for a spy via setState. vi.restoreAllMocks()
// does not undo that, so the real actions are captured once at load and put
// back before every test -- the same pattern LeftRail.test.tsx uses.
const REAL_WORKSPACE_ACTIONS = { commitDraft: useWorkspacesStore.getState().commitDraft };
const REAL_FOLDERS_ACTIONS = { toggleCollapsed: useFoldersStore.getState().toggleCollapsed };
const REAL_DASHBOARD_ACTIONS = { addDashboard: useDashboardStore.getState().addDashboard };

beforeEach(() => {
  __reset();
  __resetJsonStoreForTests();
  __resetLoggerForTests();
  useDashboardStore.setState({
    ...REAL_DASHBOARD_ACTIONS,
    viewer: false,
    dashboards: [dashboard("d1", "Alpha"), dashboard("d2", "Beta"), dashboard("d3", "Gamma")],
  });
  useFoldersStore.setState({ ...makeEmptyFolders(), ...REAL_FOLDERS_ACTIONS });
  useWorkspacesStore.setState({
    ...REAL_WORKSPACE_ACTIONS,
    workspaces: [],
    layouts: [],
    activeWorkspaceId: null,
    previousWorkspaceId: null,
    focusedSlot: null,
    draft: null,
    arrangingId: null,
  });
  vi.mocked(confirm).mockReset();
});

function show(workspaceId: string | null = null) {
  const onClose = vi.fn();
  const view = render(<WorkspaceDialog workspaceId={workspaceId} onClose={onClose} />);
  return { onClose, unmount: view.unmount };
}

/** One saved workspace, w1 "Trading" on Laptop, with whatever a test overrides. */
function seedWorkspace(over: Partial<Workspace> = {}) {
  useWorkspacesStore.setState({
    workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [], ...over }],
  });
}

const onDisk = (id: string) => JSON.parse(__read(`workspaces/${id}.json`) ?? "null");
const draft = () => useWorkspacesStore.getState().draft;
const nameField = () => screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
const layoutButton = (name: string) =>
  within(screen.getByRole("group", { name: "Layout" })).getByRole("button", { name });
const tiles = () => within(screen.getByRole("group", { name: "Tiles" }));
const tileLabels = () =>
  tiles()
    .getAllByRole("button", { name: /^Tile / })
    .map((b) => b.getAttribute("aria-label"));
const tile = (letter: string) => tiles().getByRole("button", { name: new RegExp(`^Tile ${letter}:`) });
const namesCheckbox = () => screen.getByRole("checkbox", { name: "Show dashboard names" });

describe("WorkspaceDialog", () => {
  it("opens as a real modal Workspaces dialog on a new workspace, with Open, and refuses the native close request", () => {
    show();
    const dialog = screen.getByRole("dialog", { name: "Workspaces" });
    expect(within(dialog).getByRole("heading", { name: "Untitled" })).toBeInTheDocument();
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();

    const cancel = new Event("cancel", { cancelable: true, bubbles: false });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("is titled with the workspace's name, with Open, when it opens on a saved one", () => {
    seedWorkspace();
    show("w1");
    expect(screen.getByRole("heading", { name: "Trading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(nameField().value).toBe("Trading");
  });

  it("pre-fills the next free Untitled name, focused and selected", () => {
    seedWorkspace({ name: "Untitled" });
    show();
    expect(nameField().value).toBe("Untitled 2");
    expect(nameField()).toHaveFocus();
    expect([nameField().selectionStart, nameField().selectionEnd]).toEqual([0, "Untitled 2".length]);
  });

  // Review Focus 4: an all-space name is a blank name.
  it("disables Create while the name is blank or only spaces", async () => {
    show();
    const create = screen.getByRole("button", { name: "Open" });
    await userEvent.clear(nameField());
    expect(create).toBeDisabled();
    await userEvent.type(nameField(), "   ");
    expect(create).toBeDisabled();
    await userEvent.type(nameField(), "Desk");
    expect(create).toBeEnabled();
  });

  it("creates on Enter in the name field, writes it, and switches the app into it", async () => {
    const { onClose } = show();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "Desk{Enter}");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [created] = useWorkspacesStore.getState().workspaces;
    expect(created).toMatchObject({ name: "Desk", preset: "full-screen", slots: [] });
    expect(onDisk(created.id).name).toBe("Desk");
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe(created.id);
  });

  // Review Focus 1: a ref, so the guard holds for two calls that see the same
  // render, and because Enter in the name field is not gated by the Create
  // button's disabled state; a `pending` state alone would let the second one
  // through.
  it("commits once however fast Enter is pressed twice", async () => {
    const commitDraft = vi.fn(REAL_WORKSPACE_ACTIONS.commitDraft);
    useWorkspacesStore.setState({ commitDraft });
    const { onClose } = show();

    fireEvent.keyDown(nameField(), { key: "Enter" });
    fireEvent.keyDown(nameField(), { key: "Enter" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(commitDraft).toHaveBeenCalledTimes(1);
    expect(useWorkspacesStore.getState().workspaces).toHaveLength(1);
    expect(screen.queryByText(/^Could not save/)).not.toBeInTheDocument();
  });

  it("Open writes an edit and switches the app into it", async () => {
    seedWorkspace();
    const { onClose } = show("w1");
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "Macro");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useWorkspacesStore.getState().workspaces[0].name).toBe("Macro");
    expect(onDisk("w1").name).toBe("Macro");
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe("w1");
  });

  it("Cancel discards the draft and writes nothing", async () => {
    seedWorkspace();
    const { onClose } = show("w1");
    await userEvent.type(nameField(), " edited");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(draft()).toBeNull();
    expect(useWorkspacesStore.getState().workspaces[0].name).toBe("Trading");
    expect(__read("workspaces/w1.json")).toBeUndefined();
  });

  it("Escape is Cancel", async () => {
    seedWorkspace();
    const { onClose } = show("w1");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(draft()).toBeNull();
  });

  // Review m35: the write cannot be called back, so closing while it is on
  // its way would discard a draft that still lands on disk.
  it("Escape, Cancel and ✕ do nothing while Done's write is in flight; Done closes when it lands", async () => {
    seedWorkspace();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const commitDraft = vi.fn(async () => {
      await gate;
      return REAL_WORKSPACE_ACTIONS.commitDraft();
    });
    useWorkspacesStore.setState({ commitDraft });
    const { onClose } = show("w1");
    await userEvent.type(nameField(), " edited");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(commitDraft).toHaveBeenCalledTimes(1));

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(draft()?.name).toBe("Trading edited");

    await act(async () => release());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDisk("w1").name).toBe("Trading edited");
  });

  it("the header ✕ is Cancel too", async () => {
    seedWorkspace();
    const { onClose } = show("w1");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(draft()).toBeNull();
  });

  it("never lets the draft outlive it", () => {
    seedWorkspace();
    const { unmount } = show("w1");
    expect(draft()).not.toBeNull();
    unmount();
    expect(draft()).toBeNull();
  });

  it("shows Could not save in the footer and stays open, usable, when the write fails", async () => {
    const { onClose } = show();
    __failPath("workspaces");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText(/^Could not save: EIO/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(draft()).not.toBeNull();
  });
});

describe("the layout and the tiles", () => {
  it("offers one thumbnail per preset, in table order, with the workspace's own pressed", () => {
    seedWorkspace();
    show("w1");
    const thumbs = within(screen.getByRole("group", { name: "Layout" })).getAllByRole("button");
    expect(thumbs.map((b) => b.getAttribute("aria-label"))).toEqual(Object.values(PRESETS).map((p) => p.name));
    expect(layoutButton("Laptop")).toHaveAttribute("aria-pressed", "true");
    expect(layoutButton("Full Screen")).toHaveAttribute("aria-pressed", "false");
  });

  it("starts a new workspace on Full Screen: one empty tile, selected", () => {
    show();
    expect(layoutButton("Full Screen")).toHaveAttribute("aria-pressed", "true");
    expect(tileLabels()).toEqual(["Tile A: Empty"]);
    expect(tile("A")).toHaveAttribute("aria-pressed", "true");
  });

  it("draws the preview from the arrangement's tiles on the 12 × 12 grid", () => {
    show();
    fireEvent.click(layoutButton("Laptop"));
    expect(tileLabels()).toHaveLength(PRESETS.laptop.tiles.length);
    const preview = screen.getByRole("group", { name: "Tiles" });
    expect(preview.style.gridTemplateColumns).toBe("repeat(12, minmax(0, 1fr))");
    expect(preview.style.gridTemplateRows).toBe("repeat(12, minmax(0, 1fr))");
    expect(screen.getByTestId("workspace-dialog-tile-b").style.gridColumn).toBe("7 / span 6");
    expect(tileLabels().at(-1)).toBe("Tile B: Empty");
  });

  it("selects the first empty tile on open", () => {
    seedWorkspace({ slots: [{ slot: "a", dashboardId: "d1" }] });
    show("w1");
    expect(tile("B")).toHaveAttribute("aria-pressed", "true");
    expect(tile("A")).toHaveAttribute("aria-pressed", "false");
  });

  it("selects the first tile when none is empty", () => {
    seedWorkspace({
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
      ],
    });
    show("w1");
    expect(tile("A")).toHaveAttribute("aria-pressed", "true");
  });

  it("selects a tile when it is clicked", async () => {
    seedWorkspace();
    show("w1");
    await userEvent.click(tile("B"));
    expect(tile("B")).toHaveAttribute("aria-pressed", "true");
    expect(tile("A")).toHaveAttribute("aria-pressed", "false");
  });

  it("clears a filled tile with its ✕", async () => {
    seedWorkspace({ slots: [{ slot: "a", dashboardId: "d1" }] });
    show("w1");
    expect(tileLabels()).toEqual(["Tile A: Alpha", "Tile B: Empty"]);
    await userEvent.click(screen.getByRole("button", { name: "Clear tile A" }));
    expect(tileLabels()).toEqual(["Tile A: Empty", "Tile B: Empty"]);
    expect(draft()?.slots).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Clear tile/ })).not.toBeInTheDocument();
  });

  it("hides the tiles a smaller layout lacks, restores them on switching back, and re-chooses a selection that went", async () => {
    seedWorkspace({
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
      ],
    });
    show("w1");
    await userEvent.click(tile("B"));
    await userEvent.click(layoutButton("Full Screen"));
    expect(tileLabels()).toEqual(["Tile A: Alpha"]);
    // B went with the layout, so the on-open rule picks again: nothing empty, so the first tile.
    expect(tile("A")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(layoutButton("Laptop"));
    expect(tileLabels()).toEqual(["Tile A: Alpha", "Tile B: Beta"]);
    expect(draft()?.slots).toEqual([
      { slot: "a", dashboardId: "d1" },
      { slot: "b", dashboardId: "d2" },
    ]);
  });

  // Review Focus 3: the grid already treats a dangling id as an empty tile;
  // the dialog must agree rather than show the id or select past it.
  it("shows a tile whose dashboard was deleted as empty, offers no ✕ for it, and selects it as empty", () => {
    seedWorkspace({
      slots: [
        { slot: "a", dashboardId: "gone" },
        { slot: "b", dashboardId: "d2" },
      ],
    });
    show("w1");
    expect(tileLabels()).toEqual(["Tile A: Empty", "Tile B: Beta"]);
    expect(tile("A")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Clear tile A" })).not.toBeInTheDocument();
    expect(screen.queryByText("gone")).not.toBeInTheDocument();
  });

  // Spec 2026-10-01 §4: choosing a preset re-seats, in reading order.
  it("re-seats on a layout switch: B's dashboard moves into Full Screen's one tile, and comes back on the left", async () => {
    seedWorkspace({ slots: [{ slot: "b", dashboardId: "d2" }] });
    show("w1");
    await userEvent.click(layoutButton("Full Screen"));
    expect(tileLabels()).toEqual(["Tile A: Beta"]);
    await userEvent.click(layoutButton("Laptop"));
    expect(tileLabels()).toEqual(["Tile A: Beta", "Tile B: Empty"]);
  });

  it("shows Custom, selected, for a workspace with its own layout, and no preset selected", () => {
    seedWorkspace({
      layout: [
        { slot: "a", x: 0, y: 0, w: 4, h: 12 },
        { slot: "b", x: 4, y: 0, w: 8, h: 12 },
      ],
    });
    show("w1");
    const thumbs = within(screen.getByRole("group", { name: "Layout" })).getAllByRole("button");
    expect(thumbs.map((b) => b.getAttribute("aria-label"))).toEqual(["Full Screen", "Laptop", "Custom"]);
    expect(layoutButton("Custom")).toHaveAttribute("aria-pressed", "true");
    expect(layoutButton("Laptop")).toHaveAttribute("aria-pressed", "false");
  });

  it("choosing a preset on a customised workspace drops its layout, and Custom goes", async () => {
    seedWorkspace({
      layout: [
        { slot: "a", x: 0, y: 0, w: 4, h: 12 },
        { slot: "b", x: 4, y: 0, w: 8, h: 12 },
      ],
    });
    show("w1");
    await userEvent.click(layoutButton("Laptop"));
    expect(draft()?.layout).toBeNull();
    expect(layoutButton("Laptop")).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("group", { name: "Layout" })).queryByRole("button", { name: "Custom" })).toBeNull();
  });

  it("letters tiles in reading order, in the preview and in the tree", () => {
    seedWorkspace({
      layout: [
        { slot: "b", x: 0, y: 0, w: 6, h: 12 },
        { slot: "a", x: 6, y: 0, w: 6, h: 12 },
      ],
      slots: [{ slot: "a", dashboardId: "d1" }],
    });
    show("w1");
    expect(tileLabels()).toEqual(["Tile A: Empty", "Tile B: Alpha"]);
    expect(treeRows()).toEqual(["Alpha (tile B)", "Beta", "Gamma"]);
  });

  it("says how many dashboards the layout does not show, under the preview", () => {
    seedWorkspace({
      preset: "full-screen",
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
        { slot: "c", dashboardId: "gone" },
      ],
    });
    show("w1");
    expect(screen.getByText("1 dashboard not shown in this layout")).toBeInTheDocument();
  });

  it("says nothing when every dashboard is shown", () => {
    seedWorkspace({ slots: [{ slot: "a", dashboardId: "d1" }] });
    show("w1");
    expect(screen.queryByText(/not shown in this layout/)).not.toBeInTheDocument();
  });
});

describe("Show dashboard names", () => {
  it("is checked for a new workspace, and Create leaves the key out of the file", async () => {
    const { onClose } = show();
    expect(namesCheckbox()).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [created] = useWorkspacesStore.getState().workspaces;
    expect(onDisk(created.id)).not.toHaveProperty("showTileNames");
  });

  it("unchecked, Done writes false -- and the dialog's own preview keeps showing names", async () => {
    seedWorkspace({ slots: [{ slot: "a", dashboardId: "d1" }] });
    const { onClose } = show("w1");
    await userEvent.click(namesCheckbox());
    expect(namesCheckbox()).not.toBeChecked();
    // The preview is how tiles are told apart while assigning, so it always names them.
    expect(tileLabels()).toEqual(["Tile A: Alpha", "Tile B: Empty"]);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDisk("w1").showTileNames).toBe(false);
  });

  it("starts unchecked on a workspace that hides them, and checking it writes the key out", async () => {
    seedWorkspace({ showTileNames: false });
    const { onClose } = show("w1");
    expect(namesCheckbox()).not.toBeChecked();
    await userEvent.click(namesCheckbox());
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDisk("w1")).not.toHaveProperty("showTileNames");
  });
});

/**
 * Macro > Rates, plus an Empty folder: Gamma sits in Rates, Alpha in Macro,
 * Beta at the top level. `collapsed` is the RAIL's state the dialog starts from.
 */
function seedFolders(collapsed: string[] = []) {
  useFoldersStore.setState({
    folders: [
      { id: "f1", name: "Macro", parentId: null },
      { id: "f2", name: "Rates", parentId: "f1" },
      { id: "f3", name: "Empty", parentId: null },
    ],
    folderOrder: ["f1", "f2", "f3"],
    placement: { d1: "f1", d3: "f2" },
    collapsed,
  });
}

const treeRows = () =>
  within(screen.getByRole("group", { name: "Dashboards" }))
    .queryAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));
const treeRow = (name: RegExp) =>
  within(screen.getByRole("group", { name: "Dashboards" })).getByRole("button", { name });
const search = () => screen.getByRole("searchbox", { name: "Search dashboards" });
// fireEvent.change, not userEvent.type: `[` and `{` are userEvent syntax.
const searchFor = (text: string) => fireEvent.change(search(), { target: { value: text } });

describe("the dashboard tree", () => {
  it("is the rail's tree, in the rail's order: folders depth-first, then top-level dashboards", () => {
    seedFolders();
    show();
    expect(treeRows()).toEqual(["Macro", "Rates", "Gamma", "Alpha", "Empty", "Beta"]);
  });

  it("starts each folder open or closed as the rail has it", () => {
    seedFolders(["f2"]);
    show();
    expect(treeRows()).toEqual(["Macro", "Rates", "Alpha", "Empty", "Beta"]);
    expect(treeRow(/^Rates$/)).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes folders locally, never through toggleCollapsed", async () => {
    const toggleCollapsed = vi.fn();
    useFoldersStore.setState({ toggleCollapsed });
    seedFolders();
    show();

    await userEvent.click(treeRow(/^Macro$/));
    expect(treeRows()).toEqual(["Macro", "Empty", "Beta"]);
    await userEvent.click(treeRow(/^Macro$/));
    expect(treeRows()).toEqual(["Macro", "Rates", "Gamma", "Alpha", "Empty", "Beta"]);

    expect(toggleCollapsed).not.toHaveBeenCalled();
    expect(useFoldersStore.getState().collapsed).toEqual([]);
  });

  it("searches dashboard names, forcing their folders open and dropping folders with no match", () => {
    seedFolders(["f1", "f2"]);
    show();
    searchFor("gam");
    expect(treeRows()).toEqual(["Macro", "Rates", "Gamma"]);
    expect(treeRow(/^Macro$/)).toHaveAttribute("aria-expanded", "true");

    // Clearing restores the tree's own open/closed state.
    searchFor("");
    expect(treeRows()).toEqual(["Macro", "Empty", "Beta"]);
  });

  it("searches case-insensitively", () => {
    seedFolders();
    show();
    searchFor("ALPHA");
    expect(treeRows()).toEqual(["Macro", "Alpha"]);
  });

  // Review Focus 5: a substring match, never a RegExp built from the text.
  it("matches regex characters literally and never throws on them", () => {
    useDashboardStore.setState({
      dashboards: [...useDashboardStore.getState().dashboards, dashboard("d4", "S&P (500)")],
    });
    show();
    searchFor("(500");
    expect(treeRows()).toEqual(["S&P (500)"]);
    searchFor("[");
    expect(treeRows()).toEqual([]);
  });

  it("marks a placed dashboard with its tile letter", () => {
    seedWorkspace({ slots: [{ slot: "b", dashboardId: "d2" }] });
    show("w1");
    expect(treeRows()).toEqual(["Alpha", "Beta (tile B)", "Gamma"]);
  });

  // Ruling R2 (conservative reading): a letter only for a tile the layout
  // shows. A slot kept from a bigger layout is not "placed" in this preview.
  it("gives no letter for a slot the current layout does not show", () => {
    seedWorkspace({
      preset: "full-screen",
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
      ],
    });
    show("w1");
    expect(treeRows()).toEqual(["Alpha (tile A)", "Beta", "Gamma"]);
  });
});

describe("assigning by click", () => {
  it("puts the clicked dashboard in the selected tile and moves on to the next empty one", async () => {
    show();
    await userEvent.click(layoutButton("Laptop"));
    expect(tile("A")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(treeRow(/^Alpha$/));
    expect(tileLabels()).toEqual(["Tile A: Alpha", "Tile B: Empty"]);
    expect(tile("B")).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(treeRow(/^Beta$/));
    expect(tileLabels()).toEqual(["Tile A: Alpha", "Tile B: Beta"]);
    // No empty tile left: the selection stays.
    expect(tile("B")).toHaveAttribute("aria-pressed", "true");
  });

  it("wraps round to an earlier empty tile", async () => {
    seedWorkspace();
    show("w1");
    await userEvent.click(tile("B"));
    await userEvent.click(treeRow(/^Alpha$/));
    expect(tileLabels()).toEqual(["Tile A: Empty", "Tile B: Alpha"]);
    expect(tile("A")).toHaveAttribute("aria-pressed", "true");
  });

  it("moves a dashboard that is already in another tile, rather than showing it twice", async () => {
    seedWorkspace({
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
      ],
    });
    show("w1");
    await userEvent.click(tile("B"));
    await userEvent.click(treeRow(/^Alpha/));
    expect(tileLabels()).toEqual(["Tile A: Empty", "Tile B: Alpha"]);
    // The move emptied A, which is now the next empty tile.
    expect(tile("A")).toHaveAttribute("aria-pressed", "true");
  });

  it("moves it out of a slot the current layout does not show, too", async () => {
    seedWorkspace({
      preset: "full-screen",
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
      ],
    });
    show("w1");
    await userEvent.click(treeRow(/^Beta$/));
    expect(tileLabels()).toEqual(["Tile A: Beta"]);
    await userEvent.click(layoutButton("Laptop"));
    expect(tileLabels()).toEqual(["Tile A: Beta", "Tile B: Empty"]);
  });
});

/** What a real drag of a dialog row carries -- type-aware, like the real DataTransfer. */
const dragOf = (dashboardId: string) => ({
  dataTransfer: {
    types: [DASHBOARD_REORDER_DRAG_TYPE],
    getData: (type: string) => (type === DASHBOARD_REORDER_DRAG_TYPE ? dashboardId : ""),
  },
});
const newDashboardButton = () => screen.getByRole("button", { name: "New dashboard" });

describe("assigning by drag", () => {
  it("a row's drag carries its dashboard id", () => {
    show();
    const setData = vi.fn();
    fireEvent.dragStart(treeRow(/^Alpha$/), { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(DASHBOARD_REORDER_DRAG_TYPE, "d1");
  });

  it("dropping on any tile assigns there under the move rule, leaving the selection alone", () => {
    seedWorkspace({ slots: [{ slot: "a", dashboardId: "d1" }] });
    show("w1");
    expect(tile("B")).toHaveAttribute("aria-pressed", "true");

    fireEvent.drop(screen.getByTestId("workspace-dialog-tile-a"), dragOf("d2"));
    expect(tileLabels()).toEqual(["Tile A: Beta", "Tile B: Empty"]);

    fireEvent.drop(screen.getByTestId("workspace-dialog-tile-b"), dragOf("d2"));
    expect(tileLabels()).toEqual(["Tile A: Empty", "Tile B: Beta"]);
    expect(tile("B")).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores a drop that carries no dashboard", () => {
    seedWorkspace();
    show("w1");
    fireEvent.drop(screen.getByTestId("workspace-dialog-tile-a"), {
      dataTransfer: { types: ["Files"], getData: () => "" },
    });
    expect(tileLabels()).toEqual(["Tile A: Empty", "Tile B: Empty"]);
  });
});

describe("＋ New dashboard", () => {
  it("puts a placeholder in the selected tile and moves on, and several tiles may hold one", async () => {
    show();
    await userEvent.click(layoutButton("Laptop"));
    await userEvent.click(newDashboardButton());
    expect(tileLabels()).toEqual(["Tile A: New dashboard", "Tile B: Empty"]);
    expect(tile("B")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(newDashboardButton());
    expect(tileLabels()).toEqual(["Tile A: New dashboard", "Tile B: New dashboard"]);
  });

  it("stays above the tree while a search matches nothing", () => {
    show();
    searchFor("zzz");
    expect(treeRows()).toEqual([]);
    expect(newDashboardButton()).toBeInTheDocument();
  });

  it("Create makes each placeholder a new top-level dashboard and puts its id in the tile", async () => {
    const { onClose } = show();
    await userEvent.click(layoutButton("Laptop"));
    await userEvent.click(newDashboardButton());
    await userEvent.click(newDashboardButton());
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const added = useDashboardStore.getState().dashboards.slice(3);
    expect(added.map((d) => d.name)).toEqual(["Untitled", "Untitled 2"]);
    expect(useWorkspacesStore.getState().workspaces[0].slots).toEqual([
      { slot: "a", dashboardId: added[0].id },
      { slot: "b", dashboardId: added[1].id },
    ]);
    // Top level, as the rail's own New dashboard: no folder placement written.
    expect(useFoldersStore.getState().placement).toEqual({});
  });

  // Ruling 8: a placeholder in a tile the chosen layout does not show is
  // dropped on Create, not turned into a dashboard nobody can see.
  it("drops a placeholder in a tile the chosen layout hides: no dashboard, nothing written for the slot", async () => {
    const addDashboard = vi.fn(REAL_DASHBOARD_ACTIONS.addDashboard);
    useDashboardStore.setState({ addDashboard });
    const { onClose } = show();
    await userEvent.click(layoutButton("Laptop"));
    await userEvent.click(newDashboardButton());
    await userEvent.click(newDashboardButton());
    await userEvent.click(layoutButton("Full Screen"));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Tile A is the one placeholder Full Screen shows; B is dropped.
    expect(addDashboard).toHaveBeenCalledTimes(1);
    expect(useDashboardStore.getState().dashboards).toHaveLength(4);
    const saved = useWorkspacesStore.getState().workspaces[0];
    expect(saved.slots).toEqual([{ slot: "a", dashboardId: expect.any(String) }]);
    expect(onDisk(saved.id).slots).toEqual(saved.slots);
  });

  it("creates nothing for a placeholder a smaller layout leaves hidden", async () => {
    const addDashboard = vi.fn(REAL_DASHBOARD_ACTIONS.addDashboard);
    useDashboardStore.setState({ addDashboard });
    const { onClose } = show();
    await userEvent.click(layoutButton("Laptop"));
    await userEvent.click(treeRow(/^Alpha$/));
    await userEvent.click(newDashboardButton());
    // Re-seated: Alpha into Full Screen's one tile, the placeholder hidden.
    await userEvent.click(layoutButton("Full Screen"));
    expect(tileLabels()).toEqual(["Tile A: Alpha"]);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addDashboard).not.toHaveBeenCalled();
    expect(useWorkspacesStore.getState().workspaces[0].slots).toEqual([{ slot: "a", dashboardId: "d1" }]);
  });

  it("keeps a dropped placeholder dropped when Create is retried after a failed write", async () => {
    const addDashboard = vi.fn(REAL_DASHBOARD_ACTIONS.addDashboard);
    const commitDraft = vi
      .fn(REAL_WORKSPACE_ACTIONS.commitDraft)
      .mockResolvedValueOnce({ ok: false, error: "EIO: disk full" });
    useDashboardStore.setState({ addDashboard });
    useWorkspacesStore.setState({ commitDraft });
    const { onClose } = show();
    await userEvent.click(layoutButton("Laptop"));
    await userEvent.click(newDashboardButton());
    await userEvent.click(newDashboardButton());
    await userEvent.click(layoutButton("Full Screen"));

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Could not save: EIO: disk full")).toBeInTheDocument();
    expect(draft()?.slots).toEqual([{ slot: "a", dashboardId: expect.any(String) }]);
    // Back to Laptop: the dropped tile B does not come back as a placeholder.
    await userEvent.click(layoutButton("Laptop"));
    expect(tileLabels()).toEqual([expect.stringMatching(/^Tile A: Untitled/), "Tile B: Empty"]);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addDashboard).toHaveBeenCalledTimes(1);
  });

  it("shows Could not save and keeps the placeholder when addDashboard answers null", async () => {
    useDashboardStore.setState({ addDashboard: vi.fn().mockResolvedValue(null) });
    const { onClose } = show();
    await userEvent.click(newDashboardButton());
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText("Could not save: this window cannot create dashboards")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(draft()?.slots).toEqual([{ slot: "a", newDashboard: true }]);
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
  });

  it("does not create the blank dashboards twice when Create is retried after a failed write", async () => {
    const addDashboard = vi.fn(REAL_DASHBOARD_ACTIONS.addDashboard);
    const commitDraft = vi
      .fn(REAL_WORKSPACE_ACTIONS.commitDraft)
      .mockResolvedValueOnce({ ok: false, error: "EIO: disk full" });
    useDashboardStore.setState({ addDashboard });
    useWorkspacesStore.setState({ commitDraft });
    const { onClose } = show();
    await userEvent.click(newDashboardButton());

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Could not save: EIO: disk full")).toBeInTheDocument();
    // Step 1 staged the real id as it went, so the retry has nothing to create.
    expect(draft()?.slots).toEqual([{ slot: "a", dashboardId: expect.any(String) }]);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addDashboard).toHaveBeenCalledTimes(1);
    expect(useDashboardStore.getState().dashboards).toHaveLength(4);
  });

  // Review Focus 1, with placeholders: without the busy guard both Enters
  // would read the same placeholder and each create a dashboard for it.
  it("creates each placeholder's dashboard once, however fast Enter is pressed twice", async () => {
    const addDashboard = vi.fn(REAL_DASHBOARD_ACTIONS.addDashboard);
    useDashboardStore.setState({ addDashboard });
    const { onClose } = show();
    await userEvent.click(newDashboardButton());

    fireEvent.keyDown(nameField(), { key: "Enter" });
    fireEvent.keyDown(nameField(), { key: "Enter" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addDashboard).toHaveBeenCalledTimes(1);
    expect(useDashboardStore.getState().dashboards).toHaveLength(4);
  });

  // Cancel, Escape and ✕ do nothing from Create's first write until it
  // settles: a cancel that landed while addDashboard was in flight closed the
  // dialog with blank dashboards already written. The dialog can still go
  // without them -- its window closing unmounts it -- and then the stale run
  // must stop: it may not make the remaining blank dashboards, stage its id
  // into a reopened dialog's draft, or commit it.
  it("Cancel, Escape and ✕ do nothing while Create makes its dashboards; an unmounted Create stops", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const addDashboard = vi.fn(async () => {
      await gate;
      return "late-id";
    });
    const commitDraft = vi.fn(REAL_WORKSPACE_ACTIONS.commitDraft);
    useDashboardStore.setState({ addDashboard });
    useWorkspacesStore.setState({ commitDraft });
    const first = show();
    await userEvent.click(layoutButton("Laptop"));
    await userEvent.click(newDashboardButton());
    await userEvent.click(newDashboardButton());
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(addDashboard).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(first.onClose).not.toHaveBeenCalled();
    expect(draft()?.slots).toHaveLength(2);

    // Gone anyway, as when its window closes.
    first.unmount();
    const second = show();
    await userEvent.click(newDashboardButton());

    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(addDashboard).toHaveBeenCalledTimes(1);
    expect(commitDraft).not.toHaveBeenCalled();
    expect(useWorkspacesStore.getState().workspaces).toEqual([]);
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
    expect(draft()?.slots).toEqual([{ slot: "a", newDashboard: true }]);
    expect(second.onClose).not.toHaveBeenCalled();
  });
});

// Spec 2026-10-01 §3: the dialog's Arrange… button.
describe("Arrange…", () => {
  // Review Focus 1.
  it("saves, closes, and leaves Arrange mode on with its own draft after the dialog unmounts", async () => {
    seedWorkspace();
    const { onClose, unmount } = show("w1");
    await userEvent.click(layoutButton("Full Screen"));
    await userEvent.click(screen.getByRole("button", { name: "Arrange…" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    unmount();

    expect(onDisk("w1").preset).toBe("full-screen");
    const s = useWorkspacesStore.getState();
    expect(s.arrangingId).toBe("w1");
    expect(s.activeWorkspaceId).toBe("w1");
    expect(s.draft?.id).toBe("w1");
  });

  it("creates a new workspace first, then arranges it", async () => {
    const { onClose, unmount } = show();
    await userEvent.click(screen.getByRole("button", { name: "Arrange…" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    unmount();
    const created = useWorkspacesStore.getState().workspaces[0];
    expect(useWorkspacesStore.getState().arrangingId).toBe(created.id);
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBe(created.id);
  });

  it("stays open with its note, and arranges nothing, when the save fails", async () => {
    seedWorkspace();
    show("w1");
    __failPath("workspaces");
    await userEvent.click(screen.getByRole("button", { name: "Arrange…" }));
    expect(await screen.findByText(/^Could not save: /)).toBeInTheDocument();
    expect(useWorkspacesStore.getState().arrangingId).toBeNull();
  });
});

// Spec 2026-10-01 §4 and §6: saved layouts in the strip.
const NARROW = { id: "l1", name: "Narrow", tiles: [{ x: 6, y: 0, w: 6, h: 12 }, { x: 0, y: 0, w: 4, h: 12 }] };
const WIDE = { id: "l2", name: "Wide", tiles: [{ x: 0, y: 0, w: 12, h: 12 }] };

describe("saved layouts in the strip", () => {
  const strip = () => within(screen.getByRole("group", { name: "Layout" }));

  it("come after the presets, by name, and before Custom", () => {
    useWorkspacesStore.setState({ layouts: [NARROW, WIDE] });
    seedWorkspace({ layout: [{ slot: "a", x: 0, y: 0, w: 12, h: 12 }] });
    show("w1");
    expect(strip().getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Full Screen",
      "Laptop",
      "Narrow",
      "Wide",
      "Custom",
    ]);
  });

  it("choosing one stages a copy -- slot ids in reading order, re-seated, preset kept -- and Custom is selected", async () => {
    useWorkspacesStore.setState({ layouts: [NARROW] });
    seedWorkspace({ slots: [{ slot: "b", dashboardId: "d2" }] });
    show("w1");
    await userEvent.click(layoutButton("Narrow"));
    expect(draft()?.layout).toEqual([
      { slot: "a", x: 0, y: 0, w: 4, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ]);
    expect(draft()?.preset).toBe("laptop");
    expect(tileLabels()).toEqual(["Tile A: Beta", "Tile B: Empty"]);
    expect(layoutButton("Custom")).toHaveAttribute("aria-pressed", "true");
    expect(layoutButton("Narrow")).toHaveAttribute("aria-pressed", "false");
  });

  it("right-click offers Rename and Delete", () => {
    useWorkspacesStore.setState({ layouts: [NARROW] });
    show();
    fireEvent.contextMenu(layoutButton("Narrow"));
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("Rename renames it in place", async () => {
    await act(() => useWorkspacesStore.getState().saveLayout("Narrow", NARROW.tiles));
    show();
    fireEvent.contextMenu(layoutButton("Narrow"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Rename layout" });
    await userEvent.clear(field);
    await userEvent.type(field, "Thin{Enter}");
    await waitFor(() => expect(useWorkspacesStore.getState().layouts.map((l) => l.name)).toEqual(["Thin"]));
    expect(layoutButton("Thin")).toBeInTheDocument();
  });

  it("Rename refuses a taken name and leaves the name as it was", async () => {
    await act(() => useWorkspacesStore.getState().saveLayout("Narrow", NARROW.tiles));
    await act(() => useWorkspacesStore.getState().saveLayout("Wide", WIDE.tiles));
    show();
    fireEvent.contextMenu(layoutButton("Narrow"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Rename layout" });
    await userEvent.clear(field);
    await userEvent.type(field, "wide{Enter}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Rename layout" })).toBeNull());
    expect(useWorkspacesStore.getState().layouts.map((l) => l.name)).toEqual(["Narrow", "Wide"]);
  });

  it("Rename refuses a preset's name, silently, and leaves the name as it was", async () => {
    await act(() => useWorkspacesStore.getState().saveLayout("Narrow", NARROW.tiles));
    show();
    fireEvent.contextMenu(layoutButton("Narrow"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Rename layout" });
    await userEvent.clear(field);
    await userEvent.type(field, "laptop{Enter}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Rename layout" })).toBeNull());
    expect(useWorkspacesStore.getState().layouts.map((l) => l.name)).toEqual(["Narrow"]);
    expect(screen.queryByText(/^Could not save/)).toBeNull();
  });

  it("Delete asks first; declining keeps it", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    await act(() => useWorkspacesStore.getState().saveLayout("Narrow", NARROW.tiles));
    show();
    fireEvent.contextMenu(layoutButton("Narrow"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith(
      'Delete the layout "Narrow"? No workspace is changed.',
      expect.objectContaining({ title: "Delete layout", kind: "warning" }),
    );
    expect(useWorkspacesStore.getState().layouts).toHaveLength(1);
  });

  it("Delete removes it and changes no workspace, not even one using a copy of it", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    await act(() => useWorkspacesStore.getState().saveLayout("Narrow", NARROW.tiles));
    seedWorkspace();
    show("w1");
    await userEvent.click(layoutButton("Narrow"));
    const copy = draft()?.layout;
    fireEvent.contextMenu(layoutButton("Narrow"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(useWorkspacesStore.getState().layouts).toEqual([]));
    expect(draft()?.layout).toBe(copy);
    expect(__read("workspaces/w1.json")).toBeUndefined();
  });
});

describe("the Workspaces sidebar, minimum resolution and launch (spec 2026-10-12 §7)", () => {
  function setScreen(width: number, height: number) {
    Object.defineProperty(window, "screen", { configurable: true, value: { width, height } });
  }
  const rail = () => within(screen.getByRole("navigation", { name: "Workspaces" }));
  const cardFor = (name: string) => rail().getByRole("button", { name: new RegExp(`^${name},`) });
  const minField = () => screen.getByRole("combobox", { name: /Minimum resolution/ }) as HTMLSelectElement;
  const launchBox = () => screen.getByRole("checkbox", { name: /Open at launch/ });

  function seedThree() {
    useWorkspacesStore.setState({
      workspaces: [
        { id: "w1", name: "Desk", preset: "laptop", slots: [], minResolution: { width: 1920, height: 1080 }, openAtLaunch: true },
        { id: "w2", name: "Trading 4K", preset: "laptop", slots: [], minResolution: { width: 3840, height: 2160 }, openAtLaunch: true },
        { id: "w3", name: "Research", preset: "full-screen", slots: [] },
      ],
    });
  }

  beforeEach(() => setScreen(1920, 1080));

  it("lists every workspace as a card with its minimum, fit and launch chips", () => {
    seedThree();
    show("w1");
    expect(cardFor("Desk")).toHaveAccessibleName("Desk, at least 1920 × 1080, Fits, opens at launch");
    expect(cardFor("Desk")).toHaveAttribute("aria-current", "true");
    expect(cardFor("Trading 4K")).toHaveAccessibleName("Trading 4K, at least 3840 × 2160, Zoom 50%");
    expect(cardFor("Research")).toHaveAccessibleName("Research, Any size, Fits");
    expect(rail().getByRole("button", { name: "+ New workspace" })).toBeInTheDocument();
  });

  it("explains the fit in the notice strip, and follows the minimum chosen", async () => {
    seedThree();
    show("w2");
    expect(screen.getByTestId("workspace-dialog-fit")).toHaveTextContent("Zoom 50%");
    expect(screen.getByText(/Minimum 3840 × 2160 is larger than this screen\. Lays out at 3840 × 2160, then zooms everything to 50%\./)).toBeInTheDocument();
    await userEvent.selectOptions(minField(), "any");
    expect(screen.getByTestId("workspace-dialog-fit")).toHaveTextContent("Fits · 100%");
    expect(draft()?.minResolution).toBeNull();
  });

  it("offers Any size, this screen, the common sizes and Custom", async () => {
    seedThree();
    show("w3");
    await waitFor(() => expect(within(minField()).getByRole("option", { name: /this screen/ })).toBeInTheDocument());
    const options = within(minField()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Any size",
      "1920 × 1080 — This screen · this screen",
      "2560 × 1440",
      "3440 × 1440",
      "3840 × 2160",
      "5120 × 2160",
      "Custom…",
    ]);
    await userEvent.selectOptions(minField(), "3440x1440");
    expect(draft()?.minResolution).toEqual({ width: 3440, height: 1440 });
  });

  it("takes a Custom size only when it is inside the limits", async () => {
    seedThree();
    show("w3");
    await userEvent.selectOptions(minField(), "custom");
    const w = screen.getByRole("spinbutton", { name: "Minimum width" });
    const h = screen.getByRole("spinbutton", { name: "Minimum height" });
    await userEvent.clear(w);
    await userEvent.type(w, "5120");
    await userEvent.clear(h);
    await userEvent.type(h, "1440");
    expect(draft()?.minResolution).toEqual({ width: 5120, height: 1440 });
    await userEvent.clear(h);
    await userEvent.type(h, "100");
    expect(h).toHaveAttribute("aria-invalid", "true");
    expect(draft()?.minResolution).toEqual({ width: 5120, height: 1440 });
  });

  it("saves the minimum and the launch mark with Save, and stays open", async () => {
    seedThree();
    const { onClose } = show("w3");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(minField(), "3840x2160");
    await userEvent.click(launchBox());
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(onDisk("w3")).toMatchObject({ minResolution: { width: 3840, height: 2160 }, openAtLaunch: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(useWorkspacesStore.getState().activeWorkspaceId).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
    expect(cardFor("Research")).toHaveAccessibleName("Research, at least 3840 × 2160, Zoom 50%");
  });

  it("switches cards straight away when nothing is edited", async () => {
    seedThree();
    show("w1");
    await userEvent.click(cardFor("Research"));
    expect(nameField().value).toBe("Research");
    expect(draft()?.id).toBe("w3");
    expect(screen.queryByText(/before switching\?/)).not.toBeInTheDocument();
  });

  it("asks before switching away from edits; Discard drops them", async () => {
    seedThree();
    show("w1");
    await userEvent.type(nameField(), " edited");
    expect(cardFor("Desk edited")).toHaveAccessibleName(/unsaved$/);
    await userEvent.click(cardFor("Research"));
    expect(screen.getByText('Save changes to "Desk edited" before switching?')).toBeInTheDocument();
    expect(draft()?.id).toBe("w1");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(draft()?.id).toBe("w3");
    expect(useWorkspacesStore.getState().workspaces[0].name).toBe("Desk");
    expect(__read("workspaces/w1.json")).toBeUndefined();
  });

  it("asks before switching away from edits; Save writes them, then switches", async () => {
    seedThree();
    show("w1");
    await userEvent.type(nameField(), " edited");
    await userEvent.click(cardFor("Research"));
    const bar = screen.getByRole("alert");
    await userEvent.click(within(bar).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(draft()?.id).toBe("w3"));
    expect(onDisk("w1").name).toBe("Desk edited");
  });

  it("starts a new workspace from + New workspace, shown as its own card", async () => {
    seedThree();
    show("w1");
    await userEvent.click(rail().getByRole("button", { name: "+ New workspace" }));
    expect(draft()?.id).toBeNull();
    expect(nameField().value).toBe("Untitled");
    expect(cardFor("Untitled")).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("Delete asks, removes the workspace and moves to the next one", async () => {
    seedThree();
    vi.mocked(confirm).mockResolvedValue(true);
    show("w1");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith('Delete the workspace "Desk"? Its dashboards are not deleted.', expect.anything());
    await waitFor(() => expect(useWorkspacesStore.getState().workspaces.map((w) => w.id)).toEqual(["w2", "w3"]));
    await waitFor(() => expect(draft()?.id).toBe("w2"));
  });

  it("Delete does nothing when the question is declined", async () => {
    seedThree();
    vi.mocked(confirm).mockResolvedValue(false);
    show("w1");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(useWorkspacesStore.getState().workspaces).toHaveLength(3);
  });

  it("moves the Launch chip as the launch rule would, live from the draft", async () => {
    seedThree();
    setScreen(3840, 2160);
    show("w3");
    expect(cardFor("Trading 4K")).toHaveAccessibleName(/opens at launch$/);
    await userEvent.click(launchBox());
    await userEvent.selectOptions(minField(), "5120x2160");
    // 5120 is wider than this screen, so it does not fit: Trading 4K keeps it.
    expect(cardFor("Trading 4K")).toHaveAccessibleName(/opens at launch$/);
    await userEvent.selectOptions(minField(), "3840x2160");
    // A full tie: rail order keeps Trading 4K ahead of Research.
    expect(cardFor("Trading 4K")).toHaveAccessibleName(/opens at launch$/);
  });
});
