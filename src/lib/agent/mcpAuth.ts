// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which credential an MCP request carries, and how it travels (spec §4,
 * following Workspace's apps-json-reference for directly connected
 * backends): a "token" server from a backend-served app gets THAT backend's
 * configured credential; one from a file (or whose backend is gone) gets the
 * user's pasted token as a Bearer header; everything else gets nothing.
 *
 * A credentialed request goes through the app's plugin-http fetch -- the
 * backends' path -- so an Authorization header never meets a webview CORS
 * preflight the MCP server did not plan for. Uncredentialed servers keep the
 * webview fetch they have always used.
 */
import { fetch as appFetch } from "@tauri-apps/plugin-http";
import { safeNetworkErrorMessage } from "../dataClient";
import type { BackendConfig } from "../types";
import type { McpTokens } from "../mcpTokensFile";
import { normalizeMcpUrl } from "./mcp";
import { McpError } from "./mcpError";
import type { McpServerConfig } from "./types";

export type McpAuth =
  | { kind: "none" }
  | { kind: "header"; name: string; value: string; backendName: string }
  | { kind: "query"; name: string; value: string; backendName: string }
  | { kind: "bearer"; token: string }
  | { kind: "needs-token" }
  | { kind: "refused"; message: string };

/** Lowercased hostname, ports and everything else ignored; null for an unparseable URL. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether the MCP server's host differs from its source backend's, per
 * Change A: a hostname compare only (case-insensitive, ports ignored -- a
 * backend and an MCP server on the same host at a different port still
 * match). An unparseable URL on either side counts as "differs", the same
 * fail-closed choice `refused` already makes for a cookie credential.
 */
function crossHost(serverUrl: string, backendBaseUrl: string): boolean {
  const a = hostnameOf(serverUrl);
  const b = hostnameOf(backendBaseUrl);
  return a === null || b === null || a !== b;
}

export function mcpAuthFor(server: McpServerConfig | undefined, backends: BackendConfig[], tokens: McpTokens): McpAuth {
  if (!server || server.authType !== "token") return { kind: "none" };
  if (server.source?.kind === "backend") {
    const { backendId } = server.source;
    const b = backends.find((x) => x.id === backendId);
    if (b) {
      if (!b.headerName || !b.headerValue) return { kind: "none" };
      // Change A: a cross-host forward is blocked unless the user allowed it
      // for this server specifically -- a label used to be the only guard,
      // now it's enforced here, before any credential is ever chosen.
      if (crossHost(server.url, b.baseUrl) && server.allowCrossHost !== true) {
        const mcpHostname = hostnameOf(server.url) ?? server.url;
        return { kind: "refused", message: `won't send ${b.name}'s credential to ${mcpHostname} — allow it in AI Library → MCP Servers` };
      }
      if (b.authLocation === "query") return { kind: "query", name: b.headerName, value: b.headerValue, backendName: b.name };
      if (b.authLocation === "cookie") return { kind: "refused", message: "cookie credentials can't be forwarded to an MCP server" };
      return { kind: "header", name: b.headerName, value: b.headerValue, backendName: b.name };
    }
  }
  const stored = tokens[normalizeMcpUrl(server.url)];
  return stored ? { kind: "bearer", token: stored.token } : { kind: "needs-token" };
}

export type McpAuthDeps = {
  backends: BackendConfig[];
  tokens: McpTokens;
  onTokenRejected: (url: string) => void;
  webFetch?: typeof fetch;
  appFetch?: typeof fetch;
};

export type McpTransport = { url: string; headers: Record<string, string>; fetchImpl: typeof fetch };

/**
 * task-8 review C2: plugin-http (reqwest) embeds the FULL request URL --
 * query-placement credential included -- in a network-layer failure's own
 * message ("error sending request for url (...)"), and that error would
 * otherwise reach the chat trail's "unreachable" WARNING, the tool-error
 * artifact (saved to chat.json, exported), and the MCP tab's Check text
 * verbatim. safeNetworkErrorMessage (src/lib/dataClient.ts) already redacts
 * exactly this shape -- any http(s) URL substring's query -- given the
 * plain, query-free URL the request is logically for. `plainUrl` here is
 * always that plain URL, never the credentialed one.
 *
 * safeNetworkErrorMessage only finds a credential that is inside something
 * matching its `https?://` URL regex. As a second, unconditional pass this
 * also strips the raw credential value itself (and its URL-encoded form)
 * wherever it appears in the message, so a differently-shaped error --  the
 * value quoted bare, or a percent-encoded copy sitting outside any matched
 * URL -- cannot carry it through either.
 */
function redactCredentialValue(message: string, value: string): string {
  if (value === "") return message;
  const encoded = encodeURIComponent(value);
  let out = message.split(value).join("[redacted]");
  if (encoded !== value) out = out.split(encoded).join("[redacted]");
  return out;
}

/**
 * Re-throws `err` with the credential gone from its message, while keeping
 * the error's TYPE intact: an McpError keeps its `code`/`status` (so Task 5's
 * classification in toolErrorOf still sees "auth"/"http_401"/etc rather than
 * falling through to "transport"), and any other error keeps its `name` (so
 * a TypeError still reads as one in a log or a debugger, even though `Error`
 * has no subclass-preserving copy constructor).
 */
function withMessage(err: unknown, message: string): Error {
  if (err instanceof McpError) return new McpError(err.code, message, err.status);
  const out = new Error(message);
  if (err instanceof Error) out.name = err.name;
  return out;
}

function redactQueryError(err: unknown, plainUrl: string, credentialValue: string): Error {
  return withMessage(err, redactCredentialValue(safeNetworkErrorMessage(plainUrl, err), credentialValue));
}

/**
 * Every form in which `auth`'s credential could come back inside an error.
 * A header credential is redacted whole AND, when it carries a scheme
 * ("Basic …", "Bearer …"), without it -- a server quoting back "invalid key
 * …" usually echoes only the part after the scheme.
 */
function credentialValues(auth: McpAuth): string[] {
  switch (auth.kind) {
    case "bearer":
      return [auth.token];
    case "query":
      return [auth.value];
    case "header": {
      const bare = auth.value.replace(/^\S+\s+/, "");
      return bare !== auth.value ? [auth.value, bare] : [auth.value];
    }
    default:
      return [];
  }
}

/**
 * final review I2: mcpRpc keeps up to 500 characters of a failed response's
 * body ("invalid api key abc123"), and that message travels whole into the
 * tool-error artifact (chat.json, the export), the call ledger, the trail's
 * unreachable WARNING, the MCP tab's Check text and the agent's tool result.
 * Only a 401 used to be rewritten, so any other status -- or an error thrown
 * while reading the body, after fetchImpl had already returned -- carried an
 * echoed credential through. Nothing to redact returns `err` itself, so an
 * uncredentialed error keeps its identity (an AbortError stays one).
 */
function redactEchoedCredential(err: unknown, auth: McpAuth): unknown {
  const message = err instanceof Error ? err.message : String(err);
  const clean = credentialValues(auth).reduce(redactCredentialValue, message);
  return clean === message ? err : withMessage(err, clean);
}

export async function withMcpAuth<T>(
  server: McpServerConfig | undefined,
  url: string,
  deps: McpAuthDeps,
  run: (t: McpTransport) => Promise<T>,
): Promise<T> {
  const auth = mcpAuthFor(server, deps.backends, deps.tokens);
  const web = deps.webFetch ?? fetch;
  const app = deps.appFetch ?? (appFetch as unknown as typeof fetch);
  let transport: McpTransport;
  switch (auth.kind) {
    case "needs-token":
      // The 6.2.1 rule: no connection attempt at all before a token exists.
      throw new McpError("needs_token", "Token required — add it in AI Library → MCP Servers");
    case "refused":
      throw new McpError("auth", auth.message);
    case "bearer":
      transport = { url, headers: { Authorization: `Bearer ${auth.token}` }, fetchImpl: app };
      break;
    case "header":
      transport = { url, headers: { [auth.name]: auth.value }, fetchImpl: app };
      break;
    case "query": {
      // task-8 review C1: transport.url stays the PLAIN url -- it is what
      // discoverMcpTools/callMcpTool key their cache by, stamp onto every
      // AgentTool.url, and quote back in unreachable[]/error messages, and
      // all of those get serialized whole into Rita's /v1/query body. The
      // credential is appended only inside this fetchImpl, at the instant of
      // the actual network call, so nothing upstream of it ever sees it.
      const { name, value } = auth;
      const fetchImpl: typeof fetch = async (input, init) => {
        const credentialed = new URL(String(input));
        credentialed.searchParams.set(name, value);
        try {
          return await app(credentialed.toString(), init);
        } catch (err) {
          throw redactQueryError(err, url, value);
        }
      };
      transport = { url, headers: {}, fetchImpl };
      break;
    }
    default:
      transport = { url, headers: {}, fetchImpl: web };
  }
  try {
    return await run(transport);
  } catch (err) {
    if (err instanceof McpError && err.status === 401) {
      if (auth.kind === "bearer") {
        deps.onTokenRejected(url);
        throw new McpError("auth", "Token rejected — enter it again in AI Library → MCP Servers", 401);
      }
      if (auth.kind === "header" || auth.kind === "query") {
        throw new McpError("auth", `The MCP server rejected ${auth.backendName}'s credentials`, 401);
      }
      if (server?.authType === "oauth") throw new McpError("auth", "Needs OAuth sign-in, which BDOBB doesn't support", 401);
    }
    throw redactEchoedCredential(err, auth);
  }
}
