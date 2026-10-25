// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./dialogs/ImportConflictDialog", () => ({
  decideImportConflicts: vi.fn(async () => []),
}));

import { __list, __readBytes, __reset } from "../test/memfs";
import { makeEmptyFolders } from "../lib/foldersFile";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { WIDGET_DRAG_TYPE } from "./WidgetLibrary";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { decideImportConflicts } from "./dialogs/ImportConflictDialog";
import { DropZone } from "./DropZone";

const decoder = new TextDecoder();

/** A drag carrying files, in the shape React reads off the event. */
const fileDrag = (files: File[]) => ({ dataTransfer: { types: ["Files"], files } });

/** The apps.json the rail's import understands: an array of apps. */
const APPS = JSON.stringify([
  { name: "Imported", tabs: { t1: { id: "t1", name: "Main", layout: [] } } },
]);

function cards() {
  const { dashboards, activeId, activeTabId } = useDashboardStore.getState();
  const dashboard = dashboards.find((d) => d.id === activeId);
  return dashboard?.tabs.find((t) => t.id === activeTabId)?.cards ?? [];
}

beforeEach(async () => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useDashboardStore.setState({
    dashboards: [],
    activeId: null,
    activeTabId: null,
    previousId: null,
    viewer: false,
  });
  useWidgetRegistryStore.setState({ widgets: [] });
  useWidgetRegistryStore.getState().seedBuiltins();
  await useDashboardStore.getState().load();
  // Otherwise a folders-carrying drop test would inherit whatever tree the
  // previous test in this file left behind, on top of settings.
  useFoldersStore.setState(makeEmptyFolders());
});

function renderZone(viewer = false) {
  return render(
    <DropZone viewer={viewer}>
      <div className="dashboard-grid" />
    </DropZone>,
  );
}

describe("the veil", () => {
  it("accepts a file dragover and shows the veil", () => {
    renderZone();
    const main = screen.getByRole("main");

    fireEvent.dragOver(main, { dataTransfer: { types: ["Files"] } });

    expect(screen.getByText("Drop files to add widgets")).toBeInTheDocument();
  });

  it("prevents default for a file drag only, so a widget drag still reaches the rail", () => {
    renderZone();
    const main = screen.getByRole("main");

    const widget = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(widget, "dataTransfer", { value: { types: [WIDGET_DRAG_TYPE] } });
    fireEvent(main, widget);
    expect(widget.defaultPrevented).toBe(false);
    expect(screen.queryByText("Drop files to add widgets")).not.toBeInTheDocument();

    const files = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(files, "dataTransfer", { value: { types: ["Files"] } });
    fireEvent(main, files);
    expect(files.defaultPrevented).toBe(true);
    expect(screen.getByText("Drop files to add widgets")).toBeInTheDocument();
  });

  it("clears the veil when the drag really leaves, and keeps it over a child", () => {
    renderZone();
    const main = screen.getByRole("main");
    const child = main.querySelector(".dashboard-grid")!;

    fireEvent.dragOver(main, { dataTransfer: { types: ["Files"] } });
    fireEvent(main, new MouseEvent("dragleave", { bubbles: true, relatedTarget: child }));
    expect(screen.getByText("Drop files to add widgets")).toBeInTheDocument();

    fireEvent(main, new MouseEvent("dragleave", { bubbles: true, relatedTarget: document.body }));
    expect(screen.queryByText("Drop files to add widgets")).not.toBeInTheDocument();
  });
});

describe("dropping a data file", () => {
  it("stores the bytes and adds a card titled with the original name", async () => {
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([new File(["symbol,close\nAAPL,190.5\n"], "prices.csv")]),
    );

    await waitFor(() => expect(cards()).toHaveLength(1));
    const [card] = cards();
    expect(card.widgetId).toBe("local_table");
    expect(card.backendId).toBe("builtin");
    expect(card.title).toBe("prices.csv");
    expect(card.params.file).toMatch(/^[0-9a-f-]{36}\.csv$/);
    expect(decoder.decode(__readBytes(`files/${card.params.file}`))).toBe(
      "symbol,close\nAAPL,190.5\n",
    );
  });

  it("stacks several files rather than piling them on one spot", async () => {
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([new File(["a\n"], "one.csv"), new File(["b\n"], "two.tsv")]),
    );

    await waitFor(() => expect(cards()).toHaveLength(2));
    const [first, second] = cards();
    expect(second.layout.y).toBeGreaterThan(first.layout.y);
    expect(cards().map((c) => c.title)).toEqual(["one.csv", "two.tsv"]);
  });

  it("refuses a file over the size limit without reading it", async () => {
    renderZone();
    const big = new File(["x"], "huge.csv");
    Object.defineProperty(big, "size", { value: 50 * 1024 * 1024 + 1 });

    fireEvent.drop(screen.getByRole("main"), fileDrag([big]));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "huge.csv is 50.1 MB; the limit is 50 MB.",
    );
    expect(cards()).toHaveLength(0);
  });

  it("names an unsupported file and skips it", async () => {
    renderZone();
    fireEvent.drop(screen.getByRole("main"), fileDrag([new File(["x"], "notes.txt")]));

    expect(await screen.findByRole("status")).toHaveTextContent("Unsupported file: notes.txt");
    expect(cards()).toHaveLength(0);
  });

  it("adds the good file of a mixed drop and reports only the bad one", async () => {
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([new File(["x"], "notes.txt"), new File(["a\n"], "rows.csv")]),
    );

    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.getByRole("status")).toHaveTextContent("Unsupported file: notes.txt");
    expect(cards()[0].title).toBe("rows.csv");
  });
});

describe("dropping a .json", () => {
  it("imports an apps.json instead of making a table of it", async () => {
    renderZone();
    fireEvent.drop(screen.getByRole("main"), fileDrag([new File([APPS], "my.apps.json")]));

    await waitFor(() =>
      expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toContain("Imported"),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Imported 1 dashboards, 0 cards (0 unresolved)",
    );
    expect(cards()).toHaveLength(0);
  });

  it("asks about a dropped dashboard whose name you already use", async () => {
    vi.mocked(decideImportConflicts).mockClear();
    vi.mocked(decideImportConflicts).mockResolvedValueOnce(["keep"]);
    renderZone();
    const file = JSON.stringify([{ name: "Main", tabs: { t1: { id: "t1", name: "Main", layout: [] } } }]);

    fireEvent.drop(screen.getByRole("main"), fileDrag([new File([file], "main.apps.json")]));

    await waitFor(() =>
      expect(useDashboardStore.getState().dashboards.map((d) => d.name)).toEqual(["Main", "Main (2)"]),
    );
    expect(vi.mocked(decideImportConflicts).mock.calls[0][0]).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Imported 1 dashboards, 0 cards (0 unresolved)",
    );
  });

  it("treats a data .json as a table, not as a failed import", async () => {
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([new File(['[{"a":1}]'], "rows.json")]),
    );

    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cards()[0].params.file).toMatch(/^[0-9a-f-]{36}\.json$/);
  });

  it("never reads a .json over the import limit, and imports nothing from it", async () => {
    renderZone();
    const big = new File([APPS], "my.apps.json");
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    const read = vi.spyOn(big, "text");

    fireEvent.drop(screen.getByRole("main"), fileDrag([big]));

    // Past the import ceiling the sniff is skipped entirely -- the text is
    // never pulled into the webview -- so the file takes the table path,
    // which has its own, larger ceiling.
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(read).not.toHaveBeenCalled();
    expect(cards()[0].params.file).toMatch(/^[0-9a-f-]{36}\.json$/);
    expect(useDashboardStore.getState().dashboards.map((d) => d.name)).not.toContain("Imported");
  });
});

describe("the viewer window", () => {
  it("shows no veil and ignores the drop", async () => {
    useDashboardStore.setState({ viewer: true });
    renderZone(true);
    const main = screen.getByRole("main");

    fireEvent.dragOver(main, { dataTransfer: { types: ["Files"] } });
    expect(screen.queryByText("Drop files to add widgets")).not.toBeInTheDocument();

    fireEvent.drop(main, fileDrag([new File(["a\n"], "rows.csv")]));
    await Promise.resolve();
    expect(cards()).toHaveLength(0);
  });
});

describe("a dialog or the library over the zone", () => {
  it("shows no veil and writes nothing for a drop behind the overlay", async () => {
    const { container } = renderZone();
    // Rendered inside RTL's container so cleanup takes it away with the zone.
    // A real open <dialog>, which is what the two modals now render.
    const backdrop = document.createElement("dialog");
    backdrop.open = true;
    container.append(backdrop);
    const main = screen.getByRole("main");

    fireEvent.dragOver(main, { dataTransfer: { types: ["Files"] } });
    expect(screen.queryByText("Drop files to add widgets")).not.toBeInTheDocument();

    fireEvent.drop(main, fileDrag([new File(["a\n"], "rows.csv")]));
    await Promise.resolve();

    expect(cards()).toHaveLength(0);
    expect(__list().some((p) => p.startsWith("files/"))).toBe(false);
  });
});

describe("the window-level guard", () => {
  it("swallows a dropped link, and leaves a widget drag alone", () => {
    renderZone();

    const link = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(link, "dataTransfer", { value: { types: ["text/uri-list"] } });
    window.dispatchEvent(link);
    expect(link.defaultPrevented).toBe(true);

    const widget = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(widget, "dataTransfer", { value: { types: [WIDGET_DRAG_TYPE] } });
    window.dispatchEvent(widget);
    expect(widget.defaultPrevented).toBe(false);
  });
});

describe("dropping a settings bundle", () => {
  const bundle = (text: string) => new File([text], "anything.json");

  it("imports settings rather than becoming a table", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark", railWidth: 60 } });
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([bundle(JSON.stringify({ settings: { theme: "light" } }))]),
    );

    // No kind/version: the older, pre-envelope shape, still accepted.
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Older settings file; imported the fields it names.",
    );
    expect(useSettingsStore.getState().settings.theme).toBe("light");
    // Untouched by a file that never mentioned it.
    expect(useSettingsStore.getState().settings.railWidth).toBe(60);
    // And no local-table card was added.
    expect(cards()).toHaveLength(0);
  });

  it("is recognised by shape, not by name", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      // Deliberately not called bdobb-settings.json.
      fileDrag([new File([JSON.stringify({ settings: { theme: "light" } })], "zzz.json")]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Older settings file; imported the fields it names.",
    );
  });

  it("leaves an apps.json on the apps path", async () => {
    renderZone();
    fireEvent.drop(screen.getByRole("main"), fileDrag([new File([APPS], "x.json")]));
    expect(await screen.findByRole("status")).toHaveTextContent("Imported 1 dashboard");
  });

  it("leaves a plain data .json on the table path", async () => {
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([new File([JSON.stringify([{ a: 1 }])], "rows.json")]),
    );
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.queryByText(/Imported settings/)).toBeNull();
  });

  it("applies a dropped bundle's folders member to useFoldersStore", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([bundle(JSON.stringify({ settings: { theme: "light" }, folders }))]),
    );

    // No kind/version on this dropped bundle either: the older-format notice wins.
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Older settings file; imported the fields it names.",
    );
    expect(useFoldersStore.getState().folders).toEqual(folders.folders);
    expect(useFoldersStore.getState().folderOrder).toEqual(folders.folderOrder);
  });
});

