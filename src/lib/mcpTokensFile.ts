// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Static MCP tokens, in their OWN file: settings.json is exported (AI
 * Library, settings export) and this must never be. Plain JSON, the same
 * protection backends.json gives backend credentials -- the user chose this
 * over the OS keychain, which is unusable on a Linux box with no Secret
 * Service (spec §4). Keyed by the server's normalized URL.
 */
import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";

export const MCP_TOKENS_PATH = "mcpTokens.json";

export type McpTokens = Record<string, { token: string }>;

export async function loadMcpTokens(): Promise<McpTokens> {
  const loaded = await loadJson(MCP_TOKENS_PATH, isRecord);
  if (loaded === ABSENT) return {};
  const out: McpTokens = {};
  for (const [url, entry] of Object.entries(loaded)) {
    if (isRecord(entry) && typeof entry.token === "string" && entry.token !== "") out[url] = { token: entry.token };
  }
  return out;
}

export async function saveMcpTokens(tokens: McpTokens): Promise<void> {
  await saveJson(MCP_TOKENS_PATH, tokens);
}
