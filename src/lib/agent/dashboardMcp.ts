// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The widget-derived half of the MCP union (v6 spec): the storage.mcpUrl of
 * every card on the active dashboard, normalized and deduplicated the same
 * way assembleTools deduplicates, so a Settings entry and a widget's URL that
 * differ only by a trailing slash are one server. Keys widgets are skipped
 * as they are everywhere else (isAgentOffLimits: key-maint's keys surfaces
 * and settings widgets; since fix round 2, every widget on a backend that
 * serves key-maint). The CALLER applies the Context Sharing gate.
 */
import type { DashboardCard, WidgetDef } from "../types";
import { isAgentOffLimits } from "../providerKeys";
import { normalizeMcpUrl } from "./mcp";

export function dashboardMcpUrls(
  cards: DashboardCard[],
  findWidget: (backendId: string, widgetId: string) => WidgetDef | undefined,
  /** keyMaintBackendIds over the whole registry; see isAgentOffLimits. */
  keyMaintBackends: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const c of cards) {
    const w = findWidget(c.backendId, c.widgetId);
    if (!w || isAgentOffLimits(w, keyMaintBackends) || !w.mcpUrl) continue;
    const url = normalizeMcpUrl(w.mcpUrl);
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
