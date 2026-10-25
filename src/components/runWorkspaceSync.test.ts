// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./dialogs/WorkspaceDialogs", () => ({ askWorkspaceSignIn: vi.fn(), askBackendCredential: vi.fn(), decideWorkspaceConflict: vi.fn() }));
// The dashboard half has its own suite (runDashboardSync.test.ts); here it only has to be called at the right time.
vi.mock("./runDashboardSync", () => ({ syncDashboards: vi.fn() }));
import { __read, __reset } from "../test/memfs";
import { backend } from "../test/fixtures";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { SettingsConnection } from "../lib/workspaceAccount";
import { useBackendsStore } from "../stores/backendsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { askBackendCredential, askWorkspaceSignIn, decideWorkspaceConflict } from "./dialogs/WorkspaceDialogs";
import { connectServer, keyRefusedMessage, promptSignIn, runStartupPrompt, syncAfterSignIn } from "./runWorkspaceSync";
import { syncDashboards } from "./runDashboardSync";

const userId = "11111111-1111-4111-8111-111111111111";
const conn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const ws = (id: string, askOnStartup: boolean) => ({ id, name: id, serverUrl: `https://${id}.workspace.example`, askOnStartup });
const entry = (displaySettings: unknown, connection: SettingsConnection = conn) => ({ mode: "login" as const, connection, username: "alice", userId, token: "synthetic-session", displaySettings, state: "signed-in" as const });
const keyEntry = (displaySettings: unknown, connection: SettingsConnection) => ({ mode: "key" as const, connection, displaySettings, state: "signed-in" as const });
const REFUSED = "Key refused by Work; fix the key in Connections.";
const posts = () => vi.mocked(fetch).mock.calls.filter(([, o]) => o?.method === "POST");
const REAL = { refresh: useBackendsStore.getState().refresh, probe: useWorkspaceStore.getState().probe, connectByKey: useWorkspaceStore.getState().connectByKey };
/** Stubs the probe's answer and, for key mode, a connect that lands the given display settings. */
function serverAnswers(mode: "key" | "login" | "no", display: unknown = { theme: "dark" }) {
  const probe = vi.fn(async () => mode);
  const connectByKey = vi.fn(async (c: SettingsConnection): Promise<string | null> => {
    useWorkspaceStore.setState({ sessions: { ...useWorkspaceStore.getState().sessions, [c.id]: keyEntry(display, c) } });
    return null;
  });
  useWorkspaceStore.setState({ probe, connectByKey });
  return { probe, connectByKey };
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  vi.mocked(fetch).mockReset();
  vi.mocked(askWorkspaceSignIn).mockReset();
  vi.mocked(askBackendCredential).mockReset();
  vi.mocked(decideWorkspaceConflict).mockReset();
  vi.mocked(syncDashboards).mockReset();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "ws1" }, draft: null });
  useWorkspaceStore.setState({ ...REAL, notices: {}, connections: [{ ...conn, serverUrl: conn.baseUrl, askOnStartup: false }], usernames: {}, sessions: { ws1: entry({ theme: "dark" }) } });
  useBackendsStore.setState({ backends: [], refresh: REAL.refresh });
});

describe("syncAfterSignIn", () => {
  it("syncs dashboards after a successful settings step, and not after a refused one", async () => {
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(syncDashboards).toHaveBeenCalledWith("ws1");
    vi.mocked(syncDashboards).mockClear();
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "purple" }) } });
    expect(await syncAfterSignIn("ws1")).toBe(false);
    expect(syncDashboards).not.toHaveBeenCalled();
  });

  it("finishes, asking nothing and calling nothing, when the session's settings match local", async () => {
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(decideWorkspaceConflict).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Use <name> saves the server's values locally", async () => {
    // Storage Local, as when User Settings switches: the save fires no upload.
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "light" }) } });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("server");
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(decideWorkspaceConflict).toHaveBeenCalledWith("Work", ["Theme: dark → light"], []);
    expect(JSON.parse(__read("settings.json") ?? "").theme).toBe("light");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Keep local uploads the local settings onto the session's display settings", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "light", keepMe: 1 }) } });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("local");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect(await syncAfterSignIn("ws1")).toBe(true);
    expect(useSettingsStore.getState().settings.theme).toBe("dark");
    expect(JSON.parse(posts()[0][1]?.body as string)).toMatchObject({ theme: "dark", keepMe: 1 });
  });

  it("uploads nothing while the conflict question is open; Keep local then sends the latest state once", async () => {
    // Storage already names ws1, as at launch: every save would upload.
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "light" }) } });
    let answer!: (choice: "server" | "local") => void;
    vi.mocked(decideWorkspaceConflict).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 200 }));
    const sync = syncAfterSignIn("ws1");
    await vi.waitFor(() => expect(decideWorkspaceConflict).toHaveBeenCalled());
    await useSettingsStore.getState().save({ maxDecimalPlaces: 3 });
    await new Promise((r) => setTimeout(r, 0));
    expect(posts()).toHaveLength(0);
    answer("local");
    expect(await sync).toBe(true);
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1]?.body as string)).toMatchObject({ theme: "dark", decimalDigits: 3 });
  });

  it("refuses malformed display settings without a local change", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: entry({ decimalDigits: "bad" }) } });
    expect(await syncAfterSignIn("ws1")).toBe(false);
    expect(useWorkspaceStore.getState().sessions.ws1).toMatchObject({ state: "not-synced" });
    expect(__read("settings.json")).toBeUndefined();
  });

  it("returns false without a session", async () => {
    useWorkspaceStore.setState({ sessions: {} });
    expect(await syncAfterSignIn("ws1")).toBe(false);
  });
});

describe("connectServer", () => {
  beforeEach(() => useWorkspaceStore.setState({ sessions: {} }));

  it("key mode connects with no prompt and syncs", async () => {
    const { connectByKey } = serverAnswers("key", { theme: "light" });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("server");
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    expect(await connectServer(conn)).toBe(true);
    expect(connectByKey).toHaveBeenCalledWith(conn);
    expect(askWorkspaceSignIn).not.toHaveBeenCalled();
    expect(decideWorkspaceConflict).toHaveBeenCalled();
  });

  it("login mode opens the sign-in dialog; Cancel connects nothing and syncs nothing", async () => {
    serverAnswers("login");
    vi.mocked(askWorkspaceSignIn).mockResolvedValueOnce(false);
    expect(await connectServer(conn)).toBe(false);
    expect(askWorkspaceSignIn).toHaveBeenCalledWith(conn);
    expect(decideWorkspaceConflict).not.toHaveBeenCalled();
  });

  it("no settings API, or a refused key, connects nothing and uploads nothing", async () => {
    serverAnswers("no");
    expect(await connectServer(conn)).toBe(false);
    const { connectByKey } = serverAnswers("key");
    connectByKey.mockResolvedValueOnce("key refused");
    expect(await connectServer(conn)).toBe(false);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses a live session without probing", async () => {
    const { probe } = serverAnswers("login");
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "dark" }) } });
    expect(await connectServer(conn)).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("promptSignIn (a card's Sign in)", () => {
  beforeEach(() => useWorkspaceStore.setState({ sessions: {} }));

  it("connects the connection holding settings by its mode", async () => {
    const { connectByKey } = serverAnswers("key");
    await promptSignIn(conn);
    expect(connectByKey).toHaveBeenCalled();
  });

  it("only signs in to any other connection, without probing or syncing", async () => {
    const { probe } = serverAnswers("login");
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    vi.mocked(askWorkspaceSignIn).mockResolvedValueOnce(true);
    await promptSignIn(conn);
    expect(askWorkspaceSignIn).toHaveBeenCalledWith(conn);
    expect(probe).not.toHaveBeenCalled();
    expect(decideWorkspaceConflict).not.toHaveBeenCalled();
  });
});

describe("runStartupPrompt", () => {
  beforeEach(() => useWorkspaceStore.setState({ sessions: {} }));

  it("with Server on, connects at launch even when the server is not flagged: key mode needs no prompt", async () => {
    const { connectByKey } = serverAnswers("key");
    await runStartupPrompt();
    expect(connectByKey).toHaveBeenCalledWith(conn);
    expect(askWorkspaceSignIn).not.toHaveBeenCalled();
  });

  it("login mode prompts for the server first, then walks the other flagged connections, Workspace first", async () => {
    serverAnswers("login");
    const order: string[] = [];
    vi.mocked(askWorkspaceSignIn).mockImplementation(async (c, step) => { order.push(`${c.id}:${step ?? "server"}`); return false; });
    vi.mocked(askBackendCredential).mockImplementation(async (b, step) => { order.push(`${b.id}:${step}`); return "continued"; });
    useWorkspaceStore.setState({ connections: [{ ...ws("ws1", true), serverUrl: conn.baseUrl, name: "Work" }, ws("w2", true), ws("w3", false)] });
    useBackendsStore.setState({ backends: [backend({ id: "b1", askOnStartup: true }), backend({ id: "b2" })], refresh: vi.fn(async () => {}) });
    await runStartupPrompt();
    // The server (ws1) is not walked again as a flagged connection.
    expect(order).toEqual(["ws1:server", "w2:Step 1 of 2", "b1:Step 2 of 2"]);
  });

  it("Cancel at the server's sign-in keeps local settings and uploads nothing", async () => {
    serverAnswers("login");
    vi.mocked(askWorkspaceSignIn).mockResolvedValueOnce(false);
    await runStartupPrompt();
    expect(useSettingsStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, settingsStorage: "ws1" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a flagged server backend without a value asks for Key and Value first, then connects", async () => {
    const gw = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true });
    useBackendsStore.setState({ backends: [gw], refresh: vi.fn(async () => {}) });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "g" } });
    const { probe } = serverAnswers("key");
    vi.mocked(askBackendCredential).mockImplementationOnce(async () => {
      useBackendsStore.setState({ backends: [{ ...gw, headerValue: "admin@workspace.example" }] });
      return "continued";
    });
    await runStartupPrompt();
    expect(vi.mocked(askBackendCredential).mock.calls[0][1]).toBe("Step 1 of 1");
    // Connected against the backend as it is after its step, with the value.
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ id: "g", backend: expect.objectContaining({ headerValue: "admin@workspace.example" }) }));
  });

  it("skipping the server backend's credential step keeps settings local and discovers it without", async () => {
    const gw = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true });
    const refresh = vi.fn(async () => {});
    useBackendsStore.setState({ backends: [gw], refresh });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "g" } });
    const { probe } = serverAnswers("key");
    vi.mocked(askBackendCredential).mockResolvedValueOnce("skipped");
    await runStartupPrompt();
    expect(probe).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(["g"]);
  });

  it("does nothing with Local storage and nothing flagged", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    useBackendsStore.setState({ backends: [backend({ id: "b1" })] });
    const { probe } = serverAnswers("key");
    await runStartupPrompt();
    expect(probe).not.toHaveBeenCalled();
    expect(askWorkspaceSignIn).not.toHaveBeenCalled();
    expect(askBackendCredential).not.toHaveBeenCalled();
  });
});

describe("final-review fixes", () => {
  it("a refused-key session is not live: connecting again reconnects fresh", async () => {
    useWorkspaceStore.setState({ sessions: { ws1: { ...keyEntry({ theme: "dark" }, conn), state: "not-synced", reason: "key refused" } } });
    const { probe, connectByKey } = serverAnswers("key");
    expect(await connectServer(conn)).toBe(true);
    expect(probe).toHaveBeenCalled();
    expect(connectByKey).toHaveBeenCalled();
  });

  it("Keep local with a key refused on upload returns false, keeps the refusal notice and no session", async () => {
    useWorkspaceStore.setState({ sessions: {} });
    serverAnswers("key", { theme: "light" });
    useBackendsStore.setState({ backends: [] });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("local");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await connectServer(conn)).toBe(false);
    expect(useWorkspaceStore.getState().notices.ws1).toBe(REFUSED);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });

  it("Use <server> saves the extra patch together with the server's values, in one save", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, settingsStorage: "other" } });
    useWorkspaceStore.setState({ sessions: { ws1: entry({ theme: "light" }) } });
    vi.mocked(decideWorkspaceConflict).mockResolvedValueOnce("server");
    expect(await syncAfterSignIn("ws1", { settingsStorage: "ws1" })).toBe(true);
    expect(useSettingsStore.getState().settings).toMatchObject({ theme: "light", settingsStorage: "ws1" });
    expect(JSON.parse(__read("settings.json") ?? "")).toMatchObject({ theme: "light", settingsStorage: "ws1" });
  });

  it.each(["no", "needs-https", "authorization-header"] as const)("a probe answering %s is logged, naming the connection", async (answer) => {
    useWorkspaceStore.setState({ sessions: {}, probe: vi.fn(async () => answer) });
    expect(await connectServer(conn)).toBe(false);
    expect(__read("logs/bdobb.log") ?? "").toContain(`settings server Work: probe answered "${answer}"`);
  });
});

describe("a refused key is visible (rulings R1-R3)", () => {
  beforeEach(() => useWorkspaceStore.setState({ sessions: {} }));

  it("a 401 from the key connect sets the notice, creates no session and leaves storage alone", async () => {
    const { connectByKey } = serverAnswers("key");
    connectByKey.mockResolvedValueOnce("key refused");
    expect(await connectServer(conn)).toBe(false);
    expect(useWorkspaceStore.getState().notices.ws1).toBe(REFUSED);
    expect(keyRefusedMessage("Work")).toBe(REFUSED);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
    expect(useSettingsStore.getState().settings.settingsStorage).toBe("ws1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a probe answering key-refused sets the same notice and never reaches /pro/login", async () => {
    const { connectByKey } = serverAnswers("no");
    useWorkspaceStore.setState({ probe: vi.fn(async () => "key-refused" as const) });
    expect(await connectServer(conn)).toBe(false);
    expect(useWorkspaceStore.getState().notices.ws1).toBe(REFUSED);
    expect(connectByKey).not.toHaveBeenCalled();
    expect(askWorkspaceSignIn).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a later successful connect clears the notice", async () => {
    useWorkspaceStore.setState({ notices: { ws1: REFUSED } });
    serverAnswers("key");
    expect(await connectServer(conn)).toBe(true);
    expect(useWorkspaceStore.getState().notices.ws1).toBeUndefined();
  });

  it("the launch sequence leaves the notice behind", async () => {
    useWorkspaceStore.setState({ probe: vi.fn(async () => "key-refused" as const) });
    await runStartupPrompt();
    expect(useWorkspaceStore.getState().notices.ws1).toBe(REFUSED);
  });

  it("a login whose display settings are refused leaves no session that can upload", async () => {
    serverAnswers("login");
    vi.mocked(askWorkspaceSignIn).mockImplementationOnce(async (c) => {
      useWorkspaceStore.setState({ sessions: { ws1: entry({ decimalDigits: "bad" }, c) } });
      return true;
    });
    expect(await connectServer(conn)).toBe(false);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
    expect(useWorkspaceStore.getState().notices.ws1).toMatch(/^Not synced: .+/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a login response with no display settings is refused the same way", async () => {
    serverAnswers("login");
    vi.mocked(askWorkspaceSignIn).mockImplementationOnce(async (c) => {
      useWorkspaceStore.setState({ sessions: { ws1: entry(undefined, c) } });
      return true;
    });
    expect(await connectServer(conn)).toBe(false);
    expect(useWorkspaceStore.getState().sessions).toEqual({});
  });
});
