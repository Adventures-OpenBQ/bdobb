// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fetch } from "@tauri-apps/plugin-http";
import type { BackendConfig, ParamOption, WidgetDef, WidgetForm } from "./types";
import { sendParams, type WireContext } from "./params";
import { toOptions } from "./widgetsJson";
import { resolvedTheme } from "./theme";
import { loadWidgetCalendars } from "./calendars/bundles";
import type { BundleWindow } from "./calendars/window";

/** theme goes on chart and html requests only, using the live RESOLVED theme
 * (so "system" is sent as dark or light, never as "system"). Never iframe,
 * never table.
 *
 * Exported because it is also the answer to "does this card have to be
 * refetched when the theme flips": these are exactly the requests whose
 * ANSWER depends on it (see src/hooks/useWidgetData.ts). One set, so the URL
 * and the refetch rule cannot drift apart. */
export const THEMED_TYPES = new Set(["chart", "html"]);

/**
 * A host that silently drops packets (no RST, no timely response) would
 * otherwise hang the request indefinitely, leaving the Save dialog or the
 * widget card stuck with no spinner, no error, and no way out but a restart.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * apps.json's own END-TO-END deadline, which CONNECT_TIMEOUT_MS is not: that
 * one covers the connect phase only (and the browser shim cannot honour it at
 * all), so a host that accepts the connection and then never sends a byte is
 * exactly the case it does not cover. apps.json is the one document where
 * that matters, because discovery fetches it for every backend inside a
 * Promise.all -- one stalled optional document would otherwise hold the whole
 * widget registry empty, with no spinner and no way out but a restart.
 *
 * Ten seconds, the same order as the connect timeout beside it: long enough
 * that a slow-but-working backend is never cut off, short enough that a dead
 * one is out of the way before a user goes looking for the widgets.
 */
export const APPS_TIMEOUT_MS = 10_000;

function joinUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

/** `endpoint` under the backend, with each non-empty param, then the query-placed credential (applyAuthQuery LAST). */
function endpointUrl(backend: BackendConfig, endpoint: string, params: Record<string, string> = {}): string {
  const url = new URL(joinUrl(backend.baseUrl, endpoint));
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") url.searchParams.set(key, value);
  }
  return applyAuthQuery(url, backend).toString();
}

export function buildWidgetUrl(
  backend: BackendConfig,
  widget: WidgetDef,
  params: Record<string, string>,
  ctx?: WireContext,
): string {
  // Resolved here, not at seed time, so a card that is never edited keeps
  // meaning "today" (or "this quarter"). The card itself persists the
  // expression; wireParams also splits a date_range into its two keys.
  return endpointUrl(backend, widget.endpoint, {
    ...sendParams(widget, params, ctx),
    ...(THEMED_TYPES.has(widget.type) ? { theme: resolvedTheme() } : {}),
  });
}

/**
 * The ws:// URL for a live_grid's updates. Mirrors buildWidgetUrl: it joins the
 * backend base and the widget's wsEndpoint, swaps the scheme to ws/wss, and
 * carries the credential the same way a GET does (applyAuthQuery, so a
 * query-placed key rides the socket URL). The symbol selection is NOT put here
 * -- it goes in the subscription message the renderer sends after connecting.
 */
export function buildWidgetWsUrl(backend: BackendConfig, widget: WidgetDef): string | null {
  if (!widget.wsEndpoint) return null;
  const url = new URL(joinUrl(backend.baseUrl, widget.wsEndpoint));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return applyAuthQuery(url, backend).toString();
}

/**
 * Header is the original behavior and stays the default. Query and cookie
 * exist because a backend may not accept a custom header. Query placement
 * returns no header here — see applyAuthQuery, which carries it on the URL
 * instead, applied last so a widget param can't shadow it.
 */
export function authHeaders(backend: BackendConfig): Record<string, string> {
  if (!backend.headerName || !backend.headerValue) return {};
  switch (backend.authLocation) {
    case "query":
      return {};
    case "cookie":
      // `+`, `/` and `=` are legal cookie-octets under RFC 6265, and this
      // app's documented credential shape (HTTP Basic, "Basic <base64>")
      // relies on exactly those characters. There is no percent-decoding
      // contract on the receiving end (FastAPI/Starlette's cookie parser
      // unquotes RFC 2109 quoted-strings but does not percent-decode), so
      // encoding here would silently corrupt a working credential. Send it
      // verbatim.
      return { Cookie: `${backend.headerName}=${backend.headerValue}` };
    default:
      return { [backend.headerName]: backend.headerValue };
  }
}

/** Applied LAST, after every widget param, so a param named like the
 * credential cannot overwrite it. */
export function applyAuthQuery(url: URL, backend: BackendConfig): URL {
  if (backend.authLocation !== "query") return url;
  if (!backend.headerName || !backend.headerValue) return url;
  url.searchParams.set(backend.headerName, backend.headerValue);
  return url;
}

/** Authenticated, streaming fetch for managed tables. The caller owns JSON byte/deadline limits.
 * Credentials use the same connection placement as widget discovery. A gateway may translate
 * those credentials to its private service assertion; the client never invents a principal.
 */
export function createManagedTableRequest(backend: BackendConfig): typeof globalThis.fetch {
  const connection = { ...backend };
  const base = new URL(joinUrl(connection.baseUrl, ""));
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error("Invalid managed table request destination");
    }
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(authHeaders(connection))) headers.set(name, value);
    return fetch(applyAuthQuery(url, connection).toString(), { ...init, headers, connectTimeout: CONNECT_TIMEOUT_MS });
  };
}

/** Walks a dotted dataKey; an unresolvable key yields the whole payload. */
export function extractData(payload: unknown, dataKey?: string): unknown {
  if (!dataKey) return payload;

  let current: unknown = payload;
  for (const segment of dataKey.split(".")) {
    if (typeof current !== "object" || current === null) return payload;
    const next = (current as Record<string, unknown>)[segment];
    if (next === undefined) return payload;
    current = next;
  }
  return current;
}

const MAX_ERROR_CHARS = 200;

function isLeadingLocSegment(segment: unknown): boolean {
  return segment === "query" || segment === "body";
}

/**
 * The OpenBB API server (`openbb-api`, FastAPI; the openbq-api service in
 * openbq-docker) answers every failure with `{"detail": ...}` — a
 * string for OpenBBError/unexpected errors, an array of `{loc, msg}` for 422
 * validation. Render it after the status so the card names the problem
 * instead of just the number; cap it so a stack trace cannot flood the card.
 */
export function describeHttpError(status: number, body: string): string {
  const base = `HTTP ${status}`;
  let detail: unknown;
  try {
    detail = (JSON.parse(body) as { detail?: unknown } | null)?.detail;
  } catch {
    return base;
  }

  let text: string | undefined;
  if (typeof detail === "string") {
    text = detail;
  } else if (Array.isArray(detail)) {
    const parts = detail.flatMap((item) => {
      // The API server also answers with a bare list of strings (e.g. its JSON
      // serialiser rejecting a NaN), not only pydantic's { loc, msg } items.
      if (typeof item === "string") return [item];
      if (typeof item !== "object" || item === null) return [];
      const { loc, msg } = item as { loc?: unknown; msg?: unknown };
      if (typeof msg !== "string") return [];
      const segments = Array.isArray(loc) ? loc : [];
      const path = (isLeadingLocSegment(segments[0]) ? segments.slice(1) : segments)
        .map(String)
        .join(".");
      return [path ? `${path} — ${msg}` : msg];
    });
    if (parts.length > 0) text = parts.join("; ");
  }
  if (!text) return base;

  const full = `${base}: ${text}`;
  return full.length > MAX_ERROR_CHARS ? `${full.slice(0, MAX_ERROR_CHARS - 1)}…` : full;
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    // A credential can sit ahead of the host as well as in the query: a
    // baseUrl may carry user:pass@, and it reaches the same error text.
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * A network-layer failure (connection refused, timeout, DNS) never reaches
 * describeHttpError below — it has no HTTP status, so it never gets its own
 * safe message. At runtime, tauri-plugin-http wraps reqwest transparently,
 * and reqwest's Display appends " for url (...)" to its error — with the
 * query-placement credential still in that URL. Strip the query from any
 * URL embedded in the underlying error's message, and independently name
 * the (query-stripped) request URL even when the underlying message says
 * nothing about it at all (as is the case with the plain `fetch failed`
 * this project's tests observe over real HTTP) — so every consumer
 * (discovery, the widget hook, the Test button) gets a message that is both
 * safe to log/display and still names the host and path that failed.
 */
function safeNetworkErrorMessage(url: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const safeUrl = stripQuery(url);
  // Case-insensitive: URL normalization lowercases the scheme before it
  // ever reaches here, but nothing guarantees the underlying error's own
  // message went through that normalization too.
  const redacted = raw.replace(/https?:\/\/\S+/gi, (match) => {
    // Trailing punctuation (reqwest wraps the URL as " for url (...)") is
    // not part of the URL; strip it off before parsing so it survives
    // untouched rather than being discarded along with the query.
    const trailing = match.match(/[),.]+$/)?.[0] ?? "";
    const core = trailing ? match.slice(0, -trailing.length) : match;
    return stripQuery(core) + trailing;
  });
  return redacted.includes(safeUrl) ? redacted : `${redacted} (${safeUrl})`;
}

/**
 * What request() throws for a non-2xx answer. Its message is exactly the
 * describeHttpError text every caller has always shown and logged; `status`
 * and `body` exist for the one caller that must read the answer itself -- a
 * settings form's 422, whose `errors` map is shown field by field (see
 * putSettings).
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
  }
}

/**
 * The one HTTP path every consumer goes through, so that the discipline
 * below — the connect timeout, the network-error redaction, the 204 and
 * {detail} error handling — cannot drift between the verbs.
 *
 * A body is JSON-encoded and sent as the request payload — never appended to
 * `url` — so a secret in it (e.g. a submitted API key) cannot land in an
 * access log or in safeNetworkErrorMessage's redaction, which only ever
 * inspects the URL and the thrown error's own message, neither of which
 * carries the request body.
 *
 * The API server answers EmptyDataError with 204 and no body; res.json() would
 * throw on that, turning a correct "nothing matched" into an error card.
 *
 * `parse` is false for a caller contracted on the STATUS rather than on a
 * payload — a form submit, per widget-parameters/input-form, which documents
 * only that Workspace checks the response was OK. Such an endpoint is free to
 * answer 200 with an empty body, and res.json() would throw on it and turn a
 * submit that worked into an error line.
 *
 * `allow404` is for an OPTIONAL document, where "the backend does not serve
 * this" is an answer rather than a failure: it resolves null instead of
 * throwing. It is deliberately per-call and off by default — a 404 on
 * widgets.json still has to fail loudly, since that is what decides whether a
 * backend is online. Matching on the status, not on describeHttpError's
 * message, so the distinction cannot be broken by a wording change.
 *
 * `signal` is the caller's own deadline, which is a DIFFERENT guarantee from
 * connectTimeout above: that one only bounds getting the connection open,
 * while this one bounds the whole exchange and aborts the request rather than
 * leaving it running unwatched. Opt-in per call -- a widget's own fetch is
 * allowed to take as long as the backend needs.
 *
 * `onHeaders` sees the headers of the response whose body is about to be
 * parsed, and only that one: a caller may want something the payload does
 * not carry (its declared size), and handing over headers rather than the
 * Response keeps the body this function's to consume.
 */
async function request(
  method: "GET" | "PUT" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: unknown,
  {
    parse = true,
    allow404 = false,
    onHeaders,
    signal,
  }: {
    parse?: boolean;
    allow404?: boolean;
    onHeaders?: (headers: Headers) => void;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const hasBody = method !== "GET";
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: hasBody ? { ...headers, "Content-Type": "application/json" } : headers,
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      connectTimeout: CONNECT_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    throw new Error(safeNetworkErrorMessage(url, err));
  }
  if (res.status === 204) return null;
  if (res.status === 404 && allow404) {
    // Read and discard: a body left unconsumed holds its connection out of
    // the pool until it is collected, and this 404 is the ORDINARY case for
    // an optional document — every discovery of a backend serving no
    // apps.json takes this path. Voided deliberately; the answer is "no
    // document", whatever the backend chose to say alongside it.
    void res.text().catch(() => {});
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(describeHttpError(res.status, text), res.status, text);
  }
  onHeaders?.(res.headers);
  if (!parse) {
    // Read to the end even though nothing is parsed: an unread body holds the
    // connection open, which is why the !res.ok branch above reads it too.
    await res.text().catch(() => "");
    return null;
  }
  // Content-type-aware: a widget endpoint may answer text/plain -- the youtube
  // widget returns a bare watch URL, not JSON. res.json() would throw on it, so
  // only an application/json response is parsed; anything else is read as text
  // and the renderer decides what it means. A malformed application/json body
  // still throws here, as before, so a broken data widget stays an error card.
  // A structured-syntax suffix (application/problem+json, a vendor
  // application/vnd.x+json) is JSON as well, and media types are
  // case-insensitive.
  const mediaType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json") ? res.json() : res.text();
}

/** `${widget.endpoint}/{envVar}`, with an optional trailing path segment. */
function keyActionUrl(
  backend: BackendConfig,
  widget: WidgetDef,
  envVar: string,
  suffix?: string,
): URL {
  let path = joinUrl(joinUrl(backend.baseUrl, widget.endpoint), encodeURIComponent(envVar));
  if (suffix) path = joinUrl(path, suffix);
  return applyAuthQuery(new URL(path), backend);
}

/** `GET {endpoint}/{envVar}/test` -> `{ result, detail }`. Re-tests one row. */
export async function testProviderKey(
  backend: BackendConfig,
  widget: WidgetDef,
  envVar: string,
): Promise<unknown> {
  const url = keyActionUrl(backend, widget, envVar, "test");
  return request("GET", url.toString(), authHeaders(backend));
}

/**
 * `PUT {endpoint}/{envVar}` with `{"value": …}` in the body — deliberately
 * never a query param, so the submitted credential cannot land in an access
 * log. Returns `{ status, restart_required }`.
 */
export async function putProviderKey(
  backend: BackendConfig,
  widget: WidgetDef,
  envVar: string,
  value: string,
): Promise<unknown> {
  const url = keyActionUrl(backend, widget, envVar);
  return request("PUT", url.toString(), authHeaders(backend), { value });
}

/**
 * `PUT {endpoint}` with `{ values }` -- the changed fields only -- for a
 * settings widget's form section (docs/settings-widgets.md). Same URL, auth
 * and request discipline as a data fetch, so a service's settings are exactly
 * as protected as its data.
 *
 * A 422 carrying an `errors` map is not a failure but an answer: it comes
 * back as `{ ok: false, errors }` so the form can put each message by its
 * field and keep what the user typed. A 422 without one (FastAPI's own
 * `{detail}` validation shape, say) and every other failure throw exactly as
 * every request in this file does, which the form shows as a section-level
 * error.
 */
export async function putSettings(
  backend: BackendConfig,
  widget: WidgetDef,
  values: Record<string, unknown>,
): Promise<{ ok: true; body: unknown } | { ok: false; errors: Record<string, string> }> {
  try {
    const body = await request("PUT", buildWidgetUrl(backend, widget, {}), authHeaders(backend), { values });
    return { ok: true, body };
  } catch (err) {
    if (err instanceof HttpError && err.status === 422) {
      const errors = fieldErrors(err.body);
      if (errors) return { ok: false, errors };
    }
    throw err;
  }
}

/** The string-valued entries of a 422 body's `errors` object, or null if it has none. */
function fieldErrors(body: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const errors = (parsed as { errors?: unknown } | null)?.errors;
  if (typeof errors !== "object" || errors === null || Array.isArray(errors)) return null;
  // Null-prototype so an "__proto__" id is an own key, not a setter call.
  const out: Record<string, string> = Object.create(null);
  for (const [id, message] of Object.entries(errors)) if (typeof message === "string") out[id] = message;
  return Object.keys(out).length > 0 ? out : null;
}

/** An OBBject's `warnings` ([{category, message}]) as text; [] when it carries none. */
export function obbjectWarnings(payload: unknown): string[] {
  const warnings = (payload as { warnings?: unknown } | null)?.warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.flatMap((w) => {
    const message = typeof w === "string" ? w : (w as { message?: unknown } | null)?.message;
    return typeof message === "string" && message !== "" ? [message] : [];
  });
}

export async function fetchWidgetData(
  backend: BackendConfig,
  widget: WidgetDef,
  params: Record<string, string>,
  ctx?: WireContext,
  onWarnings?: (warnings: string[]) => void,
): Promise<unknown> {
  // An opted-in card resolves on bundles only. A caller without the card hooks (the keys panel, a store) hands no
  // calendars, so they are loaded here through the same shared cache the hooks read: one resolver, one cache.
  if (widget.calendarBinding && ctx?.calendars === undefined) {
    const now = ctx?.now ?? new Date();
    const loaded = await loadWidgetCalendars(
      backend,
      widget,
      params,
      ctx?.exchange,
      now,
      (id, window) => fetchCalendarBundle(backend, id, window),
      new AbortController().signal,
    );
    ctx = { ...ctx, now, calendars: loaded.calendars };
  }
  const payload = await request("GET", buildWidgetUrl(backend, widget, params, ctx), authHeaders(backend));
  onWarnings?.(obbjectWarnings(payload));
  // A keys panel renders from the whole `{ tier, rows }` envelope — `tier`
  // decides whether edit controls show — so key-maint's own
  // `data.dataKey: "rows"` must not strip it.
  if (widget.type === "keys") return payload;
  return extractData(payload, widget.dataKey);
}

/**
 * POST an omni widget's prompt. Omni is the one data widget fetched by POST:
 * the prompt (and any visible params) go in the JSON body, exactly as the
 * reference documents. `request` is content-type-aware, so a text/plain answer
 * still comes back. Auth rides on buildWidgetUrl + authHeaders, as GET does.
 */
export async function fetchOmniData(
  backend: BackendConfig,
  widget: WidgetDef,
  body: Record<string, unknown>,
): Promise<unknown> {
  return request("POST", buildWidgetUrl(backend, widget, {}), authHeaders(backend), body);
}

/**
 * `POST <form.endpoint>?<the widget's query params>` with the form's field
 * values as the JSON body.
 *
 * The endpoint is the FORM's, not the widget's: a form declares where its
 * submit goes, and it is resolved against `backend.baseUrl` exactly as
 * buildWidgetUrl resolves a widget's. The card's own query params still ride
 * on the URL, so an endpoint that answers per `?symbol=` sees the card it was
 * submitted from; the field values go in the BODY, never the query string.
 *
 * The query params are wired through sendParams — the same function the GET
 * uses, which refuses a value that could not resolve — so a range or a
 * quarter on the card reaches the form's endpoint spelled exactly as it
 * reaches the widget's.
 *
 * Resolves on any 2xx and carries no payload back — the reference documents
 * only that Workspace checks the response was OK. A non-2xx throws
 * describeHttpError's message, which is what every other request in this file
 * reports and what the form renders inline.
 *
 * The widget is not a positional parameter (taking it would invite the
 * widget's endpoint to be used instead of the form's); it rides in `ctx`
 * instead, purely so wireParams knows its params' types. Nothing else here
 * depends on the widget, and the endpoint is still the FORM's.
 */
export async function postForm(
  backend: BackendConfig,
  form: WidgetForm,
  params: Record<string, string>,
  values: Record<string, unknown>,
  ctx: WireContext & { widget?: WidgetDef } = {},
): Promise<void> {
  // See the doc comment above: same wire as the GET, widget rides in `ctx`.
  const url = endpointUrl(backend, form.endpoint, sendParams(ctx.widget, params, ctx));
  await request("POST", url, authHeaders(backend), values, { parse: false });
}

/**
 * The end-to-end deadline on widgets.json. CONNECT_TIMEOUT_MS only bounds
 * reaching the host; discovery fetches this document for every backend
 * inside one Promise.all, so one host that accepts the connection and never
 * answers would hold every other backend's widgets out of the registry --
 * every card on every backend "unresolved".
 */
export const WIDGETS_TIMEOUT_MS = 10_000;

export async function fetchWidgetsJson(backend: BackendConfig): Promise<unknown> {
  return request("GET", endpointUrl(backend, "widgets.json"), authHeaders(backend), undefined, {
    signal: AbortSignal.timeout(WIDGETS_TIMEOUT_MS),
  });
}

/**
 * The size the response DECLARED, or undefined when it declared none a
 * number can be made of (no header, a chunked response, a junk value).
 *
 * Only ever a hint: it is the size on the wire, so a compressed body
 * declares its compressed length. The one consumer is an import ceiling
 * measured in megabytes, where that is a slightly generous reading rather
 * than a wrong one, and the alternative — re-serializing the parsed document
 * — is the cost this exists to avoid.
 */
function declaredSize(headers: Headers): number | undefined {
  const raw = headers.get("content-length");
  if (raw === null || raw.trim() === "") return undefined;
  const bytes = Number(raw);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
}

/**
 * apps.json as fetched: the parsed document, and the size the response said
 * it was. The size travels WITH the payload because it exists only on the
 * response — by the time the caller has the document, the only way back to a
 * number would be to serialize it again.
 */
export type AppsJsonResponse = { raw: unknown; bytes?: number };

/**
 * The same URL join and the same credential placement as fetchWidgetsJson —
 * authHeaders for header/cookie, applyAuthQuery LAST for query — so the two
 * documents of a backend are fetched identically. The credential is never
 * logged: the only message this can throw comes from describeHttpError or
 * safeNetworkErrorMessage, both of which are query-free.
 *
 * apps.json is OPTIONAL. Most backends serve none, and answering 404 is how
 * they say so, so a 404 resolves null — "no apps" — rather than throwing.
 * Every other failure still throws; discovery decides what to do with it.
 *
 * It also carries its own deadline (APPS_TIMEOUT_MS): a host that answers
 * nothing at all is a failure like any other, and one discovery has to be
 * told about rather than wait out.
 */
export async function fetchAppsJson(backend: BackendConfig): Promise<AppsJsonResponse> {
  let bytes: number | undefined;
  const raw = await request("GET", endpointUrl(backend, "apps.json"), authHeaders(backend), undefined, {
    allow404: true,
    // See APPS_TIMEOUT_MS: this is the one fetch whose stalling would empty
    // the registry, so it is the one fetch with a deadline of its own.
    signal: AbortSignal.timeout(APPS_TIMEOUT_MS),
    onHeaders: (headers) => {
      bytes = declaredSize(headers);
    },
  });
  return { raw, bytes };
}

/**
 * The service name discovery records for a backend whose root names one;
 * the OpenBB Platform API's is synthesised from its landing page, below.
 */
export const OPENBB_PLATFORM_SERVICE = "openbb-platform";

/** The service name the openbq-reference backend answers at its root. */
export const OPENBB_REFERENCE_SERVICE = "openbb-reference";

/**
 * `GET <baseUrl>/` -> the body's `service` name, or undefined. A backend's
 * root is not part of the OpenBB contract, so this is advisory only. Any
 * failure -- 404, not JSON, no `service`, timeout -- is simply "not
 * recognised", never an error: the backend's online/offline status is
 * widgets.json's call alone. Same deadline as apps.json, for the same
 * reason: it runs inside discovery.
 *
 * The OpenBB Platform API answers `/` with an HTML landing page rather than
 * JSON; its <title> is how Connections tells it from any other backend
 * speaking the same widgets.json protocol (stores-explorer, a custom one).
 */
export async function fetchServiceName(backend: BackendConfig): Promise<string | undefined> {
  try {
    const body = await request("GET", endpointUrl(backend, ""), authHeaders(backend), undefined, {
      signal: AbortSignal.timeout(APPS_TIMEOUT_MS),
    });
    if (typeof body === "string") {
      return /<title>\s*OpenBB Platform\s*<\/title>/i.test(body) ? OPENBB_PLATFORM_SERVICE : undefined;
    }
    const service = (body as { service?: unknown } | null)?.service;
    return typeof service === "string" && service !== "" ? service : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `GET <endpoint>?<params>` -> `[{ label, value }]`.
 *
 * The endpoint is resolved against `backend.baseUrl` exactly as
 * buildWidgetUrl resolves a widget's, and the credential is placed the same
 * way: authHeaders for header/cookie, applyAuthQuery LAST for query
 * placement, so an options param named like the credential cannot shadow it.
 * An empty value is dropped from the query string, as buildWidgetUrl does —
 * optionsRequestParams already omits unresolved entries, and this keeps a
 * direct caller honest too.
 *
 * The body goes through widgetsJson' toOptions, so a fetched `value: 2026`
 * and a static one normalise identically. An empty array is a legitimate "no
 * choices" and comes back as []; a body that is not an array at all (an
 * object, a bare string, the null a 204 produces) is a contract violation and
 * throws.
 */
export async function fetchParamOptions(
  backend: BackendConfig,
  endpoint: string,
  params: Record<string, string>,
): Promise<ParamOption[]> {
  const payload = await fetchEndpoint(backend, endpoint, params);
  if (!Array.isArray(payload)) throw new Error("options endpoint returned no list");
  return toOptions(payload) ?? [];
}

/**
 * `GET <endpoint>?<params>` -> the body, unparsed: fetchParamOptions' request
 * (which then insists on a list) and useFiscalYearEnd's. The endpoint is
 * resolved against `backend.baseUrl` and the credential placed as
 * fetchParamOptions' comment describes; an empty value is dropped from the
 * query string for the same reason. The body is handed back raw because its three
 * documented shapes (a number, a month name, `{ fiscalYearEnd }`) are
 * periods.ts' business (fiscalYearEndOf), not this layer's — and a 204's
 * null is simply "no answer" there.
 */
export async function fetchEndpoint(
  backend: BackendConfig,
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  return request("GET", endpointUrl(backend, endpoint, params), authHeaders(backend),undefined,{signal});
}

/** The path the stack's calendar router answers on (spec §2 and §3); in openbq-docker, its API (the base compose's full image). */
export const CALENDAR_PATH = "api/v1/calendar/trading";

/** One calendar bundle from openbq-docker's versioned route, with the connection's credential. */
export function fetchCalendarBundle(backend: BackendConfig, calendarId: string, window: BundleWindow): Promise<unknown> {
  return fetchEndpoint(backend, `${CALENDAR_PATH}/v1/bundle`, { calendar_id: calendarId, start: window.start, end: window.end });
}

/**
 * `GET api/v1/calendar/trading?exchange=<MIC>&year=<YYYY>` -> the EODHD v2
 * envelope, unparsed (calendar.ts' normalizeCalendar reads it), or null on a
 * 404. The 404 is an ANSWER: most backends serve no calendar, and
 * useTradingCalendar remembers the null for the session rather than asking
 * again. The URL join and the credential placement are fetchEndpoint's —
 * authHeaders for header/cookie, applyAuthQuery LAST for query — so a
 * calendar is fetched exactly as an options list or a fiscal year end is.
 */
export async function fetchTradingCalendar(backend: BackendConfig, exchange: string, year: number): Promise<unknown> {
  const url = new URL(joinUrl(backend.baseUrl, CALENDAR_PATH));
  url.searchParams.set("exchange", exchange);
  url.searchParams.set("year", String(year));
  return request("GET", applyAuthQuery(url, backend).toString(), authHeaders(backend), undefined, {
    allow404: true,
  });
}

import { FISCAL_YEAR_END_PATH } from "./periods";
export { FISCAL_YEAR_END_PATH };

/**
 * `GET api/v1/fundamentals/fiscal_year_end?symbol=<TICKER>` -> the body
 * unparsed (`{"fiscalYearEnd": "September"}`; periods.ts' fiscalYearEndOf
 * reads it), or null on a 404. The 404 is an ANSWER, exactly as the
 * calendar's is: most backends do not serve this route, and
 * useFiscalYearEnd remembers the null for the session. Built like
 * fetchTradingCalendar, so the credential goes where every other request
 * puts it.
 */
export async function fetchFiscalYearEnd(backend: BackendConfig, symbol: string): Promise<unknown> {
  const url = new URL(joinUrl(backend.baseUrl, FISCAL_YEAR_END_PATH));
  url.searchParams.set("symbol", symbol);
  return request("GET", applyAuthQuery(url, backend).toString(), authHeaders(backend), undefined, {
    allow404: true,
  });
}

/**
 * `POST <endpoint>?<params>` with `{ "<selectorParamName>": [<urls>] }` ->
 * one document object or an array of them.
 *
 * A multi_file_viewer endpoint answers 405 to a GET, so this is the only way
 * to reach one. The URL comes from buildWidgetUrl unchanged, which means the
 * same query params and the same credential placement as every GET:
 * authHeaders for header/cookie, applyAuthQuery LAST for query placement, so
 * a widget param named like the credential cannot shadow it.
 *
 * The selected document URLs go in the BODY, never the query string — they
 * are long, there can be many, and a query string lands in access logs.
 * Returns the parsed body (204 -> null); parsing into Documents is
 * src/lib/documents.ts' job, not this layer's.
 */
export async function fetchWidgetDocuments(
  backend: BackendConfig,
  widget: WidgetDef,
  params: Record<string, string>,
  body: Record<string, string[]>,
  // v5.4.0 final-review fix: optional and last, so every existing call is
  // unchanged; handed to buildWidgetUrl exactly as fetchWidgetData hands its
  // own ctx, so the documents query resolves under the dashboard's exchange.
  ctx?: WireContext,
): Promise<unknown> {
  return request("POST", buildWidgetUrl(backend, widget, params, ctx), authHeaders(backend), body);
}

/**
 * The most a fetched document may be. Past it the read is abandoned rather
 * than pulled whole into the webview -- the same 50 MB a dropped local file is
 * held to (localFiles.ts LOCAL_FILE_MAX_BYTES).
 */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The bytes of a document a backend sent as `{ url }` rather than base64
 * content, for the same pdf.js viewer. The url is some other host's (the
 * reference backend's is on S3), so NOTHING of the backend's auth goes with
 * it -- no headers at all. The error names the status only: a refusing host's
 * body (S3 answers AccessDenied XML) says nothing a card should show.
 * `signal` is the caller's: connectTimeout only bounds reaching the host.
 */
export async function fetchDocumentBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { connectTimeout: CONNECT_TIMEOUT_MS, signal });
  } catch (err) {
    throw new Error(safeNetworkErrorMessage(url, err));
  }
  if (!res.ok) throw new Error(describeHttpError(res.status, ""));
  return readCapped(res, DOCUMENT_MAX_BYTES, () => new Error(`document is larger than ${DOCUMENT_MAX_BYTES / (1024 * 1024)} MB`));
}

/**
 * A response body read under a byte cap. A declared size over the cap is
 * refused before a byte is read; a body with no declared size (or a wrong
 * one) is counted as it streams, and the read is cancelled the moment it
 * passes the cap.
 */
export async function readCapped(res: Response, max: number, tooLarge: () => Error): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length")) > max) {
    void res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > max) throw tooLarge();
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
}
