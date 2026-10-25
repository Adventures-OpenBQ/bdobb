// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { WorkspaceGrid, settleDrag, settleGesture } from "./WorkspaceGrid";
import { DASHBOARD_REORDER_DRAG_TYPE } from "../lib/dragDrop";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWorkspacesStore } from "../stores/workspacesStore";

beforeEach(() => {
  useDashboardStore.setState({
    dashboards: [
      { id: "da", name: "Alpha", tabs: [{ id: "ta", name: "Alpha tab", cards: [] }] },
      { id: "db", name: "Beta", tabs: [{ id: "tb", name: "Beta tab", cards: [] }] },
    ],
    activeId: "da",
    activeTabIds: { da: "ta", db: "tb" },
    viewer: false,
  });
  useWorkspacesStore.setState({
    workspaces: [
      {
        id: "w1",
        name: "Trading",
        preset: "laptop",
        slots: [
          { slot: "a", dashboardId: "da" },
          { slot: "b", dashboardId: "db" },
        ],
      },
    ],
    activeWorkspaceId: "w1",
    previousWorkspaceId: null,
    focusedSlot: null,
    draft: null,
    arrangingId: null,
  });
});

describe("WorkspaceGrid", () => {
  it("lays the preset's tiles out on react-grid-layout, one grid item per tile", () => {
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    const items = container.querySelectorAll(".workspace-grid > .react-grid-layout > .react-grid-item");
    expect(items).toHaveLength(2);
    expect(items[0]).toContainElement(screen.getByTestId("workspace-tile-a"));
    expect(items[1]).toContainElement(screen.getByTestId("workspace-tile-b"));
  });

  it("draws a workspace's own layout instead of its preset's", () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          ...useWorkspacesStore.getState().workspaces[0],
          layout: [
            { slot: "a", x: 0, y: 0, w: 4, h: 12 },
            { slot: "b", x: 4, y: 0, w: 4, h: 12 },
            { slot: "c", x: 8, y: 0, w: 4, h: 12 },
          ],
        },
      ],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(screen.getByTestId("workspace-tile-c")).toHaveTextContent(/drag a dashboard here/i);
  });

  it("renders both dashboards at once, each with its own tab bar", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(screen.getByRole("tab", { name: "Alpha tab" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Beta tab" })).toBeInTheDocument();
  });

  it("moves focus to the tile the mouse enters", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("workspace-tile-b"));
    expect(useDashboardStore.getState().activeId).toBe("db");
  });

  it("marks the focused tile, so the target of ⌘K is visible", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("workspace-tile-b"));
    expect(screen.getByTestId("workspace-tile-b")).toHaveAttribute("data-focused", "true");
    expect(screen.getByTestId("workspace-tile-a")).not.toHaveAttribute("data-focused");
  });

  // Finding 1: a native file drag suppresses mouse events for its duration,
  // so onMouseEnter never fires while the user drags a file over a tile
  // other than the one already focused -- dragenter is the one event such a
  // drag still fires, so it has to take over the focus-follows-mouse job for
  // this one gesture, or the eventual drop (DropZone's single <main> wraps
  // the whole grid) always lands on whichever dashboard was focused before
  // the drag started, regardless of which tile it was dropped on.
  it("moves focus to the tile a file drag enters, even though the mouse never crossed into it", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(useDashboardStore.getState().activeId).toBe("da");

    fireEvent.dragEnter(screen.getByTestId("workspace-tile-b"), {
      dataTransfer: { types: ["Files"] },
    });

    expect(useDashboardStore.getState().activeId).toBe("db");
    expect(useWorkspacesStore.getState().focusedSlot).toBe("b");
  });

  it("ignores a dragenter that does not carry files, so the dashboard-reorder drag is untouched", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);

    fireEvent.dragEnter(screen.getByTestId("workspace-tile-b"), {
      dataTransfer: { types: [DASHBOARD_REORDER_DRAG_TYPE] },
    });

    expect(useDashboardStore.getState().activeId).toBe("da");
    expect(useWorkspacesStore.getState().focusedSlot).toBeNull();
  });

  it("records the slot the mouse enters, alongside the dashboard focus, for a filled tile", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("workspace-tile-b"));
    expect(useWorkspacesStore.getState().focusedSlot).toBe("b");
    expect(useDashboardStore.getState().activeId).toBe("db");
  });

  it("records the slot the mouse enters for an EMPTY tile too, but leaves the dashboard focus alone — Task 12b", () => {
    useWorkspacesStore.setState({
      workspaces: [
        { id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "a", dashboardId: "da" }] },
      ],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    fireEvent.mouseEnter(screen.getByTestId("workspace-tile-b"));
    expect(useWorkspacesStore.getState().focusedSlot).toBe("b");
    // No dashboard sits in slot b, so there is nothing for the dashboard
    // focus to move to — the active dashboard stays whatever it was.
    expect(useDashboardStore.getState().activeId).toBe("da");
  });

  it("shows a placeholder for an empty slot", () => {
    useWorkspacesStore.setState({
      workspaces: [
        { id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "a", dashboardId: "da" }] },
      ],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(screen.getByText(/drag a dashboard here/i)).toBeInTheDocument();
  });

  it("treats a slot naming a dashboard that no longer exists as empty", () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          id: "w1",
          name: "Trading",
          preset: "laptop",
          slots: [
            { slot: "a", dashboardId: "da" },
            { slot: "b", dashboardId: "gone" },
          ],
        },
      ],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    // No crash, and the slot offers itself rather than rendering an empty grid.
    expect(screen.getByText(/drag a dashboard here/i)).toBeInTheDocument();
  });

  it("renders no tile for a slot the arrangement has no tile for", () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          id: "w1",
          name: "Trading",
          preset: "full-screen",
          slots: [
            { slot: "a", dashboardId: "da" },
            { slot: "b", dashboardId: "db" },
          ],
        },
      ],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(screen.getByRole("tab", { name: "Alpha tab" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Beta tab" })).not.toBeInTheDocument();
  });

  // Review Focus 2: Done's second click of a double click lands here once the
  // Arrange bar has unmounted and the tiles have moved up.
  it("the ✕ ignores the second click of a double click, and answers a single one", () => {
    const original = useWorkspacesStore.getState().clearSlot;
    const clearSlot = vi.fn(() => Promise.resolve());
    useWorkspacesStore.setState({ clearSlot });
    try {
      render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
      const clear = screen.getByRole("button", { name: "Clear Alpha from this slot" });
      fireEvent.click(clear, { detail: 2 });
      expect(clearSlot).not.toHaveBeenCalled();
      fireEvent.click(clear, { detail: 1 });
      expect(clearSlot).toHaveBeenCalledWith("w1", "a");
    } finally {
      useWorkspacesStore.setState({ clearSlot: original });
    }
  });
});

// Spec 2026-10-01 §3: Arrange mode's draft shows on the grid when it is for
// the workspace on screen. Rendering with a draft at all also pins the
// zustand trap -- a selector that allocated the overlaid workspace on every
// read would re-render forever and throw here.
describe("Arrange mode's draft", () => {
  /** The slot ids of the tiles on screen, in DOM order. */
  const tileIds = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-testid^="workspace-tile-"]')].map((el) =>
      el.getAttribute("data-testid")!.replace("workspace-tile-", ""),
    );

  it("re-tiles to the draft of the workspace on screen, and reverts when Arrange mode ends", () => {
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    act(() => {
      useWorkspacesStore.getState().beginDraft("w1");
      useWorkspacesStore.getState().stageDraft({
        layout: [{ slot: "a", x: 0, y: 0, w: 12, h: 12 }],
        slots: [{ slot: "a", dashboardId: "db" }],
      });
    });
    expect(tileIds(container)).toEqual(["a"]);
    expect(screen.getByRole("tab", { name: "Beta tab" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Alpha tab" })).not.toBeInTheDocument();

    act(() => useWorkspacesStore.getState().endArranging());
    expect(tileIds(container)).toEqual(["a", "b"]);
    expect(screen.getByRole("tab", { name: "Alpha tab" })).toBeInTheDocument();
  });

  it("ignores a draft for another saved workspace", () => {
    useWorkspacesStore.setState({
      workspaces: [
        ...useWorkspacesStore.getState().workspaces,
        { id: "w2", name: "Research", preset: "full-screen", slots: [{ slot: "a", dashboardId: "db" }] },
      ],
    });
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    act(() => {
      useWorkspacesStore.getState().beginDraft("w2");
      useWorkspacesStore.getState().stageDraft({ slots: [] });
    });
    expect(tileIds(container)).toEqual(["a", "b"]);
    expect(screen.getByRole("tab", { name: "Alpha tab" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Beta tab" })).toBeInTheDocument();
  });
});

// Spec 2026-09-30 §1 "Live preview": the workspace dialog's draft shows on the
// real grid when it is for the workspace on screen -- preset and all -- and
// Cancel's discard puts it back.
describe("the workspace dialog's draft", () => {
  /** The slot ids of the tiles on screen, in DOM order. */
  const tileIds = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-testid^="workspace-tile-"]')].map((el) =>
      el.getAttribute("data-testid")!.replace("workspace-tile-", ""),
    );

  it("re-tiles to the draft while the active workspace is being edited, and reverts on discard", () => {
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);

    act(() => {
      useWorkspacesStore.getState().beginDraft("w1");
      useWorkspacesStore.getState().stageDraft({ preset: "full-screen", slots: [{ slot: "a", dashboardId: "db" }] });
    });
    expect(tileIds(container)).toEqual(["a"]);
    expect(screen.getByRole("tab", { name: "Beta tab" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Alpha tab" })).not.toBeInTheDocument();

    act(() => useWorkspacesStore.getState().discardDraft());
    expect(tileIds(container)).toEqual(["a", "b"]);
    expect(screen.getByRole("tab", { name: "Alpha tab" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Beta tab" })).toBeInTheDocument();
  });

  it("ignores a draft for a workspace that is not this one", () => {
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    act(() => {
      useWorkspacesStore.getState().beginDraft(null, "Untitled");
      useWorkspacesStore.getState().stageDraft({ preset: "full-screen" });
    });
    expect(tileIds(container)).toEqual(["a", "b"]);
    expect(screen.getByRole("tab", { name: "Alpha tab" })).toBeInTheDocument();
  });
});

// Spec 2026-09-30 "Tile names": showTileNames decides whether a filled tile
// draws its title line; hidden, the ✕ rides at the end of the tab bar.
describe("tile names", () => {
  function hideNames() {
    const [workspace] = useWorkspacesStore.getState().workspaces;
    useWorkspacesStore.setState({ workspaces: [{ ...workspace, showTileNames: false }] });
  }

  it("draws each filled tile's header line when the file has no showTileNames, as before", () => {
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(container.querySelectorAll(".workspace-tile-header")).toHaveLength(2);
    expect(within(screen.getByTestId("workspace-tile-a")).getByText("Alpha")).toHaveClass("workspace-tile-name");
  });

  it("hidden: no header line and no name, and the ✕ is the last item of the tile's tab bar", () => {
    hideNames();
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(container.querySelector(".workspace-tile-header")).toBeNull();
    const tile = screen.getByTestId("workspace-tile-a");
    // "Alpha tab" is the tab's own label; the bare name must be gone.
    expect(within(tile).queryByText("Alpha")).not.toBeInTheDocument();
    const clear = within(tile).getByRole("button", { name: "Clear Alpha from this slot" });
    // The tab bar is the tablist's parent: since v3.0.7 the tablist holds the tabs only.
    expect(within(tile).getByRole("tablist").parentElement!.lastElementChild).toBe(clear);
  });

  it("hidden: the trailing ✕ still clears the tile", async () => {
    hideNames();
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear Alpha from this slot" }));
    await waitFor(() =>
      expect(useWorkspacesStore.getState().workspaces[0].slots).toEqual([{ slot: "b", dashboardId: "db" }]),
    );
  });

  it("hidden: a dashboard with no tabs still carries the ✕, through DashboardGrid's other tab bar", () => {
    useDashboardStore.setState({
      dashboards: [...useDashboardStore.getState().dashboards, { id: "dz", name: "Zero", tabs: [] }],
    });
    useWorkspacesStore.setState({
      workspaces: [
        { id: "w1", name: "Trading", preset: "full-screen", slots: [{ slot: "a", dashboardId: "dz" }], showTileNames: false },
      ],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    const tile = screen.getByTestId("workspace-tile-a");
    expect(within(tile).getByRole("tablist").parentElement!.lastElementChild).toBe(
      within(tile).getByRole("button", { name: "Clear Zero from this slot" }),
    );
  });

  it("follows the dialog's draft, so the title lines come and go with its checkbox", () => {
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    act(() => {
      useWorkspacesStore.getState().beginDraft("w1");
      useWorkspacesStore.getState().stageDraft({ showTileNames: false });
    });
    expect(container.querySelector(".workspace-tile-header")).toBeNull();
    act(() => useWorkspacesStore.getState().discardDraft());
    expect(container.querySelectorAll(".workspace-tile-header")).toHaveLength(2);
  });
});

// Spec 2026-10-01 §3 and §5: Arrange mode on the grid.
describe("arranging", () => {
  const arrange = () => act(() => useWorkspacesStore.getState().startArranging("w1"));
  const cover = (slot: string) =>
    screen.getByTestId(`workspace-tile-${slot}`).querySelector(".workspace-arrange-cover") as HTMLElement | null;

  it("covers each tile with its letter and its dashboard's name while arranging, and only then", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(cover("a")).toBeNull();
    arrange();
    expect(cover("a")).toHaveTextContent("AAlpha");
    expect(cover("b")).toHaveTextContent("BBeta");
    // The dashboard underneath stays mounted: only covered.
    expect(screen.getByRole("tab", { name: "Alpha tab" })).toBeInTheDocument();
  });

  it("puts the covered dashboard out of reach of the keyboard while arranging, and only then", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    const clear = () => screen.getByRole("button", { name: "Clear Alpha from this slot" });
    expect(clear().closest("[inert]")).toBeNull();
    arrange();
    // The face covers the pointer; inert is what covers Tab. The face's own
    // remove button sits outside it, so it still works.
    expect(clear().closest("[inert]")).not.toBeNull();
    expect(within(cover("a") as HTMLElement).getByRole("button", { name: "Remove tile A" }).closest("[inert]")).toBeNull();
  });

  it("shows the bar above the tiles while arranging, and only then", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(screen.queryByRole("toolbar", { name: /^Arranging/ })).not.toBeInTheDocument();
    arrange();
    expect(screen.getByRole("toolbar", { name: "Arranging Trading" })).toBeInTheDocument();
  });

  it("marks the area as arranging, for the drawn grid", () => {
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(container.querySelector(".workspace-grid")).not.toHaveAttribute("data-arranging");
    arrange();
    expect(container.querySelector(".workspace-grid")).toHaveAttribute("data-arranging", "true");
  });

  it("says Empty on a tile with no dashboard", () => {
    useWorkspacesStore.setState({
      workspaces: [{ ...useWorkspacesStore.getState().workspaces[0], slots: [{ slot: "a", dashboardId: "da" }] }],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    arrange();
    expect(cover("b")).toHaveTextContent("BEmpty");
  });

  it("letters follow reading order, not slot ids", () => {
    useWorkspacesStore.setState({
      workspaces: [
        {
          ...useWorkspacesStore.getState().workspaces[0],
          layout: [
            { slot: "b", x: 0, y: 0, w: 6, h: 12 },
            { slot: "a", x: 6, y: 0, w: 6, h: 12 },
          ],
        },
      ],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    arrange();
    expect(cover("b")).toHaveTextContent(/^A/);
    expect(cover("a")).toHaveTextContent(/^B/);
  });

  it("the ✕ removes a tile and its slot entry from the draft, never the dashboard", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    arrange();
    fireEvent.click(screen.getByRole("button", { name: "Remove tile B" }));
    const draft = useWorkspacesStore.getState().draft!;
    expect(draft.layout).toEqual([{ slot: "a", x: 0, y: 0, w: 6, h: 12 }]);
    expect(draft.slots).toEqual([{ slot: "a", dashboardId: "da" }]);
    expect(screen.queryByTestId("workspace-tile-b")).not.toBeInTheDocument();
    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["da", "db"]);
  });

  it("offers no ✕ on the last tile", () => {
    useWorkspacesStore.setState({
      workspaces: [{ ...useWorkspacesStore.getState().workspaces[0], preset: "full-screen" }],
    });
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    arrange();
    expect(screen.queryByRole("button", { name: /^Remove tile/ })).not.toBeInTheDocument();
  });

  // Review Focus 3: tiles render in the arrangement's own order, so a move
  // that changes reading order never reorders -- or remounts -- a tile.
  it("keeps every tile's element when a move changes reading order", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    arrange();
    const before = screen.getByTestId("workspace-tile-a");
    act(() =>
      useWorkspacesStore.getState().stageDraft({
        layout: [
          { slot: "a", x: 6, y: 0, w: 6, h: 12 },
          { slot: "b", x: 0, y: 0, w: 6, h: 12 },
        ],
      }),
    );
    expect(screen.getByTestId("workspace-tile-a")).toBe(before);
    expect(cover("b")).toHaveTextContent(/^A/);
  });

  // The jsdom area measures 0 × 0, smaller than the grid's own gaps: the row
  // height must clamp at 0 rather than go negative.
  it("renders in an area too small for its gaps", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(screen.getAllByTestId(/^workspace-tile-/)).toHaveLength(2);
  });
});

// A tile can move without changing size (a preset picked from the rail puts a
// moved tile back where it was), which no ResizeObserver sees. WorkspaceTile's
// maximize insets must follow it: the effect's `rect` dependency is the only
// thing that re-measures. jsdom has no ResizeObserver, so measure() runs on
// every effect run, which is what this pins.
describe("a maximized card's insets", () => {
  it("follow a tile that moves without changing size", () => {
    const withLayout = (ax: number) =>
      useWorkspacesStore.setState({
        workspaces: [
          {
            ...useWorkspacesStore.getState().workspaces[0],
            layout: [
              { slot: "a", x: ax, y: 0, w: 4, h: 12 },
              { slot: "b", x: 8, y: 0, w: 4, h: 12 },
            ],
          },
        ],
      });
    withLayout(0);
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    const tile = screen.getByTestId("workspace-tile-a");
    // Where the tile "is" on screen, read by measure() each time it runs.
    let left = 100;
    tile.getBoundingClientRect = () => ({ left, top: 0, right: left + 300, bottom: 600, width: 300, height: 600, x: left, y: 0, toJSON() {} });

    // Same w and h; only x changes. The mount's measurement predates the stub.
    act(() => withLayout(2));
    expect(tile.style.getPropertyValue("--tile-left")).toBe("100px");
    left = 300;
    act(() => withLayout(4));
    expect(tile.style.getPropertyValue("--tile-left")).toBe("300px");
  });

  // Review Focus 4: hiding the title line moves the tab bar up without
  // resizing the tile or the bar, which no ResizeObserver sees; `showName`
  // in the effect's dependencies is the only thing that re-measures. jsdom has
  // no ResizeObserver, so measure() runs on every effect run.
  it("follow the tab bar when the tile names are hidden", () => {
    render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    const tile = screen.getByTestId("workspace-tile-a");
    const bar = tile.querySelector(".tab-bar") as HTMLElement;
    // Where the bar's bottom "is", read by measure() each time it runs. The
    // mount's measurement predates the stub.
    let bottom = 60;
    bar.getBoundingClientRect = () => ({ left: 0, top: bottom - 30, right: 300, bottom, width: 300, height: 30, x: 0, y: bottom - 30, toJSON() {} });

    act(() => {
      const [workspace] = useWorkspacesStore.getState().workspaces;
      useWorkspacesStore.setState({ workspaces: [{ ...workspace, showTileNames: false }] });
    });
    expect(tile.style.getPropertyValue("--tile-top")).toBe("60px");

    bottom = 90;
    act(() => {
      const [workspace] = useWorkspacesStore.getState().workspaces;
      useWorkspacesStore.setState({ workspaces: [{ ...workspace, showTileNames: true }] });
    });
    expect(tile.style.getPropertyValue("--tile-top")).toBe("90px");
  });
});

describe("settleGesture", () => {
  const LAPTOP = [
    { slot: "a", x: 0, y: 0, w: 6, h: 12 },
    { slot: "b", x: 6, y: 0, w: 6, h: 12 },
  ];
  const item = (i: string, x: number, y: number, w: number, h: number) => ({ i, x, y, w, h });

  it("is unchanged for a press that moved nothing", () => {
    expect(settleGesture(LAPTOP, [item("a", 0, 0, 6, 12), item("b", 6, 0, 6, 12)])).toBe("unchanged");
  });

  it("is the new arrangement when it is one", () => {
    expect(settleGesture(LAPTOP, [item("a", 0, 0, 4, 12), item("b", 6, 0, 6, 12)])).toEqual([
      { slot: "a", x: 0, y: 0, w: 4, h: 12 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ]);
  });

  it("is refused when a pushed tile has left the grid", () => {
    // a grown to 8 wide pushed b down by its own height, off the bottom.
    expect(settleGesture(LAPTOP, [item("a", 0, 0, 8, 12), item("b", 6, 12, 6, 12)])).toBe("refused");
  });
});

// Spec 2026-10-01 §3 "Swapping", as the grid applies it when a MOVE ends (a
// resize goes through settleGesture alone and never swaps). jsdom cannot
// drive react-draggable -- GridItem's onDragStart returns early with no
// offsetParent -- so the drag itself is end to end (Task 13); this pins the
// decision the grid takes once it has the centre.
describe("settleDrag", () => {
  const LAPTOP = [
    { slot: "a", x: 0, y: 0, w: 6, h: 12 },
    { slot: "b", x: 6, y: 0, w: 6, h: 12 },
  ];
  // a 4 wide and 6 tall at the top left; b the right half; the rest free.
  const ROOMY = [
    { slot: "a", x: 0, y: 0, w: 4, h: 6 },
    { slot: "b", x: 6, y: 0, w: 6, h: 12 },
  ];
  const item = (i: string, x: number, y: number, w: number, h: number) => ({ i, x, y, w, h });

  it("swaps when the centre lands in another tile, whatever the library pushed meanwhile", () => {
    // The library's own result: b pushed down off the grid by a's arrival.
    const pushed = [item("a", 6, 0, 6, 12), item("b", 6, 12, 6, 12)];
    expect(settleDrag(LAPTOP, pushed, "a", { x: 9, y: 6 })).toEqual([
      { slot: "a", x: 6, y: 0, w: 6, h: 12 },
      { slot: "b", x: 0, y: 0, w: 6, h: 12 },
    ]);
  });

  it("is an ordinary move when the centre lands in free space", () => {
    const moved = [item("a", 0, 6, 4, 6), item("b", 6, 0, 6, 12)];
    expect(settleDrag(ROOMY, moved, "a", { x: 2, y: 9 })).toEqual([
      { slot: "a", x: 0, y: 6, w: 4, h: 6 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ]);
  });

  it("is refused when the centre lands in free space and the library pushed a tile off the grid", () => {
    const pushed = [item("a", 3, 0, 4, 6), item("b", 6, 12, 6, 12)];
    expect(settleDrag(ROOMY, pushed, "a", { x: 5, y: 3 })).toBe("refused");
  });

  it("is an ordinary move when the centre is still in the tile's own old rectangle", () => {
    const nudged = [item("a", 1, 0, 4, 6), item("b", 6, 0, 6, 12)];
    expect(settleDrag(ROOMY, nudged, "a", { x: 3, y: 3 })).toEqual([
      { slot: "a", x: 1, y: 0, w: 4, h: 6 },
      { slot: "b", x: 6, y: 0, w: 6, h: 12 },
    ]);
  });
});

describe("uniform zoom (spec 2026-10-12 §4)", () => {
  function setScreen(width: number, height: number) {
    Object.defineProperty(window, "screen", { configurable: true, value: { width, height } });
  }
  function withMinimum(minResolution?: { width: number; height: number }) {
    const w = useWorkspacesStore.getState().workspaces[0];
    useWorkspacesStore.setState({ workspaces: [{ ...w, ...(minResolution ? { minResolution } : {}) }] });
  }
  const grid = (container: HTMLElement) => container.querySelector(".workspace-grid") as HTMLElement;
  const layoutEl = (container: HTMLElement) => container.querySelector(".workspace-grid > .react-grid-layout") as HTMLElement;

  beforeEach(() => setScreen(1920, 1080));

  it("is 100% with no minimum, and sets no zoom", () => {
    withMinimum();
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(grid(container)).toHaveAttribute("data-zoom", "100");
    expect(layoutEl(container).getAttribute("style") ?? "").not.toContain("zoom");
  });

  it("is 100% when the screen is at least the minimum", () => {
    withMinimum({ width: 1920, height: 1080 });
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(grid(container)).toHaveAttribute("data-zoom", "100");
  });

  it("zooms a 4K-minimum workspace to 50% on a 1080p screen, laid out at twice the area's size", () => {
    withMinimum({ width: 3840, height: 2160 });
    const sizes = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600);
    const heights = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
    try {
      const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
      expect(grid(container)).toHaveAttribute("data-zoom", "50");
      const style = layoutEl(container).getAttribute("style") ?? "";
      expect(style).toMatch(/--ws-zoom:\s*0?\.5/);
      expect(style).toContain("width: 3200px");
      expect(style).toContain("height: 1800px");
    } finally {
      sizes.mockRestore();
      heights.mockRestore();
    }
  });

  it("previews the draft's minimum live", () => {
    withMinimum();
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    act(() => {
      useWorkspacesStore.getState().beginDraft("w1");
      useWorkspacesStore.getState().stageDraft({ minResolution: { width: 3840, height: 2160 } });
    });
    expect(grid(container)).toHaveAttribute("data-zoom", "50");
  });

  it("re-zooms when the screen changes (the window moved to another monitor)", () => {
    withMinimum({ width: 3840, height: 2160 });
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(grid(container)).toHaveAttribute("data-zoom", "50");
    act(() => {
      setScreen(3840, 2160);
      window.dispatchEvent(new Event("resize"));
    });
    expect(grid(container)).toHaveAttribute("data-zoom", "100");
  });

  it("is 100% while arranging, so the tiles follow the pointer", () => {
    withMinimum({ width: 3840, height: 2160 });
    act(() => useWorkspacesStore.getState().startArranging("w1"));
    const { container } = render(<WorkspaceGrid workspaceId="w1" onOpenLibrary={() => {}} />);
    expect(grid(container)).toHaveAttribute("data-zoom", "100");
    expect(layoutEl(container).getAttribute("style") ?? "").not.toContain("zoom");
  });
});
