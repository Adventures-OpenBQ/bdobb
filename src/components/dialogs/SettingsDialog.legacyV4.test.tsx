// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

const openMock = vi.fn();
const saveMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => openMock(...a),
  save: (...a: unknown[]) => saveMock(...a),
}));

// KeysPanel does its own backend discovery and fetching; the dialog's tests
// only need to know the section is mounted, not exercise key-maint.
// keysPanelMounts counts true mounts (via an effect with an empty deps
// array, which only re-fires if the component is actually unmounted and
// re-inserted -- not on every re-render), so a test can prove KeysPanel
// stays mounted across a tab round trip instead of being torn down and
// rebuilt. vi.hoisted() is required because vi.mock factories are hoisted
// above ordinary imports/consts.
const keysPanelMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./KeysPanel", async () => {
  const React = await import("react");
  return {
    KeysPanel: () => {
      React.useEffect(() => {
        keysPanelMounts.count++;
      }, []);
      return <div data-testid="keys-panel-stub" />;
    },
  };
});

// A form section's own behaviour is SettingsForm.test.tsx's; here it only
// needs to be identifiable and to count its mounts, like the keys stub above.
const formMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./settings/SettingsForm", async () => {
  const React = await import("react");
  return {
    SettingsForm: ({ widget }: { widget: { name: string } }) => {
      React.useEffect(() => {
        formMounts.count++;
      }, []);
      return <div data-testid={`form-${widget.name}`} />;
    },
  };
});

import { __failPath, __failRead, __read, __reset, __restoreRead, __seed } from "../../test/memfs";
import { decimalPlacesExample } from "../../lib/format";
import { makeEmptyFolders } from "../../lib/foldersFile";
import { __resetLoggerForTests } from "../../lib/logger";
import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import {
  DEFAULT_SETTINGS,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  WIDGET_GAP_MAX,
  WIDGET_GAP_MIN,
} from "../../lib/settingsFile";
import type { WidgetDef } from "../../lib/types";
import { backend, widget } from "../../test/fixtures";
import { useBackendsStore } from "../../stores/backendsStore";
import { useFoldersStore } from "../../stores/foldersStore";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { HelpDialog } from "./HelpDialog";
import { SettingsDialog } from "./SettingsDialog";

/**
 * The store's real save action, captured once so a test can swap in a spy to
 * count writes and beforeEach can always put the real one back.
 */
const realSave = useSettingsStore.getState().save;
const realReplaceAll = useFoldersStore.getState().replaceAll;

/** Switches to the named tab, matching what a click on the tab bar does. */
async function openTab(name: string) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, save: realSave, draft: null });
  useFoldersStore.setState({ replaceAll: realReplaceAll });
  keysPanelMounts.count = 0;
  useWidgetRegistryStore.setState({ widgets: [] });
  useBackendsStore.setState({ backends: [], statuses: {} });
  formMounts.count = 0;
  openMock.mockReset();
  saveMock.mockReset();
});

/** One key-maint backend, advertising its Keys section the v3.0.3 way. */
function connectKeyMaint() {
  useBackendsStore.setState({ backends: [backend({ id: "km", name: "key-maint" })] });
  useWidgetRegistryStore.setState({
    widgets: [
      widget({ id: "provider_api_keys_panel", backendId: "km", type: "keys", endpoint: "keys" }),
      widget({ id: "provider_api_keys_settings", backendId: "km", name: "Provider API Keys", type: "settings", endpoint: "keys", settingsUi: { kind: "app", name: "keys" } }),
    ],
  });
}

describe("shell and tabs", () => {
  // REVIEW (v8 Part C, C2): "four" became "five": Settings ▸ Locked Widgets
  // sits before Logs; the counts and lists below gain it and nothing else.
  it("opens as a real modal dialog with the five app tabs, General selected by default", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.tagName).toBe("DIALOG");
    // jsdom's showModal() stand-in (src/test/setup.ts) records the open
    // attribute, which is the observable part of the real modal behavior.
    expect(dialog).toHaveAttribute("open");

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["General", "Widget", "Layout", "Locked Widgets", "Logs"]);
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    for (const name of ["Widget", "Layout", "Locked Widgets", "Logs"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "false");
    }
  });

  it("gives only the selected tab a 0 tabIndex (roving tabindex)", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("tabIndex", "0");
    for (const name of ["Widget", "Layout", "Locked Widgets", "Logs"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("tabIndex", "-1");
    }
  });

  it("moves tab selection with Arrow, Home and End (DialogTabs' own keyboard handling)", async () => {
    // A light integration check -- DialogTabs.test.tsx already exercises
    // its full keyboard contract; this only proves Settings is wired to it.
    render(<SettingsDialog onClose={vi.fn()} />);
    screen.getByRole("tab", { name: "General" }).focus();

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Widget" })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Logs" })).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders exactly one tabpanel, named for the selected tab", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("General");

    await openTab("Layout");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Layout");
  });
});

describe("staging -- nothing writes until Done", () => {
  it("stages every control across every tab without ever calling save or touching disk", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={vi.fn()} />);

    // Light, not System: System is already the default, so clicking it
    // (an already-checked radio) fires no change event and stages nothing.
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    await userEvent.selectOptions(screen.getByLabelText("Auto-refresh"), "15");
    await userEvent.click(screen.getByRole("switch", { name: "Match dashboard symbol" }));

    await openTab("Widget");
    await userEvent.selectOptions(screen.getByLabelText("Maximum decimal places"), "4");
    await userEvent.click(screen.getByRole("switch", { name: "Minimize button on header" }));
    await userEvent.click(screen.getByRole("switch", { name: "Collapse widget controls" }));

    await openTab("Layout");
    await userEvent.click(screen.getByRole("switch", { name: "Corner drag handles" }));
    await userEvent.click(screen.getByRole("switch", { name: "Quick add toolbar" }));
    fireEvent.change(screen.getByLabelText("Collapsed rail width"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Dashboard widget spacing"), { target: { value: "20" } });

    expect(save).not.toHaveBeenCalled();
    expect(__read("settings.json")).toBeUndefined();
    // The committed settings are untouched -- only the draft moved.
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);

    expect(useSettingsStore.getState().draft?.patch).toMatchObject({
      theme: "light",
      fontSize: "large",
      autoRefreshMinutes: 15,
      matchDashboardSymbol: true,
      maxDecimalPlaces: 4,
      minimizeButton: true,
      collapseWidgetControls: true,
      cornerDragHandles: true,
      quickAddToolbar: false,
      railWidth: 90,
      widgetGap: 20,
    });
  });
});

describe("live preview through selectEffective", () => {
  it("previews a staged theme, including System, before it is committed", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(selectEffective(useSettingsStore.getState()).theme).toBe("dark");
    expect(useSettingsStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);

    await userEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(selectEffective(useSettingsStore.getState()).theme).toBe("system");
  });

  it("previews a staged font size before it is committed", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(selectEffective(useSettingsStore.getState()).fontSize).toBe("large");
    expect(useSettingsStore.getState().settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it("previews the collapsed rail width as it is dragged, and commits only on release", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, railWidth: 72 } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Layout");
    const input = screen.getByLabelText("Collapsed rail width") as HTMLInputElement;

    expect(input).toHaveAttribute("type", "range");
    expect(input.value).toBe("72");
    expect(input).toHaveAttribute("min", String(RAIL_WIDTH_MIN));
    expect(input).toHaveAttribute("max", String(RAIL_WIDTH_MAX));
    expect(screen.getByText("72 px")).toBeInTheDocument();

    fireEvent.input(input, { target: { value: "60" } });
    fireEvent.input(input, { target: { value: "90" } });
    expect(screen.getByText("90 px")).toBeInTheDocument();
    expect(useSettingsStore.getState().draft?.patch.railWidth).toBeUndefined();

    fireEvent.change(input, { target: { value: "90" } });
    expect(selectEffective(useSettingsStore.getState()).railWidth).toBe(90);
    expect(useSettingsStore.getState().settings.railWidth).toBe(72);
  });

  it("previews the dashboard widget spacing as it is dragged, and commits only on release", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, widgetGap: 18 } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Layout");
    const input = screen.getByLabelText("Dashboard widget spacing") as HTMLInputElement;

    expect(input).toHaveAttribute("type", "range");
    expect(input.value).toBe("18");
    expect(input).toHaveAttribute("min", String(WIDGET_GAP_MIN));
    expect(input).toHaveAttribute("max", String(WIDGET_GAP_MAX));
    expect(screen.getByText("18 px")).toBeInTheDocument();
    expect(screen.getByText("Space between cards.")).toBeInTheDocument();

    fireEvent.input(input, { target: { value: "12" } });
    expect(screen.getByText("12 px")).toBeInTheDocument();
    expect(useSettingsStore.getState().draft?.patch.widgetGap).toBeUndefined();

    fireEvent.change(input, { target: { value: "12" } });
    expect(selectEffective(useSettingsStore.getState()).widgetGap).toBe(12);
    expect(useSettingsStore.getState().settings.widgetGap).toBe(18);
  });
});

describe("default ticker", () => {
  it("holds the typed ticker only in local state -- blur never stages or saves it", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    const input = screen.getByLabelText("Default widget ticker");
    await userEvent.type(input, "  aapl  ");
    fireEvent.blur(input);

    expect(useSettingsStore.getState().draft?.patch.defaultTicker).toBeUndefined();
    expect(useSettingsStore.getState().settings.defaultTicker).toBeUndefined();
  });

  it("does not stage or save a typed ticker when switching away from General", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    const input = screen.getByLabelText("Default widget ticker");
    await userEvent.type(input, "aapl");
    await openTab("Widget");

    expect(useSettingsStore.getState().draft?.patch.defaultTicker).toBeUndefined();
    expect(useSettingsStore.getState().settings.defaultTicker).toBeUndefined();

    // The typed text survives the round trip in local state.
    await openTab("General");
    expect(screen.getByLabelText("Default widget ticker")).toHaveValue("aapl");
  });

  it("does not stage or save a typed ticker on Escape", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Default widget ticker"), "aapl");
    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().settings.defaultTicker).toBeUndefined();
  });

  it("Done trims and commits the typed ticker", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Default widget ticker"), "  aapl  ");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.defaultTicker).toBe("aapl");
      expect(JSON.parse(__read("settings.json") ?? "").defaultTicker).toBe("aapl");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Done clears the ticker when the field is emptied", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, defaultTicker: "AAPL" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    const input = screen.getByLabelText("Default widget ticker");
    expect(input).toHaveValue("AAPL");
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.defaultTicker).toBeUndefined();
      expect(JSON.parse(__read("settings.json") ?? "")).not.toHaveProperty("defaultTicker");
    });
  });
});

describe("Done / Cancel / Close / Escape", () => {
  it("Done writes exactly one dirty-only save, then closes", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ save });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await openTab("Layout");
    fireEvent.change(screen.getByLabelText("Collapsed rail width"), { target: { value: "90" } });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ theme: "dark", railWidth: 90 });
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("Done is disabled while the commit is pending, and re-enables after it settles", async () => {
    let resolveSave!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => (resolveSave = resolve)));
    useSettingsStore.setState({ save });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    const done = screen.getByRole("button", { name: "Done" });
    await userEvent.click(done);

    expect(done).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    resolveSave();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Cancel discards the draft and closes, writing nothing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ save });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(selectEffective(useSettingsStore.getState()).theme).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).toBeNull();
    // The preview reverts: nothing outside the (now closed) dialog ever saw the staged theme.
    expect(useSettingsStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it("the shell's Close button discards the draft and closes, writing nothing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ save });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("Escape discards the draft and closes, writing nothing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ save });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  // v3.1.3's m35, carried: Escape is Cancel, guard included.
  it("ignores Escape while Done's commit is in flight, so the dialog closes once, on the commit", async () => {
    let resolveSave!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => (resolveSave = resolve)));
    useSettingsStore.setState({ save });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    resolveSave();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // v3.1.3's E1, carried: ⌘? opens Quick Help over Settings (App renders it
  // as a later sibling). Help is on the modal stack, so the press closes Help,
  // the dialog on top, and Settings keeps its staged edit.
  it("Escape with Help open over Settings closes Help and leaves Settings' draft intact", async () => {
    const settingsClose = vi.fn();
    const helpClose = vi.fn();
    const { rerender } = render(<SettingsDialog onClose={settingsClose} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    rerender(
      <>
        <SettingsDialog onClose={settingsClose} />
        <HelpDialog set="quick" onClose={helpClose} />
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(helpClose).toHaveBeenCalledTimes(1);
    expect(settingsClose).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "dark" });
  });

  it("a failed save keeps the draft open and shows the error notice", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    useSettingsStore.setState({ save });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Could not save: disk full");
    expect(onClose).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).not.toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).not.toBeDisabled();
  });

  it("a conflict shows a warning notice; Done again replaces the newer value", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));

    // Something else commits a change to the same field while the dialog is open.
    await act(async () => {
      await useSettingsStore.getState().save({ theme: "light" });
    });

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "theme changed elsewhere while this dialog was open. Done again to replace the newer values.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.theme).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(useSettingsStore.getState().draft).toBeNull();
  });
});

describe("Logs", () => {
  it("shows the resolved log path and the log file's contents", async () => {
    __seed("logs/bdobb.log", "line1\nline2\n");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");

    await waitFor(() => {
      expect(screen.getByText("/fake/appdata/logs/bdobb.log")).toBeInTheDocument();
      expect(screen.getByText(/line1/)).toBeInTheDocument();
    });
  });

  it("shows an empty-state message instead of an error when the log file is absent", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");

    await waitFor(() => {
      expect(screen.getByText(/no log entries yet/i)).toBeInTheDocument();
    });
  });

  it("re-reads the log file on Refresh", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/no log entries yet/i)).toBeInTheDocument());

    __seed("logs/bdobb.log", "line1\n");
    await userEvent.click(screen.getByRole("button", { name: "Refresh log" }));

    await waitFor(() => {
      expect(screen.getByText(/line1/)).toBeInTheDocument();
    });
  });

  it("Export logs is disabled while no log entries are showing", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/no log entries yet/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Export logs" })).toBeDisabled();
  });

  it("Export logs writes the displayed lines, one per line plus a trailing newline, as bdobb-logs-<stamp>.txt", async () => {
    __seed("logs/bdobb.log", "line1\nline2\n");
    saveMock.mockResolvedValue("/tmp/bdobb-logs-stamp.txt");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/line1/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Export logs" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const [{ defaultPath }] = saveMock.mock.calls[0] as [{ defaultPath: string }];
    expect(defaultPath).toMatch(/^bdobb-logs-[0-9T-]+Z\.txt$/);
    expect(__read("/tmp/bdobb-logs-stamp.txt")).toBe("line1\nline2\n");
  });

  it("disables Export logs while an export is in flight", async () => {
    __seed("logs/bdobb.log", "line1\n");
    let resolveSave: ((path: string | null) => void) | undefined;
    saveMock.mockReturnValue(new Promise<string | null>((resolve) => { resolveSave = resolve; }));
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/line1/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Export logs" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export logs" })).toBeDisabled());

    resolveSave?.("/tmp/bdobb-logs-stamp.txt");
    await waitFor(() => expect(screen.getByRole("button", { name: "Export logs" })).not.toBeDisabled());
  });

  it("disables Export logs while a refresh is in flight, even with logs already showing", async () => {
    __seed("logs/bdobb.log", "line1\n");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/line1/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Export logs" })).not.toBeDisabled();

    const logViewer = await import("../../lib/logViewer");
    let resolveTail: ((v: { path: string; lines: string[] }) => void) | undefined;
    const pending = new Promise<{ path: string; lines: string[] }>((resolve) => {
      resolveTail = resolve;
    });
    const spy = vi.spyOn(logViewer, "readLogTail").mockReturnValueOnce(pending);

    await userEvent.click(screen.getByRole("button", { name: "Refresh log" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export logs" })).toBeDisabled());

    resolveTail?.({ path: "/fake/appdata/logs/bdobb.log", lines: ["line1"] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export logs" })).not.toBeDisabled());
    spy.mockRestore();
  });

  it("a cancelled log export says nothing", async () => {
    __seed("logs/bdobb.log", "line1\n");
    saveMock.mockResolvedValue(null);
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/line1/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Export logs" }));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/line1/)).toBeInTheDocument();
  });

  it("a failed log export shows an inline error and keeps the displayed lines", async () => {
    __seed("logs/bdobb.log", "line1\n");
    saveMock.mockResolvedValue("/tmp/bdobb-logs-stamp.txt");
    __failPath("/tmp/bdobb-logs-stamp.txt");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/line1/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Export logs" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/log export failed/i);
    expect(screen.getByText(/line1/)).toBeInTheDocument();
  });

  it("a failed Refresh after a good load keeps the last lines and shows the stale message", async () => {
    __seed("logs/bdobb.log", "line1\n");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await waitFor(() => expect(screen.getByText(/line1/)).toBeInTheDocument());

    __failRead("logs/bdobb.log");
    await userEvent.click(screen.getByRole("button", { name: "Refresh log" }));

    await waitFor(() => {
      expect(screen.getByText("Showing the last loaded log; refresh failed.")).toBeInTheDocument();
    });
    expect(screen.getByText(/line1/)).toBeInTheDocument();

    __restoreRead("logs/bdobb.log");
    __seed("logs/bdobb.log", "line1\nline2\n");
    await userEvent.click(screen.getByRole("button", { name: "Refresh log" }));
    await waitFor(() => {
      expect(screen.queryByText("Showing the last loaded log; refresh failed.")).not.toBeInTheDocument();
      expect(screen.getByText(/line2/)).toBeInTheDocument();
    });
  });
});

describe("Provider keys", () => {
  it("renders a key-maint backend's Keys tab between Layout and Logs; its panel loads only when selected", async () => {
    connectKeyMaint();
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "General", "Widget", "Layout", "Locked Widgets", "Provider API Keys", "Logs",
    ]);
    expect(screen.queryByTestId("keys-panel-stub")).not.toBeInTheDocument();

    await openTab("Provider API Keys");
    expect(screen.getByTestId("keys-panel-stub")).toBeInTheDocument();
  });

  it("keeps the Provider keys panel mounted once visited, hiding (not unmounting) it on other tabs", async () => {
    connectKeyMaint();
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.queryByTestId("keys-panel-stub")).not.toBeInTheDocument();

    await openTab("Provider API Keys");
    expect(screen.getByTestId("keys-panel-stub")).toBeVisible();
    expect(keysPanelMounts.count).toBe(1);

    await openTab("Layout");
    expect(screen.getByTestId("keys-panel-stub")).not.toBeVisible();

    await openTab("Provider API Keys");
    expect(screen.getByTestId("keys-panel-stub")).toBeVisible();
    // Still exactly one mount: the panel was hidden, not torn down and rebuilt.
    expect(keysPanelMounts.count).toBe(1);
  });

  it("shows the Provider keys footer note instead of the Import/Export one", async () => {
    connectKeyMaint();
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Provider API Keys");
    expect(
      screen.getByText(/Key edits use their own permission-gated submit action\./),
    ).toBeInTheDocument();
  });
});

describe("maxDecimalPlaces", () => {
  it("shows the current value as selected", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, maxDecimalPlaces: 4 } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Widget");
    expect(screen.getByLabelText("Maximum decimal places")).toHaveValue(String(4));
    expect(
      (screen.getByRole("option", { name: decimalPlacesExample(4) }) as HTMLOptionElement).selected,
    ).toBe(true);
  });
});

describe("Export… and Import…", () => {
  it("Export… writes the bundle, including a staged (uncommitted) change, and says so", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, railWidth: 60 }, save: realSave });
    saveMock.mockResolvedValue("/tmp/bdobb-settings.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    await userEvent.click(await screen.findByRole("button", { name: "Export…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Exported settings.");
    const bundle = JSON.parse(__read("/tmp/bdobb-settings.json") ?? "{}");
    // The staged (not yet committed) theme is what got exported.
    expect(bundle.settings.theme).toBe("dark");
    // Never committed to disk -- Export previews, it does not save.
    expect(useSettingsStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it("Import… shows a review before staging anything, and Apply stages it per field without writing to disk until Done", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark", railWidth: 60 }, save: realSave });
    __seed("/tmp/in.json", JSON.stringify({ settings: { theme: "light" } }));
    openMock.mockResolvedValue("/tmp/in.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    const review = await screen.findByRole("status");
    expect(review).toHaveTextContent("Older settings file; imported the fields it names.");
    expect(review).toHaveTextContent("Theme: dark → light");

    // Nothing staged yet -- the review sits in front of Apply.
    expect(selectEffective(useSettingsStore.getState()).theme).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Staged, not saved: the committed theme is untouched until Done.
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(selectEffective(useSettingsStore.getState()).theme).toBe("light");
    expect(JSON.parse(__read("settings.json") ?? "null")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(useSettingsStore.getState().settings.theme).toBe("light");
      // Untouched by a file that never mentioned it -- the per-field merge.
      expect(useSettingsStore.getState().settings.railWidth).toBe(60);
    });
  });

  it("an imported default ticker survives Done", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, defaultTicker: "AAPL" }, save: realSave });
    __seed("/tmp/in.json", JSON.stringify({ settings: { defaultTicker: "MSFT" } }));
    openMock.mockResolvedValue("/tmp/in.json");
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useSettingsStore.getState().settings.defaultTicker).toBe("MSFT");
  });

  it("Import… review's Discard drops the parsed plan without staging anything", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" }, save: realSave });
    __seed("/tmp/in.json", JSON.stringify({ settings: { theme: "light" } }));
    openMock.mockResolvedValue("/tmp/in.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    await screen.findByRole("button", { name: "Apply" });

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(selectEffective(useSettingsStore.getState()).theme).toBe("dark");
    expect(useSettingsStore.getState().draft?.patch).toEqual({});
  });

  it("Done surfaces a folder-write failure and keeps the dialog open instead of wedging", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, save: realSave });
    useFoldersStore.setState(makeEmptyFolders());
    useFoldersStore.setState({ replaceAll: vi.fn().mockRejectedValue(new Error("disk full")) });
    __seed("/tmp/in.json", JSON.stringify({ settings: { theme: "light" }, folders }));
    openMock.mockResolvedValue("/tmp/in.json");
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    // The folder write rejected AFTER prefs committed. The dialog must surface the
    // failure, re-enable Done, and NOT close -- the pre-fix bug swallowed the
    // rejection, leaving Done disabled forever with onClose never called.
    expect(await screen.findByText("Could not save: disk full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).not.toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // v3.1.3's E6, carried.
  it("after a failed folder write, further edits still stage and Done retries the folders", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, save: realSave });
    useFoldersStore.setState(makeEmptyFolders());
    const replaceAll = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    useFoldersStore.setState({ replaceAll });
    __seed("/tmp/in.json", JSON.stringify({ settings: { theme: "light" }, folders }));
    openMock.mockResolvedValue("/tmp/in.json");
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Could not save: disk full")).toBeInTheDocument();
    // The prefs commit cleared the draft; the dialog must open a fresh one, or
    // this edit has nowhere to go.
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "dark" });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(replaceAll).toHaveBeenCalledTimes(2);
  });

  it("Import…'s Apply stages a bundle's folders member, applied to useFoldersStore only once Done commits", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, save: realSave });
    useFoldersStore.setState(makeEmptyFolders());
    __seed("/tmp/in.json", JSON.stringify({ settings: { theme: "light" }, folders }));
    openMock.mockResolvedValue("/tmp/in.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Folders: replace 1 folder");

    // Not applied yet -- the review sits in front of Apply, which is what stages it.
    expect(useFoldersStore.getState().folders).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useFoldersStore.getState().folders).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(useFoldersStore.getState().folders).toEqual(folders.folders);
      expect(useFoldersStore.getState().folderOrder).toEqual(folders.folderOrder);
    });
  });

  it("a refused import changes nothing", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" }, save: realSave });
    __seed("/tmp/bad.json", "{not json");
    openMock.mockResolvedValue("/tmp/bad.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("That file is not JSON.");
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(useSettingsStore.getState().draft?.patch).toEqual({});
  });

  it("a cancelled export says nothing", async () => {
    saveMock.mockResolvedValue(null);
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Export…" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a cancelled import says nothing", async () => {
    openMock.mockResolvedValue(null);
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Logs on each visit", () => {
  it("re-reads the log file every time the Logs tab is selected", async () => {
    __seed("logs/bdobb.log", "first\n");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    expect(await screen.findByText(/first/)).toBeInTheDocument();

    await openTab("Layout");
    __seed("logs/bdobb.log", "first\nsecond\n");
    await openTab("Logs");
    expect(await screen.findByText(/second/)).toBeInTheDocument();
  });
});

describe("service sections", () => {
  const settingsWidget = (over: Partial<WidgetDef>): WidgetDef =>
    widget({ type: "settings", endpoint: "settings", settingsUi: { kind: "form" }, ...over });

  it("sit between Layout and Logs, sorted by backend name then widget name", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "z", name: "Zeta" }), backend({ id: "a", name: "Alpha" })] });
    useWidgetRegistryStore.setState({
      widgets: [
        settingsWidget({ id: "c", backendId: "z", name: "Charts" }),
        settingsWidget({ id: "r", backendId: "a", name: "RSS ticker" }),
        settingsWidget({ id: "x", backendId: "a", name: "Archive" }),
      ],
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "General", "Widget", "Layout", "Locked Widgets", "Archive", "RSS ticker", "Charts", "Logs",
    ]);
  });

  it("has no Keys tab when no backend runs key-maint", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Widget", "Layout", "Locked Widgets", "Logs"]);
    expect(screen.queryByTestId("keys-panel-stub")).not.toBeInTheDocument();
  });

  it("labels the Keys tab with the settings widget's name from widgets.json", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "nas", name: "NAS" })] });
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "provider_api_keys_panel", backendId: "nas", type: "keys", endpoint: "keys" }),
        settingsWidget({ id: "provider_api_keys_settings", backendId: "nas", name: "Provider API Keys", settingsUi: { kind: "app", name: "keys" } }),
      ],
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "General", "Widget", "Layout", "Locked Widgets", "Provider API Keys", "Logs",
    ]);
  });

  it("gives each key-maint backend its own Keys section, named for its backend", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "nas", name: "NAS" }), backend({ id: "lap", name: "Laptop" })] });
    useWidgetRegistryStore.setState({
      widgets: [
        widget({ id: "provider_api_keys_panel", backendId: "nas", type: "keys", endpoint: "keys" }),
        settingsWidget({ id: "provider_api_keys_settings", backendId: "nas", name: "Provider API Keys", settingsUi: { kind: "app", name: "keys" } }),
        // The old path on the second backend: labelled with the keys widget's own name.
        widget({ id: "provider_api_keys_panel", backendId: "lap", name: "Provider API Keys", type: "keys", endpoint: "keys" }),
      ],
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "General", "Widget", "Layout", "Locked Widgets", "Provider API Keys (Laptop)", "Provider API Keys (NAS)", "Logs",
    ]);
  });

  it("keeps a visited form section mounted (hidden) across a tab round trip, so edits survive", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "a", name: "Alpha" })] });
    useWidgetRegistryStore.setState({ widgets: [settingsWidget({ id: "r", backendId: "a", name: "RSS ticker" })] });
    render(<SettingsDialog onClose={vi.fn()} />);

    await openTab("RSS ticker");
    expect(screen.getByTestId("form-RSS ticker")).toBeVisible();
    await openTab("Layout");
    expect(screen.getByTestId("form-RSS ticker")).not.toBeVisible();
    await openTab("RSS ticker");
    expect(screen.getByTestId("form-RSS ticker")).toBeVisible();
    expect(formMounts.count).toBe(1);
  });

  it("falls back to General when the selected service section disappears", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "a", name: "Alpha" })] });
    useWidgetRegistryStore.setState({ widgets: [settingsWidget({ id: "r", backendId: "a", name: "RSS ticker" })] });
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("RSS ticker");

    act(() => useWidgetRegistryStore.setState({ widgets: [] }));

    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("General");

    // The section coming back must not pull the user back to it.
    act(() => useWidgetRegistryStore.setState({ widgets: [settingsWidget({ id: "r", backendId: "a", name: "RSS ticker" })] }));
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("General");
  });

  it("shows the reserved page mode and an unknown app name as messages, drawing nothing else", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "a", name: "Alpha" })] });
    useWidgetRegistryStore.setState({
      widgets: [
        settingsWidget({ id: "p", backendId: "a", name: "Paged", settingsUi: { kind: "page", path: "/p" } }),
        settingsWidget({ id: "s", backendId: "a", name: "Studies", settingsUi: { kind: "app", name: "studies" } }),
      ],
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Paged");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Not supported in this version.");
    await openTab("Studies");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Needs a newer app version.");
  });

  it("gives a form section its own footer note: it saves with its own button, not Done", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "a", name: "Alpha" })] });
    useWidgetRegistryStore.setState({ widgets: [settingsWidget({ id: "r", backendId: "a", name: "RSS ticker" })] });
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("RSS ticker");
    expect(
      screen.getByText(
        "This service's settings save with their own Save button. Done applies pending preferences; Cancel discards them.",
      ),
    ).toBeInTheDocument();
  });
});
