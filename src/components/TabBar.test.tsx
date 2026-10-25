// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Deletes confirm through the native dialog now — WKWebView has no
// window.confirm — so the plugin's IPC call is what gets mocked.
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));

import { confirm } from "@tauri-apps/plugin-dialog";

import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { __read, __reset as __resetFs } from "../test/memfs";
import { TabBar } from "./TabBar";
import { WIDGET_DRAG_TYPE } from "./WidgetLibrary";

// Several tests below replace store actions with a vi.fn() via setState.
// vi.restoreAllMocks() does not undo that (it only reverts vi.spyOn spies),
// so the real actions are captured once at module load and reinstated here
// before every test. Mirrors DashboardTabs.test.tsx's own pattern.
const REAL_ACTIONS = {
  addTab: useDashboardStore.getState().addTab,
  renameTab: useDashboardStore.getState().renameTab,
  removeTab: useDashboardStore.getState().removeTab,
  setActiveTab: useDashboardStore.getState().setActiveTab,
  refreshAll: useDashboardStore.getState().refreshAll,
  reorderTabs: useDashboardStore.getState().reorderTabs,
  renameGroup: useDashboardStore.getState().renameGroup,
  deleteGroup: useDashboardStore.getState().deleteGroup,
};

beforeEach(() => {
  // vi.restoreAllMocks() does not reset a module mock's fns, so this does.
  vi.mocked(confirm).mockReset();
  __resetLoggerForTests();
  __resetFs();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useDashboardStore.setState({
    ...REAL_ACTIONS,
    dashboards: [
      {
        id: "d1",
        name: "Main",
        tabs: [
          { id: "t1", name: "First", cards: [] },
          { id: "t2", name: "Second", cards: [] },
        ],
      },
    ],
    activeId: "d1",
    activeTabId: "t1",
  });
});

afterEach(() => vi.restoreAllMocks());

describe("TabBar", () => {
  it("renders one tab per tab on the active dashboard and marks the active one", () => {
    render(<TabBar onOpenLibrary={() => {}} />);
    expect(screen.getByRole("tab", { name: "First" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the active tab on click", async () => {
    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(useDashboardStore.getState().activeTabId).toBe("t2");
  });

  it("renders nothing when there is no active dashboard", () => {
    useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null });
    const { container } = render(<TabBar onOpenLibrary={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("adds a tab named Untitled immediately, asking for nothing", async () => {
    const addTab = vi.fn().mockResolvedValue("t3");
    useDashboardStore.setState({ addTab });

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Add tab" }));

    await waitFor(() => expect(addTab).toHaveBeenCalledWith("d1", "Untitled"));
  });

  it("names the new tab Untitled 2 when Untitled is already taken", async () => {
    const addTab = vi.fn().mockResolvedValue("t3");
    useDashboardStore.setState({
      addTab,
      dashboards: [
        { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Untitled", cards: [] }] },
      ],
    });

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Add tab" }));

    await waitFor(() => expect(addTab).toHaveBeenCalledWith("d1", "Untitled 2"));
  });

  it("renames a tab through the inline field opened by double-click", async () => {
    const renameTab = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ renameTab });

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.dblClick(screen.getByRole("tab", { name: "First" }));
    // skipClick: the field mounts focused with its text selected, and a click
    // would collapse that selection.
    await userEvent.type(screen.getByRole("textbox", { name: "Rename tab" }), "Renamed{Enter}", {
      skipClick: true,
    });

    await waitFor(() => expect(renameTab).toHaveBeenCalledWith("t1", "Renamed"));
    expect(screen.queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
  });

  it("commits the rename on blur", async () => {
    const renameTab = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ renameTab });

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.dblClick(screen.getByRole("tab", { name: "First" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Rename tab" }), "Renamed", {
      skipClick: true,
    });
    await userEvent.tab();

    await waitFor(() => expect(renameTab).toHaveBeenCalledWith("t1", "Renamed"));
  });

  it("cancels the rename on Escape, restoring the tab's label", async () => {
    const renameTab = vi.fn();
    useDashboardStore.setState({ renameTab });

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.dblClick(screen.getByRole("tab", { name: "First" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Rename tab" }), "Renamed{Escape}", {
      skipClick: true,
    });

    expect(renameTab).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "First" })).toBeInTheDocument();
  });

  it("keeps Add tab and Refresh all out of the tablist, which holds tabs", () => {
    render(<TabBar onOpenLibrary={() => {}} />);
    const tablist = screen.getByRole("tablist", { name: "Tabs" });
    expect(tablist).not.toContainElement(screen.getByRole("button", { name: "Add tab" }));
    expect(tablist).not.toContainElement(screen.getByRole("button", { name: "Refresh all" }));
    expect(within(tablist).getAllByRole("tab")).toHaveLength(2);
  });

  it("removes a tab after the native confirmation", async () => {
    const removeTab = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ removeTab });
    vi.mocked(confirm).mockResolvedValue(true);

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete tab Second" }));

    await waitFor(() => expect(removeTab).toHaveBeenCalledWith("t2"));
    expect(confirm).toHaveBeenCalledWith(
      'Delete tab "Second"?',
      expect.objectContaining({ title: "Delete tab", kind: "warning" }),
    );
  });

  it("does not remove a tab when the confirmation is declined", async () => {
    const removeTab = vi.fn();
    useDashboardStore.setState({ removeTab });
    vi.mocked(confirm).mockResolvedValue(false);

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete tab Second" }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(removeTab).not.toHaveBeenCalled();
  });

  it("logs a rejected removeTab write rather than letting it escape as an unhandled rejection", async () => {
    const removeTab = vi.fn().mockRejectedValue(new Error("disk full"));
    useDashboardStore.setState({ removeTab });
    vi.mocked(confirm).mockResolvedValue(true);

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete tab Second" }));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to remove tab");
    });
  });

  // The native dialog is an IPC call that can reject; outside the try that
  // rejection escaped unhandled with nothing logged.
  it("logs a failed delete confirmation rather than letting it escape", async () => {
    const removeTab = vi.fn();
    useDashboardStore.setState({ removeTab });
    vi.mocked(confirm).mockRejectedValue(new Error("ipc"));

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete tab Second" }));

    await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("failed to remove tab"));
    expect(removeTab).not.toHaveBeenCalled();
  });

  it("refreshes every mounted card from the ↻ button", async () => {
    const refreshAll = vi.fn();
    useDashboardStore.setState({ refreshAll });

    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh all" }));

    expect(refreshAll).toHaveBeenCalledTimes(1);
  });

  it("keeps ↻ immediately left of the quick-add +", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, quickAddToolbar: true } });
    const { container } = render(<TabBar onOpenLibrary={() => {}} />);

    const buttons = [...container.querySelectorAll("button")];
    const refreshAt = buttons.findIndex((b) => b.getAttribute("aria-label") === "Refresh all");
    const addAt = buttons.findIndex((b) => b.getAttribute("aria-label") === "Add widget");
    expect(refreshAt).toBeGreaterThan(-1);
    expect(addAt).toBe(refreshAt + 1);
  });

  /**
   * Its own test, scoped to its own container. Folded into the case above it
   * could not fail: a second render leaves the first TabBar mounted, so a
   * document-wide screen.getAllByRole would still find the FIRST render's ↻
   * even if this render emitted none.
   *
   * Where ↻ ends up on screen is a CSS question (.tab-bar .refresh-all takes
   * the auto margin) that jsdom computes no layout for -- the geometry is
   * asserted in e2e/parity.spec.ts against real Chromium.
   */
  it("shows ↻ even with the quick-add toolbar off", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, quickAddToolbar: false } });
    const { container } = render(<TabBar onOpenLibrary={() => {}} />);

    expect(container.querySelector('button[aria-label="Refresh all"]')).toBeInTheDocument();
    // The premise: with the toolbar off there is no + for ↻ to be found
    // next to, so the ↻ above is genuinely this render's own.
    expect(container.querySelector('button[aria-label="Add widget"]')).toBeNull();
  });

  it("shows the quick-add button and calls onOpenLibrary when quickAddToolbar is on", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, quickAddToolbar: true } });
    const onOpenLibrary = vi.fn();

    render(<TabBar onOpenLibrary={onOpenLibrary} />);
    await userEvent.click(screen.getByRole("button", { name: "Add widget" }));

    expect(onOpenLibrary).toHaveBeenCalled();
  });

  it("does not show the quick-add button when quickAddToolbar is off", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, quickAddToolbar: false } });

    render(<TabBar onOpenLibrary={() => {}} />);

    expect(screen.queryByRole("button", { name: "Add widget" })).not.toBeInTheDocument();
  });
});

describe("TabBar in viewer mode", () => {
  it("keeps the tabs and Refresh all, and drops every editing affordance", async () => {
    render(<TabBar onOpenLibrary={vi.fn()} viewer />);

    expect(screen.getByRole("tab", { name: "First" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh all" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add tab" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete tab/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add widget" })).not.toBeInTheDocument();

    // Rename is off: a double-click leaves the tab a tab.
    await userEvent.dblClick(screen.getByRole("tab", { name: "First" }));
    expect(screen.queryByRole("textbox", { name: "Rename tab" })).not.toBeInTheDocument();
  });

  it("shows a grouping-off tag only while the dashboard has grouping disabled", () => {
    const { rerender } = render(<TabBar onOpenLibrary={vi.fn()} />);
    expect(screen.queryByText("grouping off")).not.toBeInTheDocument();

    useDashboardStore.setState({
      dashboards: useDashboardStore
        .getState()
        .dashboards.map((d) => ({ ...d, groupsDisabled: true })),
    });
    rerender(<TabBar onOpenLibrary={vi.fn()} />);

    expect(screen.getByText("grouping off")).toBeInTheDocument();
  });
});

/**
 * Drag-to-reorder. Each .tab-bar-tab WRAPPER is both the drag source and the
 * drop target -- not the [role="tab"] button -- so the ✕ area is droppable
 * too and there is no dead strip inside a tab.
 */
describe("TabBar tab reordering", () => {
  const TAB_TYPE = "application/x-bdobb-tab";

  // Type-aware, like the real DataTransfer: a stub that ignored its argument
  // would pass even if the drop read the payload under the wrong type.
  const drag = (payload: string, type = TAB_TYPE) => ({
    dataTransfer: { types: [type], getData: (t: string) => (t === type ? payload : "") },
  });

  /** Three tabs, so a leftward and a rightward drag are both expressible. */
  function seedThreeTabs() {
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          tabs: [
            { id: "t1", name: "First", cards: [] },
            { id: "t2", name: "Second", cards: [] },
            { id: "t3", name: "Third", cards: [] },
          ],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  const wrapperFor = (name: string) =>
    screen.getByRole("tab", { name }).closest(".tab-bar-tab") as HTMLElement;
  const renderedNames = () => screen.getAllByRole("tab").map((b) => b.textContent);
  const persistedTabIds = () =>
    (JSON.parse(__read("dashboards/d1.json") ?? "{}") as { tabs?: { id: string }[] }).tabs?.map(
      (t) => t.id,
    );

  it("drags a tab leftward onto another and splices it in before that target", async () => {
    seedThreeTabs();
    render(<TabBar onOpenLibrary={() => {}} />);

    const setData = vi.fn();
    fireEvent.dragStart(wrapperFor("Third"), { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith("application/x-bdobb-tab", "t3");

    fireEvent.drop(wrapperFor("First"), drag("t3"));

    await waitFor(() => expect(renderedNames()).toEqual(["Third", "First", "Second"]));
    await waitFor(() => expect(persistedTabIds()).toEqual(["t3", "t1", "t2"]));
  });

  it("drags a tab rightward onto another and lands it after that target", async () => {
    // `to` is read BEFORE the removal, so a rightward drag lands after its
    // target -- which is what reaches the last slot with no trailing zone.
    seedThreeTabs();
    render(<TabBar onOpenLibrary={() => {}} />);

    fireEvent.drop(wrapperFor("Third"), drag("t1"));

    await waitFor(() => expect(renderedNames()).toEqual(["Second", "Third", "First"]));
    await waitFor(() => expect(persistedTabIds()).toEqual(["t2", "t3", "t1"]));
  });

  it("ignores a drop that carries a widget rather than a tab", () => {
    seedThreeTabs();
    const reorderTabs = vi.fn();
    useDashboardStore.setState({ reorderTabs });
    render(<TabBar onOpenLibrary={() => {}} />);

    fireEvent.drop(wrapperFor("First"), drag("b1:w1", WIDGET_DRAG_TYPE));

    expect(reorderTabs).not.toHaveBeenCalled();
    expect(renderedNames()).toEqual(["First", "Second", "Third"]);
  });

  it("ignores a drop whose payload names no tab on this dashboard", () => {
    seedThreeTabs();
    const reorderTabs = vi.fn();
    useDashboardStore.setState({ reorderTabs });
    render(<TabBar onOpenLibrary={() => {}} />);

    // A payload left over from a dashboard that is no longer active: the -1
    // guard makes it a silent no-op rather than a throw.
    fireEvent.drop(wrapperFor("First"), drag("t-from-elsewhere"));

    expect(reorderTabs).not.toHaveBeenCalled();
    expect(renderedNames()).toEqual(["First", "Second", "Third"]);
  });

  it("ignores a drop of a tab onto itself", () => {
    seedThreeTabs();
    const reorderTabs = vi.fn();
    useDashboardStore.setState({ reorderTabs });
    render(<TabBar onOpenLibrary={() => {}} />);

    fireEvent.drop(wrapperFor("Second"), drag("t2"));

    expect(reorderTabs).not.toHaveBeenCalled();
  });

  it("accepts a dragover only when it carries the tab type", () => {
    // Without preventDefault the browser fires no drop at all, so gating it on
    // the type is what refuses everything else.
    seedThreeTabs();
    render(<TabBar onOpenLibrary={() => {}} />);
    const wrapper = wrapperFor("First");

    const tabDrag = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(tabDrag, "dataTransfer", { value: { types: [TAB_TYPE] } });
    fireEvent(wrapper, tabDrag);
    expect(tabDrag.defaultPrevented).toBe(true);

    const widgetDrag = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(widgetDrag, "dataTransfer", { value: { types: [WIDGET_DRAG_TYPE] } });
    fireEvent(wrapper, widgetDrag);
    expect(widgetDrag.defaultPrevented).toBe(false);
  });

  it("highlights the tab under a tab drag and clears it only on a real leave", () => {
    seedThreeTabs();
    render(<TabBar onOpenLibrary={() => {}} />);
    const wrapper = wrapperFor("First");
    const tabButton = screen.getByRole("tab", { name: "First" });

    fireEvent.dragEnter(wrapper, drag("t3"));
    expect(wrapper).toHaveAttribute("data-drop-target", "true");

    // fireEvent.dragLeave(el, { relatedTarget }) silently drops relatedTarget
    // in jsdom (no DragEvent constructor there); dispatch a plain bubbling
    // MouseEvent instead, which does carry it. Same caveat LeftRail.test.tsx
    // documents for the rail's rows.
    fireEvent(wrapper, new MouseEvent("dragleave", { bubbles: true, relatedTarget: tabButton }));
    expect(wrapper).toHaveAttribute("data-drop-target", "true");

    fireEvent(
      wrapper,
      new MouseEvent("dragleave", { bubbles: true, relatedTarget: document.body }),
    );
    expect(wrapper).not.toHaveAttribute("data-drop-target", "true");
  });

  it("does not highlight a tab for a drag that is not carrying a tab", () => {
    seedThreeTabs();
    render(<TabBar onOpenLibrary={() => {}} />);
    const wrapper = wrapperFor("First");

    fireEvent.dragEnter(wrapper, drag("b1:w1", WIDGET_DRAG_TYPE));

    expect(wrapper).not.toHaveAttribute("data-drop-target", "true");
  });

  it("clears the highlight when the drop lands", async () => {
    seedThreeTabs();
    render(<TabBar onOpenLibrary={() => {}} />);
    const wrapper = wrapperFor("First");

    fireEvent.dragEnter(wrapper, drag("t3"));
    expect(wrapper).toHaveAttribute("data-drop-target", "true");

    fireEvent.drop(wrapper, drag("t3"));

    await waitFor(() => expect(wrapper).not.toHaveAttribute("data-drop-target", "true"));
  });

  it("renders no draggable tab in the viewer window", () => {
    // The viewer's tabs still switch; they do not reorder. Belt and braces
    // over the store's own memory-only path: the drop cannot even be started.
    seedThreeTabs();
    const { container } = render(<TabBar onOpenLibrary={() => {}} viewer />);

    const wrappers = [...container.querySelectorAll(".tab-bar-tab")];
    expect(wrappers).toHaveLength(3);
    for (const w of wrappers) expect(w).toHaveAttribute("draggable", "false");
  });

  it("stops being draggable while its label is being renamed", async () => {
    // A text field inside a draggable ancestor cannot be selected with the
    // mouse, because the drag starts instead.
    seedThreeTabs();
    render(<TabBar onOpenLibrary={() => {}} />);
    const wrapper = wrapperFor("First");
    expect(wrapper).toHaveAttribute("draggable", "true");

    await userEvent.dblClick(screen.getByRole("tab", { name: "First" }));

    expect(screen.getByRole("textbox", { name: "Rename tab" })).toBeInTheDocument();
    expect(wrapper).toHaveAttribute("draggable", "false");
  });

  it("logs a rejected reorder write rather than letting it escape as an unhandled rejection", async () => {
    seedThreeTabs();
    useDashboardStore.setState({
      reorderTabs: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    render(<TabBar onOpenLibrary={() => {}} />);

    fireEvent.drop(wrapperFor("First"), drag("t3"));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to reorder tabs");
    });
  });
});

describe("group chips", () => {
  function seedGroups() {
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "Main",
          groups: [
            { id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "AAPL" },
            { id: "g2", name: "Dates", paramName: "date", groupType: "date", value: "2026-01-01" },
            { id: "g3", name: "Quarter", paramName: "quarter", groupType: "quarter", value: "2026-Q3" },
          ],
          tabs: [
            {
              id: "t1",
              name: "First",
              cards: [
                {
                  id: "c1",
                  widgetId: "quote",
                  backendId: "b1",
                  params: {},
                  layout: { x: 0, y: 0, w: 1, h: 1 },
                  bindings: [{ groupId: "g1", paramName: "symbol" }],
                },
              ],
            },
          ],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
  }

  it("shows one numbered chip per group with its value", () => {
    seedGroups();
    render(<TabBar onOpenLibrary={() => {}} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Ticker · AAPL")).toBeInTheDocument();
    expect(screen.getByText("Dates · 2026-01-01")).toBeInTheDocument();
    // The chip shows the STORED calendar label, never a member's relabelling.
    expect(screen.getByText("Quarter · 2026-Q3")).toBeInTheDocument();
  });

  it("shows a grouped statement period by its fiscal name", () => {
    seedGroups();
    useDashboardStore.setState((st) => ({
      dashboards: st.dashboards.map((d) => ({
        ...d,
        groups: [...(d.groups ?? []), { id: "g4", name: "Period", paramName: "period", groupType: "period", value: "quarter" }],
      })),
    }));
    render(<TabBar onOpenLibrary={() => {}} />);
    expect(screen.getByText("Period · FQ")).toBeInTheDocument();
  });

  it("renames on double-click and Enter", async () => {
    seedGroups();
    const renameGroup = vi.fn(async () => {});
    useDashboardStore.setState({ renameGroup });
    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.dblClick(screen.getByText("Ticker · AAPL"));
    const field = screen.getByRole("textbox", { name: "Rename group" });
    await userEvent.clear(field);
    await userEvent.type(field, "Watchlist{Enter}");
    expect(renameGroup).toHaveBeenCalledWith("d1", "g1", "Watchlist");
  });

  it("deletes after the confirmation names the member count", async () => {
    seedGroups();
    const deleteGroup = vi.fn(async () => {});
    useDashboardStore.setState({ deleteGroup });
    vi.mocked(confirm).mockResolvedValueOnce(true);
    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete group Ticker" }));
    expect(confirm).toHaveBeenCalledWith(
      'Delete group "Ticker"? Its 1 card keeps its current value.',
      expect.objectContaining({ kind: "warning" }),
    );
    expect(deleteGroup).toHaveBeenCalledWith("d1", "g1");
  });

  it("logs a rejected native confirm rather than letting it escape as an unhandled rejection", async () => {
    seedGroups();
    const deleteGroup = vi.fn(async () => {});
    useDashboardStore.setState({ deleteGroup });
    vi.mocked(confirm).mockRejectedValueOnce(new Error("dialog unavailable"));
    render(<TabBar onOpenLibrary={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete group Ticker" }));
    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to delete group g1");
    });
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("hides rename and delete in the viewer", () => {
    seedGroups();
    render(<TabBar onOpenLibrary={() => {}} viewer />);
    expect(screen.queryByRole("button", { name: "Delete group Ticker" })).not.toBeInTheDocument();
  });
});

// v8 removed the rail's Add widget row, so the bar's green + is how a touch
// user adds a widget. With many tabs the tablist could neither shrink nor
// scroll, and pushed ↻ and + off the right edge (seen on the iPad sim with the
// reference app's ten tabs). styles.css is not in the test build (`css:
// false`), so the rule is asserted on the file, as DayPicker.test.tsx does.
describe("tab bar overflow", () => {
  it("lets the tablist shrink and scroll so ↻ and + stay on screen", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const rule = css.match(/\n\.tab-bar-tabs \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/min-width:\s*0/);
    expect(rule).toMatch(/overflow-x:\s*auto/);
  });
});
