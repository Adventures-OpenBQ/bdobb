// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// v8 locked widgets, ruling R6: the docks sync through the server's system
// route, never through the owned/POST dashboard plan. The fake below plays
// openbq-docker v8's contract (docs/v8/news-relay-and-hidden-dashboards.md
// §3): one docks per account, GET {dashboard: record|null}, PUT exactly
// {revision, content} answering 409 with the stored record when it is newer,
// `hidden: true` set server-side, 404 when unsupported.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./dialogs/WorkspaceDialogs", () => ({ decideDashboardConflict: vi.fn(), decideDeletedDashboard: vi.fn() }));
import { __read, __reset } from "../test/memfs";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { DOCKS_ID, makeDefaultDocks } from "../lib/dashboardsFile";
import { decodeDocksContent, encodeDocksContent } from "../lib/docksSync";
import type { Dashboard } from "../lib/types";
import { backend, card } from "../test/fixtures";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";
import { startDashboardAutoUpload, syncDashboards, syncDocks, UPLOAD_DEBOUNCE_MS } from "./runDashboardSync";

type Rec = Record<string, unknown>;
const conn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const loginSession = { mode: "login" as const, connection: conn, username: "alice", userId: "11111111-1111-4111-8111-111111111111", token: "synthetic-session", displaySettings: {}, state: "signed-in" as const };
const keyConn = { ...conn, backend: backend({ id: "ws1", baseUrl: conn.baseUrl, headerName: "Authorization", headerValue: "Basic dXNlcjpwYXNz" }) };
const keySession = { mode: "key" as const, connection: keyConn, displaySettings: {}, state: "signed-in" as const };

/** Docks with one card at the bottom, at `revision` (epoch ms). */
const docksAt = (revision: number | undefined, title = "Local"): Dashboard => {
  const d = makeDefaultDocks();
  return { ...d, tabs: [d.tabs[0], { ...d.tabs[1], cards: [card({ id: `c-${title}`, title })] }], ...(revision === undefined ? {} : { revision }) };
};
const record = (revision: number, content: unknown) => ({
  id: "docks", hidden: true, revision, content,
  created_date: "2026-10-01T00:00:00Z", updated_date: "2026-10-12T00:00:00Z", created_by: "Example User", creator: true, is_shared: false,
});

/** The dashboard routes a sign-in sync needs, empty, plus the docks system route. `docks: "absent"` is a server without it. */
function fakeServer(seed: { docks?: Rec | null | "absent"; fail?: string } = {}) {
  const state = { docks: seed.docks === undefined ? null : seed.docks, requests: [] as string[], bodies: [] as unknown[], auth: [] as string[], posted: [] as Rec[] };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const method = init?.method ?? "GET";
    const u = new URL(String(url));
    const key = `${method} ${u.pathname}${u.search}`;
    state.requests.push(key);
    state.auth.push(String((init?.headers as Rec | undefined)?.Authorization ?? ""));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (seed.fail === `${method} ${u.pathname}`) return json({ detail: "boom" }, 500);
    if (method === "GET" && u.pathname === "/pro/dash/sync/owned") return json({ owned: {} });
    if (method === "POST" && u.pathname === "/pro/dash/sync") {
      state.posted.push(body.items);
      return json({ success: true });
    }
    if (u.pathname === "/pro/dash/sync/system/docks" && state.docks !== "absent") {
      const stored = state.docks as Rec | null;
      if (method === "GET") return json({ dashboard: stored });
      if (method === "PUT") {
        state.bodies.push(body);
        if (stored && (stored.revision as number) > body.revision) return json({ detail: "newer", dashboard: stored }, 409);
        state.docks = record(body.revision, body.content);
        return json({ success: true, dashboard: state.docks });
      }
    }
    return json({ detail: "not found" }, 404);
  });
  return state;
}
const docksRequests = (s: ReturnType<typeof fakeServer>) => s.requests.filter((r) => r.includes("/system/docks"));
const docks = () => useDashboardStore.getState().docks;

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(fetch).mockReset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" }, draft: null });
  // A sign-out first clears the module's per-session gates from the previous test.
  useWorkspaceStore.setState({ sessions: {} });
  useWorkspaceStore.setState({ connections: [{ ...conn, serverUrl: conn.baseUrl, askOnStartup: false }], sessions: { ws1: loginSession }, notices: {}, deciding: [] });
  useWorkspaceSyncStore.setState({ links: [], tombstones: [], unreadable: false });
  useWidgetRegistryStore.setState({ widgets: [] });
  useDashboardStore.setState({ dashboards: [], docks: makeDefaultDocks(), dockEdit: null, activeId: null, activeTabId: null, viewer: false });
});
afterEach(() => vi.useRealTimers());

describe("the docks sync on the system route (R6)", () => {
  it("never puts the docks through the owned/POST dashboard plan", async () => {
    useDashboardStore.setState({ dashboards: [{ id: "d1", name: "Main", tabs: [{ id: "t", name: "Main", cards: [] }] }], docks: docksAt(1_760_000_000_000) });
    const server = fakeServer();
    await syncDashboards("ws1");
    expect(server.posted.flatMap((items) => Object.keys(items))).not.toContain(DOCKS_ID);
    expect(JSON.stringify(server.posted)).not.toContain("Locked at Bottom");
    expect(docksRequests(server)).toEqual(["GET /pro/dash/sync/system/docks", "PUT /pro/dash/sync/system/docks"]);
  });

  it("PUTs exactly {revision, content} when the server has none and the docks were edited here", async () => {
    const local = docksAt(1_760_000_000_000);
    useDashboardStore.setState({ docks: local });
    const server = fakeServer();
    await syncDashboards("ws1");
    expect(server.bodies).toEqual([{ revision: 1_760_000_000_000, content: encodeDocksContent(local) }]);
    expect(Object.keys(server.bodies[0] as Rec)).toEqual(["revision", "content"]);
    expect((server.docks as Rec).hidden).toBe(true);
    expect(decodeDocksContent((server.docks as Rec).content)?.tabs[1].cards[0].title).toBe("Local");
  });

  it("sends nothing for docks never edited here when the server has none", async () => {
    const server = fakeServer();
    await syncDashboards("ws1");
    expect(docksRequests(server)).toEqual(["GET /pro/dash/sync/system/docks"]);
  });

  it("takes a newer server copy whole, at the server's revision, and writes it without a bump", async () => {
    useDashboardStore.setState({ docks: docksAt(1_760_000_000_000) });
    const theirs = docksAt(undefined, "Theirs");
    const server = fakeServer({ docks: record(1_770_000_000_000, encodeDocksContent(theirs)) });
    await syncDashboards("ws1");
    expect(docks().tabs[1].cards.map((c) => c.title)).toEqual(["Theirs"]);
    expect(docks().revision).toBe(1_770_000_000_000);
    expect(JSON.parse(__read("dashboards/docks.json")!).revision).toBe(1_770_000_000_000);
    expect(docksRequests(server)).toEqual(["GET /pro/dash/sync/system/docks"]);
  });

  it("PUTs a newer local copy over an older server one", async () => {
    useDashboardStore.setState({ docks: docksAt(1_770_000_000_000) });
    const server = fakeServer({ docks: record(1_760_000_000_000, encodeDocksContent(docksAt(undefined, "Old"))) });
    await syncDashboards("ws1");
    expect((server.docks as Rec).revision).toBe(1_770_000_000_000);
    expect(docks().tabs[1].cards[0].title).toBe("Local");
  });

  it("does nothing when the revisions are equal", async () => {
    useDashboardStore.setState({ docks: docksAt(1_760_000_000_000) });
    const server = fakeServer({ docks: record(1_760_000_000_000, encodeDocksContent(docksAt(undefined, "Same"))) });
    await syncDashboards("ws1");
    expect(docksRequests(server)).toEqual(["GET /pro/dash/sync/system/docks"]);
    expect(docks().tabs[1].cards[0].title).toBe("Local");
  });

  it("takes the record a 409 returns: a newer copy landed between the GET and the PUT", async () => {
    useDashboardStore.setState({ docks: docksAt(1_770_000_000_000) });
    const server = fakeServer();
    const newer = record(1_780_000_000_000, encodeDocksContent(docksAt(undefined, "Raced")));
    const real = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if ((init?.method ?? "GET") === "PUT") server.docks = newer;
      return real(url, init);
    });
    await syncDashboards("ws1");
    expect(docks().tabs[1].cards[0].title).toBe("Raced");
    expect(docks().revision).toBe(1_780_000_000_000);
  });

  // Review W3: a concurrent first PUT could answer 409 with the OLDER row that
  // won the insert. That record is not a winner: keep the local docks and
  // upload again, which now meets the stored row and wins on revision.
  it("ignores a 409 whose record is older than the local docks, and uploads again", async () => {
    const local = docksAt(1_770_000_000_000);
    useDashboardStore.setState({ docks: local });
    const older = record(1_760_000_000_000, encodeDocksContent(docksAt(undefined, "Older")));
    const server = fakeServer();
    const real = vi.mocked(fetch).getMockImplementation()!;
    let puts = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if ((init?.method ?? "GET") === "PUT" && ++puts === 1) {
        server.docks = older;
        return new Response(JSON.stringify({ detail: "newer", dashboard: older }), { status: 409 });
      }
      return real(url, init);
    });
    await syncDashboards("ws1");
    expect(docks().tabs[1].cards[0].title).toBe("Local");
    expect(docks().revision).toBe(1_770_000_000_000);
    expect(puts).toBe(2);
    expect((server.docks as Rec).revision).toBe(1_770_000_000_000);
  });

  it("keeps the local docks, quietly, when the server's newer record cannot be read (Q3)", async () => {
    useDashboardStore.setState({ docks: docksAt(1_760_000_000_000) });
    const server = fakeServer({ docks: record(1_770_000_000_000, { schemaVersion: 2, profile: "v9", anything: true }) });
    await syncDashboards("ws1");
    expect(docks().tabs[1].cards[0].title).toBe("Local");
    expect(docksRequests(server)).toEqual(["GET /pro/dash/sync/system/docks"]);
    expect(useWorkspaceStore.getState().notices.ws1).toBeUndefined();
    expect(__read("logs/bdobb.log")).toMatch(/cannot read/);
  });

  it("keeps the docks local on a server without the route (404), says so in the log, and asks no more this session", async () => {
    useDashboardStore.setState({ docks: docksAt(1_760_000_000_000) });
    const server = fakeServer({ docks: "absent" });
    await syncDashboards("ws1");
    expect(docksRequests(server)).toEqual(["GET /pro/dash/sync/system/docks"]);
    expect(useWorkspaceStore.getState().notices.ws1).toBeUndefined();
    expect(__read("logs/bdobb.log")).toMatch(/keeps no locked widgets/);
    await syncDocks("ws1");
    expect(docksRequests(server)).toHaveLength(1);
  });

  it("reports a failed request on the connection, as a dashboard failure is", async () => {
    useDashboardStore.setState({ docks: docksAt(1_760_000_000_000) });
    fakeServer({ fail: "GET /pro/dash/sync/system/docks" });
    await syncDashboards("ws1");
    expect(useWorkspaceStore.getState().notices.ws1).toMatch(/^Locked widgets not synced:/);
  });

  it("sends the session's Bearer token in login mode and the connection's Basic credential in key mode", async () => {
    useDashboardStore.setState({ docks: docksAt(1_760_000_000_000) });
    let server = fakeServer();
    await syncDashboards("ws1");
    const loginAuth = server.requests.map((r, i) => [r, server.auth[i]]).filter(([r]) => r.includes("/system/docks"));
    expect(loginAuth.map(([, a]) => a)).toEqual(["Bearer synthetic-session", "Bearer synthetic-session"]);

    useWorkspaceStore.setState({ sessions: {} });
    useWorkspaceStore.setState({ sessions: { ws1: keySession } });
    useDashboardStore.setState({ docks: docksAt(1_770_000_000_000) });
    server = fakeServer();
    await syncDashboards("ws1");
    const keyAuth = server.requests.map((r, i) => [r, server.auth[i]]).filter(([r]) => r.includes("/system/docks"));
    expect(keyAuth.map(([, a]) => a)).toEqual(["Basic dXNlcjpwYXNz", "Basic dXNlcjpwYXNz"]);
  });

  it("uploads after an edit ends (OK), and nothing while the editor is open", async () => {
    await useDashboardStore.getState().setDockRows("top", 4); // an edited docks, as on disk
    const server = fakeServer({ docks: null });
    await syncDashboards("ws1");
    server.requests.length = 0;
    server.bodies.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startDashboardAutoUpload();
    try {
      useDashboardStore.getState().beginDockEdit("bottom");
      await useDashboardStore.getState().setDockRows("bottom", 10);
      await vi.advanceTimersByTimeAsync(UPLOAD_DEBOUNCE_MS * 2);
      expect(docksRequests(server)).toEqual([]);
      await useDashboardStore.getState().commitDockEdit();
      await vi.advanceTimersByTimeAsync(UPLOAD_DEBOUNCE_MS);
      await vi.waitFor(() => expect(server.bodies).toHaveLength(1));
    } finally {
      stop();
    }
    expect((server.bodies[0] as { revision: number }).revision).toBe(docks().revision);
    expect(decodeDocksContent((server.bodies[0] as Rec).content)?.dockRows?.bottom).toBe(10);
  });
});
