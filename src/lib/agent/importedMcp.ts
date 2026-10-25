// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * apps.json `mcp_servers` (Workspace apps-json-reference): parsed at the
 * boundary, then merged into Settings SWITCHED OFF. An apps.json from any
 * backend can name any URL, and a "token" server would be handed that
 * backend's credential, so nothing is contacted until the user turns a
 * server on in AI Library -> MCP Servers.
 */
import { isRecord } from "../isRecord";
import { logOnce } from "../logger";
import { isPrivateHost } from "../privateHost";
import { safeUrl } from "../safeUrl";
import { toMcpServerConfig } from "../settingsFile";
import { normalizeMcpUrl } from "./mcp";
import type { McpAuthType, McpServerConfig, McpServerSource } from "./types";

export type ImportedMcpServer = { name: string; description: string; url: string; authType: McpAuthType };

export function parseMcpServers(raw: unknown, appName: string): ImportedMcpServer[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportedMcpServer[] = [];
  raw.forEach((entry, i) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.description !== "string" ||
      typeof entry.url !== "string" ||
      safeUrl(entry.url.trim()) === null
    ) {
      void logOnce(`apps.json:${appName}:mcp_servers:${i}`, `apps.json app ${appName}: mcp_servers[${i}] is malformed; skipped`);
      return;
    }
    out.push({
      name: entry.name,
      description: entry.description,
      url: entry.url.trim(),
      // The reference's default; anything unrecognised is treated the same.
      authType: entry.authType === "token" ? "token" : "oauth",
    });
  });
  return out;
}

/**
 * The URLs among `servers` that name this computer or a private network --
 * main's ac2d3475 rule (isPrivateHost), ported down the chain by the user's
 * ruling and shared by every MCP import path: the AI Library file, a
 * settings bundle and apps.json each name these in their notice. A warning,
 * never a refusal: a loopback or LAN server is legitimate, it just should
 * not arrive unremarked from a file someone else wrote. Tailscale addresses
 * and *.ts.net are not flagged (see isPrivateHost).
 */
export function privateMcpUrls(servers: readonly { url: string }[]): string[] {
  return servers
    .map((s) => s.url)
    .filter((url) => {
      const safe = safeUrl(url);
      return safe !== null && isPrivateHost(new URL(safe).hostname);
    });
}

/** The one wording every import notice uses for them; empty when there are none. */
export function privateNetworkWarning(urls: readonly string[]): string {
  return urls.length > 0 ? `Warning: on this computer or a private network: ${urls.join(", ")}.` : "";
}

/**
 * The consent gate every MCP import path shares (Task C1): the AI Library's
 * own file, a settings bundle and apps.json. Before C1 each path carried its
 * own copy, and the settings bundle carried none -- it installed servers
 * exactly as the file said. One function now, so the paths cannot drift.
 *
 * The row is normalized by the loader's own toMcpServerConfig, so an import
 * stores exactly what a restart would read back; null is a row the loader
 * would drop.
 */
export function sanitizeImportedMcpServer(v: unknown): McpServerConfig | null {
  const s = toMcpServerConfig(v);
  if (!s) return null;
  // final review I3: a "token" server sourced from a backend forwards
  // THAT backend's credential once enabled (spec §4), so a crafted file
  // saying enabled: true would send it with no click. Every import path
  // keeps the consent gate "imported switched off"; the provenance stays.
  if (s.authType === "token" && s.source?.kind === "backend") s.enabled = false;
  // Change A: a file must never pre-approve a cross-host credential
  // forward either -- every imported entry arrives with it off, even one
  // that already agrees with its backend's host today (the backend or
  // the server's URL could both change later).
  delete s.allowCrossHost;
  return s;
}

export function addImportedMcpServers(
  current: McpServerConfig[],
  imported: ImportedMcpServer[],
  source: McpServerSource,
): { next: McpServerConfig[]; added: number; local: string[] } {
  const known = new Set(current.map((s) => normalizeMcpUrl(s.url)));
  const next = [...current];
  let added = 0;
  for (const m of imported) {
    const key = normalizeMcpUrl(m.url);
    // An existing entry is the user's and is left exactly as it is.
    if (known.has(key)) continue;
    known.add(key);
    // Built switched off with no allowCrossHost already; the shared gate
    // (Task C1) is what keeps it that way if this row ever grows a field.
    const row = sanitizeImportedMcpServer({ id: crypto.randomUUID(), url: m.url, enabled: false, name: m.name, description: m.description, authType: m.authType, source });
    if (!row) continue;
    next.push(row);
    added += 1;
  }
  // The added rows only: an existing entry is the user's and was already seen.
  return { next, added, local: privateMcpUrls(next.slice(current.length)) };
}

export function mcpImportNotice(added: number, from: string, local: readonly string[] = []): string {
  if (added === 0) return "";
  const noun = added === 1 ? "MCP server" : "MCP servers";
  const them = added === 1 ? "it" : "them";
  const warning = local.length > 0 ? ` ${privateNetworkWarning(local)}` : "";
  return ` Added ${added} ${noun} from ${from}. Turn ${them} on in AI Library → MCP Servers.${warning}`;
}
