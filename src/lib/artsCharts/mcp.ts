// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * B10: the Art's Charts connection brings its MCP server, bound to that connection so its
 * credential goes only to its own host (mcpAuthFor's source binding). B11: the bundled
 * arts-charts skill is added once if no skill has that slug; a user's edit is never replaced.
 */
import { useSettingsStore } from "../../stores/settingsStore";
import { useSkillsStore } from "../../stores/skillsStore";
import type { McpServerConfig } from "../agent/types";
import { joinUrl } from "../dataClient";
import { bundledSkills } from "../skillsFiles";
import type { BackendConfig } from "../types";

export const ARTS_MCP_ID = "arts-charts";

const serverFor = (b: BackendConfig): McpServerConfig => ({
  id: ARTS_MCP_ID, name: "Art's Charts", url: joinUrl(b.baseUrl, "charts/mcp"), enabled: true,
  authType: "token", source: { kind: "backend", backendId: b.id },
});

export async function syncArtsChartsMcp(prev: BackendConfig | null, next: BackendConfig | null): Promise<void> {
  const servers = useSettingsStore.getState().settings.mcpServers;
  const others = servers.filter((s) => s.id !== ARTS_MCP_ID);
  if (next === null) {
    if (others.length !== servers.length) await useSettingsStore.getState().save({ mcpServers: others });
    return;
  }
  const mine = servers.find((s) => s.id === ARTS_MCP_ID);
  const wanted = serverFor(next);
  const same = prev !== null && prev.id === next.id && prev.baseUrl === next.baseUrl;
  const current = mine !== undefined && mine.url === wanted.url && mine.source?.kind === "backend" && mine.source.backendId === next.id;
  // The same connection as before (the start-time call): only update an entry that is there, so a server
  // the user deleted stays deleted. Added or changed: (re)register, keeping the user's enabled toggle on a change.
  if (same && (mine === undefined || current)) return;
  await useSettingsStore.getState().save({ mcpServers: [...others, { ...wanted, enabled: prev === null ? true : (mine?.enabled ?? true) }] });
}

export async function ensureArtsChartsSkill(): Promise<void> {
  if (useSkillsStore.getState().skills.some((s) => s.slug === "arts-charts")) return;
  const seed = bundledSkills().find((s) => s.slug === "arts-charts");
  if (seed) await useSkillsStore.getState().upsert({ ...seed, updated: new Date().toISOString() });
}
