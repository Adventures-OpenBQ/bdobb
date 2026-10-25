// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { fetch } from "@tauri-apps/plugin-http";
import { applyAuthQuery, authHeaders, readCapped } from "./dataClient";
import { IMPORT_MAX_BYTES } from "./importLimits";
import { isRecord } from "./isRecord";
import { planSettingsImport } from "./settingsBundle";
import { systemTheme } from "./theme";
import type { BackendConfig, Settings } from "./types";

/**
 * Anything settings can be stored on. A Workspace connection (workspace.json)
 * has no `backend`; a data backend that serves the Workspace settings API
 * carries its BackendConfig, whose own credential then rides on every request
 * exactly as it rides on that backend's data requests.
 */
export type SettingsConnection = { id: string; name: string; baseUrl: string; backend?: BackendConfig };
export type WorkspaceCredentials = { connection: SettingsConnection; username: string; password: string };
/**
 * A connected server, in memory only (workspaceStore). Login mode holds a
 * /pro/login session; key mode holds nothing but the connection, whose own
 * key/value credential authorises the settings calls (spec: Key mode
 * contract). `displaySettings` is the server's pro_display_settings -- from
 * the login response (bug #9: a self-hosted server refuses the opaque token
 * on GET /pro/user) or from key mode's GET /pro/user -- then replaced by what
 * each successful upload posted.
 */
export type WorkspaceSession =
  | { mode: "login"; connection: SettingsConnection; username: string; userId: string; token: string; displaySettings: unknown }
  | { mode: "key"; connection: SettingsConnection; displaySettings: unknown };
/**
 * Every request's answer. Requests never throw: the callers are a store and
 * fire-and-forget uploads, and a rejection there would surface nowhere.
 * `expired` marks a 401 on a login-mode request, the one failure that ends
 * the session rather than just this attempt.
 */
export type WorkspaceResult<T> = { ok: true; value: T } | { ok: false; message: string; expired: boolean };
export type WorkspaceDownload = { patch: Partial<Settings>; notes: string[]; review: string[] };
/**
 * The probe's mode. "needs-https" is decided without a request;
 * "authorization-header" is a login-mode server whose backend credential
 * already occupies the header the session token needs. "key-refused" is a
 * server that challenged (401 + WWW-Authenticate: Basic) a credential the
 * connection did send: a key-mode server that rejected the key.
 */
export type SettingsApi = "key" | "login" | "no" | "needs-https" | "authorization-header" | "key-refused";
/** A key-mode 401: the user fixes the key in Connections (spec §7). */
export const KEY_REFUSED = "key refused";
class WorkspaceError extends Error {
  expired: boolean;
  constructor(message: string, expired = false) {
    super(message);
    this.expired = expired;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NATIVE_KEYS = new Set(["theme", "fontSize", "defaultTicker", "matchDashboardSymbol", "maxDecimalPlaces", "minimizeButton", "collapseWidgetControls", "cornerDragHandles", "quickAddToolbar", "railWidth", "autoRefreshMinutes", "widgetGap", "numberShortcutTarget"]);

function serverAddress(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new WorkspaceError("Enter a Workspace server address."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new WorkspaceError("Use an HTTPS Workspace address without credentials, query parameters or a fragment. HTTP is allowed on loopback for development.");
  }
  return url.toString().replace(/\/+$/, "");
}
async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(await readCapped(response, IMPORT_MAX_BYTES, () => new WorkspaceError("Workspace response exceeds the import size limit.")));
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new WorkspaceError("Workspace returned invalid JSON."); }
  if (!isRecord(parsed)) throw new WorkspaceError("Workspace returned an invalid account response.");
  return parsed;
}
function preferencePatch(display: unknown, current: Settings): WorkspaceDownload {
  if (!isRecord(display)) throw new WorkspaceError("Workspace did not return display settings.");
  const settings: Record<string, unknown> = {};
  const notes: string[] = [];
  if (display.theme === "light" || display.theme === "dark") settings.theme = display.theme;
  else if (display.theme != null) throw new WorkspaceError("Workspace returned an invalid theme.");
  if (display.fontSize === "medium" || display.fontSize === "large") settings.fontSize = display.fontSize;
  else if (display.fontSize === "small") notes.push("Small font size is unavailable in v3; the local font size is unchanged.");
  else if (display.fontSize !== undefined) throw new WorkspaceError("Workspace returned an invalid font size.");
  if (display.decimalDigits !== undefined) {
    if (typeof display.decimalDigits !== "number" || !Number.isInteger(display.decimalDigits)) throw new WorkspaceError("Workspace returned an invalid decimal setting.");
    if (display.decimalDigits >= 0 && display.decimalDigits <= 5) settings.maxDecimalPlaces = display.decimalDigits;
    else notes.push("The decimal setting is outside v3's range; the local value is unchanged.");
  }
  if (Object.hasOwn(display, "defaultTicker")) {
    if (display.defaultTicker === null) settings.defaultTicker = null;
    else if (isRecord(display.defaultTicker) && typeof display.defaultTicker.symbol === "string") settings.defaultTicker = display.defaultTicker.symbol;
    else throw new WorkspaceError("Workspace returned an invalid default ticker.");
  }
  if (display.showWidgetControls !== undefined) {
    if (typeof display.showWidgetControls !== "boolean") throw new WorkspaceError("Workspace returned invalid widget controls.");
    settings.collapseWidgetControls = !display.showWidgetControls;
  }
  if (display.gridCorners !== undefined) {
    if (!Array.isArray(display.gridCorners) || display.gridCorners.some((x) => !["ne", "nw", "se", "sw"].includes(x))) throw new WorkspaceError("Workspace returned invalid grid corners.");
    settings.cornerDragHandles = display.gridCorners.length > 0;
  }
  if (display.extensions !== undefined) {
    if (!isRecord(display.extensions)) throw new WorkspaceError("Workspace returned invalid settings extensions.");
    if (Object.hasOwn(display.extensions, "bdobb")) {
      const native = display.extensions.bdobb;
      if (!isRecord(native) || native.schemaVersion !== 1 || native.profile !== "v3" || !isRecord(native.settings) || Object.keys(native).some((k) => !["schemaVersion", "profile", "settings"].includes(k))) throw new WorkspaceError("Unsupported BDOBB settings extension.");
      // A later BDOBB line syncs keys this one does not know (widgetGap): use
      // the rest and say what was left, rather than refuse the whole sync.
      const unknown = Object.keys(native.settings).filter((k) => !NATIVE_KEYS.has(k));
      if (unknown.length > 0) notes.push(`Settings from a later BDOBB version are not used here: ${unknown.join(", ")}.`);
      for (const [k, v] of Object.entries(native.settings)) if (NATIVE_KEYS.has(k)) settings[k] = v;
    }
  }
  const text = JSON.stringify({ kind: "bdobb-settings", version: 1, settings });
  const plan = planSettingsImport(text, new TextEncoder().encode(text).length, current);
  if (!plan.ok) throw new WorkspaceError(plan.refusal);
  return { patch: plan.patch, notes, review: plan.review };
}

/**
 * The abort/timeout/refusal wrapper every request shares, lifted unchanged
 * out of v3.0.0's loadWorkspaceSettings: a 30 s ceiling, the caller's signal
 * honoured, and only WorkspaceError's own messages reach the caller -- never
 * server text, never a credential.
 */
async function guarded<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<WorkspaceResult<T>> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
  try {
    if (controller.signal.aborted) throw new WorkspaceError("Request cancelled.");
    const value = await run(controller.signal);
    if (controller.signal.aborted) throw new WorkspaceError("Request cancelled.");
    return { ok: true, value };
  } catch (err) {
    const message = timedOut ? "The server timed out; local settings are unchanged."
      : signal?.aborted ? "Request cancelled."
      : err instanceof WorkspaceError ? err.message : "Could not contact the server; local settings are unchanged.";
    return { ok: false, message, expired: err instanceof WorkspaceError && err.expired };
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
}

/** Whether the connection sends a credential of its own (a Workspace connection sends none). */
const sendsCredential = (b: BackendConfig | undefined) => !!b?.headerName?.trim() && !!b.headerValue?.trim();
/** A 401 whose WWW-Authenticate scheme is Basic (case-insensitive): the answer to a rejected HTTP Basic key. */
const basicChallenge = (r: Response) => /^\s*basic(\s|$)/i.test(r.headers.get("WWW-Authenticate") ?? "");

/** A backend whose own credential is an Authorization header: a session token has nowhere left to go. */
const usesAuthorizationHeader = (b: BackendConfig | undefined) =>
  b !== undefined && (b.authLocation ?? "header") === "header" && b.headerName?.trim().toLowerCase() === "authorization";

/**
 * `path` on a connection, with a backend's query-placed credential applied
 * last, as its data requests apply it. serverAddress throws on an address the
 * rule refuses, so no credential is ever sent to one.
 */
function endpoint(connection: SettingsConnection, path: string): string {
  const url = new URL(`${serverAddress(connection.baseUrl)}${path}`);
  return (connection.backend ? applyAuthQuery(url, connection.backend) : url).toString();
}

/**
 * A backend's own credential (header, query -- see endpoint -- or cookie, per
 * authLocation), plus, in login mode, the session token as
 * `Authorization: Bearer`. Only there: X-OpenBB-Authorization sends the
 * server down its JWT path, which the opaque login token fails (bug #9). A
 * backend whose own credential IS the Authorization header cannot carry a
 * token, so it cannot use login mode; key mode sends no token and is fine.
 */
function requestHeaders(connection: SettingsConnection, token?: string): Record<string, string> {
  const own = connection.backend ? authHeaders(connection.backend) : {};
  if (token === undefined) return own;
  if (usesAuthorizationHeader(connection.backend)) {
    throw new WorkspaceError("This backend's credential uses the Authorization header, so it cannot sign in to hold settings.");
  }
  return { ...own, Authorization: `Bearer ${token}` };
}

/** The address rule, for a form that must refuse before writing anything. */
export function workspaceAddress(raw: string): WorkspaceResult<string> {
  try { return { ok: true, value: serverAddress(raw) }; }
  catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err), expired: false }; }
}

/**
 * Login mode: POST /pro/login, and nothing else (bug #9) -- the response
 * carries the account's display settings. The token comes back for the
 * in-memory session; the password goes nowhere else.
 */
export function workspaceSignIn(input: WorkspaceCredentials, signal?: AbortSignal): Promise<WorkspaceResult<WorkspaceSession>> {
  const username = input.username.trim();
  if (username === "" || input.password === "") return Promise.resolve({ ok: false, message: "Provide both a username and password.", expired: false });
  return guarded(signal, async (s) => {
    const loginResponse = await fetch(endpoint(input.connection, "/pro/login"), {
      method: "POST", headers: { ...requestHeaders(input.connection), "Content-Type": "application/json" },
      body: JSON.stringify({ email: username, password: input.password, remember: false, source: "pro" }),
      credentials: "omit", redirect: "error", maxRedirections: 0, signal: s,
    });
    if (loginResponse.status === 202) throw new WorkspaceError("This account requires additional verification. Complete it in OpenBB Workspace before signing in here.");
    if (loginResponse.status !== 200) throw new WorkspaceError("Sign-in failed. Check the account details and server address.");
    const login = await responseJson(loginResponse);
    if (login.force_2fa === true || login.temporary_password === true) throw new WorkspaceError("Complete account verification or password setup in OpenBB Workspace first.");
    if (typeof login.uuid !== "string" || !UUID.test(login.uuid) || typeof login.access_token !== "string" || login.access_token === "") throw new WorkspaceError("The server returned an invalid sign-in response.");
    const displaySettings = isRecord(login.user) ? login.user.pro_display_settings : undefined;
    return { mode: "login", connection: input.connection, username, userId: login.uuid, token: login.access_token, displaySettings };
  });
}

/**
 * Key mode: GET /pro/user authorised by the connection's own key/value
 * credential alone -- no /pro/login, no token. A 401/403 is "key refused";
 * nothing here can expire.
 */
export function connectByKey(connection: SettingsConnection, signal?: AbortSignal): Promise<WorkspaceResult<WorkspaceSession>> {
  return guarded(signal, async (s) => {
    const response = await fetch(endpoint(connection, "/pro/user"), {
      headers: requestHeaders(connection), credentials: "omit", redirect: "error", maxRedirections: 0, signal: s,
    });
    if (response.status === 401 || response.status === 403) throw new WorkspaceError(KEY_REFUSED);
    if (response.status !== 200) throw new WorkspaceError("Settings could not be read from the server; local settings are unchanged.");
    const body = await responseJson(response);
    if (!isRecord(body.pro_display_settings)) throw new WorkspaceError("The server returned no display settings.");
    return { mode: "key", connection, displaySettings: body.pro_display_settings };
  });
}

/** The sign-in sync's download, from the session alone: today's mapping and refusals, plus the review of what differs. */
export function readSessionSettings(session: WorkspaceSession, current: Settings): WorkspaceResult<WorkspaceDownload> {
  try {
    return { ok: true, value: preferencePatch(session.displaySettings, current) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), expired: false };
  }
}

/**
 * The upload's merge. POST /pro/display-settings REPLACES the whole object,
 * so this starts from what the server holds and overwrites only what BDOBB
 * owns; every other key, other extensions included, goes back untouched.
 * defaultTicker is deliberately not written as a shared key: the server's
 * is a full instrument object (id, symbol, exchange, ...) that a bare symbol
 * cannot rebuild, and an invalid one is silently reset server-side -- so
 * the ticker travels only inside extensions.bdobb. Absent optionals go as
 * null, as the export bundle writes them, so a cleared value clears on the
 * other side instead of being left behind.
 */
export function mergeUpload(display: Record<string, unknown>, settings: Settings): Record<string, unknown> {
  const corners = Array.isArray(display.gridCorners) && display.gridCorners.length > 0 ? display.gridCorners : ["se"];
  const extensions = isRecord(display.extensions) ? display.extensions : {};
  return {
    ...display,
    // Workspace's theme is light or dark; "system" sends the OS appearance at
    // upload time, and extensions.bdobb still carries "system" back to BDOBB.
    theme: settings.theme === "system" ? systemTheme() : settings.theme,
    fontSize: settings.fontSize,
    decimalDigits: settings.maxDecimalPlaces,
    showWidgetControls: !settings.collapseWidgetControls,
    gridCorners: settings.cornerDragHandles ? corners : [],
    extensions: {
      ...extensions,
      bdobb: {
        schemaVersion: 1,
        profile: "v3",
        settings: Object.fromEntries([...NATIVE_KEYS].map((k) => [k, settings[k as keyof Settings] ?? null])),
      },
    },
  };
}

/**
 * Merge onto what the session last knew the server held and POST it; no
 * GET /pro/user first (bug #9). Login mode adds the Bearer token, and its 401
 * expires the session; key mode sends only the connection's own credential,
 * and its 401 is "key refused" (spec §7). Resolves with what was posted,
 * which the caller keeps as the session's new displaySettings. The server
 * keeps no version, so another writer between two uploads is lost -- an
 * accepted limit (spec, Server contract).
 */
export function uploadWorkspaceSettings(session: WorkspaceSession, settings: Settings, signal?: AbortSignal): Promise<WorkspaceResult<Record<string, unknown>>> {
  // POST replaces the whole object; merging onto {} when the server's settings
  // are unknown (sign-in can succeed without them) would wipe them. Refuse.
  if (!isRecord(session.displaySettings)) return Promise.resolve({ ok: false, message: "The server's current settings are unknown, so nothing was uploaded.", expired: false });
  const display = session.displaySettings;
  return guarded(signal, async (s) => {
    const merged = mergeUpload(display, settings);
    const response = await syncRequest(session, "POST", "/pro/display-settings", s, merged);
    if (!response.ok) throw new WorkspaceError(`The server refused the settings upload (HTTP ${response.status}).`);
    return merged;
  });
}

/**
 * Which mode, if any, this connection offers (spec: Probe and mode).
 * GET /pro/user with the connection's own key/value credential (none for a
 * Workspace connection) and no session token, 5 s at most: 200 carrying a
 * pro_display_settings object is key mode, 401/403 is login mode, anything
 * else -- another status, a body without settings, an error, silence -- is
 * no API. A connection whose address would not be allowed a credential is
 * never probed; a login-mode backend whose own credential is the
 * Authorization header is reported as such, since login cannot work there.
 */
export async function probeSettingsApi(connection: SettingsConnection): Promise<SettingsApi> {
  if (!workspaceAddress(connection.baseUrl).ok) return "needs-https";
  try {
    const response = await fetch(endpoint(connection, "/pro/user"), {
      headers: requestHeaders(connection), credentials: "omit", redirect: "error", maxRedirections: 0,
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      // A rejected HTTP Basic key is a key-mode server saying no, not a login-mode server (ruling R2).
      if (response.status === 401 && sendsCredential(connection.backend) && basicChallenge(response)) return "key-refused";
      return usesAuthorizationHeader(connection.backend) ? "authorization-header" : "login";
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      return "no";
    }
    const body = await responseJson(response);
    return isRecord(body.pro_display_settings) ? "key" : "no";
  } catch {
    return "no";
  }
}

/** One stored dashboard or app: its content and the server's updated date, the only clock sync compares. */
export type ServerRecord = { content: unknown; updated: string };
/** What the dashboard sync downloads. Keys are canonical uuids. */
export type ServerStore = { owned: Record<string, ServerRecord>; shared: Record<string, ServerRecord>; apps: Record<string, ServerRecord> };

/** A server map key in one spelling, lowercase and dashed: Workspace keys come as hex or dashed uuids. */
export function canonicalUuid(raw: string): string {
  const hex = raw.toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hex)) return raw.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One dashboard-sync request, with the session's credential as the settings
 * upload sends it: login mode's 401 expires the session; key mode's 401/403
 * is a refused key.
 */
async function syncRequest(session: WorkspaceSession, method: string, path: string, signal: AbortSignal, body?: unknown): Promise<Response> {
  const token = session.mode === "login" ? session.token : undefined;
  const response = await fetch(endpoint(session.connection, path), {
    method,
    headers: { ...requestHeaders(session.connection, token), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "omit", redirect: "error", maxRedirections: 0, signal,
  });
  if (session.mode === "key" && (response.status === 401 || response.status === 403)) throw new WorkspaceError(KEY_REFUSED);
  if (response.status === 401) throw new WorkspaceError("The session expired. Sign in again.", true);
  return response;
}

/** GET a sync route: its JSON, or null on 404 (no such store on this server). */
async function getSync(session: WorkspaceSession, path: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  const response = await syncRequest(session, "GET", path, signal);
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new WorkspaceError(`The server refused the dashboard list (HTTP ${response.status}).`);
  }
  return responseJson(response);
}

/** A server's `{uuid: record}` map, keyed canonically. A dashboard record dates itself `updated_date`; an app record `updatedDate`. */
function records(map: unknown): Record<string, ServerRecord> {
  if (!isRecord(map)) throw new WorkspaceError("The server returned an invalid dashboard list.");
  const out: Record<string, ServerRecord> = {};
  for (const [key, value] of Object.entries(map)) {
    const updated = isRecord(value) ? (value.updated_date ?? value.updatedDate) : undefined;
    if (!isRecord(value) || typeof updated !== "string") throw new WorkspaceError("The server returned an invalid dashboard list.");
    out[canonicalUuid(key)] = { content: value.content, updated };
  }
  return out;
}

/**
 * The sign-in sync's download: owned dashboards, shared dashboards and owned
 * apps (spec: Sync rules, step 2). `null` when owned answers 404 -- the
 * server keeps no dashboards, and sync stays settings-only. Shared or apps
 * answering 404 count as empty.
 */
export function fetchServerStore(session: WorkspaceSession, signal?: AbortSignal): Promise<WorkspaceResult<ServerStore | null>> {
  return guarded(signal, async (s) => {
    const [owned, shared, apps] = await Promise.all(
      ["/pro/dash/sync/owned", "/pro/dash/sync/shared", "/pro/user-apps/sync"].map((path) => getSync(session, path, s)),
    );
    if (owned === null) return null;
    return {
      owned: records(owned.owned),
      shared: { ...records(shared?.shared ?? {}), ...records(shared?.entity_shared ?? {}) },
      apps: records(apps?.owned ?? {}),
    };
  });
}

/** GET owned dashboards alone (the root folder, a new updated date); null on 404. */
export function fetchOwnedDashboards(session: WorkspaceSession, signal?: AbortSignal): Promise<WorkspaceResult<Record<string, ServerRecord> | null>> {
  return guarded(signal, async (s) => {
    const owned = await getSync(session, "/pro/dash/sync/owned", s);
    return owned === null ? null : records(owned.owned);
  });
}

/** GET owned apps alone (a new updated date); null on 404. */
export function fetchOwnedApps(session: WorkspaceSession, signal?: AbortSignal): Promise<WorkspaceResult<Record<string, ServerRecord> | null>> {
  return guarded(signal, async (s) => {
    const apps = await getSync(session, "/pro/user-apps/sync", s);
    return apps === null ? null : records(apps.owned);
  });
}

/** A write's answer: "absent" is a 404, a server with no such store. */
async function written(response: Response, what: string): Promise<"ok" | "absent"> {
  void response.body?.cancel().catch(() => {});
  if (response.status === 404) return "absent";
  if (!response.ok) throw new WorkspaceError(`The server refused the ${what} (HTTP ${response.status}).`);
  return "ok";
}

/** POST /pro/dash/sync: each item upserted, or deleted by "DELETE" -- per item, never a whole-tree replace. */
export function postDashboardItems(session: WorkspaceSession, items: Record<string, unknown>, signal?: AbortSignal): Promise<WorkspaceResult<"ok" | "absent">> {
  return guarded(signal, async (s) => written(await syncRequest(session, "POST", "/pro/dash/sync", s, { items }), "dashboard upload"));
}

/** POST /pro/user-apps/{uuid}: upsert one app; the body is its content. */
export function putApp(session: WorkspaceSession, uuid: string, content: unknown, signal?: AbortSignal): Promise<WorkspaceResult<"ok" | "absent">> {
  return guarded(signal, async (s) => written(await syncRequest(session, "POST", `/pro/user-apps/${encodeURIComponent(uuid)}`, s, content), "app upload"));
}

/** DELETE /pro/user-apps/{uuid}. "absent" (404) means it is already gone. */
export function deleteApp(session: WorkspaceSession, uuid: string, signal?: AbortSignal): Promise<WorkspaceResult<"ok" | "absent">> {
  return guarded(signal, async (s) => written(await syncRequest(session, "DELETE", `/pro/user-apps/${encodeURIComponent(uuid)}`, s), "app delete"));
}

/**
 * v8 locked widgets (ruling R6): the docks dashboard's own server record, on
 * the system route `/pro/dash/sync/system/docks` (openbq-docker v8,
 * docs/v8/news-relay-and-hidden-dashboards.md §3). Never part of the owned
 * dashboards and never POSTed through /pro/dash/sync: the server keeps one
 * per account, flags it `hidden: true` so Workspace's own app does not list
 * it, and the newest `revision` wins -- a PUT or DELETE with an older one
 * answers 409 carrying the stored record, which the caller takes. The same
 * in key mode (the connection's own Basic credential) and login mode (the
 * session's Bearer token), through syncRequest. `revision` is the client's
 * last docks edit time in epoch ms (R6a).
 */
export type ServerDocks = { revision: number; content: unknown };
/** A docks write's answer: done, refused as older (with the winner), or a server without the route (404). */
export type DocksWrite = { kind: "ok"; record?: ServerDocks } | { kind: "conflict"; record: ServerDocks } | { kind: "unsupported" };
const DOCKS_PATH = "/pro/dash/sync/system/docks";

/** A stored docks record, or a refusal: the reserved id, an integer revision >= 0. */
function docksRecord(value: unknown): ServerDocks {
  if (!isRecord(value) || value.id !== "docks" || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new WorkspaceError("The server returned an invalid locked-widgets record.");
  }
  return { revision: value.revision as number, content: value.content };
}

/** GET the account's docks: the record, null when none is stored, or "unsupported" on a 404 (no such route). */
export function fetchServerDocks(session: WorkspaceSession, signal?: AbortSignal): Promise<WorkspaceResult<ServerDocks | null | "unsupported">> {
  return guarded(signal, async (s) => {
    const body = await getSync(session, DOCKS_PATH, s);
    if (body === null) return "unsupported";
    if (!Object.hasOwn(body, "dashboard")) throw new WorkspaceError("The server returned an invalid locked-widgets record.");
    return body.dashboard === null ? null : docksRecord(body.dashboard);
  });
}

/** A PUT's answer: 200, 409 with the stored record, or 404. */
async function docksWritten(response: Response, what: string): Promise<DocksWrite> {
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {});
    return { kind: "unsupported" };
  }
  if (response.status === 409) return { kind: "conflict", record: docksRecord((await responseJson(response)).dashboard) };
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new WorkspaceError(`The server refused the ${what} (HTTP ${response.status}).`);
  }
  const body = await responseJson(response);
  return { kind: "ok", ...(isRecord(body.dashboard) ? { record: docksRecord(body.dashboard) } : {}) };
}

/** PUT the docks: exactly `{revision, content}`. */
export function putServerDocks(session: WorkspaceSession, revision: number, content: unknown, signal?: AbortSignal): Promise<WorkspaceResult<DocksWrite>> {
  return guarded(signal, async (s) => docksWritten(await syncRequest(session, "PUT", DOCKS_PATH, s, { revision, content }), "locked-widgets upload"));
}
