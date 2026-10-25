// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __failPath, __read, __reset, __writes } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import type { Workspace } from "../lib/workspacesFile";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { WorkspaceArrangeBar } from "./WorkspaceArrangeBar";

// Replace asks through the native dialog -- WKWebView has no window.confirm
// -- so the plugin's IPC call is what gets mocked, as LeftRail.test does.
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));

const dashboard = (id: string, name: string) => ({ id, name, tabs: [{ id: `t-${id}`, name: "Main", cards: [] }] });

const TRADING: Workspace = {
  id: "w1",
  name: "Trading",
  preset: "laptop",
  slots: [
    { slot: "a", dashboardId: "d1" },
    { slot: "b", dashboardId: "d2" },
  ],
};

beforeEach(() => {
  __reset();
  __resetJsonStoreForTests();
  __resetLoggerForTests();
  useDashboardStore.setState({
    viewer: false,
    dashboards: [dashboard("d1", "Alpha"), dashboard("d2", "Beta")],
    maximizedCardId: null,
  });
  useWorkspacesStore.setState({
    workspaces: [TRADING],
    activeWorkspaceId: null,
    previousWorkspaceId: null,
    focusedSlot: null,
    draft: null,
    arrangingId: null,
    layouts: [],
  });
  vi.mocked(confirm).mockReset();
});

/** Arrange mode on w1 (or `over` laid over it first), and the bar rendered. */
function arrange(over: Partial<Workspace> = {}) {
  useWorkspacesStore.setState({ workspaces: [{ ...TRADING, ...over }] });
  useWorkspacesStore.getState().startArranging("w1");
  render(<WorkspaceArrangeBar workspaceId="w1" />);
}

const store = () => useWorkspacesStore.getState();
const addTile = () => screen.getByRole("button", { name: "Add tile" });
const onDisk = () => JSON.parse(__read("workspaces/w1.json") ?? "null");
const workspaceWrites = () => __writes().filter((path) => path.startsWith("workspaces/")).length;

describe("WorkspaceArrangeBar", () => {
  it("is a toolbar named for the workspace, with Add tile, Cancel and Done", () => {
    arrange();
    const bar = screen.getByRole("toolbar", { name: "Arranging Trading" });
    expect(bar).toHaveTextContent("Trading");
    expect(addTile()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("Done writes the draft and ends Arrange mode", async () => {
    arrange();
    act(() => store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }, { slot: "b", x: 6, y: 0, w: 6, h: 12 }] }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(store().arrangingId).toBeNull());
    expect(onDisk().layout).toEqual([
      { slot: "a", x: 0, y: 0, w: 4, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ]);
    expect(store().draft).toBeNull();
  });

  // Review Focus 2.
  it("Done twice writes once", async () => {
    arrange();
    const done = screen.getByRole("button", { name: "Done" });
    fireEvent.click(done);
    fireEvent.click(done);
    await waitFor(() => expect(store().arrangingId).toBeNull());
    expect(workspaceWrites()).toBe(1);
    expect(screen.queryByText(/^Could not save/)).not.toBeInTheDocument();
  });

  // Both clicks land before React re-renders, so the button is not yet
  // disabled for the second: only the ref stops it.
  it("Done twice in one render writes once", async () => {
    arrange();
    const done = screen.getByRole("button", { name: "Done" });
    act(() => {
      fireEvent.click(done);
      fireEvent.click(done);
    });
    await waitFor(() => expect(store().arrangingId).toBeNull());
    expect(workspaceWrites()).toBe(1);
  });

  it("says Could not save and stays in Arrange mode with the draft intact when the write fails", async () => {
    arrange();
    act(() => store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 12, h: 12 }] }));
    // saveJson mkdirs the directory first, so failing it fails every workspace write.
    __failPath("workspaces");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText(/^Could not save: /)).toBeInTheDocument();
    expect(store().arrangingId).toBe("w1");
    expect(store().draft?.layout).toEqual([{ slot: "a", x: 0, y: 0, w: 12, h: 12 }]);
  });

  // Known failures answer { ok: false }; only an unexpected throw rejects,
  // and that must not leave Done disabled for good.
  it("says Could not save and lets Done be pressed again when the commit rejects", async () => {
    const real = store().commitDraft;
    try {
      useWorkspacesStore.setState({ commitDraft: () => Promise.reject(new Error("boom")) });
      arrange();
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(await screen.findByText("Could not save: boom")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
      expect(store().arrangingId).toBe("w1");
    } finally {
      useWorkspacesStore.setState({ commitDraft: real });
    }
  });

  it("Cancel discards the draft, writing nothing", () => {
    arrange();
    act(() => store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 12, h: 12 }] }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store().arrangingId).toBeNull();
    expect(store().draft).toBeNull();
    expect(workspaceWrites()).toBe(0);
  });

  it("Escape is Cancel", () => {
    arrange();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(store().arrangingId).toBeNull();
    expect(store().draft).toBeNull();
  });

  it("Escape in a text field, or mid-composition, leaves Arrange mode on", () => {
    arrange();
    const field = document.createElement("input");
    document.body.append(field);
    try {
      field.focus();
      fireEvent.keyDown(field, { key: "Escape" });
      expect(store().arrangingId).toBe("w1");
      fireEvent.keyDown(document.body, { key: "Escape", isComposing: true });
      expect(store().arrangingId).toBe("w1");
      // From the body it is still Cancel.
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(store().arrangingId).toBeNull();
    } finally {
      field.remove();
    }
  });

  // Review Focus 4.
  it("restores a maximized card on entering, since its tile is about to be covered", () => {
    useDashboardStore.setState({ maximizedCardId: "c1" });
    arrange();
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });
});

describe("the hidden note", () => {
  it("is absent when every dashboard is shown", () => {
    arrange();
    expect(screen.queryByText(/not shown in this layout/)).not.toBeInTheDocument();
  });

  it("counts the dashboards the arrangement does not show, singular for one, ignoring a deleted one", () => {
    arrange({
      preset: "full-screen",
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
        { slot: "c", dashboardId: "gone" },
      ],
    });
    expect(screen.getByText("1 dashboard not shown in this layout")).toBeInTheDocument();
  });

  it("uses the plural for more than one", () => {
    useDashboardStore.setState({ dashboards: [dashboard("d1", "Alpha"), dashboard("d2", "Beta"), dashboard("d3", "Gamma")] });
    arrange({
      preset: "full-screen",
      slots: [
        { slot: "a", dashboardId: "d1" },
        { slot: "b", dashboardId: "d2" },
        { slot: "c", dashboardId: "d3" },
      ],
    });
    expect(screen.getByText("2 dashboards not shown in this layout")).toBeInTheDocument();
  });
});

describe("Add tile", () => {
  it("is disabled, with its title, when there is no free 2 × 2 space", () => {
    arrange();
    expect(addTile()).toBeDisabled();
    expect(addTile()).toHaveAttribute("title", "No room. Shrink a tile first.");
  });

  it("puts an empty tile in the largest free rectangle, under the first free slot id", () => {
    arrange();
    act(() => store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }, { slot: "b", x: 6, y: 0, w: 6, h: 12 }] }));
    fireEvent.click(addTile());
    expect(store().draft?.layout).toEqual([
      { slot: "a", x: 0, y: 0, w: 4, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
      { slot: "c", x: 4, y: 0, w: 2, h: 12 },
    ]);
    expect(store().draft?.slots.some((s) => s.slot === "c")).toBe(false);
  });

  it("takes the first hidden dashboard's slot id, so that dashboard shows", () => {
    arrange({ layout: [{ slot: "a", x: 0, y: 0, w: 6, h: 12 }] });
    expect(screen.getByText("1 dashboard not shown in this layout")).toBeInTheDocument();
    fireEvent.click(addTile());
    expect(store().draft?.layout).toEqual([
      { slot: "a", x: 0, y: 0, w: 6, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ]);
    expect(screen.queryByText(/not shown in this layout/)).not.toBeInTheDocument();
  });

  it("is disabled, with no title, when every id a–z is taken and nothing is hidden", () => {
    arrange({
      layout: [{ slot: "a", x: 0, y: 0, w: 6, h: 12 }],
      slots: "abcdefghijklmnopqrstuvwxyz".split("").map((slot) => ({ slot, dashboardId: "gone" })),
    });
    expect(addTile()).toBeDisabled();
    expect(addTile()).not.toHaveAttribute("title");
  });
});
describe("Save layout as…", () => {
  const nameField = () => screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
  const saveDialog = () => screen.queryByRole("dialog", { name: "Save layout" });

  it("asks for a name, pre-filled with the next free Untitled layout, and saves the draft's tiles without slot ids", async () => {
    arrange();
    act(() => store().stageDraft({ layout: [{ slot: "a", x: 0, y: 0, w: 4, h: 12 }, { slot: "b", x: 6, y: 0, w: 6, h: 12 }] }));
    await userEvent.click(screen.getByRole("button", { name: "Save layout as…" }));
    expect(nameField().value).toBe("Untitled layout");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveDialog()).toBeNull());
    expect(store().layouts).toEqual([
      { id: expect.any(String), name: "Untitled layout", tiles: [{ x: 0, y: 0, w: 4, h: 12 }, { x: 6, y: 0, w: 6, h: 12 }] },
    ]);
    // Saving a layout is not Done: the mode and its draft stay.
    expect(store().arrangingId).toBe("w1");
  });

  it("cannot save an empty name", async () => {
    arrange();
    await userEvent.click(screen.getByRole("button", { name: "Save layout as…" }));
    await userEvent.clear(nameField());
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("asks before replacing a taken name, in any case; declining returns to the name field and writes nothing", async () => {
    await act(() => store().saveLayout("Narrow", [{ x: 0, y: 0, w: 12, h: 12 }]));
    vi.mocked(confirm).mockResolvedValue(false);
    arrange();
    await userEvent.click(screen.getByRole("button", { name: "Save layout as…" }));
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "narrow{Enter}");

    expect(confirm).toHaveBeenCalledWith('Replace the layout "narrow"?', expect.objectContaining({ okLabel: "Replace" }));
    expect(saveDialog()).not.toBeNull();
    await waitFor(() => expect(nameField()).toHaveFocus());
    expect(store().layouts.map((l) => l.name)).toEqual(["Narrow"]);
  });

  it("refuses a preset's name, in any case, without asking to replace: the line shows and nothing is written", async () => {
    // A layout already on disk under the preset's name must not turn this into a Replace.
    useWorkspacesStore.setState({ layouts: [{ id: "old", name: "Laptop", tiles: [{ x: 0, y: 0, w: 12, h: 12 }] }] });
    arrange();
    await userEvent.click(screen.getByRole("button", { name: "Save layout as…" }));
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "laptop{Enter}");

    expect(
      await screen.findByText('Could not save: "Laptop" is a built-in layout. Choose another name.'),
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(saveDialog()).not.toBeNull();
    expect(store().layouts).toEqual([{ id: "old", name: "Laptop", tiles: [{ x: 0, y: 0, w: 12, h: 12 }] }]);
    expect(__writes().filter((w) => w.startsWith("layouts/"))).toEqual([]);
  });

  it("replaces when the answer is yes", async () => {
    await act(() => store().saveLayout("Narrow", [{ x: 0, y: 0, w: 12, h: 12 }]));
    const id = store().layouts[0].id;
    vi.mocked(confirm).mockResolvedValue(true);
    arrange();
    await userEvent.click(screen.getByRole("button", { name: "Save layout as…" }));
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), "Narrow{Enter}");
    await waitFor(() => expect(saveDialog()).toBeNull());
    expect(store().layouts).toEqual([
      { id, name: "Narrow", tiles: [{ x: 0, y: 0, w: 6, h: 12 }, { x: 6, y: 0, w: 6, h: 12 }] },
    ]);
  });

  // Review Focus 4.
  it("Escape closes the Save layout dialog and leaves Arrange mode on", async () => {
    arrange();
    await userEvent.click(screen.getByRole("button", { name: "Save layout as…" }));
    await userEvent.keyboard("{Escape}");
    expect(saveDialog()).toBeNull();
    expect(store().arrangingId).toBe("w1");
    expect(store().draft).not.toBeNull();
  });

  it("says Could not save in the dialog, which stays open, when the write fails", async () => {
    arrange();
    __failPath("layouts");
    await userEvent.click(screen.getByRole("button", { name: "Save layout as…" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/^Could not save: /)).toBeInTheDocument();
    expect(saveDialog()).not.toBeNull();
  });
});
