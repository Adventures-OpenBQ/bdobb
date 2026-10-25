// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetch } from "@tauri-apps/plugin-http";
import {
  connectByKey,
  KEY_REFUSED,
  mergeUpload,
  probeSettingsApi,
  readSessionSettings,
  uploadWorkspaceSettings,
  workspaceAddress,
  workspaceSignIn,
  type SettingsConnection,
  type WorkspaceSession,
} from "./workspaceAccount";
import { DEFAULT_SETTINGS } from "./settingsFile";
import { backend } from "../test/fixtures";
import type { AuthLocation, Settings } from "./types";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
const userId = "11111111-1111-4111-8111-111111111111";
const workspace: SettingsConnection = { id: "ws1", name: "Work", baseUrl: "https://workspace.example/api/" };
const credentials = { connection: workspace, username: "alice", password: "synthetic-password" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const login = (display: unknown = { theme: "light" }) =>
  vi.mocked(fetch).mockResolvedValueOnce(reply({ uuid: userId, access_token: "synthetic-session", force_2fa: false, temporary_password: false, user: { pro_display_settings: display } }));
const session = (displaySettings: unknown, connection: SettingsConnection = workspace): WorkspaceSession => ({ mode: "login", connection, username: "alice", userId, token: "synthetic-session", displaySettings });
const keySession = (displaySettings: unknown, connection: SettingsConnection): WorkspaceSession => ({ mode: "key", connection, displaySettings });
const call = (n: number) => vi.mocked(fetch).mock.calls[n];
const headersOf = (n: number) => call(n)[1]?.headers as Record<string, string>;
const viaBackend = (headerName: string, authLocation: AuthLocation = "header"): SettingsConnection => {
  const b = backend({ id: "b1", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName, headerValue: "Basic c3ludGhldGlj", authLocation });
  return { id: b.id, name: b.name, baseUrl: b.baseUrl, backend: b };
};
beforeEach(() => vi.mocked(fetch).mockReset());

describe("workspaceAddress", () => {
  it("normalises an HTTPS address and refuses an unsafe one", () => {
    expect(workspaceAddress("https://workspace.example/api/")).toEqual({ ok: true, value: "https://workspace.example/api" });
    for (const raw of ["", "http://remote.example", "https://name:pass@workspace.example", "https://workspace.example/?token=secret", "https://workspace.example/#x"]) {
      expect(workspaceAddress(raw).ok).toBe(false);
    }
    expect(workspaceAddress("http://127.0.0.1:6900").ok).toBe(true);
  });
});

describe("workspaceSignIn (login mode; bug #9: login only)", () => {
  it.each([
    { ...credentials, username: "" },
    { ...credentials, password: "" },
    { ...credentials, connection: { ...workspace, baseUrl: "" } },
  ])("rejects partial input without network traffic", async (input) => {
    expect((await workspaceSignIn(input)).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns the session with the login response's display settings, and calls nothing else", async () => {
    login({ theme: "light", keepMe: 1 });
    const result = await workspaceSignIn(credentials);
    expect(result).toEqual({ ok: true, value: session({ theme: "light", keepMe: 1 }) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call(0)[0]).toBe("https://workspace.example/api/pro/login");
    expect(JSON.parse(call(0)[1]?.body as string)).toEqual({ email: "alice", password: "synthetic-password", remember: false, source: "pro" });
    expect(JSON.stringify(result)).not.toContain("synthetic-password");
  });
  it.each([202, 401, 403, 500])("refuses a login answered with HTTP %i, not as an expiry", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ detail: "synthetic-password" }, status));
    const result = await workspaceSignIn(credentials);
    expect(result).toMatchObject({ ok: false, expired: false });
    expect(JSON.stringify(result)).not.toContain("synthetic-password");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ force_2fa: true }, { temporary_password: true }, { uuid: "not-a-uuid" }])("refuses an unverified account or an invalid response", async (flags) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ uuid: userId, access_token: "synthetic-session", ...flags }));
    expect((await workspaceSignIn(credentials)).ok).toBe(false);
  });
  it.each(["http://remote.example", "https://name:pass@workspace.example", "https://workspace.example/?token=secret"])("refuses %s before sending credentials", async (baseUrl) => {
    expect((await workspaceSignIn({ ...credentials, connection: { ...workspace, baseUrl } })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("allows a loopback development server", async () => {
    login();
    expect((await workspaceSignIn({ ...credentials, connection: { ...workspace, baseUrl: "http://127.0.0.1:6900" } })).ok).toBe(true);
  });
  it("cancels before making a request when already aborted", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await workspaceSignIn(credentials, controller.signal)).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("handles invalid JSON and network failure without echoing response data", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic-password"));
    const result = await workspaceSignIn(credentials);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-password");
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not JSON"));
    expect((await workspaceSignIn(credentials)).ok).toBe(false);
  });
  it("sends a data backend's own credential with the login", async () => {
    login();
    await workspaceSignIn({ ...credentials, connection: viaBackend("X-Gateway-Key") });
    expect(headersOf(0)).toMatchObject({ "X-Gateway-Key": "Basic c3ludGhldGlj" });
  });
});

describe("connectByKey (key mode)", () => {
  it.each([
    ["header", "X-Gateway-Key", (n: number) => expect(headersOf(n)).toEqual({ "X-Gateway-Key": "Basic c3ludGhldGlj" })],
    ["cookie", "session", (n: number) => expect(headersOf(n)).toEqual({ Cookie: "session=Basic c3ludGhldGlj" })],
    ["query", "apikey", (n: number) => expect(call(n)[0]).toBe("https://gateway.workspace.example/pro/user?apikey=Basic+c3ludGhldGlj")],
  ] as const)("reads GET /pro/user with only the %s credential: no login, no token", async (location, name, check) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: { theme: "light" } }));
    const connection = viaBackend(name, location);
    expect(await connectByKey(connection)).toEqual({ ok: true, value: keySession({ theme: "light" }, connection) });
    expect(fetch).toHaveBeenCalledTimes(1);
    check(0);
    expect(JSON.stringify(call(0))).not.toContain("Bearer");
  });
  it("works for a backend whose own credential is the Authorization header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    expect((await connectByKey(viaBackend("Authorization"))).ok).toBe(true);
    expect(headersOf(0)).toEqual({ Authorization: "Basic c3ludGhldGlj" });
  });
  it.each([[401, KEY_REFUSED], [500, undefined]])("a %i is a failure, never an expiry", async (status, message) => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, status));
    const result = await connectByKey(viaBackend("X-Gateway-Key"));
    expect(result).toMatchObject({ ok: false, expired: false });
    if (message !== undefined) expect(result).toMatchObject({ message });
  });
  it("R2: a 200 with an empty pro_display_settings (never written) is a key session with empty display settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    const connection = viaBackend("Authorization");
    expect(await connectByKey(connection)).toEqual({ ok: true, value: keySession({}, connection) });
  });
  it("R2: a 401 with a Basic challenge is key refused", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401, headers: { "WWW-Authenticate": "Basic realm=x" } }));
    expect(await connectByKey(viaBackend("Authorization"))).toEqual({ ok: false, expired: false, message: KEY_REFUSED });
  });
  it("refuses a 200 without display settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ uuid: userId }));
    expect((await connectByKey(viaBackend("X-Gateway-Key"))).ok).toBe(false);
  });
});

describe("readSessionSettings", () => {
  it("maps the session's display settings and reviews what differs, with no network", () => {
    // This line's default theme is "system"; Workspace's shared theme is light or dark.
    const current = { ...DEFAULT_SETTINGS, theme: "dark" as const, autoRefreshMinutes: 15 as const };
    const result = readSessionSettings(session({ theme: "light", decimalDigits: 3, fontSize: "large", defaultTicker: { symbol: "MSFT" }, showWidgetControls: true }), current);
    expect(result).toMatchObject({ ok: true, value: { patch: { theme: "light", maxDecimalPlaces: 3, fontSize: "large", defaultTicker: "MSFT", collapseWidgetControls: false } } });
    if (result.ok) expect(result.value.review).toContain("Theme: dark → light");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not mutate the current settings", () => {
    const current = { ...DEFAULT_SETTINGS, autoRefreshMinutes: 15 as const };
    const before = JSON.stringify(current);
    readSessionSettings(session({ theme: "light", decimalDigits: 3 }), current);
    expect(JSON.stringify(current)).toBe(before);
  });
  it("lets the extensions.bdobb block override the shared keys", () => {
    const result = readSessionSettings(session({ theme: "light", extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { theme: "dark", autoRefreshMinutes: 5, railWidth: 60, defaultTicker: null } } } }), DEFAULT_SETTINGS);
    expect(result).toMatchObject({ ok: true, value: { patch: { theme: "dark", autoRefreshMinutes: 5, railWidth: 60, defaultTicker: undefined } } });
  });
  it("ignores BDOBB settings a later version wrote, with a note, and applies the rest", () => {
    // widgetGap is synced on this line (below); laterKey stands for a key a later line adds.
    const result = readSessionSettings(session({ extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { railWidth: 60, laterKey: 1 } } } }), DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.patch).toMatchObject({ railWidth: 60 });
    expect(result.value.patch).not.toHaveProperty("laterKey");
    expect(result.value.notes).toContain("Settings from a later BDOBB version are not used here: laterKey.");
  });
  it("applies a synced widgetGap without a note", () => {
    const result = readSessionSettings(session({ extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { widgetGap: 12 } } } }), DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.patch.widgetGap).toBe(12);
    expect(result.value.notes).toEqual([]);
  });
  // Previously refused outright; since the 2026-10-09 ruling an unknown key
  // is ignored with a note. The property that matters still holds: neither a
  // credential-shaped key nor this machine's storage choice is ever applied.
  it.each([
    [{ headerValue: "secret" }, "headerValue"],
    [{ settingsStorage: "ws1" }, "settingsStorage"],
  ])("never applies an unknown key such as %o, and names it in a note", (native, key) => {
    const result = readSessionSettings(session({ extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: native } } }), DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.patch).not.toHaveProperty(key);
    expect(result.value.notes).toContain(`Settings from a later BDOBB version are not used here: ${key}.`);
  });
  it("reviews nothing when the server matches local", () => {
    const current = { ...DEFAULT_SETTINGS, theme: "dark" as const };
    expect(readSessionSettings(session({ theme: "dark" }), current)).toMatchObject({ ok: true, value: { review: [] } });
  });
  it.each([
    undefined,
    { extensions: { bdobb: { schemaVersion: 2, profile: "v3", settings: {} } } },
    { extensions: { bdobb: { schemaVersion: 1, profile: "v3", settings: { autoRefreshMinutes: 2 } } } },
    { decimalDigits: "bad" },
  ])("refuses invalid or missing display settings", (display) => {
    expect(readSessionSettings(session(display), DEFAULT_SETTINGS)).toMatchObject({ ok: false, expired: false });
  });
  it("reports unsupported OpenBB preferences without replacing supported local values", () => {
    const result = readSessionSettings(session({ theme: null, fontSize: "small", decimalDigits: 8 }), DEFAULT_SETTINGS);
    expect(result).toMatchObject({ ok: true, value: { patch: {} } });
    if (result.ok) expect(result.value.notes.length).toBeGreaterThan(0);
  });
});

describe("mergeUpload", () => {
  const local: Settings = { ...DEFAULT_SETTINGS, theme: "light", fontSize: "large", maxDecimalPlaces: 4, collapseWidgetControls: true, cornerDragHandles: true, defaultTicker: "AAPL", autoRefreshMinutes: 5, settingsStorage: "ws1" };
  it("writes the shared keys and the bdobb block, and keeps everything else", () => {
    const server = { theme: "dark", defaultTicker: { id: "x", symbol: "MSFT", name: "Microsoft" }, dashboardDensity: "compact", gridCorners: ["ne", "sw"], extensions: { other: { a: 1 } } };
    const merged = mergeUpload(server, local);
    expect(merged).toMatchObject({ theme: "light", fontSize: "large", decimalDigits: 4, showWidgetControls: false, gridCorners: ["ne", "sw"], dashboardDensity: "compact" });
    // The server's instrument object stands: BDOBB holds a symbol only.
    expect(merged.defaultTicker).toEqual(server.defaultTicker);
    expect(merged.extensions).toEqual({
      other: { a: 1 },
      bdobb: { schemaVersion: 1, profile: "v3", settings: expect.objectContaining({ defaultTicker: "AAPL", autoRefreshMinutes: 5, railWidth: 48 }) },
    });
    const native = (merged.extensions as { bdobb: { settings: Record<string, unknown> } }).bdobb.settings;
    // Eleven v3 keys plus this line's widgetGap.
    expect(Object.keys(native)).toHaveLength(12);
    expect(native.widgetGap).toBe(local.widgetGap);
    expect(native).not.toHaveProperty("settingsStorage");
  });
  it.each([
    [true, "dark"],
    [false, "light"],
  ] as const)("on theme system, sends the OS appearance (dark OS: %s) and keeps system in the bdobb block", (dark, sent) => {
    vi.stubGlobal("matchMedia", () => ({ matches: dark }) as MediaQueryList);
    try {
      const merged = mergeUpload({}, { ...local, theme: "system" });
      expect(merged.theme).toBe(sent);
      expect((merged.extensions as { bdobb: { settings: Record<string, unknown> } }).bdobb.settings.theme).toBe("system");
      // The next sign-in reads the object back without refusing it.
      const read = readSessionSettings(session(merged), { ...local, theme: "system" });
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.patch.theme).toBe("system");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("applies the gridCorners rule", () => {
    expect(mergeUpload({ gridCorners: ["ne"] }, { ...local, cornerDragHandles: false }).gridCorners).toEqual([]);
    expect(mergeUpload({ gridCorners: [] }, local).gridCorners).toEqual(["se"]);
    expect(mergeUpload({}, local).gridCorners).toEqual(["se"]);
  });
  it("sends a cleared ticker or auto-refresh as null so another device clears it too", () => {
    const native = (mergeUpload({}, { ...local, defaultTicker: undefined, autoRefreshMinutes: undefined }).extensions as { bdobb: { settings: Record<string, unknown> } }).bdobb.settings;
    expect(native.defaultTicker).toBeNull();
    expect(native.autoRefreshMinutes).toBeNull();
  });
});

describe("uploadWorkspaceSettings", () => {
  const local: Settings = { ...DEFAULT_SETTINGS, theme: "light", railWidth: 60, defaultTicker: "AAPL", settingsStorage: "ws1" };
  it("login mode: merges onto the session's display settings, posts once with Bearer only, and returns what it posted", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await uploadWorkspaceSettings(session({ theme: "dark", keepMe: true }), local);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call(0)[0]).toBe("https://workspace.example/api/pro/display-settings");
    expect(call(0)[1]?.method).toBe("POST");
    expect(headersOf(0)).toEqual({ Authorization: "Bearer synthetic-session", "Content-Type": "application/json" });
    const posted = JSON.parse(call(0)[1]?.body as string);
    expect(posted).toMatchObject({ theme: "light", keepMe: true });
    expect(result).toEqual({ ok: true, value: posted });
  });
  it("round-trips: what an upload posts reads back as the same synced settings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await uploadWorkspaceSettings(session({}), local);
    if (!result.ok) throw new Error(result.message);
    const back = readSessionSettings(session(result.value), DEFAULT_SETTINGS);
    expect(back.ok).toBe(true);
    if (back.ok) expect({ ...DEFAULT_SETTINGS, ...back.value.patch, settingsStorage: "ws1" }).toEqual(local);
  });
  it("login mode on a data backend: its own credential per authLocation, plus Bearer, never X-OpenBB-Authorization", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await uploadWorkspaceSettings(session({}, viaBackend("X-Gateway-Key")), local);
    expect(headersOf(0)).toMatchObject({ "X-Gateway-Key": "Basic c3ludGhldGlj", Authorization: "Bearer synthetic-session" });
    expect(headersOf(0)).not.toHaveProperty("X-OpenBB-Authorization");
  });
  it("login mode refuses, without a request, a backend whose own credential uses the Authorization header", async () => {
    expect(await uploadWorkspaceSettings(session({}, viaBackend("authorization")), local)).toMatchObject({ ok: false, expired: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("key mode posts with only the backend credential, and a 401 is key refused, not an expiry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await uploadWorkspaceSettings(keySession({ keepMe: 1 }, viaBackend("Authorization")), local);
    expect(headersOf(0)).toEqual({ Authorization: "Basic c3ludGhldGlj", "Content-Type": "application/json" });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await uploadWorkspaceSettings(keySession({}, viaBackend("X-Gateway-Key")), local)).toEqual({ ok: false, expired: false, message: KEY_REFUSED });
  });
  it.each([undefined, null, "x", [1]])("refuses, without a request, when the server's settings are unknown (%j)", async (display) => {
    expect(await uploadWorkspaceSettings(session(display), local)).toMatchObject({ ok: false, expired: false });
    expect(await uploadWorkspaceSettings(keySession(display, workspace), local)).toMatchObject({ ok: false, expired: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("key mode with a legitimately empty settings object still uploads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect((await uploadWorkspaceSettings(keySession({}, viaBackend("X-Gateway-Key")), local)).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("key mode: a 403 is key refused like a 401; login mode: a 403 is a plain failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await uploadWorkspaceSettings(keySession({}, viaBackend("X-Gateway-Key")), local)).toEqual({ ok: false, expired: false, message: KEY_REFUSED });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await uploadWorkspaceSettings(session({}), local)).toMatchObject({ ok: false, expired: false, message: "The server refused the settings upload (HTTP 403)." });
  });
  it("login mode: a 401 is expired and a 5xx a plain failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await uploadWorkspaceSettings(session({}), local)).toMatchObject({ ok: false, expired: true });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await uploadWorkspaceSettings(session({}), local)).toMatchObject({ ok: false, expired: false, message: "The server refused the settings upload (HTTP 503)." });
  });
  it("reports a network failure without throwing", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    expect(await uploadWorkspaceSettings(session({}), local)).toMatchObject({ ok: false, expired: false });
  });
});

describe("probeSettingsApi", () => {
  it("classifies 200 with display settings as key mode", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    expect(await probeSettingsApi(viaBackend("X-Gateway-Key"))).toBe("key");
    // The connection's own credential, and no token.
    expect(headersOf(0)).toEqual({ "X-Gateway-Key": "Basic c3ludGhldGlj" });
  });
  it.each([401, 403])("classifies %i as login mode", async (status) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status }));
    expect(await probeSettingsApi(workspace)).toBe("login");
    expect(call(0)[0]).toBe("https://workspace.example/api/pro/user");
    expect(headersOf(0)).toEqual({});
    expect(call(0)[1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    ["404", () => new Response(null, { status: 404 })],
    ["500", () => new Response(null, { status: 500 })],
    ["200 without display settings", () => reply({ uuid: userId })],
    ["200 that is not JSON", () => new Response("<html></html>", { status: 200 })],
  ])("classifies %s as no API", async (_label, answer) => {
    vi.mocked(fetch).mockResolvedValueOnce(answer());
    expect(await probeSettingsApi(workspace)).toBe("no");
  });
  it.each([new Error("offline"), new DOMException("timed out", "TimeoutError")])("a failed or timed-out probe means no API", async (err) => {
    vi.mocked(fetch).mockRejectedValueOnce(err);
    expect(await probeSettingsApi(workspace)).toBe("no");
  });
  it("never probes a backend that would not be allowed a credential", async () => {
    const plain = backend({ id: "b3", baseUrl: "http://nas.workspace.example:6900" });
    expect(await probeSettingsApi({ id: plain.id, name: plain.name, baseUrl: plain.baseUrl, backend: plain })).toBe("needs-https");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("R2: a 401 with a Basic challenge to a sent credential is key refused, not login mode", async () => {
    for (const scheme of ['Basic realm="x"', "basic", "BASIC realm=y"]) {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401, headers: { "WWW-Authenticate": scheme } }));
      expect(await probeSettingsApi(viaBackend("Authorization"))).toBe("key-refused");
    }
  });
  it("R2: a 401 without a Basic challenge is still login mode; 403 stays login; a non-Basic challenge is login", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await probeSettingsApi(viaBackend("X-Gateway-Key"))).toBe("login");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 403, headers: { "WWW-Authenticate": "Basic" } }));
    expect(await probeSettingsApi(viaBackend("X-Gateway-Key"))).toBe("login");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401, headers: { "WWW-Authenticate": "Bearer" } }));
    expect(await probeSettingsApi(viaBackend("X-Gateway-Key"))).toBe("login");
  });
  it("R2: a Workspace connection sends no credential, so a Basic challenge never means key refused", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401, headers: { "WWW-Authenticate": "Basic" } }));
    expect(await probeSettingsApi(workspace)).toBe("login");
  });
  it("R2: an openbq-docker style Basic key answered 200 is key mode: one GET, no token, no /pro/login", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    expect(await probeSettingsApi(viaBackend("Authorization"))).toBe("key");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(call(0)[0]).toBe("https://gateway.workspace.example/pro/user");
    expect(headersOf(0)).toEqual({ Authorization: "Basic c3ludGhldGlj" });
  });
  it("a backend whose own credential is Authorization can be key mode but never login mode", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply({ pro_display_settings: {} }));
    expect(await probeSettingsApi(viaBackend("Authorization"))).toBe("key");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await probeSettingsApi(viaBackend("Authorization"))).toBe("authorization-header");
  });
});
