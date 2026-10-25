// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import { __list, __read, __reset, __seed } from "../test/memfs";
import { backend } from "../test/fixtures";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { useBackendsStore } from "./backendsStore";
import { storageConnection, toSettingsConnections, useWorkspaceStore } from "./workspaceStore";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const ws = { id: "ws1", name: "Work", serverUrl: "https://workspace.example", askOnStartup: false };
const wsConn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const entry = { mode: "login" as const, connection: wsConn, username: "alice", userId, token: "synthetic-session", displaySettings: { keepMe: 1 }, state: "signed-in" as const };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const loginReply = () => reply({ uuid: userId, access_token: "synthetic-session", user: { pro_display_settings: { keepMe: 1 } } });
const uploads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/pro/display-settings"));
const file = () => JSON.parse(__read("workspace.json") ?? "null");

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(fetch).mockReset();
  useBackendsStore.setState({ backends: [] });
  useWorkspaceStore.setState({ connections: [], usernames: {}, sessions: {}, apis: {}, notices: {} });
});

describe("connections", () => {
  it("loads nothing when workspace.json is absent, and every connection when present", async () => {
    await useWorkspaceStore.getState().load();
    expect(useWorkspaceStore.getState().connections).toEqual([]);
    __seed("workspace.json", JSON.stringify({ connections: [ws, { id: "ws2", name: "Home", serverUrl: "https://home.workspace.example" }], usernames: { ws1: "alice" } }));
    await useWorkspaceStore.getState().load();
    expect(useWorkspaceStore.getState().connections).toEqual([ws, { id: "ws2", name: "Home", serverUrl: "https://home.workspace.example", askOnStartup: false }]);
    expect(useWorkspaceStore.getState().usernames).toEqual({ ws1: "alice" });
  });

  it("writes exactly the connections and usernames, and allows several", async () => {
    const a = await useWorkspaceStore.getState().saveConnection({ name: "Work", serverUrl: "https://workspace.example", askOnStartup: true });
    const b = await useWorkspaceStore.getState().saveConnection({ name: "Home", serverUrl: "https://home.workspace.example", askOnStartup: false });
    expect(file()).toEqual({
      connections: [
        { id: a.id, name: "Work", serverUrl: "https://workspace.example", askOnStartup: true },
        { id: b.id, name: "Home", serverUrl: "https://home.workspace.example", askOnStartup: false },
      ],
      usernames: {},
    });
  });

  it("edits in place by id, dropping that session only when the address changes", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: {} }));
    await useWorkspaceStore.getState().load();
    useWorkspaceStore.setState({ sessions: { ws1: entry } });
    await useWorkspaceStore.getState().saveConnection({ ...ws, name: "Work 2", askOnStartup: true });
    expect(useWorkspaceStore.getState().sessions.ws1).toBeDefined();
    await useWorkspaceStore.getState().saveConnection({ ...ws, name: "Work 2", serverUrl: "https://other.workspace.example" });
    expect(file().connections).toEqual([{ ...ws, name: "Work 2", serverUrl: "https://other.workspace.example" }]);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("removes a Workspace connection with its username and session, and forgets a backend's username", async () => {
    __seed("workspace.json", JSON.stringify({ connections: [ws], usernames: { ws1: "alice", b1: "bob" } }));
    await useWorkspaceStore.getState().load();
    useWorkspaceStore.setState({ sessions: { ws1: entry, b1: { ...entry, connection: { id: "b1", name: "G", baseUrl: "https://g.workspace.example" } } } });
    await useWorkspaceStore.getState().removeConnection("ws1");
    expect(file()).toEqual({ connections: [], usernames: { b1: "bob" } });
    expect(Object.keys(useWorkspaceStore.getState().sessions)).toEqual(["b1"]);
    await useWorkspaceStore.getState().removeConnection("b1");
    expect(file().usernames).toEqual({});
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("does not create workspace.json when removing a backend it knows nothing about", async () => {
    await useWorkspaceStore.getState().removeConnection("b9");
    expect(__read("workspace.json")).toBeUndefined();
  });

  it("lists Workspace connections first, then backends, and treats a dangling storage id as Local", () => {
    const b = backend({ id: "b1", name: "Gateway", baseUrl: "https://gateway.workspace.example" });
    const list = toSettingsConnections([ws], [b]);
    expect(list).toEqual([wsConn, { id: "b1", name: "Gateway", baseUrl: b.baseUrl, backend: b }]);
    expect(storageConnection({ ...DEFAULT_SETTINGS, settingsStorage: "b1" }, list)?.id).toBe("b1");
    expect(storageConnection({ ...DEFAULT_SETTINGS, settingsStorage: "gone" }, list)).toBeNull();
    expect(storageConnection(DEFAULT_SETTINGS, list)).toBeNull();
  });
});

describe("sign-in", () => {
  it("keeps one session per connection, and Remember me decides whether the username is stored", async () => {
    useWorkspaceStore.setState({ connections: [ws, { ...ws, id: "ws2", name: "Home" }] });
    vi.mocked(fetch).mockResolvedValueOnce(loginReply()).mockResolvedValueOnce(loginReply());
    expect(await useWorkspaceStore.getState().signIn(wsConn, " alice ", "synthetic-password", true)).toBeNull();
    expect(await useWorkspaceStore.getState().signIn({ ...wsConn, id: "ws2", name: "Home" }, "bob", "synthetic-password", false)).toBeNull();
    expect(Object.keys(useWorkspaceStore.getState().sessions).sort()).toEqual(["ws1", "ws2"]);
    expect(useWorkspaceStore.getState().sessions.ws1).toMatchObject({ username: "alice", state: "signed-in", displaySettings: { keepMe: 1 } });
    expect(file().usernames).toEqual({ ws1: "alice" });
    // Unticking Remember me at the next sign-in deletes the stored username.
    vi.mocked(fetch).mockResolvedValueOnce(loginReply());
    await useWorkspaceStore.getState().signIn(wsConn, "alice", "synthetic-password", false);
    expect(file().usernames).toEqual({});
  });

  it("never writes the password or token to disk", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    vi.mocked(fetch).mockResolvedValueOnce(loginReply()).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await useWorkspaceStore.getState().signIn(wsConn, "alice", "synthetic-password", true);
    await useWorkspaceStore.getState().queueUpload("ws1", { ...DEFAULT_SETTINGS, settingsStorage: "ws1" });
    for (const path of __list()) {
      expect(__read(path)).not.toContain("synthetic-session");
      expect(__read(path)).not.toContain("synthetic-password");
    }
  });

  it("returns the refusal and stays signed out when sign-in fails", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, 401));
    expect(await useWorkspaceStore.getState().signIn(wsConn, "alice", "wrong", true)).toMatch(/Sign-in failed/);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("drops a sign-in whose connection was removed while it was in flight", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(loginReply());
    expect(await useWorkspaceStore.getState().signIn(wsConn, "alice", "synthetic-password", true)).toMatch(/removed/);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });
});

describe("key mode", () => {
  const gw = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "X-Key", headerValue: "k1" });
  const gwConn = { id: "g", name: "Gateway", baseUrl: gw.baseUrl, backend: gw };
  beforeEach(() => useBackendsStore.setState({ backends: [gw] }));

  it("connects with the key alone and keeps the server's display settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: { keepMe: 1 } }));
    expect(await useWorkspaceStore.getState().connectByKey(gwConn)).toBeNull();
    expect(useWorkspaceStore.getState().sessions.g).toEqual({ mode: "key", connection: gwConn, displaySettings: { keepMe: 1 }, state: "signed-in" });
  });

  it("creates no session when the key is refused", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, 401));
    expect(await useWorkspaceStore.getState().connectByKey(gwConn)).toBe("key refused");
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("a key-mode upload refused with 401 is Not synced: key refused, and the session stays", async () => {
    useWorkspaceStore.setState({ sessions: { g: { mode: "key", connection: gwConn, displaySettings: {}, state: "signed-in" } } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await useWorkspaceStore.getState().queueUpload("g", DEFAULT_SETTINGS);
    expect(useWorkspaceStore.getState().sessions.g).toMatchObject({ mode: "key", state: "not-synced", reason: "key refused" });
  });
});

describe("probe and probeAll", () => {
  it("records each connection's mode, never probing one that needs HTTPS", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    useBackendsStore.setState({
      backends: [
        backend({ id: "b1", baseUrl: "https://a.workspace.example" }),
        backend({ id: "b2", baseUrl: "http://nas.workspace.example" }),
        backend({ id: "b3", baseUrl: "https://c.workspace.example", headerName: "Authorization", headerValue: "Basic x", authLocation: "header" }),
        backend({ id: "b4", baseUrl: "https://d.workspace.example" }),
      ],
    });
    vi.mocked(fetch).mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("https://workspace.example") || u.startsWith("https://c.")) return new Response(null, { status: 401 });
      if (u.startsWith("https://d.")) return reply({ pro_display_settings: {} });
      return new Response(null, { status: 404 });
    });
    await useWorkspaceStore.getState().probeAll();
    expect(useWorkspaceStore.getState().apis).toEqual({ ws1: "login", b1: "no", b2: "needs-https", b3: "authorization-header", b4: "key" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("probe records one connection's answer and returns it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await useWorkspaceStore.getState().probe(wsConn)).toBe("login");
    expect(useWorkspaceStore.getState().apis).toEqual({ ws1: "login" });
  });
});

describe("queueUpload", () => {
  const signedIn = () => useWorkspaceStore.setState({ connections: [ws], sessions: { ws1: entry } });

  it("does not upload without a session for that connection", async () => {
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("collapses queued uploads to the latest state and keeps what it posted as the session's display settings", async () => {
    signedIn();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const { queueUpload } = useWorkspaceStore.getState();
    await Promise.all([
      queueUpload("ws1", { ...DEFAULT_SETTINGS, railWidth: 30 }),
      queueUpload("ws1", { ...DEFAULT_SETTINGS, railWidth: 40 }),
      queueUpload("ws1", { ...DEFAULT_SETTINGS, railWidth: 50 }),
    ]);
    expect(uploads()).toHaveLength(1);
    const posted = JSON.parse(uploads()[0][1]?.body as string);
    expect(posted.extensions.bdobb.settings.railWidth).toBe(50);
    expect(useWorkspaceStore.getState().sessions.ws1.displaySettings).toEqual(posted);
    expect(posted.keepMe).toBe(1);
  });

  it.each([
    ["a 5xx", () => new Response(null, { status: 503 }), "The server refused the settings upload (HTTP 503)."],
    ["a network failure", () => { throw new Error("offline"); }, "Could not contact the server; local settings are unchanged."],
  ])("reports %s as Not synced and keeps the session", async (_label, post, reason) => {
    signedIn();
    vi.mocked(fetch).mockImplementationOnce(async () => post());
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(useWorkspaceStore.getState().sessions.ws1).toMatchObject({ token: "synthetic-session", state: "not-synced", reason, displaySettings: { keepMe: 1 } });
  });

  it("marks the session expired on a 401, and uploads nothing more for it", async () => {
    signedIn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(useWorkspaceStore.getState().sessions.ws1.state).toBe("expired");
    await useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores an upload result that lands after sign-out", async () => {
    signedIn();
    let release!: (r: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise((r) => { release = r; }));
    const upload = useWorkspaceStore.getState().queueUpload("ws1", DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    useWorkspaceStore.getState().signOut("ws1");
    release(new Response(null, { status: 200 }));
    await upload;
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });
});

describe("final-review fixes", () => {
  const keyed = { id: "k1", name: "Keyed", baseUrl: "https://keyed.example", backend: backend({ id: "k1", name: "Keyed", baseUrl: "https://keyed.example", headerName: "Authorization", headerValue: "Basic x" }) };
  const keyedEntry = { mode: "key" as const, connection: keyed, displaySettings: {}, state: "signed-in" as const };

  it("a key refused on upload leaves the visible notice", async () => {
    useBackendsStore.setState({ backends: [keyed.backend] });
    useWorkspaceStore.setState({ sessions: { k1: keyedEntry } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await useWorkspaceStore.getState().queueUpload("k1", DEFAULT_SETTINGS);
    expect(useWorkspaceStore.getState().sessions.k1).toMatchObject({ state: "not-synced", reason: "key refused" });
    expect(useWorkspaceStore.getState().notices.k1).toBe("Key refused by Keyed; fix the key in Connections.");
  });

  it("Sign out and Remove clear the connection's notice", async () => {
    useWorkspaceStore.setState({ connections: [ws], notices: { ws1: "x", other: "y" } });
    useWorkspaceStore.getState().signOut("ws1");
    expect(useWorkspaceStore.getState().notices).toEqual({ other: "y" });
    useWorkspaceStore.setState({ notices: { ws1: "x" } });
    await useWorkspaceStore.getState().removeConnection("ws1");
    expect(useWorkspaceStore.getState().notices).toEqual({});
  });

  it("a Remove landing right after the session is set leaves no remembered username", async () => {
    useWorkspaceStore.setState({ connections: [ws] });
    vi.mocked(fetch).mockResolvedValueOnce(loginReply());
    const unsubscribe = useWorkspaceStore.subscribe((s, prev) => {
      if (s.sessions.ws1 !== undefined && prev.sessions.ws1 === undefined) useWorkspaceStore.setState({ connections: [] });
    });
    await useWorkspaceStore.getState().signIn(wsConn, "alice", "pw", true);
    unsubscribe();
    expect(useWorkspaceStore.getState().usernames).toEqual({});
    expect(file()).toBeNull();
  });
});
