// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Deletes confirm through the native dialog now — WKWebView has no
// window.confirm — so the plugin's IPC call is what gets mocked. Export and
// Import add save() and open() from the same module.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
}));

// Save… asks the native macOS Save panel, which reports the path AND the
// Format pop-up's choice; the command is the IPC call mocked here.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

// The Help menu's two items hand a URL to the OS browser.
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// The conflict prompt is its own unit (ImportConflictDialog.test.tsx). Here it
// answers "no conflicts" unless a test says otherwise.
vi.mock("./dialogs/ImportConflictDialog", () => ({
  decideImportConflicts: vi.fn(async () => []),
}));

// The second window is a real native window; nothing about it can exist under
// jsdom, so the class is a spy that records what it was constructed with.
const { webviewWindowCtor, getByLabel, setFocus } = vi.hoisted(() => ({
  webviewWindowCtor: vi.fn(),
  getByLabel: vi.fn(),
  setFocus: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = getByLabel;
    constructor(label: string, options: unknown) {
      webviewWindowCtor(label, options);
    }
    once = vi.fn().mockResolvedValue(() => {});
    setFocus = setFocus;
  },
}));

// Wraps the real hook so close() is observable, without replacing its
// behavior — the data-expanded assertions below still exercise the genuine
// hook. Established pattern: dashboardStore.test.ts wraps saveDashboard the
// same way, via importActual.
const { closeSpy } = vi.hoisted(() => ({ closeSpy: vi.fn() }));

vi.mock("../hooks/useHoverPanel", async () => {
  const actual =
    await vi.importActual<typeof import("../hooks/useHoverPanel")>("../hooks/useHoverPanel");
  return {
    ...actual,
    useHoverPanel: (...args: Parameters<typeof actual.useHoverPanel>) => {
      const panel = actual.useHoverPanel(...args);
      return {
        ...panel,
        close: () => {
          closeSpy();
          panel.close();
        },
      };
    },
  };
});

import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { WidgetDef } from "../lib/types";
import { __resetLoggerForTests } from "../lib/logger";
import { makeEmptyFolders } from "../lib/foldersFile";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { __read, __reset as __resetFs, __seed as __seedFs } from "../test/memfs";
import { WIDGET_DRAG_TYPE } from "./WidgetLibrary";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { decideImportConflicts } from "./dialogs/ImportConflictDialog";
import { LeftRail } from "./LeftRail";

const libraryWidget = (): WidgetDef => makeWidget({ name: "Widget" });

// Several tests below replace addCardTo with a vi.fn() via setState.
// vi.restoreAllMocks() does not undo that (it only reverts vi.spyOn spies),
// so the real action is captured once at module load and reinstated here
// before every test. Established pattern: see WidgetLibrary.test.tsx.
const REAL_ACTIONS = {
  addCardTo: useDashboardStore.getState().addCardTo,
  renameDashboard: useDashboardStore.getState().renameDashboard,
  removeDashboard: useDashboardStore.getState().removeDashboard,
  reorderDashboards: useDashboardStore.getState().reorderDashboards,
};

// Same leak concern as REAL_ACTIONS above, but for settingsStore: a test
// that replaces save() via setState would otherwise leave the mock in
// place for every test after it.
const REAL_SETTINGS_ACTIONS = {
  save: useSettingsStore.getState().save,
};

// And once more for foldersStore. makeEmptyFolders() restores only the four
// persisted fields, so a test that swaps an ACTION out via setState (the
// rejecting deleteFolder below does) would otherwise leave that mock in place
// for every test appended after it.
const REAL_FOLDERS_ACTIONS = {
  addFolder: useFoldersStore.getState().addFolder,
  renameFolder: useFoldersStore.getState().renameFolder,
  deleteFolder: useFoldersStore.getState().deleteFolder,
  moveDashboard: useFoldersStore.getState().moveDashboard,
  toggleCollapsed: useFoldersStore.getState().toggleCollapsed,
};

beforeEach(() => {
  closeSpy.mockReset();
  vi.mocked(confirm).mockReset();
  vi.mocked(save).mockReset();
  vi.mocked(invoke).mockReset();
  vi.mocked(open).mockReset();
  vi.mocked(openUrl).mockReset();
  vi.mocked(openUrl).mockResolvedValue(undefined);
  webviewWindowCtor.mockReset();
  getByLabel.mockReset();
  getByLabel.mockResolvedValue(null);
  setFocus.mockReset();
  __resetLoggerForTests();
  __resetFs();
  useDashboardStore.setState({
    ...REAL_ACTIONS,
    dashboards: [
      { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] },
      { id: "d2", name: "Second", tabs: [{ id: "t2", name: "Main", cards: [] }] },
    ],
    activeId: "d1",
    activeTabId: "t1",
  });
  useWidgetRegistryStore.setState({ widgets: [] });
  useFoldersStore.setState({ ...makeEmptyFolders(), ...REAL_FOLDERS_ACTIONS });
  useSettingsStore.setState({
    ...REAL_SETTINGS_ACTIONS,
    settings: { ...DEFAULT_SETTINGS },
  });
});

describe("LeftRail", () => {
  it("lists the saved dashboards", () => {
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Main/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Second/ })).toBeInTheDocument();
  });

  it("shows the Option shortcut beside each of the first nine dashboards", () => {
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    expect(screen.getByText("⌥1")).toBeInTheDocument();
    expect(screen.getByText("⌥2")).toBeInTheDocument();
  });

  it("shows no shortcut past the ninth dashboard", () => {
    useDashboardStore.setState({
      dashboards: Array.from({ length: 10 }, (_, i) => ({
        id: `d${i}`,
        name: `Dash ${i}`,
        tabs: [{ id: `t${i}`, name: "Main", cards: [] }],
      })),
      activeId: "d0",
      activeTabId: "t0",
    });
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    expect(screen.getByText("⌥9")).toBeInTheDocument();
    expect(screen.queryByText("⌥10")).not.toBeInTheDocument();
  });

  // Collapsed, the badge is a dashboard row's only visible content, so a
  // row past the ninth was a blank strip. It carries its initial instead.
  it("gives a dashboard past the ninth its initial where the shortcut would be", () => {
    useDashboardStore.setState({
      dashboards: Array.from({ length: 10 }, (_, i) => ({
        id: `d${i}`,
        name: i === 9 ? "zeta" : `Dash ${i}`,
        tabs: [{ id: `t${i}`, name: "Main", cards: [] }],
      })),
      activeId: "d0",
      activeTabId: "t0",
    });
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    const row = screen.getByRole("button", { name: "zeta" });
    expect(row.children[0]).toHaveClass("rail-initial");
    expect(row.children[0]).toHaveTextContent("z");
    expect(row.children[0]).toHaveAttribute("aria-hidden", "true");
  });

  // Issue #26: Edit… left the hover rail expanded over the tiles after the
  // dialog's Done, because the menu opened the dialog without collapsing it.
  it("collapses the rail before the workspace row menu opens its dialog", async () => {
    useWorkspacesStore.setState({ workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [] }] });
    const onOpenWorkspace = vi.fn();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} onOpenWorkspace={onOpenWorkspace} />);
    const rail = screen.getByRole("navigation");
    await userEvent.hover(rail);
    expect(rail).toHaveAttribute("data-expanded", "true");

    fireEvent.contextMenu(screen.getByText("Trading"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit…" }));

    expect(rail).toHaveAttribute("data-expanded", "false");
    expect(onOpenWorkspace).toHaveBeenCalledWith("w1");
    useWorkspacesStore.setState({ workspaces: [] });
  });

  it("marks a workspace Open at launch from its row menu", async () => {
    useWorkspacesStore.setState({
      workspaces: [
        { id: "w1", name: "Trading", preset: "laptop", slots: [] },
        { id: "w2", name: "Macro", preset: "laptop", slots: [], openAtLaunch: true },
      ],
    });
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    fireEvent.contextMenu(screen.getByText("Trading"));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: /Open at launch/ }));

    await waitFor(() => expect(useWorkspacesStore.getState().workspaces.find((w) => w.id === "w1")?.openAtLaunch).toBe(true));
    // Several may be marked: the other keeps its mark.
    expect(useWorkspacesStore.getState().workspaces.find((w) => w.id === "w2")?.openAtLaunch).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    useWorkspacesStore.setState({ workspaces: [] });
  });

  it("switches the active dashboard on click", async () => {
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Second/ }));
    expect(useDashboardStore.getState().activeId).toBe("d2");
  });

  it("collapses the rail before opening the library", async () => {
    const order: string[] = [];
    closeSpy.mockImplementation(() => order.push("close"));
    const onOpenLibrary = vi.fn(() => order.push("library"));

    render(<LeftRail onOpenLibrary={onOpenLibrary} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    const rail = screen.getByRole("navigation");
    await userEvent.hover(rail);
    expect(rail).toHaveAttribute("data-expanded", "true");

    await userEvent.click(screen.getByRole("button", { name: /widget library/i }));

    // panel.close() runs before onOpenLibrary(), or the expanded rail stays
    // painted over the library overlay until the pointer happens to leave.
    expect(rail).toHaveAttribute("data-expanded", "false");
    expect(onOpenLibrary).toHaveBeenCalled();
    expect(order).toEqual(["close", "library"]);
  });

  it("opens the library from the rail's Add widget button, after collapsing", async () => {
    const order: string[] = [];
    closeSpy.mockImplementation(() => order.push("close"));
    const onOpenLibrary = vi.fn(() => order.push("library"));

    render(<LeftRail onOpenLibrary={onOpenLibrary} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add widget (⌘K)" }));

    // Same ordering contract as the Widget Library button below it: the
    // expanded rail sits at z-index 40 and would paint over the library
    // overlay at z-index 30 until the pointer happened to leave.
    expect(onOpenLibrary).toHaveBeenCalled();
    expect(order).toEqual(["close", "library"]);
  });

  it("puts Apps between Widget Library and Connections, and opens it after collapsing", async () => {
    const order: string[] = [];
    closeSpy.mockImplementation(() => order.push("close"));
    const onOpenApps = vi.fn(() => order.push("apps"));

    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={onOpenApps} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    // Read off the DOM rather than assumed: the design puts this row below
    // Widget Library and above Connections, and nothing else pins it there.
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
      .filter((l): l is string => l !== null);
    expect(labels.indexOf("Widget Library")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Widget Library")).toBeLessThan(labels.indexOf("Apps"));
    expect(labels.indexOf("Apps")).toBeLessThan(labels.indexOf("Connections"));

    await userEvent.click(screen.getByRole("button", { name: "Apps" }));

    // Same ordering contract as the two rows above it: the expanded rail
    // (z-index 40) must not stay painted over the dialog.
    expect(onOpenApps).toHaveBeenCalled();
    expect(order).toEqual(["close", "apps"]);
  });

  it("opens the connections dialog from the bottom-pinned group, after collapsing", async () => {
    const order: string[] = [];
    closeSpy.mockImplementation(() => order.push("close"));
    const onOpenConnections = vi.fn(() => order.push("connections"));

    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={onOpenConnections} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Connections" }));

    expect(closeSpy).toHaveBeenCalled();
    expect(onOpenConnections).toHaveBeenCalled();
    expect(order).toEqual(["close", "connections"]);
  });

  it("opens the settings dialog from the bottom-pinned group, after collapsing", async () => {
    const order: string[] = [];
    closeSpy.mockImplementation(() => order.push("close"));
    const onOpenSettings = vi.fn(() => order.push("settings"));

    render(
      <LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={onOpenSettings} onOpenHelp={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(closeSpy).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
    expect(order).toEqual(["close", "settings"]);
  });

  it("opens the Help menu from the bottom-pinned group, without collapsing the rail", async () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Help" }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /report a bug/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /request a feature/i })).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("closes the Help menu when its onClose fires", async () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the Help menu when its own button is clicked again", async () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the GitHub issues URL when Report a Bug is clicked, then closes", async () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Help" }));

    await userEvent.click(screen.getByRole("menuitem", { name: /report a bug/i }));

    expect(openUrl).toHaveBeenCalledWith("https://github.com/Adventures-OpenBQ/bdobb/issues");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the Canny board URL when Request a Feature is clicked, then closes", async () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Help" }));

    await userEvent.click(screen.getByRole("menuitem", { name: /request a feature/i }));

    expect(openUrl).toHaveBeenCalledWith("https://artcashin.canny.io/bdobb");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("carries a tooltip reminding to search Canny first", async () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Help" }));

    expect(screen.getByRole("menuitem", { name: /request a feature/i })).toHaveAttribute(
      "title",
      "Search first — upvote it if it's already there.",
    );
  });

  it("logs rather than throwing when openUrl rejects, and still closes the Help menu", async () => {
    vi.mocked(openUrl).mockRejectedValue(new Error("no browser"));
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Help" }));

    await userEvent.click(screen.getByRole("menuitem", { name: /report a bug/i }));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to open");
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("returns focus to the Help row when its menu closes", async () => {
    // The menu takes focus on mount, so closing it without handing focus back
    // drops a keyboard user on <body> — nowhere near where they were.
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const button = screen.getByRole("button", { name: "Help" });
    await userEvent.click(button);
    expect(button).not.toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("positions the Help menu from its row, opening upwards", async () => {
    // jsdom measures everything as 0x0, and a zero-height menu opens upwards
    // to exactly where it would have opened downwards. Giving the menu a real
    // height is what makes the direction observable: 100 - 40, not 100.
    const MENU_HEIGHT = 40;
    const realRect = Element.prototype.getBoundingClientRect;
    // Restored by hand: nothing in this suite restores mocks between tests,
    // and a prototype left patched would follow every test after this one.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.classList.contains("row-context-menu")
        ? ({ left: 0, top: 0, right: 160, bottom: MENU_HEIGHT, width: 160, height: MENU_HEIGHT, x: 0, y: 0, toJSON: () => {} } as DOMRect)
        : realRect.call(this);
    };
    try {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      const button = screen.getByRole("button", { name: "Help" });
      button.getBoundingClientRect = () =>
        ({ left: 12, top: 100, right: 0, bottom: 0, width: 0, height: 0, x: 12, y: 100, toJSON: () => {} }) as DOMRect;

      await userEvent.click(button);

      // Placed from the ROW -- not the pointer, not the window origin -- and
      // ABOVE it: the Help row is pinned to the bottom of the window.
      expect(screen.getByRole("menu")).toHaveStyle({ left: "12px", top: "60px" });
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
    }
  });

  it("renders the Library and My Dashboards section labels in order", () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const labels = screen.getAllByTestId("rail-section-label").map((el) => el.textContent);
    expect(labels).toEqual(["Library", "Workspaces", "My Dashboards"]);
  });

  // getData is type-aware, like the real DataTransfer: a stub that ignored
  // its argument would pass even if handleDrop read under the wrong type.
  const dragEvent = (key: string, type = WIDGET_DRAG_TYPE) => ({
    dataTransfer: { types: [type], getData: (t: string) => (t === type ? key : "") },
  });

  it("adds the dropped widget to that dashboard, switches to it, and clears the highlight", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    useWidgetRegistryStore.setState({
      widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }],
    });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const row = screen.getByRole("button", { name: /second/i });
    fireEvent.dragEnter(row, dragEvent("b1:w1"));
    expect(row).toHaveAttribute("data-drop-target", "true");

    fireEvent.drop(row, dragEvent("b1:w1"));
    expect(row).not.toHaveAttribute("data-drop-target", "true");

    await waitFor(() =>
      expect(addCardTo).toHaveBeenCalledWith("d2", "t2", expect.objectContaining({ id: "w1" }), {}),
    );
    expect(useDashboardStore.getState().activeId).toBe("d2");
  });

  it("lands a drop on the tab the target dashboard is showing, and in a workspace routes it through its tile", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    const twoTabs = [
      { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] },
      { id: "d2", name: "Second", tabs: [{ id: "t2", name: "One", cards: [] }, { id: "t2b", name: "Two", cards: [] }] },
    ];
    useDashboardStore.setState({ addCardTo, dashboards: twoTabs, activeTabIds: { d1: "t1", d2: "t2b" } });
    useWidgetRegistryStore.setState({ widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }] });
    const { unmount } = render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));
    await waitFor(() => expect(addCardTo).toHaveBeenCalledWith("d2", "t2b", expect.objectContaining({ id: "w1" }), {}));
    unmount();

    addCardTo.mockClear();
    const assignSlot = vi.fn().mockResolvedValue(undefined);
    const realAssignSlot = useWorkspacesStore.getState().assignSlot;
    useDashboardStore.setState({ activeId: "d1", activeTabIds: { d1: "t1", d2: "t2b" } });
    useWorkspacesStore.setState({
      assignSlot,
      activeWorkspaceId: "w1",
      workspaces: [{ id: "w1", name: "Trading", preset: "laptop", slots: [{ slot: "a", dashboardId: "d1" }, { slot: "b", dashboardId: "d2" }], activeTabIds: { d2: "t2b" } }],
    });
    try {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));
      await waitFor(() => expect(addCardTo).toHaveBeenCalledWith("d2", "t2b", expect.objectContaining({ id: "w1" }), {}));
      expect(assignSlot).toHaveBeenCalledWith("w1", expect.any(String), "d2");
      await waitFor(() => expect(useDashboardStore.getState().activeTabIds.d2).toBe("t2b"));
    } finally {
      useWorkspacesStore.setState({ assignSlot: realAssignSlot, activeWorkspaceId: null, workspaces: [] });
    }
  });

  it("a drop on another dashboard's row lands on the tab that is shown after the switch", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({
      addCardTo,
      dashboards: [
        { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] },
        { id: "d2", name: "Second", tabs: [{ id: "t2", name: "One", cards: [] }, { id: "t2b", name: "Two", cards: [] }] },
      ],
      activeId: "d1",
      activeTabId: "t1",
      activeTabIds: { d1: "t1", d2: "t2b" },
    });
    useWidgetRegistryStore.setState({ widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }] });
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));
    await waitFor(() => expect(addCardTo).toHaveBeenCalled());
    const s = useDashboardStore.getState();
    expect([s.activeId, s.activeTabId]).toEqual(["d2", addCardTo.mock.calls[0][1]]);
  });

  it("in a workspace, a drop lands on the tile's tab and leaves the saved tiles alone", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({
      addCardTo,
      dashboards: [
        { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] },
        { id: "d2", name: "Second", tabs: [{ id: "t2", name: "One", cards: [] }, { id: "t2b", name: "Two", cards: [] }] },
      ],
      activeId: "d1",
      activeTabId: "t1",
      // The rail's record says t2b; the tile was saved on t2, and t2 is what it shows.
      activeTabIds: { d1: "t1", d2: "t2b" },
    });
    useWidgetRegistryStore.setState({ widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }] });
    const ws = { id: "w1", name: "Trading", preset: "laptop" as const, slots: [{ slot: "a", dashboardId: "d1" }, { slot: "b", dashboardId: "d2" }], activeTabIds: { d2: "t2" } };
    useWorkspacesStore.setState({ activeWorkspaceId: "w1", focusedSlot: "a", workspaces: [ws] });
    try {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));
      await waitFor(() => expect(addCardTo).toHaveBeenCalled());
      await waitFor(() => expect(useDashboardStore.getState().activeId).toBe("d2"));
      expect(useDashboardStore.getState().activeTabId).toBe(addCardTo.mock.calls[0][1]);
      expect(useWorkspacesStore.getState().workspaces[0].slots).toEqual(ws.slots);
    } finally {
      useWorkspacesStore.setState({ activeWorkspaceId: null, focusedSlot: null, workspaces: [] });
    }
  });

  it("logs a rejected drop write rather than letting it escape as an unhandled rejection", async () => {
    const addCardTo = vi.fn().mockRejectedValue(new Error("disk full"));
    useDashboardStore.setState({ addCardTo });
    useWidgetRegistryStore.setState({
      widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }],
    });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to add the dropped widget");
    });
  });

  it("neither collapses the rail nor opens the library on a drop", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    useWidgetRegistryStore.setState({
      widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }],
    });
    const onOpenLibrary = vi.fn();

    render(<LeftRail onOpenLibrary={onOpenLibrary} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const rail = screen.getByRole("navigation");
    fireEvent.dragEnter(rail, dragEvent("b1:w1"));
    expect(rail).toHaveAttribute("data-expanded", "true");

    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));
    await waitFor(() => expect(addCardTo).toHaveBeenCalled());

    expect(rail).toHaveAttribute("data-expanded", "true");
    expect(closeSpy).not.toHaveBeenCalled();
    expect(onOpenLibrary).not.toHaveBeenCalled();
  });

  it("reads the drop payload under the widget drag type, not any type carried", () => {
    const addCardTo = vi.fn();
    useDashboardStore.setState({ addCardTo });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), {
      dataTransfer: {
        types: [WIDGET_DRAG_TYPE],
        getData: (t: string) => (t === "text/plain" ? "b1:w1" : ""),
      },
    });

    expect(addCardTo).not.toHaveBeenCalled();
  });

  it("ignores a drop whose widget cannot be resolved", async () => {
    const addCardTo = vi.fn();
    useDashboardStore.setState({ addCardTo });
    useWidgetRegistryStore.setState({ widgets: [] });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:gone"));

    expect(addCardTo).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("treats a payload with no colon separator as a no-op, not a mis-sliced match", () => {
    const addCardTo = vi.fn();
    useDashboardStore.setState({ addCardTo });
    // Chosen so the OLD buggy raw.slice(0, -1) / raw.slice(0) (indexOf
    // returning -1 for "no colon" being read as a slice bound) would
    // accidentally produce backendId "b1" and widgetId "b1w" — a real,
    // resolvable widget — even though the payload has no ':' at all.
    useWidgetRegistryStore.setState({
      widgets: [{ ...libraryWidget(), id: "b1w", backendId: "b1" }],
    });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1w"));

    expect(addCardTo).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("leaves the user on the dashboard from the most recent drop, even if an earlier drop's write resolves later", async () => {
    useWidgetRegistryStore.setState({
      widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }],
    });
    let resolveFirst!: (id: string) => void;
    const addCardTo = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce("c2");
    useDashboardStore.setState({ addCardTo });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    // Drop on "Second" (d2) first — its write is left pending — then drop on
    // "Main" (d1) before that first write resolves.
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));
    fireEvent.drop(screen.getByRole("button", { name: /main/i }), dragEvent("b1:w1"));

    expect(useDashboardStore.getState().activeId).toBe("d1");

    // The first (d2) write settling afterwards must not yank the user back.
    resolveFirst("c1");
    await waitFor(() => expect(addCardTo).toHaveBeenCalledTimes(2));
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("passes a matched sibling symbol as the new card's params override when matchDashboardSymbol is enabled", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({
      addCardTo,
      dashboards: [
        { id: "d1", name: "Main", tabs: [{ id: "t1", name: "Main", cards: [] }] },
        {
          id: "d2",
          name: "Second",
          tabs: [
            {
              id: "t2",
              name: "Main",
              cards: [
                makeCard({
                  id: "c0",
                  widgetId: "x",
                  params: { symbol: "AAPL" },
                  layout: { x: 0, y: 0, w: 1, h: 1 },
                }),
              ],
            },
          ],
        },
      ],
      activeId: "d1",
      activeTabId: "t1",
    });
    useWidgetRegistryStore.setState({
      widgets: [
        { ...libraryWidget(), id: "w1", backendId: "b1", params: [{ paramName: "symbol", type: "text" }] },
      ],
    });
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, matchDashboardSymbol: true },
    });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));

    await waitFor(() =>
      expect(addCardTo).toHaveBeenCalledWith("d2", "t2", expect.objectContaining({ id: "w1" }), {
        symbol: "AAPL",
      }),
    );
  });

  it("accepts a dragover only when it carries the widget type", () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const row = screen.getByRole("button", { name: /second/i });

    const widgetDrag = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(widgetDrag, "dataTransfer", { value: { types: [WIDGET_DRAG_TYPE] } });
    fireEvent(row, widgetDrag);
    expect(widgetDrag.defaultPrevented).toBe(true);

    const fileDrag = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(fileDrag, "dataTransfer", { value: { types: ["Files"] } });
    fireEvent(row, fileDrag);
    expect(fileDrag.defaultPrevented).toBe(false);
  });

  it("resolves a widget id containing a colon", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    useWidgetRegistryStore.setState({
      widgets: [{ ...libraryWidget(), id: "a:b", backendId: "b1" }],
    });

    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:a:b"));

    await waitFor(() =>
      expect(addCardTo).toHaveBeenCalledWith("d2", "t2", expect.objectContaining({ id: "a:b" }), {}),
    );
  });

  it("marks the row under the pointer and clears it again", () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const row = screen.getByRole("button", { name: /second/i });

    fireEvent.dragEnter(row, dragEvent("b1:w1"));
    expect(row).toHaveAttribute("data-drop-target", "true");
    fireEvent.dragLeave(row, dragEvent("b1:w1"));
    expect(row).not.toHaveAttribute("data-drop-target", "true");
  });

  it("does not highlight a row for a drag that isn't carrying a widget", () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const row = screen.getByRole("button", { name: /second/i });

    fireEvent.dragEnter(row, dragEvent("ignored", "Files"));
    expect(row).not.toHaveAttribute("data-drop-target", "true");
  });

  it("keeps a row highlighted when a dragleave crosses onto one of its own children, but clears on a real leave", () => {
    // fireEvent.dragLeave(el, { relatedTarget }) silently drops relatedTarget
    // in jsdom (no DragEvent constructor there); dispatch a plain
    // bubbling MouseEvent instead, which does carry it.
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const row = screen.getByRole("button", { name: /second/i });
    const label = row.querySelector(".rail-item-label")!;

    fireEvent.dragEnter(row, dragEvent("b1:w1"));
    expect(row).toHaveAttribute("data-drop-target", "true");

    fireEvent(row, new MouseEvent("dragleave", { bubbles: true, relatedTarget: label }));
    expect(row).toHaveAttribute("data-drop-target", "true");

    fireEvent(row, new MouseEvent("dragleave", { bubbles: true, relatedTarget: document.body }));
    expect(row).not.toHaveAttribute("data-drop-target", "true");
  });

  it("does not collapse the rail when a dragleave crosses between two rows inside it", () => {
    // Same relatedTarget caveat as above: use a plain MouseEvent, not
    // fireEvent.dragLeave, so relatedTarget actually survives.
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const rail = screen.getByRole("navigation");
    const rowA = screen.getByRole("button", { name: /main/i });
    const rowB = screen.getByRole("button", { name: /second/i });

    fireEvent.dragEnter(rail, dragEvent("b1:w1"));
    expect(rail).toHaveAttribute("data-expanded", "true");

    vi.useFakeTimers();
    try {
      // dragenter/dragleave bubble (mouseenter/mouseleave do not), and the
      // browser fires dragenter on rowB before dragleave on rowA — so only
      // the dragleave (bubbling up to the nav) is at risk of arming a
      // collapse with no later dragenter reaching the nav to cancel it.
      fireEvent(rowA, new MouseEvent("dragleave", { bubbles: true, relatedTarget: rowB }));
      act(() => void vi.advanceTimersByTime(300));
      expect(rail).toHaveAttribute("data-expanded", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the menu on right-click and suppresses the browser's own", () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const label = screen.getByText("My Dashboards");

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(label, event);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(true);
  });

  it("creates a dashboard named Untitled immediately and switches to it", async () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));
    await userEvent.click(screen.getByRole("menuitem", { name: "New dashboard" }));

    await waitFor(() => {
      const created = useDashboardStore.getState().dashboards.find((d) => d.name === "Untitled");
      expect(created).toBeDefined();
      expect(useDashboardStore.getState().activeId).toBe(created?.id);
    });
  });

  it("names the next dashboard Untitled 2 when Untitled is already taken", async () => {
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "Untitled", tabs: [{ id: "t1", name: "Main", cards: [] }] }],
    });
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));
    await userEvent.click(screen.getByRole("menuitem", { name: "New dashboard" }));

    await waitFor(() => {
      expect(
        useDashboardStore.getState().dashboards.map((d) => d.name),
      ).toEqual(["Untitled", "Untitled 2"]);
    });
  });

  // Judgement call: a second right-click inside the same trigger area must
  // reposition the menu rather than leave it stuck closed. The browser
  // dispatches mousedown (which RowContextMenu's outside-press listener
  // sees as "outside", since the new target isn't inside the old menu's DOM
  // node) before contextmenu (which reopens it at the new point) — so both
  // fireEvent calls are needed, in that order, to reproduce it.
  it("repositions the menu on a second right-click in the trigger area, rather than leaving it closed", () => {
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const label = screen.getByText("My Dashboards");

    fireEvent.contextMenu(label, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toHaveStyle({ left: "10px", top: "10px" });

    fireEvent.mouseDown(label);
    fireEvent.contextMenu(label, { clientX: 50, clientY: 60 });

    expect(screen.getByRole("menu")).toHaveStyle({ left: "50px", top: "60px" });
  });

  describe("row-level context menu (rename/delete a specific dashboard)", () => {
    it("opens Rename/Delete on a row's own right-click, not New dashboard", () => {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

      expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "New dashboard" })).not.toBeInTheDocument();
    });

    it("does not also open the section-level menu for the same right-click", () => {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

      // Exactly one menu — the row's own, not a second section-level one
      // racing it via bubbling.
      expect(screen.getAllByRole("menu")).toHaveLength(1);
    });

    it("renames the dashboard through the inline field", async () => {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      // skipClick: the field mounts focused with its text selected, and a
      // click would collapse that selection.
      await userEvent.type(
        screen.getByRole("textbox", { name: "Rename dashboard" }),
        "Renamed{Enter}",
        { skipClick: true },
      );

      await waitFor(() => {
        expect(
          useDashboardStore.getState().dashboards.find((d) => d.id === "d1")?.name,
        ).toBe("Renamed");
      });
      expect(screen.queryByRole("textbox", { name: "Rename dashboard" })).not.toBeInTheDocument();
    });

    it("does not rename when the field is cancelled with Escape", async () => {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      await userEvent.type(
        screen.getByRole("textbox", { name: "Rename dashboard" }),
        "Renamed{Escape}",
        { skipClick: true },
      );

      expect(useDashboardStore.getState().dashboards.find((d) => d.id === "d1")?.name).toBe(
        "Main",
      );
      expect(screen.getByRole("button", { name: /Main/ })).toBeInTheDocument();
    });

    it("deletes the dashboard after the native confirmation", async () => {
      vi.mocked(confirm).mockResolvedValue(true);
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

      await waitFor(() => {
        expect(useDashboardStore.getState().dashboards.find((d) => d.id === "d1")).toBeUndefined();
      });
      expect(confirm).toHaveBeenCalledWith(
        'Delete dashboard "Main"?',
        expect.objectContaining({ title: "Delete dashboard", kind: "warning" }),
      );
    });

    it("does not delete when the confirmation is declined", async () => {
      vi.mocked(confirm).mockResolvedValue(false);
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(useDashboardStore.getState().dashboards.find((d) => d.id === "d1")).toBeDefined();
    });

    it("keeps the rail expanded while the field is open, and collapses again once it closes", async () => {
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      const rail = screen.getByRole("navigation");
      await userEvent.hover(rail);
      expect(rail).toHaveAttribute("data-expanded", "true");

      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      const field = screen.getByRole("textbox", { name: "Rename dashboard" });

      // The rail is `overflow: hidden` at 48px collapsed, so a collapse here
      // would clip the field out of sight mid-typing. mouseOut, not
      // mouseLeave: React synthesizes onMouseLeave from the bubbling
      // mouseout, and fireEvent.mouseLeave would not reach it.
      vi.useFakeTimers();
      try {
        fireEvent.mouseOut(rail, { relatedTarget: document.body });
        act(() => void vi.advanceTimersByTime(300));
        expect(rail).toHaveAttribute("data-expanded", "true");
      } finally {
        vi.useRealTimers();
      }

      fireEvent.keyDown(field, { key: "Escape" });
      expect(screen.queryByRole("textbox", { name: "Rename dashboard" })).not.toBeInTheDocument();

      vi.useFakeTimers();
      try {
        fireEvent.mouseOut(rail, { relatedTarget: document.body });
        act(() => void vi.advanceTimersByTime(300));
        expect(rail).toHaveAttribute("data-expanded", "false");
      } finally {
        vi.useRealTimers();
      }
    });

    it("logs a rejected rename write rather than letting it escape as an unhandled rejection", async () => {
      const renameDashboard = vi.fn().mockRejectedValue(new Error("disk full"));
      useDashboardStore.setState({ renameDashboard });

      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
      await userEvent.type(
        screen.getByRole("textbox", { name: "Rename dashboard" }),
        "Renamed{Enter}",
        { skipClick: true },
      );

      await waitFor(() => {
        const log = __read("logs/bdobb.log") ?? "";
        expect(log).toContain("ERROR");
        expect(log).toContain("failed to rename dashboard");
      });
    });

    it("logs a rejected delete write rather than letting it escape as an unhandled rejection", async () => {
      const removeDashboard = vi.fn().mockRejectedValue(new Error("disk full"));
      useDashboardStore.setState({ removeDashboard });
      vi.mocked(confirm).mockResolvedValue(true);

      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

      await waitFor(() => {
        const log = __read("logs/bdobb.log") ?? "";
        expect(log).toContain("ERROR");
        expect(log).toContain("failed to remove dashboard");
      });
    });

    // The native dialog itself can fail; outside the try that rejection
    // escaped unhandled with nothing logged.
    it("logs a failed delete confirmation rather than letting it escape", async () => {
      vi.mocked(confirm).mockRejectedValue(new Error("ipc"));
      render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
      fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

      await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("failed to remove dashboard"));
      expect(useDashboardStore.getState().dashboards.find((d) => d.id === "d1")).toBeDefined();
    });
  });

  it("reorders dashboards on drag-and-drop, and persists the new order to settings", async () => {
    const reorderDashboards = vi.fn();
    useDashboardStore.setState({ reorderDashboards });
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

    const second = screen.getByRole("button", { name: /second/i });
    expect(second).toHaveAttribute("draggable", "true");

    const setData = vi.fn();
    fireEvent.dragStart(second, {
      dataTransfer: { setData, effectAllowed: "" },
    });
    expect(setData).toHaveBeenCalledWith("application/x-bdobb-dashboard-reorder", "d2");

    const main = screen.getByRole("button", { name: /main/i });
    fireEvent.drop(main, {
      dataTransfer: {
        types: ["application/x-bdobb-dashboard-reorder"],
        getData: (t: string) => (t === "application/x-bdobb-dashboard-reorder" ? "d2" : ""),
      },
    });

    expect(reorderDashboards).toHaveBeenCalledWith(["d2", "d1"]);
    await waitFor(() => {
      const saved = JSON.parse(__read("settings.json") ?? "{}");
      expect(saved.dashboardOrder).toEqual(["d2", "d1"]);
    });
  });

  it("logs a rejected dashboard-order write rather than letting it escape as an unhandled rejection", async () => {
    const reorderDashboards = vi.fn();
    useDashboardStore.setState({ reorderDashboards });
    useSettingsStore.setState({ save: vi.fn().mockRejectedValue(new Error("disk full")) });
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

    const second = screen.getByRole("button", { name: /second/i });
    const setData = vi.fn();
    fireEvent.dragStart(second, {
      dataTransfer: { setData, effectAllowed: "" },
    });

    const main = screen.getByRole("button", { name: /main/i });
    fireEvent.drop(main, {
      dataTransfer: {
        types: ["application/x-bdobb-dashboard-reorder"],
        getData: (t: string) => (t === "application/x-bdobb-dashboard-reorder" ? "d2" : ""),
      },
    });

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to persist dashboard order");
    });
  });

  it("a dashboard-reorder drag does not add a widget, and a widget drag does not reorder", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    const reorderDashboards = vi.fn();
    useDashboardStore.setState({ addCardTo, reorderDashboards });
    useWidgetRegistryStore.setState({
      widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }],
    });
    render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);

    fireEvent.drop(screen.getByRole("button", { name: /second/i }), dragEvent("b1:w1"));
    await waitFor(() => expect(addCardTo).toHaveBeenCalled());
    expect(reorderDashboards).not.toHaveBeenCalled();

    addCardTo.mockClear();
    fireEvent.drop(
      screen.getByRole("button", { name: /main/i }),
      dragEvent("d2", "application/x-bdobb-dashboard-reorder"),
    );
    await waitFor(() => expect(reorderDashboards).toHaveBeenCalled());
    expect(addCardTo).not.toHaveBeenCalled();
  });
});

describe("LeftRail folders", () => {
  /** Puts d2 inside a folder named Macro and returns the folder id. */
  function seedFolder(): string {
    useFoldersStore.setState({
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
      placement: { d2: "f1" },
    });
    return "f1";
  }

  const reorderEvent = (id: string) => ({
    dataTransfer: {
      types: ["application/x-bdobb-dashboard-reorder"],
      getData: (t: string) => (t === "application/x-bdobb-dashboard-reorder" ? id : ""),
    },
  });

  // The file's existing `dragEvent` helper is scoped inside another describe
  // block, so this suite carries its own copy of the same two lines.
  const dragEvent = (key: string, type = WIDGET_DRAG_TYPE) => ({
    dataTransfer: { types: [type], getData: (t: string) => (t === type ? key : "") },
  });

  it("renders a folder row with its dashboards nested under it", () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Macro/ })).toHaveClass("rail-folder-row");
    // d1 stays top level, d2 moved inside — both are still rendered.
    expect(screen.getByRole("button", { name: /Main/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Second/ })).toBeInTheDocument();
  });

  it("collapses and re-expands a folder, hiding and showing its dashboards", async () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    const folder = screen.getByRole("button", { name: /Macro/ });
    expect(folder).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(folder);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Second/ })).not.toBeInTheDocument();
    });
    expect(useFoldersStore.getState().collapsed).toEqual(["f1"]);

    await userEvent.click(screen.getByRole("button", { name: /Macro/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Second/ })).toBeInTheDocument();
    });
  });

  it("keeps the Option shortcut numbering on the FLAT dashboard order, not the tree order", () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    // d1 is index 0 and d2 index 1 in dashboards[], even though the folder
    // row pushes d2 above d1 visually.
    expect(screen.getByRole("button", { name: /Main/ })).toHaveTextContent("⌥1");
    expect(screen.getByRole("button", { name: /Second/ })).toHaveTextContent("⌥2");
  });

  it("moves a dashboard into a folder when its row is dropped on the folder", async () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    fireEvent.drop(screen.getByRole("button", { name: /Macro/ }), reorderEvent("d1"));

    await waitFor(() => {
      expect(useFoldersStore.getState().placement).toEqual({ d1: "f1", d2: "f1" });
    });
  });

  it("highlights a folder row only for a dashboard drag, and clears it after the drop", async () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    const folder = screen.getByRole("button", { name: /Macro/ });

    fireEvent.dragEnter(folder, dragEvent("b1:w1"));
    expect(folder).not.toHaveAttribute("data-drop-target");

    fireEvent.dragEnter(folder, reorderEvent("d1"));
    expect(folder).toHaveAttribute("data-drop-target", "true");

    fireEvent.drop(folder, reorderEvent("d1"));
    await waitFor(() => expect(folder).not.toHaveAttribute("data-drop-target"));
  });

  it("refuses a widget drop on a folder row — a folder has no tab to land a card on", async () => {
    const addCardTo = vi.fn().mockResolvedValue("c1");
    useDashboardStore.setState({ addCardTo });
    useWidgetRegistryStore.setState({ widgets: [{ ...libraryWidget(), id: "w1", backendId: "b1" }] });
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    fireEvent.drop(screen.getByRole("button", { name: /Macro/ }), dragEvent("b1:w1"));

    await waitFor(() => expect(addCardTo).not.toHaveBeenCalled());
  });

  it("creates a folder from the section menu and opens its rename field", async () => {
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));

    await userEvent.click(screen.getByRole("menuitem", { name: "New folder" }));

    await waitFor(() => {
      expect(useFoldersStore.getState().folders.map((f) => f.name)).toEqual(["Untitled"]);
    });
    expect(screen.getByRole("textbox", { name: "Rename folder" })).toBeInTheDocument();
  });

  it("renames a folder inline", async () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    await userEvent.type(
      screen.getByRole("textbox", { name: "Rename folder" }),
      "Rates{Enter}",
      { skipClick: true },
    );

    await waitFor(() => {
      expect(useFoldersStore.getState().folders[0].name).toBe("Rates");
    });
  });

  it("creates a nested folder and a dashboard from a folder row's own menu", async () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New folder here" }));
    await waitFor(() => expect(useFoldersStore.getState().folders).toHaveLength(2));
    expect(useFoldersStore.getState().folders[1].parentId).toBe("f1");

    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New dashboard here" }));
    await waitFor(() => {
      const created = useDashboardStore.getState().dashboards.find((d) => d.name === "Untitled");
      expect(created).toBeDefined();
      expect(useFoldersStore.getState().placement[created!.id]).toBe("f1");
    });
  });

  it("deletes a folder after the native confirmation, reparenting its dashboards", async () => {
    seedFolder();
    vi.mocked(confirm).mockResolvedValue(true);
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));

    await waitFor(() => expect(useFoldersStore.getState().folders).toEqual([]));
    expect(useFoldersStore.getState().placement).toEqual({});
    // Reparented, never deleted with the folder.
    expect(useDashboardStore.getState().dashboards.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("does not delete a folder when the confirmation is declined", async () => {
    seedFolder();
    vi.mocked(confirm).mockResolvedValue(false);
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));

    await waitFor(() => expect(useFoldersStore.getState().folders).toHaveLength(1));
  });

  // The placement entry outlived its dashboard, kept in folders.json for good.
  it("forgets a deleted dashboard's folder placement", async () => {
    seedFolder();
    vi.mocked(confirm).mockResolvedValue(true);
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Second" }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => expect(useFoldersStore.getState().placement).toEqual({}));
  });

  it("logs a failed folder delete confirmation rather than letting it escape", async () => {
    seedFolder();
    vi.mocked(confirm).mockRejectedValue(new Error("ipc"));
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));

    await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("failed to remove folder"));
    expect(useFoldersStore.getState().folders).toHaveLength(1);
  });

  it("moves a dashboard through the row menu's Move to submenu, and back to the top level", async () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Macro" }));
    await waitFor(() => expect(useFoldersStore.getState().placement.d1).toBe("f1"));

    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Top level" }));
    await waitFor(() => expect(useFoldersStore.getState().placement.d1).toBeUndefined());
  });

  it("duplicates a dashboard into the same folder and persists the new flat order", async () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Second/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() => {
      expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual([
        "Main",
        "Second",
        "Second copy",
      ]);
    });
    const copy = useDashboardStore.getState().dashboards[2];
    expect(useFoldersStore.getState().placement[copy.id]).toBe("f1");
    await waitFor(() => {
      const saved = JSON.parse(__read("settings.json") ?? "{}");
      expect(saved.dashboardOrder).toEqual(["d1", "d2", copy.id]);
    });
  });

  it("toggles Disable grouping from the row menu and shows its current state", async () => {
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Disable grouping" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Disable grouping" }));

    await waitFor(() => {
      expect(
        useDashboardStore.getState().dashboards.find((d) => d.id === "d1")?.groupsDisabled,
      ).toBe(true);
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Disable grouping" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("indents a folder's dashboards one step deeper than the folder's own row", () => {
    seedFolder();
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);

    // The row carries its depth as a number, and the stylesheet turns that
    // into the 16px-per-level margin (see rowIndent) -- inline geometry would
    // outrank the collapsed rail's own padding rule. So what is checkable
    // here, with no stylesheet applied, is the depth itself: a nested
    // dashboard is exactly one step deeper than the folder holding it, which
    // is what lands its label on the folder's rather than to the LEFT of it.
    const depth = (el: HTMLElement) => Number(el.style.getPropertyValue("--rail-depth"));
    expect(depth(screen.getByRole("button", { name: /Second/ }))).toBe(
      depth(screen.getByRole("button", { name: /Macro/ })) + 1,
    );
  });

  it("expands a collapsed folder when creating inside it, so the rename field mounts", async () => {
    seedFolder();
    useFoldersStore.setState({ collapsed: ["f1"] });
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "New folder here" }));

    // Without the un-collapse, the new row never mounts and renamingId stays
    // set: the rail sits pinned open around nothing at all.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Rename folder" })).toBeInTheDocument();
    });
    expect(useFoldersStore.getState().collapsed).toEqual([]);
    expect(screen.getByRole("button", { name: /Macro/ })).toHaveAttribute("aria-expanded", "true");

    // And the rail lets go again once the field is gone. Same idiom as the
    // rename test above: the click left the rail hovered, so the collapse
    // needs an explicit mouseOut plus the hover timer to actually run.
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename folder" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Rename folder" })).not.toBeInTheDocument();

    const rail = screen.getByRole("navigation");
    vi.useFakeTimers();
    try {
      fireEvent.mouseOut(rail, { relatedTarget: document.body });
      act(() => void vi.advanceTimersByTime(300));
      expect(rail).toHaveAttribute("data-expanded", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("expands a collapsed folder when creating a dashboard inside it", async () => {
    seedFolder();
    useFoldersStore.setState({ collapsed: ["f1"] });
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "New dashboard here" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Untitled/ })).toBeInTheDocument();
    });
    expect(useFoldersStore.getState().collapsed).toEqual([]);
  });

  it("logs a rejected folder write rather than letting it escape as an unhandled rejection", async () => {
    seedFolder();
    useFoldersStore.setState({ deleteFolder: vi.fn().mockRejectedValue(new Error("disk full")) });
    vi.mocked(confirm).mockResolvedValue(true);
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Macro/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("ERROR");
      expect(log).toContain("failed to remove folder");
    });
  });
});

describe("LeftRail apps.json and the viewer window", () => {
  it("writes the Strict OpenBB Workspace app to the path the Save panel answered", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: "/tmp/Main.apps.json", format: "strict" });
    render(<LeftRail onOpenAI={vi.fn()} onOpenApps={vi.fn()} onOpenLibrary={vi.fn()} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));

    await waitFor(() => expect(__read("tmp/Main.apps.json")).toBeDefined());
    const written = JSON.parse(__read("tmp/Main.apps.json") ?? "");
    expect(Array.isArray(written)).toBe(true);
    expect(written[0].name).toBe("Main");
    expect(written[0].allowCustomization).toBe(true);
    expect(Object.keys(written[0].tabs)).toEqual(["t1"]);
    expect(invoke).toHaveBeenCalledWith("save_workspace_panel", { defaultName: "Main.apps.json" });
    expect(await screen.findByRole("status")).toHaveTextContent("Exported Main.");
  });

  it("writes BDOBB Workspace table state without an internal card id", async () => {
    const dashboards = useDashboardStore.getState().dashboards;
    useDashboardStore.setState({ dashboards: dashboards.map((d) => d.id !== "d1" ? d : {
      ...d, tabs: [{ id: "t1", name: "Main", cards: [{ id: "internal-export-card", widgetId: "prices", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 20, h: 9 }, table: { pinned: { close: null } } }] }],
    }) });
    vi.mocked(invoke).mockResolvedValue({ path: "/tmp/Main.apps.json", format: "bdobb" });
    render(<LeftRail onOpenAI={vi.fn()} onOpenApps={vi.fn()} onOpenLibrary={vi.fn()} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));
    await waitFor(() => expect(__read("tmp/Main.apps.json")).toBeDefined());
    const text = __read("tmp/Main.apps.json") ?? "";
    expect(text).not.toContain("internal-export-card");
    expect(JSON.parse(text)[0].tabs.t1.layout[0].state.extensions.bdobb.table.pinned).toEqual({ close: null });
    expect(await screen.findByRole("status")).toHaveTextContent("Exported Main with BDOBB v3 state.");
  });

  it("names the profile the BDOBB Workspace save actually wrote (#18)", async () => {
    const dashboards = useDashboardStore.getState().dashboards;
    useDashboardStore.setState({ dashboards: dashboards.map((d) => d.id !== "d1" ? d : {
      ...d, tabs: [{ id: "t1", name: "Main", cards: [{ id: "c", widgetId: "prices", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 20, h: 9 }, view: "calendar" }] }],
    }) });
    vi.mocked(invoke).mockResolvedValue({ path: "/tmp/Main.apps.json", format: "bdobb" });
    render(<LeftRail onOpenAI={vi.fn()} onOpenApps={vi.fn()} onOpenLibrary={vi.fn()} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));
    await waitFor(() => expect(__read("tmp/Main.apps.json")).toBeDefined());
    expect(JSON.parse(__read("tmp/Main.apps.json") ?? "")[0].extensions.bdobb.profile).toBe("v4");
    expect(await screen.findByRole("status")).toHaveTextContent("Exported Main with BDOBB v4 state.");
  });

  it("refuses invalid BDOBB Workspace state and writes nothing", async () => {
    const dashboards = useDashboardStore.getState().dashboards;
    useDashboardStore.setState({ dashboards: dashboards.map((d) => d.id !== "d1" ? d : {
      ...d, tabs: [{ id: "t1", name: "Main", cards: [{ id: "c", widgetId: "prices", backendId: "b1", params: {}, layout: { x: 0, y: 0, w: 20, h: 9 }, table: { widths: { close: -1 } } }] }],
    }) });
    vi.mocked(invoke).mockResolvedValue({ path: "/tmp/Main.apps.json", format: "bdobb" });
    render(<LeftRail onOpenAI={vi.fn()} onOpenApps={vi.fn()} onOpenLibrary={vi.fn()} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Export refused: INVALID_EXTENSION");
    expect(__read("tmp/Main.apps.json")).toBeUndefined();
  });

  it("writes nothing when the Save panel is cancelled", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    render(<LeftRail onOpenAI={vi.fn()} onOpenApps={vi.fn()} onOpenLibrary={vi.fn()} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));

    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalled());
    expect(__read("tmp/Main.apps.json")).toBeUndefined();
  });

  it("logs a failed export and shows a notice, without naming any card value", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    render(<LeftRail onOpenAI={vi.fn()} onOpenApps={vi.fn()} onOpenLibrary={vi.fn()} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Save…" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Export failed: disk full");
    await waitFor(() => {
      expect(__read("logs/bdobb.log") ?? "").toContain("failed to export dashboard");
    });
  });

  it("imports a file, adds its dashboards, activates the first, and reports the counts", async () => {
    useWidgetRegistryStore.setState({ widgets: [{ ...libraryWidget(), id: "quote", backendId: "b1" }] });
    __seedFs(
      "imports/apps.json",
      JSON.stringify([
        {
          name: "Imported",
          description: "",
          img: "",
          img_dark: "",
          img_light: "",
          allowCustomization: true,
          tabs: {
            t1: {
              id: "t1",
              name: "Main",
              layout: [
                { i: "quote", x: 0, y: 0, w: 20, h: 9 },
                { i: "nowhere", x: 20, y: 0, w: 20, h: 9 },
              ],
            },
          },
          groups: [],
          prompts: [],
        },
      ]),
    );
    vi.mocked(open).mockResolvedValue("imports/apps.json");
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));

    await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Imported 1 dashboard, 2 cards (1 unresolved: nowhere)",
    );
    const added = useDashboardStore.getState().dashboards.find((d) => d.name === "Imported")!;
    expect(added.tabs[0].cards.map((c) => c.backendId)).toEqual(["b1", "unresolved"]);
    expect(useDashboardStore.getState().activeId).toBe(added.id);
    await waitFor(() => {
      const saved = JSON.parse(__read("settings.json") ?? "{}");
      expect(saved.dashboardOrder).toEqual(["d1", "d2", added.id]);
    });
  });

  it("asks about a name you already use and replaces it in place", async () => {
    vi.mocked(decideImportConflicts).mockResolvedValueOnce(["replace"]);
    __seedFs(
      "imports/apps.json",
      JSON.stringify([{ name: "Second", tabs: { t1: { id: "t1", name: "From file", layout: [] } } }]),
    );
    vi.mocked(open).mockResolvedValue("imports/apps.json");
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));

    await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Imported 1 dashboard (1 replaced), 0 cards",
    );
    const { dashboards } = useDashboardStore.getState();
    expect(dashboards.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(dashboards[1].name).toBe("Second");
    expect(dashboards[1].tabs[0].name).toBe("From file");
  });

  it("reports a malformed file as a notice rather than throwing", async () => {
    __seedFs("imports/apps.json", '{"not":"an array"}');
    vi.mocked(open).mockResolvedValue("imports/apps.json");
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));

    await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Import failed: not an apps.json file",
    );
    expect(useDashboardStore.getState().dashboards).toHaveLength(2);
  });

  it("imports nothing when the open dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValue(null);
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));

    await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));

    await waitFor(() => expect(vi.mocked(open)).toHaveBeenCalled());
    expect(useDashboardStore.getState().dashboards).toHaveLength(2);
  });

  it("refuses an oversize file with a notice, and imports nothing", async () => {
    // memfs's stat reports the seeded string's length, so this IS an
    // 11 MB file as far as the flow can tell -- and it is never parsed.
    __seedFs("imports/apps.json", "x".repeat(11 * 1024 * 1024));
    vi.mocked(open).mockResolvedValue("imports/apps.json");
    const importSpy = vi.spyOn(useDashboardStore.getState(), "importDashboards");
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));

    await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "File is 11 MB; the limit is 10 MB.",
    );
    expect(importSpy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards).toHaveLength(2);
  });

  it("refuses a file holding more dashboards than the limit", async () => {
    const apps = Array.from({ length: 501 }, (_, i) => ({
      name: `App ${i}`,
      description: "",
      img: "",
      img_dark: "",
      img_light: "",
      allowCustomization: true,
      tabs: { t1: { id: "t1", name: "Main", layout: [] } },
      groups: [],
      prompts: [],
    }));
    __seedFs("imports/apps.json", JSON.stringify(apps));
    vi.mocked(open).mockResolvedValue("imports/apps.json");
    const importSpy = vi.spyOn(useDashboardStore.getState(), "importDashboards");
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("My Dashboards"));

    await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "File holds 501 dashboards; the limit is 500.",
    );
    expect(importSpy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboards).toHaveLength(2);
  });

  it("opens a second window on the viewer route, labelled by the dashboard id", async () => {
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Open in a new window" }));

    await waitFor(() =>
      expect(webviewWindowCtor).toHaveBeenCalledWith("dash-d1", {
        url: "/?viewer=d1",
        title: "Main",
        width: 1200,
        height: 800,
        // Tauri would otherwise swallow every drop before the webview saw
        // it, leaving DropZone's window guard unable to run there.
        dragDropEnabled: false,
      }),
    );
  });

  it("focuses the existing window instead of creating a second one", async () => {
    getByLabel.mockResolvedValue({ setFocus });
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Open in a new window" }));

    await waitFor(() => expect(setFocus).toHaveBeenCalled());
    expect(webviewWindowCtor).not.toHaveBeenCalled();
  });

  it("logs a window that could not be opened", async () => {
    getByLabel.mockRejectedValue(new Error("no runtime"));
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Main/ }));

    await userEvent.click(screen.getByRole("menuitem", { name: "Open in a new window" }));

    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("failed to open dashboard d1 in a new window");
    });
  });
});

describe("rail icons", () => {
  function rail() {
    render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} />);
  }

  // All five button rows. "Add widget (⌘K)" is spelled out verbatim on
  // purpose: e2e/layout.spec.ts's quick-add toolbar test tells the tab bar's
  // "Add widget" from this one by an exact match, so the parentheses and the
  // ⌘K are load-bearing.
  it.each(["Add widget (⌘K)", "Widget Library", "Connections", "Settings", "Help"])(
    "gives the %s row an icon and keeps its accessible name",
    (name) => {
      rail();
      const button = screen.getByRole("button", { name });
      expect(button.querySelector("svg.rail-icon")).not.toBeNull();
      // The label is still in the DOM alongside the icon -- the collapsed
      // rule hides it with display: none, which is why the button also
      // carries an aria-label so this query keeps working either way.
      expect(button.querySelector(".rail-item-label")).toHaveTextContent(name);
      expect(button).toHaveAttribute("aria-label", name);
    },
  );

  it("accents exactly one icon in the whole rail: the quick-add plus", () => {
    rail();
    const accented = document.querySelectorAll(".rail-icon-accent");
    expect(accented).toHaveLength(1);
    expect(accented[0].closest("button")).toHaveAttribute("aria-label", "Add widget (⌘K)");
  });

  // The badge leads the row, matching the fixed rows' [icon][label] shape, so
  // the collapsed rail has its glyph in the same column on every kind of row.
  it("puts a dashboard row's ⌥N badge before its name", () => {
    rail();
    // Exact, not /Main/: the row's own aria-label is what names it, so the
    // badge text cannot leak into the name and the name survives the collapsed
    // rule that hides the label span.
    const row = screen.getByRole("button", { name: "Main" });
    const kbd = row.querySelector("kbd.rail-shortcut") as HTMLElement;
    const label = row.querySelector(".rail-item-label") as HTMLElement;
    expect(kbd).not.toBeNull();
    expect(label).not.toBeNull();
    // Both orderings would satisfy "contains a kbd and a label", so assert the
    // order itself -- DOCUMENT_POSITION_FOLLOWING means label comes after kbd.
    expect(kbd.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.children[0]).toBe(kbd);
  });

  // Collapsed, .rail-item-label is display: none and leaves the accessibility
  // tree, so a row whose name lives only in that span becomes a nameless
  // button. jsdom applies no stylesheet, so the attribute itself is the only
  // thing a unit test can hold onto -- asserting on the name alone would pass
  // here either way.
  it("names dashboard and folder rows with an aria-label, so the name survives collapsing", () => {
    useFoldersStore.setState({
      ...makeEmptyFolders(),
      ...REAL_FOLDERS_ACTIONS,
      folders: [{ id: "f1", name: "Macro", parentId: null }],
    });
    rail();
    expect(screen.getByRole("button", { name: "Main" })).toHaveAttribute("aria-label", "Main");
    expect(screen.getByRole("button", { name: "Macro" })).toHaveAttribute("aria-label", "Macro");
  });
});

describe("LeftRail Help menu", () => {
  it("collapses the hover panel and calls onOpenHelp with the chosen set", async () => {
    const order: string[] = [];
    const onOpenHelp = vi.fn(() => order.push("help"));
    render(
      <LeftRail
        onOpenLibrary={vi.fn()}
        onOpenAI={vi.fn()}
        onOpenApps={() => {}} onOpenConnections={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={onOpenHelp}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /quick help/i }));

    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(onOpenHelp).toHaveBeenCalledWith("quick");
    expect(order).toEqual(["help"]);
    // The rail collapses before the dialog opens -- panel.close() runs first,
    // exactly as it does for Connections and Settings.
    expect(document.querySelector("nav.left-rail[data-expanded='true']")).toBeNull();
    // Choosing an item closes the menu, the same as every other item here.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("puts the two help items first and leaves the two feedback items behind them", async () => {
    render(
      <LeftRail
        onOpenLibrary={vi.fn()}
        onOpenAI={vi.fn()}
        onOpenApps={() => {}} onOpenConnections={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Help" }));

    const names = screen.getAllByRole("menuitem").map((i) => i.textContent ?? "");
    expect(names).toHaveLength(5);
    expect(names[0]).toMatch(/quick help/i);
    expect(names[1]).toMatch(/reference manual/i);
    expect(names[2]).toMatch(/report a bug/i);
    expect(names[3]).toMatch(/request a feature/i);
    expect(names[4]).toMatch(/source code/i);
    // One rule, above Report a Bug: neither help set is a feedback destination.
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("calls onOpenHelp with the manual set when Reference Manual is chosen", async () => {
    const onOpenHelp = vi.fn();
    render(
      <LeftRail
        onOpenLibrary={vi.fn()}
        onOpenAI={vi.fn()}
        onOpenApps={() => {}}
        onOpenConnections={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={onOpenHelp}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /reference manual/i }));

    expect(onOpenHelp).toHaveBeenCalledWith("manual");
    expect(document.querySelector("nav.left-rail[data-expanded='true']")).toBeNull();
  });

  it("names the shortcut on the item, so it is discoverable from the menu", async () => {
    render(
      <LeftRail
        onOpenLibrary={vi.fn()}
        onOpenAI={vi.fn()}
        onOpenApps={() => {}} onOpenConnections={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Help" }));

    // In the label itself, not a second column -- the rail's own "Add widget
    // (⌘K)" row spells its shortcut the same way.
    expect(screen.getByRole("menuitem", { name: /quick help/i })).toHaveTextContent("⌘?");
  });
});

describe("LeftRail import MCP-server failure", () => {
  // final review M3: the dashboards are imported and ordered by then, so a
  // failed MCP-server save must not turn the notice into "Import failed".
  it("keeps the import's notice when only its MCP servers fail to save", async () => {
    __seedFs(
      "imports/apps.json",
      JSON.stringify([
        {
          name: "Imported",
          tabs: { t1: { id: "t1", name: "Main", layout: [] } },
          mcp_servers: [{ name: "Docs", description: "", url: "https://docs.example/mcp", authType: "token" }],
        },
      ]),
    );
    vi.mocked(open).mockResolvedValue("imports/apps.json");
    const save = useSettingsStore.getState().save;
    // The first save is the dashboard order; the second is the MCP servers.
    useSettingsStore.setState({ save: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("disk full")) });
    try {
      render(<LeftRail onOpenLibrary={vi.fn()} onOpenAI={vi.fn()} onOpenApps={() => {}} onOpenConnections={vi.fn()} onOpenSettings={vi.fn()} onOpenHelp={vi.fn()} onOpenWorkspace={vi.fn()} />);
      fireEvent.contextMenu(screen.getByText("My Dashboards"));

      await userEvent.click(screen.getByRole("menuitem", { name: "Import apps.json…" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Imported 1 dashboard, 0 cards");
      expect(screen.getByRole("status")).not.toHaveTextContent(/failed/i);
      await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("its MCP servers could not be saved"));
    } finally {
      act(() => {
        useSettingsStore.setState({ save });
      });
    }
  });
});

describe("AI Library row", () => {
  it("sits directly after Widget Library and opens after collapsing the rail", () => {
    const order: string[] = [];
    closeSpy.mockImplementation(() => order.push("close"));
    const onOpenAI = vi.fn(() => order.push("ai"));
    render(
      <LeftRail
        onOpenLibrary={vi.fn()}
        onOpenAI={onOpenAI}
        onOpenApps={() => {}}
        onOpenConnections={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
        onOpenWorkspace={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(rows.indexOf("AI Library")).toBe(rows.indexOf("Widget Library") + 1);
    fireEvent.click(screen.getByRole("button", { name: "AI Library" }));
    // Same ordering contract as the Widget Library button above it: the
    // expanded rail (z-index 40) would otherwise stay painted over the
    // library overlay (z-index 30).
    expect(onOpenAI).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["close", "ai"]);
  });
});

it("offers corresponding source in Help and opens the exact archived revision", async () => {
  const { sourceOffer } = await import("../lib/sourceOffer");
  render(<LeftRail onOpenLibrary={() => {}} onOpenAI={() => {}} onOpenApps={() => {}} onOpenConnections={() => {}} onOpenSettings={() => {}} onOpenHelp={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Help" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /source code/i }));
  expect(openUrl).toHaveBeenCalledWith(sourceOffer.archiveUrl);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
