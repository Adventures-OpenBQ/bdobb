// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./dialogs/ImportConflictDialog", () => ({
  decideImportConflicts: vi.fn(async () => []),
}));

import { __list, __read, __readBytes, __reset } from "../test/memfs";
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
const uploadHttp=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/plugin-http',()=>({fetch:(...args:unknown[])=>uploadHttp(...args)}));
afterEach(()=>vi.restoreAllMocks());

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
      "Imported 1 dashboard, 0 cards",
    );
    expect(cards()).toHaveLength(0);
  });

  // final review M3: the dashboards are already imported by then, so a
  // failed MCP-server save must not read as a failed import.
  it("keeps the import's notice when only its MCP servers fail to save", async () => {
    const withMcp = JSON.stringify([
      {
        name: "Imported",
        tabs: { t1: { id: "t1", name: "Main", layout: [] } },
        mcp_servers: [{ name: "Docs", description: "", url: "https://docs.example/mcp", authType: "token" }],
      },
    ]);
    const save = useSettingsStore.getState().save;
    // The first save is the dashboard order; the second is the MCP servers.
    useSettingsStore.setState({ save: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("disk full")) });
    try {
      renderZone();
      fireEvent.drop(screen.getByRole("main"), fileDrag([new File([withMcp], "my.apps.json")]));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Imported 1 dashboard, 0 cards"));
      expect(screen.getByRole("status")).not.toHaveTextContent(/failed/i);
      await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("its MCP servers could not be saved"));
    } finally {
      useSettingsStore.setState({ save });
    }
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
      "Imported 1 dashboard, 0 cards",
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

  // A versioned (kind/version-tagged) bundle takes the current-format
  // branch, where planSettingsImport's own `notice` is empty (its detail
  // lives in `review`/`folderReview` instead, which this no-review drop
  // path never reads) -- runSettingsImport falls back to reconstructing the
  // old-style folder-count summary. The three tests above are all
  // pre-envelope fixtures, so none of them reach this branch.
  it("a versioned bundle with no folders member falls back to the old-style notice", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([bundle(JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light" } }))]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Imported settings.");
    expect(useSettingsStore.getState().settings.theme).toBe("light");
  });

  // Review U2: a drop applies with no review, so it must not repoint Rita or
  // switch on context sharing; those wait for Settings ▸ Import.
  it("skips ritaUrl, contextSharing, shareTargets, mcpDisabledTools and agentOptions on a drop and says so", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark", ritaUrl: "https://mine.example", contextSharing: false } });
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([bundle(JSON.stringify({ kind: "bdobb-settings", version: 1, settings: { theme: "light", ritaUrl: "https://attacker.example", contextSharing: true, shareTargets: DEFAULT_SETTINGS.shareTargets, mcpDisabledTools: { "https://mcp.example/mcp": [] }, agentOptions: { a: { model: "x" } } } }))]),
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Skipped ritaUrl, contextSharing, shareTargets, mcpDisabledTools, agentOptions");
    expect(status).toHaveTextContent("Settings ▸ Import");
    const now = useSettingsStore.getState().settings;
    expect(now).toMatchObject({ theme: "light", ritaUrl: "https://mine.example", contextSharing: false, mcpDisabledTools: {}, agentOptions: {} });
  });

  it("a versioned bundle with a folders member falls back to the folder-count notice", async () => {
    const folders = {
      ...makeEmptyFolders(),
      folders: [{ id: "f1", name: "Macro", parentId: null }],
      folderOrder: ["f1"],
    };
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([bundle(JSON.stringify({ kind: "bdobb-settings", version: 1, settings: {}, folders }))]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Imported settings and 1 folder.");
    expect(useFoldersStore.getState().folders).toEqual(folders.folders);
  });

  // Unlike the dialog's Import (which shows warnings in its review notice
  // before Apply), this path applies immediately with no review step --
  // so a warning has nowhere else to surface but the one status line.
  it("surfaces import warnings on the status line instead of dropping them", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "dark" } });
    renderZone();
    fireEvent.drop(
      screen.getByRole("main"),
      fileDrag([
        bundle(
          JSON.stringify({
            kind: "bdobb-settings",
            version: 1,
            // Not ritaUrl: the AI Library makes that a real setting on this
            // line, so it would import rather than be ignored.
            settings: { theme: "light", nosuchPref: "https://x/" },
            folders: "nonsense",
          }),
        ),
      ]),
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Imported settings.");
    expect(status).toHaveTextContent("Ignored unknown fields: nosuchPref.");
    expect(status).toHaveTextContent("Ignored an invalid folder tree.");
    // The recognised field still applied despite the warnings.
    expect(useSettingsStore.getState().settings.theme).toBe("light");
  });
});

it('offers explicit server execution for file drops while keeping local execution the default',()=>{
 const managed={...useWidgetRegistryStore.getState().widgets[0],id:'managed',backendId:'server',name:'Native table',type:'table_ssrm',provider:'managed-native',protocolVersion:1};
 useWidgetRegistryStore.setState(s=>({widgets:[...s.widgets,managed]}));
 renderZone();
 expect(screen.getByLabelText('Dropped file execution')).toHaveValue('local');
 expect(screen.getByRole('option',{name:'Server · Native table'})).toBeInTheDocument();
});

it('keeps an uploaded source after its card reference is saved even when the later title save fails',async()=>{
 const {useBackendsStore}=await import('../stores/backendsStore');
 const managed={...useWidgetRegistryStore.getState().widgets[0],id:'managed',backendId:'server',name:'Native table',type:'table_ssrm',provider:'managed-native',protocolVersion:1};
 useWidgetRegistryStore.setState(s=>({widgets:[...s.widgets,managed]}));
 useBackendsStore.setState({backends:[{id:'server',name:'Server',baseUrl:'https://table.test',authLocation:'header',validateWidgets:true}]});
 uploadHttp.mockReset();uploadHttp.mockImplementation(async(_url,init)=>Response.json(init.method==='DELETE'?{deleted:true}:{sourceId:'owned-upload'}));
 const patch=useDashboardStore.getState().patchCardField;
 vi.spyOn(useDashboardStore.getState(),'patchCardField').mockImplementation(async(id,field,value)=>{if(field==='title')throw new Error('Title save failed');await patch<Parameters<typeof patch>[1]>(id,field,value);});
 renderZone();fireEvent.change(screen.getByLabelText('Dropped file execution'),{target:{value:JSON.stringify(['server','managed'])}});
 fireEvent.drop(screen.getByRole('main'),fileDrag([new File(['amount\n5'],'private.csv')]));
 expect(await screen.findByRole('status')).toHaveTextContent('Title save failed');
 expect(cards()[0].managedSource).toEqual({sourceId:'owned-upload',kind:'upload',version:1});
 const saved=JSON.parse(__read(`dashboards/${useDashboardStore.getState().activeId}.json`)!);
 expect(saved.tabs[0].cards[0].managedSource.sourceId).toBe('owned-upload');
 expect(uploadHttp.mock.calls.filter(([,init])=>init.method==='DELETE')).toHaveLength(0);
});
