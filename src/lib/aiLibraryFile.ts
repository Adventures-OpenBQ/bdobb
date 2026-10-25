// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { privateMcpUrls, privateNetworkWarning, sanitizeImportedMcpServer } from "./agent/importedMcp";
import { MAX_FUNCTION_ROUNDS, MIN_FUNCTION_ROUNDS } from "./agent/limits";
import { isRecord } from "./isRecord";
import { safeUrl } from "./safeUrl";
import { isShareTarget } from "./shareTargets";
import type { Settings } from "./types";

/** The AI Library's settings, as one exchangeable file. */
export type AiLibraryFile = Pick<
  Settings,
  "ritaUrl" | "contextSharing" | "mcpServers" | "shareTargets" | "agentPromptSuggestions" | "ritaMaxFunctionRounds"
>;

export const AI_LIBRARY_FILE_NAME = "ai-library.json";

export function exportAiLibrary(s: Settings): string {
  const file: AiLibraryFile = {
    ritaUrl: s.ritaUrl,
    contextSharing: s.contextSharing,
    mcpServers: s.mcpServers,
    shareTargets: s.shareTargets,
    agentPromptSuggestions: s.agentPromptSuggestions,
    ritaMaxFunctionRounds: s.ritaMaxFunctionRounds,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type AiLibraryImport = { ok: true; patch: AiLibraryFile; notice: string } | { ok: false; refusal: string };

/**
 * A file is a whole snapshot: every field present replaces the current one,
 * an absent field is left alone. Entries are validated by the same guards
 * the settings loader uses, so an import can never store what a restart
 * would then drop; a malformed list entry is dropped on its own.
 */
export function parseAiLibrary(text: string, current: Settings): AiLibraryImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, refusal: "Not a JSON file." };
  }
  if (!isRecord(raw)) return { ok: false, refusal: "Not an AI Library file." };
  const r = raw;
  const patch: AiLibraryFile = { ...current };
  const parts: string[] = [];
  // Servers that reach this computer or a private network. A shared file is
  // a preset someone else wrote, so these are named in the notice rather
  // than arriving unremarked; they are still imported.
  let local: string[] = [];
  if ("ritaUrl" in r) {
    if (typeof r.ritaUrl !== "string" || (r.ritaUrl !== "" && safeUrl(r.ritaUrl) === null)) {
      return { ok: false, refusal: "ritaUrl is not an http(s) URL." };
    }
    patch.ritaUrl = r.ritaUrl;
    parts.push(r.ritaUrl === "" ? "Rita off" : "Rita URL");
  }
  if ("contextSharing" in r) {
    if (typeof r.contextSharing !== "boolean") return { ok: false, refusal: "contextSharing is not a boolean." };
    patch.contextSharing = r.contextSharing;
    parts.push("context sharing");
  }
  if ("ritaMaxFunctionRounds" in r) {
    const value = r.ritaMaxFunctionRounds;
    if (typeof value !== "number" || !Number.isInteger(value) ||
        value < MIN_FUNCTION_ROUNDS || value > MAX_FUNCTION_ROUNDS) {
      return { ok: false, refusal: `ritaMaxFunctionRounds must be an integer from ${MIN_FUNCTION_ROUNDS} to ${MAX_FUNCTION_ROUNDS}.` };
    }
    patch.ritaMaxFunctionRounds = value;
    parts.push(`Rita tool limit: ${value} rounds`);
  }
  if ("agentPromptSuggestions" in r) {
    if (typeof r.agentPromptSuggestions !== "boolean") return { ok: false, refusal: "agentPromptSuggestions is not a boolean." };
    patch.agentPromptSuggestions = r.agentPromptSuggestions;
    parts.push("follow-up suggestions");
  }
  if ("mcpServers" in r) {
    if (!Array.isArray(r.mcpServers)) return { ok: false, refusal: "mcpServers is not a list." };
    // final review I3 (a backend-sourced "token" server arrives switched
    // off) and Change A (allowCrossHost never survives an import), now the
    // one gate every MCP import path shares (Task C1) -- the reasoning is
    // on sanitizeImportedMcpServer.
    patch.mcpServers = r.mcpServers.map(sanitizeImportedMcpServer).filter((s) => s !== null);
    parts.push(`${patch.mcpServers.length} of ${r.mcpServers.length} MCP servers`);
    // main ac2d3475's rule, from the one helper every import path shares.
    local = privateMcpUrls(patch.mcpServers);
  }
  if ("shareTargets" in r) {
    if (!Array.isArray(r.shareTargets)) return { ok: false, refusal: "shareTargets is not a list." };
    patch.shareTargets = r.shareTargets.filter(isShareTarget);
    parts.push(`${patch.shareTargets.length} of ${r.shareTargets.length} share targets`);
  }
  // Every recognized field above pushes its own label onto `parts` (including
  // the two booleans, which used to be silent and fall back to a hardcoded
  // "context sharing" -- wrong once agentPromptSuggestions could ALSO be the
  // only field present), so an empty `parts` here means nothing recognized.
  if (parts.length === 0) {
    return { ok: false, refusal: "Not an AI Library file." };
  }
  const warning = local.length > 0 ? ` ${privateNetworkWarning(local)}` : "";
  return { ok: true, patch, notice: `Imported ${parts.join(", ")}.${warning}` };
}
