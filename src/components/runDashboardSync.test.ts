// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./dialogs/WorkspaceDialogs", () => ({ decideDashboardConflict: vi.fn(), decideDeletedDashboard: vi.fn() }));
import { __failPath, __failRead, __read, __reset, __seed } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { Dashboard, SyncLink } from "../lib/types";
import { BUILTIN_WIDGETS, LOCAL_TABLE_ID } from "../lib/builtins";
import { fromWorkspace, toWorkspace } from "../lib/workspaceDashboards";
import { card as makeCard } from "../test/fixtures";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { decideDashboardConflict, decideDeletedDashboard } from "./dialogs/WorkspaceDialogs";
import { deleteSyncedDashboard, startDashboardAutoUpload, syncDashboards, UPLOAD_DEBOUNCE_MS, uploadDashboard } from "./runDashboardSync";

type Rec = Record<string, unknown>;
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "src/test/workspace-fama-french.json"), "utf8"));
const ROOT = "aaaaaaaa-0000-4000-8000-000000000001";
const DASH = "aaaaaaaa-0000-4000-8000-000000000002";
const APP = "aaaaaaaa-0000-4000-8000-000000000003";
const conn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const session = { mode: "login" as const, connection: conn, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state: "signed-in" as const };
const content = (uuid: string): Rec => structuredClone(fixture.owned[uuid].content);
const local = (id: string, name: string, revision?: number): Dashboard => ({ id, name, tabs: [{ id: `${id}-t`, name: "Main", cards: [] }], ...(revision === undefined ? {} : { revision }) });
const link = (over: Partial<SyncLink> = {}): SyncLink => ({ dashboardId: "d1", connectionId: "ws1", store: "dashboard", uuid: DASH, serverUpdatedDate: "2026-10-11T00:00:00Z", localRevisionAtSync: 2, shared: false, ...over });

/**
 * An in-memory Workspace: GET owned/shared/apps, per-item POST /pro/dash/sync, POST and DELETE
 * /pro/user-apps/{uuid}. Every write stamps a later updated_date. `fail` makes one route answer 500.
 */
function fakeServer(seed: { owned?: Record<string, Rec>; shared?: Record<string, Rec>; apps?: Record<string, Rec> } = {}) {
  let clock = 0;
  const stamp = () => `2026-10-11T00:00:${String(++clock).padStart(2, "0")}Z`;
  const wrap = (c: unknown, updated = "2026-10-11T00:00:00Z") => ({ creator: true, content: c, created_date: "2026-10-01T00:00:00Z", updated_date: updated, created_by: "Example User", is_shared: false });
  const lift = (m: Record<string, Rec> = {}) => Object.fromEntries(Object.entries(m).map(([k, c]) => [k, wrap(c)]));
  const state = { owned: lift(seed.owned), shared: lift(seed.shared), apps: lift(seed.apps), fail: new Set<string>(), requests: [] as string[] };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(String(url)).pathname;
    state.requests.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (state.fail.has(`${method} ${path}`)) return json({ detail: "boom" }, 500);
    if (method === "GET" && path === "/pro/dash/sync/owned") return json({ owned: state.owned });
    if (method === "GET" && path === "/pro/dash/sync/shared") return json({ shared: state.shared, entity_shared: {} });
    if (method === "GET" && path === "/pro/user-apps/sync") {
      return json({ owned: Object.fromEntries(Object.entries(state.apps).map(([k, v]) => [k, { content: v.content, creator: true, is_shared: false, createdDate: v.created_date, updatedDate: v.updated_date, createdBy: "Example User", sharedWith: [] }])), shared: {} });
    }
    if (method === "POST" && path === "/pro/dash/sync") {
      for (const [k, v] of Object.entries(body.items as Rec)) {
        if (v === "DELETE") delete state.owned[k];
        else state.owned[k] = wrap(v, stamp());
      }
      return json({ success: true });
    }
    const app = path.match(/^\/pro\/user-apps\/(.+)$/);
    if (app && method === "POST") {
      state.apps[app[1]] = wrap(body, stamp());
      return json({ success: true });
    }
    if (app && method === "DELETE") {
      if (!state.apps[app[1]]) return json({}, 404);
      delete state.apps[app[1]];
      return json({ success: true });
    }
    return json({ detail: "not found" }, 404);
  });
  return state;
}
const posts = (state: ReturnType<typeof fakeServer>) => state.requests.filter((r) => r.startsWith("POST"));
const dashboards = () => useDashboardStore.getState().dashboards;
const links = () => useWorkspaceSyncStore.getState().links;
const rootChildren = (state: ReturnType<typeof fakeServer>) => (Object.values(state.owned).find((r) => (r.content as Rec).isRoot)?.content as Rec).children as string[];
const serverNames = (state: ReturnType<typeof fakeServer>) => Object.values(state.owned).map((r) => r.content as Rec).filter((c) => !c.isFolder).map((c) => (c.data as Rec).name).sort();

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(fetch).mockReset();
  vi.mocked(decideDashboardConflict).mockReset();
  vi.mocked(decideDeletedDashboard).mockReset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" }, draft: null });
  useWorkspaceStore.setState({ connections: [{ ...conn, serverUrl: conn.baseUrl, askOnStartup: false }], sessions: { ws1: session }, notices: {}, deciding: [] });
  useWorkspaceSyncStore.setState({ links: [], tombstones: [], unreadable: false });
  useWidgetRegistryStore.setState({ widgets: [] });
  useDashboardStore.setState({ dashboards: [local("d1", "Main")], activeId: "d1", activeTabId: "d1-t", viewer: false });
});

describe("syncDashboards: the decision table", () => {
  it("first sync: creates and links the server's dashboards and app, uploads the local one into the root", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) }, apps: { [APP]: fixture.apps.owned[APP].content } });
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.name).sort()).toEqual(["Fama-French App", "Fama-French Research Data", "Main"]);
    const famaFrench = dashboards().find((d) => d.name === "Fama-French Research Data")!;
    expect(links()).toEqual(expect.arrayContaining([
      { dashboardId: famaFrench.id, connectionId: "ws1", store: "dashboard", uuid: DASH, serverUpdatedDate: "2026-10-11T00:00:00Z", localRevisionAtSync: 0, shared: false },
      expect.objectContaining({ store: "app", uuid: APP }),
      expect.objectContaining({ dashboardId: "d1", store: "dashboard" }),
    ]));
    const mainUuid = links().find((l) => l.dashboardId === "d1")!.uuid;
    expect(serverNames(server)).toEqual(["Fama-French Research Data", "Main"]);
    expect(rootChildren(server)).toEqual([DASH, mainUuid]);
    expect(JSON.parse(__read("workspaceSync.json") ?? "null").links).toHaveLength(3);
  });

  it("takes the server's copy when only the server changed, keeping the local id", async () => {
    const changed = content(DASH);
    (changed.data as Rec).name = "Renamed on server";
    fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: changed } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    expect(dashboards()).toEqual([expect.objectContaining({ id: "d1", name: "Renamed on server", revision: 2 })]);
    expect(links()).toEqual([link({ serverUpdatedDate: "2026-10-11T00:00:00Z" })]);
  });

  it("keeps a local table card's file when the server's copy replaces the dashboard", async () => {
    useWidgetRegistryStore.setState({ widgets: BUILTIN_WIDGETS });
    const mine: Dashboard = { id: "d1", name: "Mine", revision: 2, tabs: [{ id: "t1", name: "Main", cards: [makeCard({ id: "widget-1", widgetId: LOCAL_TABLE_ID, backendId: "builtin", params: { file: "mine.csv", sheet: "1" } })] }] };
    const onServer = toWorkspace(mine, "dashboard", { index: DASH, parentId: ROOT });
    ((onServer.data as Rec).widgets as Rec[])[0].name = "Edited elsewhere";
    (onServer.data as Rec).name = "Renamed on server";
    fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: onServer } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [mine] });
    await syncDashboards("ws1");
    const [taken] = dashboards();
    expect(taken.name).toBe("Renamed on server");
    expect(taken.tabs[0].cards[0]).toMatchObject({ widgetId: LOCAL_TABLE_ID, params: { file: "mine.csv", sheet: "1" } });
  });

  it("uploads when only the local copy changed, back to the same uuid", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Edited here", 3)] });
    await syncDashboards("ws1");
    expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Edited here");
    expect(links()).toEqual([link({ localRevisionAtSync: 3, serverUpdatedDate: server.owned[DASH].updated_date as string })]);
  });

  it.each([
    ["server", ["Server name"], ["Server name"]],
    ["local", ["Local name"], ["Local name"]],
    ["both", ["Local name", "Server name"], ["Local name", "Server name"]],
  ] as const)("asks when both changed, and %s does what it says", async (choice, localNames, onServer) => {
    const changed = content(DASH);
    (changed.data as Rec).name = "Server name";
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: changed } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Local name", 3)] });
    vi.mocked(decideDashboardConflict).mockResolvedValueOnce(choice);
    await syncDashboards("ws1");
    expect(decideDashboardConflict).toHaveBeenCalledWith("Work", "Local name", "Server name");
    expect(dashboards().map((d) => d.name).sort()).toEqual(localNames);
    expect(serverNames(server)).toEqual(onServer);
  });

  it("names Keep both's copy by the import ruling's suffix", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Fama-French Research Data", 3)] });
    vi.mocked(decideDashboardConflict).mockResolvedValueOnce("both");
    await syncDashboards("ws1");
    expect(decideDashboardConflict).toHaveBeenCalledWith("Work", "Fama-French Research Data", "Fama-French Research Data (2)");
    expect(dashboards().map((d) => d.name).sort()).toEqual(["Fama-French Research Data", "Fama-French Research Data (2)"]);
    // The server ends with the same two distinct names, the copy still on its own uuid.
    expect(serverNames(server)).toEqual(["Fama-French Research Data", "Fama-French Research Data (2)"]);
    const copy = dashboards().find((d) => d.name.endsWith("(2)"))!;
    expect(links().find((l) => l.dashboardId === copy.id)!.uuid).toBe(DASH);
    expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Fama-French Research Data (2)");
  });

  it("deletes the local copy when the server deleted it and it did not change here", async () => {
    fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2), local("d2", "Other")] });
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.id)).toEqual(["d2"]);
    expect(links().some((l) => l.dashboardId === "d1")).toBe(false);
  });

  it.each([["delete", []], ["keep", ["Main"]]] as const)("asks when the server deleted one that changed here: %s", async (choice, onServer) => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 3)] });
    vi.mocked(decideDeletedDashboard).mockResolvedValueOnce(choice);
    await syncDashboards("ws1");
    expect(decideDeletedDashboard).toHaveBeenCalledWith("Work", "Main");
    expect(dashboards().map((d) => d.name)).toEqual(onServer);
    expect(serverNames(server)).toEqual(onServer);
  });

  it("keeps a shared dashboard read-only: downloaded, marked shared, never uploaded", async () => {
    const server = fakeServer({ owned: {}, shared: { [DASH]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    const [shared] = dashboards();
    expect(links()).toEqual([expect.objectContaining({ dashboardId: shared.id, shared: true })]);
    useDashboardStore.setState({ dashboards: [{ ...shared, name: "Edited", revision: 5 }] });
    await syncDashboards("ws1");
    expect(posts(server)).toEqual([]);
  });

  it("reads a hex-keyed server item under its dashed uuid, so the next sync finds its link", async () => {
    fakeServer({ owned: { [ROOT.replace(/-/g, "")]: content(ROOT), [DASH.replace(/-/g, "")]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    await syncDashboards("ws1");
    expect(dashboards()).toHaveLength(1);
    expect(links()).toEqual([expect.objectContaining({ uuid: DASH })]);
  });
});

describe("syncDashboards: tombstones and failures", () => {
  it("sends tombstones first, removing the item and its root entry", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ tombstones: [{ connectionId: "ws1", store: "dashboard", uuid: DASH }] });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    expect(server.requests.slice(0, 2)).toEqual(["GET /pro/dash/sync/owned", "POST /pro/dash/sync"]);
    expect(server.owned[DASH]).toBeUndefined();
    expect(rootChildren(server)).toEqual([]);
    expect(useWorkspaceSyncStore.getState().tombstones).toEqual([]);
    expect(dashboards()).toEqual([]);
  });

  it("keeps a tombstone that fails and stops, so nothing deleted comes back down", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    server.fail.add("POST /pro/dash/sync");
    useWorkspaceSyncStore.setState({ tombstones: [{ connectionId: "ws1", store: "dashboard", uuid: DASH }] });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    expect(useWorkspaceSyncStore.getState().tombstones).toHaveLength(1);
    expect(dashboards()).toEqual([]);
    expect(server.requests).not.toContain("GET /pro/dash/sync/shared");
    expect(useWorkspaceStore.getState().notices.ws1).toMatch(/^Dashboards not synced: .*HTTP 500/);
  });

  it("clears an app tombstone the server answers 404 for", async () => {
    fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceSyncStore.setState({ tombstones: [{ connectionId: "ws1", store: "app", uuid: APP }] });
    await syncDashboards("ws1");
    expect(useWorkspaceSyncStore.getState().tombstones).toEqual([]);
  });

  it("stays settings-only, silently, when the server keeps no dashboards", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 404 }));
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.id)).toEqual(["d1"]);
    expect(__read("workspaceSync.json")).toBeUndefined();
    expect(useWorkspaceStore.getState().notices).toEqual({});
  });

  it("writes nothing when one server item cannot be read", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH), [APP]: { isFolder: false, data: { name: "Broken" } } } });
    await syncDashboards("ws1");
    expect(dashboards().map((d) => d.id)).toEqual(["d1"]);
    expect(__read("workspaceSync.json")).toBeUndefined();
    expect(posts(server)).toEqual([]);
    expect(useWorkspaceStore.getState().notices.ws1).toBe("Dashboards not synced: The server's dashboards could not be read; local dashboards are unchanged.");
  });

  it("expires the session on a 401 and writes nothing", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 401 }));
    await syncDashboards("ws1");
    expect(useWorkspaceStore.getState().sessions.ws1.state).toBe("expired");
    expect(dashboards().map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("overlapping and stale syncs", () => {
  it("runs two overlapping syncs on one connection one after the other, so nothing is created twice", async () => {
    fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    await Promise.all([syncDashboards("ws1"), syncDashboards("ws1")]);
    expect(dashboards().filter((d) => d.name === "Fama-French Research Data")).toHaveLength(1);
    expect(links()).toHaveLength(1);
  });

  it("does not open the gate for a new session when a sign-out and sign-in happened during the run", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 3)] });
    vi.mocked(decideDashboardConflict).mockImplementationOnce(async () => {
      useWorkspaceStore.setState({ sessions: {} });
      useWorkspaceStore.setState({ sessions: { ws1: { ...session } } });
      return "server";
    });
    await syncDashboards("ws1");
    useDashboardStore.setState({ dashboards: [local("d1", "Edited after relogin", 9)] });
    const before = server.requests.length;
    await uploadDashboard("ws1", "d1");
    expect(server.requests.slice(before)).toEqual([]);
  });
});

describe("a sync that cannot trust or keep its link records", () => {
  it("does not sync when workspaceSync.json could not be read, and says so", async () => {
    __seed("workspaceSync.json", "{}");
    __failRead("workspaceSync.json");
    await expect(useWorkspaceSyncStore.getState().load()).rejects.toThrow();
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    await syncDashboards("ws1");
    expect(dashboards()).toEqual([]);
    expect(server.requests).toEqual([]);
    expect(useWorkspaceStore.getState().notices.ws1).toMatch(/^Dashboards not synced: .*link/);
  });

  it("reports a failed links write, writes nothing more, and does not open the upload gate", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    __failPath("workspaceSync.json");
    await expect(syncDashboards("ws1")).resolves.toBeUndefined();
    expect(useWorkspaceStore.getState().notices.ws1).toMatch(/^Dashboards not synced: /);
    expect(posts(server)).toEqual([]);
    useDashboardStore.setState({ dashboards: [{ ...dashboards()[0], revision: 4 }] });
    await uploadDashboard("ws1", dashboards()[0].id);
    expect(posts(server)).toEqual([]);
  });

  it("does not bring back a dashboard the rail deleted between the fetch and the plan", async () => {
    fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useDashboardStore.setState({ dashboards: [] });
    const serve = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const res = await serve(url, init);
      if (new URL(String(url)).pathname === "/pro/dash/sync/shared") {
        useWorkspaceSyncStore.setState({ tombstones: [{ connectionId: "ws1", store: "dashboard", uuid: DASH }] });
      }
      return res;
    });
    await syncDashboards("ws1");
    expect(dashboards()).toEqual([]);
    expect(links()).toEqual([]);
  });
});

describe("uploads", () => {
  it("puts every new dashboard into the root, even uploading at once and after another device added one", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 3), local("d2", "Second"), local("d3", "Third")] });
    // While the question is open, another device adds a dashboard to the root.
    vi.mocked(decideDashboardConflict).mockImplementationOnce(async () => {
      (server.owned[ROOT].content as Rec).children = [DASH, "elsewhere"];
      return "local";
    });
    await syncDashboards("ws1");
    const uuids = ["d2", "d3"].map((id) => links().find((l) => l.dashboardId === id)!.uuid);
    expect(rootChildren(server)).toEqual([DASH, "elsewhere", ...uuids]);
  });

  it("sends a save made while a question was open, once the sync finishes", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" }), link({ dashboardId: "d2", uuid: "bbbbbbbb-0000-4000-8000-0000000000aa" })] });
    server.owned["bbbbbbbb-0000-4000-8000-0000000000aa"] = { ...server.owned[DASH], content: { ...content(DASH), index: "bbbbbbbb-0000-4000-8000-0000000000aa" }, updated_date: "2026-10-11T00:00:00Z" };
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 3), local("d2", "Other", 2)] });
    vi.mocked(decideDashboardConflict).mockImplementationOnce(async () => {
      await useDashboardStore.getState().renameDashboard("d2", "Renamed meanwhile");
      return "server";
    });
    await syncDashboards("ws1");
    expect(((server.owned["bbbbbbbb-0000-4000-8000-0000000000aa"].content as Rec).data as Rec).name).toBe("Renamed meanwhile");
  });

  describe.each([
    ["take", { serverUpdatedDate: "older" }, true],
    ["deleteLocal", {}, false],
  ] as const)("a save made while a question is open, on a dashboard planned %s", (_kind, over, onServer) => {
    it("survives locally and is not overwritten or deleted", async () => {
      const U2 = "bbbbbbbb-0000-4000-8000-0000000000aa";
      const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH), ...(onServer ? { [U2]: { ...content(DASH), index: U2 } } : {}) } });
      useWorkspaceSyncStore.setState({ links: [link({ serverUpdatedDate: "older" }), link({ dashboardId: "d2", uuid: U2, ...over })] });
      useDashboardStore.setState({ dashboards: [local("d1", "Main", 3), local("d2", "Other", 2)] });
      vi.mocked(decideDashboardConflict).mockImplementationOnce(async () => {
        await useDashboardStore.getState().renameDashboard("d2", "Renamed meanwhile");
        return "local";
      });
      await syncDashboards("ws1");
      expect(dashboards().find((d) => d.id === "d2")?.name).toBe("Renamed meanwhile");
      // Left linked, so the next sync sees both sides changed and asks.
      expect(links().find((l) => l.dashboardId === "d2")).toEqual(expect.objectContaining({ uuid: U2, localRevisionAtSync: 2 }));
      if (onServer) expect(((server.owned[U2].content as Rec).data as Rec).name).not.toBe("Renamed meanwhile");
    });
  });

  it("uploads an unlinked dashboard that still carries a server shell under its NEW index and the root", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) } });
    const downloaded = { ...fromWorkspace(content(DASH), "dashboard", []), id: "d1", revision: 3 };
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [downloaded] });
    vi.mocked(decideDeletedDashboard).mockResolvedValueOnce("keep");
    await syncDashboards("ws1");
    const uuid = links().find((l) => l.dashboardId === "d1")!.uuid;
    expect(uuid).not.toBe(DASH);
    expect(server.owned[uuid].content).toMatchObject({ index: uuid, parentId: ROOT });
  });

  it("still writes the link when the session ends between a successful POST and the link write", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    const serve = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const res = await serve(url, init);
      if (init?.method === "POST") useWorkspaceStore.setState({ sessions: {} });
      return res;
    });
    useDashboardStore.setState({ dashboards: [local("d1", "Edited", 3)] });
    await uploadDashboard("ws1", "d1");
    expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Edited");
    // The upload landed, so the link records it; the date is empty (no read-back), so the next sync re-reads the item.
    expect(links()).toEqual([link({ localRevisionAtSync: 3, serverUpdatedDate: "" })]);
  });

  it("uploads an edited app through /pro/user-apps/{uuid}", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) }, apps: { [APP]: fixture.apps.owned[APP].content } });
    useWorkspaceSyncStore.setState({ links: [link({ store: "app", uuid: APP })] });
    useDashboardStore.setState({ dashboards: [{ ...local("d1", "App edited here", 3) }] });
    await syncDashboards("ws1");
    expect(server.requests).toContain(`POST /pro/user-apps/${APP}`);
    expect((server.apps[APP].content as Rec).name).toBe("App edited here");
  });

  it("never uploads a dashboard that is linked as shared on another connection", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceSyncStore.setState({ links: [link({ connectionId: "ws2", shared: true, dashboardId: "d1" })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Shared elsewhere", 5)] });
    await syncDashboards("ws1");
    await uploadDashboard("ws1", "d1");
    expect(posts(server)).toEqual([]);
  });

  it("keeps uploading after the store replaces the session object, and drops the gate on sign-out", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Same", 1)] });
    await syncDashboards("ws1");
    // queueUpload and fail() rewrite sessions[id] as a spread copy.
    useWorkspaceStore.setState((s) => ({ sessions: { ...s.sessions, ws1: { ...s.sessions.ws1, displaySettings: { x: 1 } } } }));
    useDashboardStore.setState({ dashboards: [local("d1", "Edited after settings save", 3)] });
    await uploadDashboard("ws1", "d1");
    expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Edited after settings save");
    // Sign out, sign in again without a dashboard sync: the old gate must not carry over.
    useWorkspaceStore.setState({ sessions: {} });
    useWorkspaceStore.setState({ sessions: { ws1: { ...session } } });
    useDashboardStore.setState({ dashboards: [local("d1", "After relogin", 5)] });
    const before = server.requests.length;
    await uploadDashboard("ws1", "d1");
    expect(server.requests.slice(before)).toEqual([]);
  });

  it("sends nothing to an expired session, or while it is deciding", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT) } });
    useWorkspaceStore.setState({ deciding: ["ws1"] });
    await uploadDashboard("ws1", "d1");
    useWorkspaceStore.setState({ deciding: [], sessions: { ws1: { ...session, state: "expired" } } });
    await uploadDashboard("ws1", "d1");
    expect(server.requests).toEqual([]);
  });

  it.each([
    ["a failed fetch", "GET /pro/dash/sync/shared", []],
    ["a failed tombstone", "POST /pro/dash/sync", [{ connectionId: "ws1", store: "dashboard" as const, uuid: DASH }]],
  ])("sends nothing after %s, until a sync succeeds", async (_n, failRoute, tombstones) => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()], tombstones });
    useDashboardStore.setState({ dashboards: [local("d1", "Edited here", 3)] });
    server.fail.add(failRoute);
    await syncDashboards("ws1");
    const before = server.requests.length;
    await uploadDashboard("ws1", "d1");
    expect(server.requests.slice(before)).toEqual([]);
    server.fail.clear();
    useWorkspaceSyncStore.setState({ tombstones: [] });
    await syncDashboards("ws1");
    expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Edited here");
  });
});

describe("startDashboardAutoUpload", () => {
  // uploadDashboard sends nothing until a sync has finished, so every case syncs first (nothing differs, so nothing is sent).
  it("uploads a linked dashboard once, after a burst of saves settles", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    expect(posts(server)).toEqual([]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startDashboardAutoUpload();
    try {
      await useDashboardStore.getState().renameDashboard("d1", "One");
      await useDashboardStore.getState().renameDashboard("d1", "Two");
      await vi.advanceTimersByTimeAsync(UPLOAD_DEBOUNCE_MS - 1);
      expect(posts(server)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
    } finally {
      vi.useRealTimers();
      stop();
    }
    await vi.waitFor(() => expect(((server.owned[DASH].content as Rec).data as Rec).name).toBe("Two"));
    expect(posts(server)).toEqual(["POST /pro/dash/sync"]);
  });

  it("stops a queued upload when stop() is called before the debounce elapses", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    server.requests.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startDashboardAutoUpload();
    try {
      await useDashboardStore.getState().renameDashboard("d1", "Renamed");
      // Call stop() before debounce elapses
      stop();
      // Advance timers past the debounce
      await vi.advanceTimersByTimeAsync(UPLOAD_DEBOUNCE_MS);
    } finally {
      vi.useRealTimers();
    }
    // No POST should have been sent
    expect(server.requests).toEqual([]);
  });

  it.each([
    ["an unlinked dashboard", () => useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] })],
    ["a shared dashboard", () => useWorkspaceSyncStore.setState({ links: [link({ shared: true })] })],
    ["a dashboard when settings are local", () => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })],
  ])("never uploads %s", async (_, arrange) => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    const unlinked = _ === "an unlinked dashboard";
    if (!unlinked) useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: unlinked ? [] : [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    arrange();
    server.requests.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startDashboardAutoUpload();
    try {
      await useDashboardStore.getState().renameDashboard("d1", "Renamed");
      await vi.advanceTimersByTimeAsync(UPLOAD_DEBOUNCE_MS);
    } finally {
      vi.useRealTimers();
      stop();
    }
    expect(server.requests).toEqual([]);
  });
});

describe("deleteSyncedDashboard", () => {
  it("signed in and synced: deletes here, then on the server with its root entry, and clears the tombstone", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    await deleteSyncedDashboard("d1");
    expect(dashboards()).toEqual([]);
    expect(server.owned[DASH]).toBeUndefined();
    expect(rootChildren(server)).toEqual([]);
    expect(useWorkspaceSyncStore.getState()).toMatchObject({ links: [], tombstones: [] });
  });

  it("removes an upper-case root entry and writes a canonical tombstone", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    (server.owned[ROOT].content as Rec).children = [DASH.toUpperCase()];
    useWorkspaceSyncStore.setState({ links: [link()] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await syncDashboards("ws1");
    await deleteSyncedDashboard("d1");
    expect(rootChildren(server)).toEqual([]);
    useWorkspaceStore.setState({ sessions: {} });
    useWorkspaceSyncStore.setState({ links: [link({ uuid: DASH.toUpperCase() })] });
    useDashboardStore.setState({ dashboards: [local("d1", "Main", 2)] });
    await deleteSyncedDashboard("d1");
    expect(useWorkspaceSyncStore.getState().tombstones).toEqual([{ connectionId: "ws1", store: "dashboard", uuid: DASH }]);
  });

  it("signed in but not yet synced: leaves the tombstone for the sync to send first", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    // The gate outlives a test while the session id stays signed in; a sign-out clears it.
    useWorkspaceStore.setState({ sessions: {} });
    useWorkspaceStore.setState({ sessions: { ws1: session } });
    useWorkspaceSyncStore.setState({ links: [link()] });
    await deleteSyncedDashboard("d1");
    expect(dashboards()).toEqual([]);
    expect(server.requests).toEqual([]);
    expect(useWorkspaceSyncStore.getState().tombstones).toHaveLength(1);
  });

  it("signed out: deletes here at once and leaves a tombstone on disk for the next sign-in", async () => {
    const server = fakeServer({ owned: { [ROOT]: content(ROOT), [DASH]: content(DASH) } });
    useWorkspaceStore.setState({ sessions: {} });
    useWorkspaceSyncStore.setState({ links: [link()] });
    await deleteSyncedDashboard("d1");
    expect(dashboards()).toEqual([]);
    expect(server.requests).toEqual([]);
    expect(JSON.parse(__read("workspaceSync.json") ?? "null")).toEqual({ links: [], tombstones: [{ connectionId: "ws1", store: "dashboard", uuid: DASH }] });
  });

  it("shared: deletes only the local copy and dismisses the link", async () => {
    const server = fakeServer({ owned: {}, shared: { [DASH]: content(DASH) } });
    useWorkspaceSyncStore.setState({ links: [link({ shared: true })] });
    await deleteSyncedDashboard("d1");
    expect(server.requests).toEqual([]);
    expect(useWorkspaceSyncStore.getState()).toMatchObject({ links: [link({ shared: true, dismissed: true })], tombstones: [] });
    await syncDashboards("ws1");
    expect(dashboards()).toEqual([]);
  });
});
