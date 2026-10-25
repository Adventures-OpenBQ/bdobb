// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { addImportedMcpServers, type ImportedMcpServer } from "../lib/agent/importedMcp";
import type { McpServerSource } from "../lib/agent/types";
import { logError } from "../lib/logger";
import { useSettingsStore } from "./settingsStore";

/**
 * Merges an import's MCP servers into Settings (switched off) and returns how
 * many were new, and which of those are on this computer or a private
 * network -- the notice names them (main ac2d3475's warning, shared).
 *
 * Never rejects (final review M3): every caller has already written its
 * dashboards, so a failed save is logged as `failure` plus the error, and
 * reads as nothing added.
 */
export async function saveImportedMcpServers(
  imported: ImportedMcpServer[],
  source: McpServerSource,
  failure: string,
): Promise<{ added: number; local: string[] }> {
  if (imported.length === 0) return { added: 0, local: [] };
  try {
    const { next, added, local } = addImportedMcpServers(useSettingsStore.getState().settings.mcpServers, imported, source);
    if (added > 0) await useSettingsStore.getState().save({ mcpServers: next });
    return { added, local };
  } catch (err) {
    await logError(`${failure} ${err instanceof Error ? err.message : String(err)}`);
    return { added: 0, local: [] };
  }
}
