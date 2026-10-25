// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

const workspaceConnect = vi.hoisted(() => vi.fn());
const workspacePrompt = vi.hoisted(() => vi.fn());
vi.mock("../runWorkspaceSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runWorkspaceSync")>()),
  connectServer: workspaceConnect,
  promptSignIn: workspacePrompt,
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

import { __failPath, __failRead, __read, __reset, __seed } from "../../test/memfs";
import { stubMatchMedia, type MatchMediaStub } from "../../test/matchMedia";
import { decimalPlacesExample } from "../../lib/format";
import { makeEmptyFolders } from "../../lib/foldersFile";
import { __resetLoggerForTests } from "../../lib/logger";
import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { DEFAULT_SETTINGS, RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from "../../lib/settingsFile";
import type { WidgetDef } from "../../lib/types";
import { backend, widget } from "../../test/fixtures";
import { useBackendsStore } from "../../stores/backendsStore";
import { useFoldersStore } from "../../stores/foldersStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
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

/**
 * DialogTabs (used via the shell) calls useMediaQuery to flip orientation
 * below 740px; jsdom implements no matchMedia at all, so every test needs
 * this stub in place before the dialog mounts.
 */
let media: MatchMediaStub | null = null;

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  // draft: null alongside settings/save -- a leftover draft from a prior
  // test's unmounted dialog would otherwise be found by the next render's
  // mount-guarded beginDraft() and silently reused.
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null, save: realSave });
  useFoldersStore.setState({ replaceAll: realReplaceAll });
  keysPanelMounts.count = 0;
  useWidgetRegistryStore.setState({ widgets: [] });
  useBackendsStore.setState({ backends: [], statuses: {} });
  formMounts.count = 0;
  openMock.mockReset();
  saveMock.mockReset();
  media = stubMatchMedia(false);
});

afterEach(() => {
  media?.restore();
  media = null;
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

describe("SettingsDialog", () => {
  it("opens as a real modal dialog, and refuses the native close request", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveClass("bd-dialog-backdrop");
    // showModal() is what puts it in the top layer, over every card, with the
    // rest of the app inert. jsdom's stand-in (src/test/setup.ts) records it
    // as the open attribute, which is the observable part of it.
    expect(dialog).toHaveAttribute("open");

    // Escape is handled by the component, which unmounts this element; the
    // browser's own close request must not close it behind React's back.
    const cancel = new Event("cancel", { cancelable: true, bubbles: false });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  it("hands focus back to whatever opened it when it unmounts", async () => {
    // The rail's Settings row, standing in for the real trigger: showModal()
    // moves focus into the dialog, so unmounting without restoring it drops a
    // keyboard user on <body>.
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    try {
      trigger.focus();
      const { unmount } = render(<SettingsDialog onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
      // A real showModal() moves focus into the dialog; jsdom's stand-in
      // (src/test/setup.ts) only sets the open attribute, so do it here —
      // otherwise focus never leaves the trigger and the test proves nothing.
      screen.getAllByRole("tab")[0].focus();
      expect(trigger).not.toHaveFocus();

      unmount();

      expect(trigger).toHaveFocus();
    } finally {
      trigger.remove();
    }
  });

  it("renders the four app tabs on the shell, in order, with no Locked Widgets tab", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    expect(screen.getByRole("dialog", { name: "Settings" })).toHaveClass("bd-dialog-backdrop");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["General", "Widget", "Layout", "Logs"]);
  });

  it("offers System alongside Light and Dark", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    expect(screen.getAllByRole("radio", { name: /^(Light|Dark)$/ })).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
  });

  // Restored (pass I, lost-test audit): the v3.1.0 rewrite's tests stage and
  // preview, but none asserted that the dialog OPENS on the stored values.
  // These four do, on this line's controls (the decimal places control is a
  // select here, so that one asserts the selected option, not a radio).
  it("shows the current theme and font size as checked radios", async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, theme: "light", fontSize: "large" },
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
  });

  it("shows Off as the auto-refresh default", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    // findBy, not getBy: the dialog settles asynchronously on mount.
    expect(await screen.findByLabelText("Auto-refresh")).toHaveValue("");
  });

  it("reflects the quick add toolbar's default-on state", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await openTab("Layout");
    expect(screen.getByRole("switch", { name: "Quick add toolbar" })).toBeChecked();
  });

  it("shows the current maxDecimalPlaces as the selected option", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, maxDecimalPlaces: 4 } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await openTab("Widget");
    expect(screen.getByLabelText("Maximum decimal places")).toHaveValue("4");
  });

  it("stages a theme change into the draft and writes nothing until Done", async () => {
    const save = vi.fn(realSave);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "light" });
    expect(save).not.toHaveBeenCalled();
    // The committed setting is unchanged, and the dialog's own preview
    // reflects the staged value (one of the "three preview readers": theme,
    // font size and the rail width, all driven by selectEffective).
    expect(useSettingsStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  });

  it("Done writes one save with only the dirty fields and closes", async () => {
    const onClose = vi.fn();
    const save = vi.fn(realSave);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ theme: "light" });
  });

  it("Done disables itself while the commit is pending", async () => {
    const onClose = vi.fn();
    let resolveSave: () => void = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    const done = screen.getByRole("button", { name: "Done" });
    await userEvent.click(done);
    expect(done).toBeDisabled();
    resolveSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("ignores Escape while Done's commit is in flight, so the dialog closes once, on the commit", async () => {
    const onClose = vi.fn();
    let resolveSave: () => void = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    resolveSave();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("Cancel discards the draft, writes nothing and clears the preview", async () => {
    const onClose = vi.fn();
    const save = vi.fn(realSave);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("Close (the ✕ button) discards the draft and writes nothing", async () => {
    const onClose = vi.fn();
    const save = vi.fn(realSave);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("Escape discards the draft and closes", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  // ⌘? opens Quick Help over Settings (App renders it as a later sibling).
  // Help is on the modal stack, so the press closes Help, the dialog on top,
  // and Settings keeps its staged edit.
  it("Escape with Help open over Settings closes Help and leaves Settings' draft intact", async () => {
    const settingsClose = vi.fn();
    const helpClose = vi.fn();
    const { rerender } = render(
      <>
        <SettingsDialog onClose={settingsClose} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    rerender(
      <>
        <SettingsDialog onClose={settingsClose} />
        <HelpDialog set="quick" onClose={helpClose} />
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(helpClose).toHaveBeenCalledTimes(1);
    expect(settingsClose).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "light" });
  });

  it("shows a conflict notice, then replaces on the second Done", async () => {
    const onClose = vi.fn();
    const save = vi.fn(realSave);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" }, save });
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    // Something else changes theme underneath the open dialog.
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, theme: "light" } });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText(/Done again to replace/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Second Done replaces.
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith({ theme: "light" });
  });

  it("shows a save error inline and keeps the draft when commitDraft fails", async () => {
    const onClose = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText(/could not save: disk full/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "light" });
  });

  it("keeps the ticker out of the store until Done, trimmed and cleared when empty", async () => {
    const save = vi.fn(realSave);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    const ticker = screen.getByRole("textbox", { name: /default widget ticker/i });
    await userEvent.clear(ticker);
    await userEvent.type(ticker, "  aapl  ");
    fireEvent.blur(ticker);
    expect(save).not.toHaveBeenCalled(); // no blur/tab-leave persistence
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ defaultTicker: "aapl" }));
  });

  it("clears the ticker on Done when left empty or whitespace-only", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, defaultTicker: "AAPL" } });
    const save = vi.fn(realSave);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    const ticker = screen.getByRole("textbox", { name: /default widget ticker/i });
    await userEvent.clear(ticker);
    await userEvent.type(ticker, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ defaultTicker: undefined }));
  });

  it("never persists the ticker on switching away from General, unlike v3's old commit-on-tab-leave", async () => {
    const save = vi.fn(realSave);
    useSettingsStore.setState({ save });
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    const ticker = screen.getByRole("textbox", { name: /default widget ticker/i });
    await userEvent.type(ticker, "aapl");
    await openTab("Widget");
    expect(save).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft?.patch).not.toHaveProperty("defaultTicker");
    await openTab("General");
    expect(screen.getByRole("textbox", { name: /default widget ticker/i })).toHaveValue("aapl");
  });

  it("renders a key-maint backend's Keys tab between Layout and Logs; its panel loads only when selected", async () => {
    connectKeyMaint();
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "General", "Widget", "Layout", "Provider API Keys", "Logs",
    ]);
    expect(screen.queryByTestId("keys-panel-stub")).not.toBeInTheDocument();

    await openTab("Provider API Keys");
    expect(screen.getByTestId("keys-panel-stub")).toBeInTheDocument();
  });

  it("keeps KeysPanel mounted across a tab round trip, hiding rather than unmounting it", async () => {
    connectKeyMaint();
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
    await openTab("Provider API Keys");
    expect(screen.getByTestId("keys-panel-stub")).toBeVisible();
    expect(keysPanelMounts.count).toBe(1);

    await openTab("Layout");
    expect(screen.getByTestId("keys-panel-stub")).not.toBeVisible();

    await openTab("Provider API Keys");
    expect(screen.getByTestId("keys-panel-stub")).toBeVisible();
    // Still exactly one mount: the panel was hidden, not torn down and
    // rebuilt, across the round trip.
    expect(keysPanelMounts.count).toBe(1);
  });

  it("the footer note on Provider keys leads with its own permission-gated submit action", async () => {
    connectKeyMaint();
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
    expect(
      screen.getByText(
        "Import and Export include preferences only, never provider keys. Done applies pending preferences; Cancel discards them.",
      ),
    ).toBeInTheDocument();

    await openTab("Provider API Keys");
    expect(
      screen.getByText(
        "Key edits use their own permission-gated submit action. Done applies pending preferences; Cancel discards them.",
      ),
    ).toBeInTheDocument();
  });

  it("stages General tab's font size, auto-refresh and match-dashboard-symbol controls into the draft", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(screen.getByRole("radio", { name: "Large" }));
    await userEvent.selectOptions(screen.getByLabelText("Auto-refresh"), "5");
    await userEvent.click(screen.getByRole("switch", { name: "Match dashboard symbol" }));
    expect(useSettingsStore.getState().draft?.patch).toEqual({
      theme: "light",
      fontSize: "large",
      autoRefreshMinutes: 5,
      matchDashboardSymbol: true,
    });
  });

  it("stages Widget tab controls into the draft", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await openTab("Widget");
    await userEvent.selectOptions(screen.getByLabelText("Maximum decimal places"), decimalPlacesExample(0));
    await userEvent.click(screen.getByRole("switch", { name: "Minimize button on header" }));
    await userEvent.click(screen.getByRole("switch", { name: "Collapse widget controls" }));
    expect(useSettingsStore.getState().draft?.patch).toEqual({
      maxDecimalPlaces: 0,
      minimizeButton: true,
      collapseWidgetControls: true,
    });
  });

  it("stages Layout tab switches and the RangeRow slider into the draft, with the widget-spacing control", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await openTab("Layout");
    await userEvent.click(screen.getByRole("switch", { name: "Corner drag handles" }));
    await userEvent.click(screen.getByRole("switch", { name: "Quick add toolbar" }));
    const rail = screen.getByLabelText("Collapsed rail width") as HTMLInputElement;
    expect(rail).toHaveAttribute("min", String(RAIL_WIDTH_MIN));
    expect(rail).toHaveAttribute("max", String(RAIL_WIDTH_MAX));
    fireEvent.change(rail, { target: { value: "90" } });
    expect(screen.getByLabelText("Dashboard widget spacing")).toBeInTheDocument();
    expect(useSettingsStore.getState().draft?.patch).toEqual({
      cornerDragHandles: true,
      quickAddToolbar: false,
      railWidth: 90,
    });
  });

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

  it("Export logs writes bdobb-logs-<stamp>.txt with the exact joined log content", async () => {
    __seed("logs/bdobb.log", "line1\nline2\n");
    saveMock.mockResolvedValue("/tmp/out.txt");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await screen.findByText(/line1/);

    await userEvent.click(screen.getByRole("button", { name: "Export logs" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    const [opts] = saveMock.mock.calls[0] as [{ defaultPath: string; filters: unknown }];
    // bdobb-logs-<new Date().toISOString() with `:`/`.` -> `-`>.txt
    expect(opts.defaultPath).toMatch(/^bdobb-logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.txt$/);
    expect(opts.filters).toEqual([{ name: "Log files", extensions: ["txt"] }]);
    // logLines.join("\n") + "\n" -- the exact content snapshot, not just "some text".
    expect(__read("/tmp/out.txt")).toBe("line1\nline2\n");
  });

  it("Export logs is disabled while the log is empty, while a refresh is loading, and while an export is in flight", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    const exportBtn = screen.getByRole("button", { name: "Export logs" });
    const refreshBtn = screen.getByRole("button", { name: "Refresh log" });

    // Empty log, nothing seeded: disabled.
    await waitFor(() => expect(screen.getByText(/no log entries yet/i)).toBeInTheDocument());
    expect(exportBtn).toBeDisabled();

    // A refresh in flight disables both buttons; once it resolves with lines
    // present, Export re-enables. fireEvent (not userEvent) so the assertion
    // lands before the awaited read resolves, catching the transient state.
    __seed("logs/bdobb.log", "line1\n");
    fireEvent.click(refreshBtn);
    expect(refreshBtn).toBeDisabled();
    expect(exportBtn).toBeDisabled();
    await waitFor(() => expect(screen.getByText(/line1/)).toBeInTheDocument());
    expect(exportBtn).not.toBeDisabled();

    // An export in flight disables Export until the save dialog settles.
    let resolveSave: ((v: string | null) => void) | undefined;
    saveMock.mockImplementation(() => new Promise<string | null>((resolve) => (resolveSave = resolve)));
    fireEvent.click(exportBtn);
    expect(exportBtn).toBeDisabled();
    resolveSave?.(null);
    await waitFor(() => expect(exportBtn).not.toBeDisabled());
  });

  it("a cancelled Export logs shows no notice", async () => {
    __seed("logs/bdobb.log", "line1\n");
    saveMock.mockResolvedValue(null);
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await screen.findByText(/line1/);

    await userEvent.click(screen.getByRole("button", { name: "Export logs" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a failed Export logs shows an inline error and keeps the displayed log lines", async () => {
    __seed("logs/bdobb.log", "line1\n");
    saveMock.mockResolvedValue("/tmp/out.txt");
    __failPath("/tmp/out.txt");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await screen.findByText(/line1/);

    await userEvent.click(screen.getByRole("button", { name: "Export logs" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/^Log export failed:/);
    expect(screen.getByText(/line1/)).toBeInTheDocument();
  });

  it("a failed Refresh after a successful load keeps the last lines and shows the stale message", async () => {
    __seed("logs/bdobb.log", "line1\n");
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Logs");
    await screen.findByText(/line1/);

    // The file still exists but its content can no longer be read -- a
    // refresh failure, not a first-ever load with nothing to be stale about.
    __failRead("logs/bdobb.log");
    await userEvent.click(screen.getByRole("button", { name: "Refresh log" }));

    expect(await screen.findByText("Showing the last loaded log; refresh failed.")).toBeInTheDocument();
    expect(screen.getByText(/line1/)).toBeInTheDocument();
  });

  it("selects General by default, rendering only its panel", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    for (const name of ["Widget", "Layout", "Logs"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-selected", "false");
    }
  });
});

describe("Export… and Import…", () => {
  it("Export… writes the bundle and says so", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "light", railWidth: 60 }, save: realSave });
    saveMock.mockResolvedValue("/tmp/bdobb-settings.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Export…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Exported settings.");
    const written = JSON.parse(__read("/tmp/bdobb-settings.json") ?? "{}");
    expect(written.kind).toBe("bdobb-settings");
    expect(written.version).toBe(1);
    expect(written.settings.theme).toBe("light");
  });

  it("Export… ships the staged draft, not just what's already on disk", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" }, save: realSave });
    saveMock.mockResolvedValue("/tmp/bdobb-settings.json");
    render(<SettingsDialog onClose={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(await screen.findByRole("button", { name: "Export…" }));
    expect(JSON.parse(__read("/tmp/bdobb-settings.json") ?? "{}").settings.theme).toBe("light");
    // Nothing committed to the store by exporting.
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
  });

  it("Import… shows a review; Apply stages into the draft; Done applies per field, leaving the rest alone", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark", railWidth: 60 }, save: realSave });
    __seed("/tmp/in.json", JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" } }));
    openMock.mockResolvedValue("/tmp/in.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));

    // The review names the one changed field; nothing is staged yet.
    expect(await screen.findByText("Theme: dark → light")).toBeInTheDocument();
    expect(useSettingsStore.getState().draft?.patch ?? {}).toEqual({});
    expect(useSettingsStore.getState().settings.theme).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    // Staged, not yet written.
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "light" });
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(screen.queryByText("Theme: dark → light")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(useSettingsStore.getState().settings.theme).toBe("light"));
    // Untouched by a file that never mentioned it — this is the per-field merge.
    expect(useSettingsStore.getState().settings.railWidth).toBe(60);
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
    __seed("/tmp/in.json", JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" }, folders }));
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

  it("after a failed folder write, further edits still stage and Done retries the folders", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    useFoldersStore.setState(makeEmptyFolders());
    const replaceAll = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    useFoldersStore.setState({ replaceAll });
    __seed("/tmp/in.json", JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" }, folders }));
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

  it("Import… review shows the folder line; Apply stages the tree; Done replaces it in useFoldersStore", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, save: realSave });
    useFoldersStore.setState(makeEmptyFolders());
    __seed("/tmp/in.json", JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" }, folders }));
    openMock.mockResolvedValue("/tmp/in.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));

    expect(await screen.findByText("Folders: replace 1 folder")).toBeInTheDocument();
    // Not written yet -- the review is only a preview.
    expect(useFoldersStore.getState().folders).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    // Applied into dialog state, still not written to the store.
    expect(useFoldersStore.getState().folders).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(useFoldersStore.getState().folders).toEqual(folders.folders));
    expect(useFoldersStore.getState().folderOrder).toEqual(folders.folderOrder);
  });

  it("review → Discard drops the plan without staging anything", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" }, save: realSave });
    __seed("/tmp/in.json", JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" } }));
    openMock.mockResolvedValue("/tmp/in.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    await screen.findByText("Theme: dark → light");

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText("Theme: dark → light")).toBeNull();
    expect(useSettingsStore.getState().draft?.patch ?? {}).toEqual({});
  });

  it("review → Apply, then the dialog's own Cancel drops the staged patch and the staged folders", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    const onClose = vi.fn();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" }, save: realSave });
    useFoldersStore.setState(makeEmptyFolders());
    __seed("/tmp/in.json", JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" }, folders }));
    openMock.mockResolvedValue("/tmp/in.json");
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    await screen.findByText("Theme: dark → light");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "light" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    // Discarded, not committed: neither the settings patch nor the folder tree landed.
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(useFoldersStore.getState().folders).toEqual([]);
  });

  it("a refused import stages nothing and shows no review", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" }, save: realSave });
    __seed("/tmp/bad.json", "{not json");
    openMock.mockResolvedValue("/tmp/bad.json");
    render(<SettingsDialog onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("That file is not JSON.");
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(useSettingsStore.getState().draft?.patch ?? {}).toEqual({});
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

describe("collapsed rail width", () => {
  /** Opens Layout and hands back the slider. */
  async function slider(): Promise<HTMLInputElement> {
    render(<SettingsDialog onClose={vi.fn()} />);
    await openTab("Layout");
    return screen.getByLabelText("Collapsed rail width") as HTMLInputElement;
  }

  it("shows the current width, with the bounds settingsFile enforces", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, railWidth: 72 } });
    const input = await slider();

    expect(input).toHaveAttribute("type", "range");
    // .value rather than toHaveValue: jest-dom's matcher special-cases
    // number inputs and says nothing about range, so the raw string is the
    // assertion that cannot drift.
    expect(input.value).toBe("72");
    expect(input).toHaveAttribute("min", String(RAIL_WIDTH_MIN));
    expect(input).toHaveAttribute("max", String(RAIL_WIDTH_MAX));
    expect(input).toHaveAttribute("step", "1");
  });

  it("stages exactly once, on change, no matter how many ticks preceded it", async () => {
    const input = await slider();

    // input, not change: React maps onChange onto the native `input` event,
    // so these are exactly what the ticks of a drag deliver -- the readout
    // follows every one of them, and none of them stages the setting.
    fireEvent.input(input, { target: { value: "60" } });
    fireEvent.input(input, { target: { value: "75" } });
    fireEvent.input(input, { target: { value: "90" } });
    expect(useSettingsStore.getState().draft?.patch ?? {}).toEqual({});

    fireEvent.change(input, { target: { value: "90" } });

    expect(useSettingsStore.getState().draft?.patch).toEqual({ railWidth: 90 });
  });

  it("puts the new width through the real store only on Done", async () => {
    const input = await slider();

    fireEvent.change(input, { target: { value: "36" } });
    expect(useSettingsStore.getState().settings.railWidth).not.toBe(36);

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.railWidth).toBe(36);
    });
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
      "General", "Widget", "Layout", "Archive", "RSS ticker", "Charts", "Logs",
    ]);
  });

  it("has no Keys tab when no backend runs key-maint", async () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Widget", "Layout", "Logs"]);
    expect(screen.queryByTestId("keys-panel-stub")).not.toBeInTheDocument();
  });

  it("labels the Keys tab from an old stack's keys widget alone, falling back to Provider API Keys", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "nas", name: "NAS" })] });
    // No settings widget: the openbb-docker tags paired with this line serve only the keys widget.
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "provider_api_keys_panel", backendId: "nas", name: "provider_api_keys_panel", type: "keys", endpoint: "keys" })],
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "General", "Widget", "Layout", "Provider API Keys", "Logs",
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
      "General", "Widget", "Layout", "Provider API Keys (Laptop)", "Provider API Keys (NAS)", "Logs",
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

describe("User Settings", () => {
  const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false };
  const wsConn = { id: "ws1", name: "Work", baseUrl: ws.serverUrl };
  const entry = (state: "signed-in" | "expired") => ({ mode: "login" as const, connection: wsConn, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state });
  const choice = (name: "Local" | "Server") => within(screen.getByRole("group", { name: "userSettings" })).getByRole("radio", { name });
  // By role: the Server radio carries the same label text.
  const select = () => screen.getByRole("combobox", { name: "Server" }) as HTMLSelectElement;
  const option = (label: RegExp) => [...select().options].find((o) => label.test(o.text))!;
  beforeEach(() => {
    workspaceConnect.mockReset();
    workspacePrompt.mockReset();
    // probeAll and queueUpload are stubbed: a real probe or upload would
    // send requests to the fixtures' fake addresses and outlive the test.
    useWorkspaceStore.setState({
      connections: [ws], usernames: {}, sessions: {}, notices: {},
      apis: { ws1: "login" }, probeAll: vi.fn(async () => {}), queueUpload: vi.fn(async () => {}),
    });
    useBackendsStore.setState({ backends: [] });
  });

  it("no longer renders the Workspace account panel, and probes on open", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Workspace account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Workspace settings" })).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().probeAll).toHaveBeenCalled();
  });

  it("is the first row of General, above Theme", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    const userSettings = screen.getByRole("group", { name: "userSettings" });
    const theme = screen.getByRole("group", { name: "theme" });
    expect(userSettings.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is Local by default, with no server dropdown", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(choice("Local")).toBeChecked();
    expect(screen.queryByRole("combobox", { name: "Server" })).toBeNull();
  });

  it("Server shows the dropdown: each connection with its mode, the ineligible disabled with their reason, nothing saved yet", async () => {
    useBackendsStore.setState({ backends: ["Gateway", "NAS", "Basic", "Other", "Pending"].map((name, i) => backend({ id: `b${i}`, name })) });
    useWorkspaceStore.setState({ apis: { ws1: "login", b0: "key", b1: "needs-https", b2: "authorization-header", b3: "no" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    expect([...select().options].map((o) => o.text)).toEqual([
      "Choose a server…",
      "Work — login",
      "Gateway — key",
      "NAS — Needs HTTPS",
      "Basic — Credential uses the Authorization header",
      "Other — No settings API",
      "Pending — Checking…",
    ]);
    expect(option(/Work/).disabled).toBe(false);
    expect(option(/Gateway/).disabled).toBe(false);
    for (const label of [/NAS/, /Basic/, /Other/, /Pending/]) expect(option(label).disabled).toBe(true);
    expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined();
  });

  it("a key-refused probe renders the option disabled, reading '<name> — key refused'", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "b0", name: "Gateway" })] });
    useWorkspaceStore.setState({ apis: { ws1: "login", b0: "key-refused" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    expect(option(/Gateway/).text).toBe("Gateway — key refused");
    expect(option(/Gateway/).disabled).toBe(true);
  });

  it("hints when no connection is eligible", () => {
    useWorkspaceStore.setState({ apis: { ws1: "no" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByText("Add a Workspace connection in Connections, or a backend that serves the Workspace settings API.")).toBeInTheDocument();
  });

  it("choosing a server connects to it; a failure or Cancel keeps the previous value", async () => {
    workspaceConnect.mockResolvedValueOnce(false);
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    expect(workspaceConnect).toHaveBeenCalledWith(wsConn, { settingsStorage: "ws1" });
    await waitFor(() => expect(select().value).toBe(""));
    expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined();
  });

  it("a refused key shows 'Key refused by <name>; fix the key in Connections.' in the row, keeps the previous value and saves nothing (ruling R1)", async () => {
    // The real connectServer, with the key connect refused (a 401 from
    // connectByKey): the notice it leaves is what the row must show.
    const actual = await vi.importActual<typeof import("../runWorkspaceSync")>("../runWorkspaceSync");
    workspaceConnect.mockImplementation(actual.connectServer);
    useBackendsStore.setState({ backends: [backend({ id: "b0", name: "Gateway" })] });
    useWorkspaceStore.setState({
      apis: { ws1: "login", b0: "key" },
      probe: vi.fn(async () => "key" as const),
      connectByKey: vi.fn(async () => "key refused"),
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "b0");
    expect(await screen.findByRole("status")).toHaveTextContent("Key refused by Gateway; fix the key in Connections.");
    expect(select().value).toBe("");
    expect(useWorkspaceStore.getState().sessions.b0).toBeUndefined();
    expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined();
    expect(__read("settings.json") ?? "").not.toContain("settingsStorage");
  });

  it("saves the server once connected and synced", async () => {
    workspaceConnect.mockResolvedValueOnce(true);
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1"));
    expect(JSON.parse(__read("settings.json") ?? "").settingsStorage).toBe("ws1");
    expect(choice("Server")).toBeChecked();
    expect(select().value).toBe("ws1");
  });

  it("Local saves storage as absent and keeps the session", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry("signed-in") } });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(choice("Server")).toBeChecked();
    await userEvent.click(choice("Local"));
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBeUndefined());
    expect(JSON.parse(__read("settings.json") ?? "")).not.toHaveProperty("settingsStorage");
    expect(useWorkspaceStore.getState().sessions.ws1).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Server" })).toBeNull();
  });

  it("locks the User Settings controls and Done while a connect is pending, so the last choice cannot be overwritten", async () => {
    let resolve!: (ok: boolean) => void;
    workspaceConnect.mockReturnValueOnce(new Promise<boolean>((r) => { resolve = r; }));
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    expect(choice("Local")).toBeDisabled();
    expect(choice("Server")).toBeDisabled();
    expect(select()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    await act(async () => { resolve(true); });
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1"));
    expect(choice("Local")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("Cancel and Escape do nothing while a connect is pending", async () => {
    const onClose = vi.fn();
    let resolve!: (ok: boolean) => void;
    workspaceConnect.mockReturnValueOnce(new Promise<boolean>((r) => { resolve = r; }));
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().draft?.patch).toMatchObject({ theme: "light" });
    await act(async () => { resolve(true); });
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the ticker field follows a ticker the connect saved, unless the draft touched it", async () => {
    workspaceConnect.mockImplementation(async () => {
      await useSettingsStore.getState().save({ defaultTicker: "NEW" });
      return true;
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    const ticker = screen.getByRole("textbox", { name: /default widget ticker/i });
    await waitFor(() => expect(ticker).toHaveValue("NEW"));
  });

  it("Done after a connect saved another ticker, with the field untouched, closes without a conflict", async () => {
    workspaceConnect.mockImplementation(async () => {
      await useSettingsStore.getState().save({ defaultTicker: "NEW" });
      return true;
    });
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1"));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/changed elsewhere/)).not.toBeInTheDocument();
    expect(useSettingsStore.getState().settings.defaultTicker).toBe("NEW");
  });

  it("Done still saves a ticker typed into the field, trimmed", async () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    const ticker = screen.getByRole("textbox", { name: /default widget ticker/i });
    await userEvent.clear(ticker);
    await userEvent.type(ticker, "  MSFT ");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useSettingsStore.getState().settings.defaultTicker).toBe("MSFT");
  });

  it("the ticker field keeps what the user typed when the connect saves another ticker", async () => {
    workspaceConnect.mockImplementation(async () => {
      await useSettingsStore.getState().save({ defaultTicker: "NEW" });
      return true;
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    const ticker = screen.getByRole("textbox", { name: /default widget ticker/i });
    await userEvent.clear(ticker);
    await userEvent.type(ticker, "MINE");
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1"));
    expect(ticker).toHaveValue("MINE");
  });

  it("Use <name> landing under an open draft flags the overlap at Done; Done again keeps the server's other values and the storage", async () => {
    const onClose = vi.fn();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
    // The connect's "Use Work" save, under the draft.
    workspaceConnect.mockImplementation(async (_c, alsoSave) => {
      await useSettingsStore.getState().save({ theme: "light", fontSize: "large", ...alsoSave });
      return true;
    });
    render(<SettingsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    await userEvent.click(choice("Server"));
    await userEvent.selectOptions(select(), "ws1");
    await waitFor(() => expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1"));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("theme changed elsewhere while this dialog was open. Done again to replace the newer values.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useSettingsStore.getState().settings).toMatchObject({ theme: "light", fontSize: "large", settingsStorage: "ws1" });
    expect(JSON.parse(__read("settings.json") ?? "")).toMatchObject({ theme: "light", fontSize: "large", settingsStorage: "ws1" });
  });

  it("shows the holder's notice left by the launch, without any choice made here", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    useWorkspaceStore.setState({ notices: { ws1: "Key refused by Work; fix the key in Connections." } });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Key refused by Work; fix the key in Connections.");
  });

  it("a failed choice that left no notice of its own does not hide the holder's notice", async () => {
    workspaceConnect.mockResolvedValueOnce(false);
    useBackendsStore.setState({ backends: [backend({ id: "b0", name: "Gateway" })] });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    useWorkspaceStore.setState({ apis: { ws1: "login", b0: "key" }, notices: { ws1: "Not synced: offline" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.selectOptions(select(), "b0");
    await waitFor(() => expect(workspaceConnect).toHaveBeenCalled());
    await waitFor(() => expect(select()).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("Not synced: offline");
  });

  it("the holder's Sign in shows the holder's notice, not an earlier choice's", async () => {
    useBackendsStore.setState({ backends: [backend({ id: "b0", name: "Gateway" })] });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    useWorkspaceStore.setState({ apis: { ws1: "login", b0: "key" } });
    workspaceConnect.mockImplementationOnce(async () => {
      useWorkspaceStore.getState().setNotice("b0", "Key refused by Gateway; fix the key in Connections.");
      return false;
    });
    workspacePrompt.mockImplementationOnce(async () => {
      useWorkspaceStore.getState().setNotice("ws1", "Not synced: offline");
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.selectOptions(select(), "b0");
    expect(await screen.findByRole("status")).toHaveTextContent("Key refused by Gateway");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Not synced: offline"));
  });

  it("Sign in with a refused key shows the message, and holds Done while it runs", async () => {
    const actual = await vi.importActual<typeof import("../runWorkspaceSync")>("../runWorkspaceSync");
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    workspacePrompt.mockImplementation(async (c) => { await gate; await actual.promptSignIn(c); });
    useBackendsStore.setState({ backends: [backend({ id: "b0", name: "Gateway" })] });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "b0" } });
    useWorkspaceStore.setState({
      apis: { ws1: "login", b0: "key" },
      probe: vi.fn(async () => "key" as const),
      connectByKey: vi.fn(async () => "key refused"),
    });
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
    expect(select()).toBeDisabled();
    await act(async () => { release(); });
    expect(await screen.findByRole("status")).toHaveTextContent("Key refused by Gateway; fix the key in Connections.");
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("shows a dangling storage id as Local", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "gone" } });
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(choice("Local")).toBeChecked();
  });

  it.each([["not connected", {}], ["expired", { ws1: entry("expired") }]])("offers Sign in when the server is %s", async (_label, sessions) => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" } });
    useWorkspaceStore.setState({ sessions });
    workspacePrompt.mockResolvedValueOnce(undefined);
    render(<SettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(workspacePrompt).toHaveBeenCalledWith(wsConn);
  });
});
