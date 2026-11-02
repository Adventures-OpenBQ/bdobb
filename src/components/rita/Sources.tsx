// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { openUrl } from "@tauri-apps/plugin-opener";
import type { AgentCall, McpServerConfig } from "../../lib/agent/types";
import { isRecord } from "../../lib/isRecord";
import { logError } from "../../lib/logger";
import { safeUrl } from "../../lib/safeUrl";
import type { WidgetDef } from "../../lib/types";
import { useDashboardStore } from "../../stores/dashboardStore";

/** Reduces a Rita citation to a label and an openable url (null when the source has none). */
export function citationLink(c: unknown): { name: string; url: string | null } | null {
  if (!isRecord(c)) return null;
  const info = isRecord(c.source_info) ? c.source_info : {};
  const name = typeof info.name === "string" ? info.name : typeof c.id === "string" ? c.id : "Source";
  const raw = typeof info.url === "string" ? info.url : typeof c.url === "string" ? c.url : null;
  if (raw === null) return { name, url: null };
  const url = safeUrl(raw);
  return url === null ? null : { name, url };
}

/**
 * The widgets whose `mcp_tool` matches a completed MCP call: the call's server,
 * by its Settings `name`, and the tool it ran (a proxied call's
 * `effectiveTools`, else its `tool`), both exactly. An unnamed server and a
 * failed call (`ok: false`) match nothing.
 */
export function citedWidgets(calls: AgentCall[], servers: McpServerConfig[], widgets: WidgetDef[]): WidgetDef[] {
  const used = calls.flatMap((c) => {
    if (c.kind !== "agent_tool" || c.ok === false) return [];
    const name = servers.find((s) => s.id === c.server_id)?.name;
    return name === undefined ? [] : (c.effectiveTools ?? [c.tool]).map((tool) => ({ name, tool }));
  });
  return widgets.filter((w) => {
    const t = w.mcpTool;
    return t !== undefined && used.some((u) => u.name === t.mcpServer && u.tool === t.toolId);
  });
}

/** Brings the widget's card on the open dashboard into view, or adds the widget there. */
export async function openCitedWidget(widget: WidgetDef): Promise<void> {
  const store = useDashboardStore.getState();
  const dashboard = store.activeDashboard();
  if (!dashboard) return;
  for (const tab of dashboard.tabs) {
    const existing = tab.cards.find((c) => c.widgetId === widget.id && c.backendId === widget.backendId);
    if (!existing) continue;
    store.setActiveTab(dashboard.id, tab.id);
    // After the tab switch has rendered the card. jsdom has no scrollIntoView.
    setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLElement>("[data-card-id]")].find((e) => e.dataset.cardId === existing.id);
      if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    }, 0);
    return;
  }
  try {
    await store.addCard(widget);
  } catch (err) {
    await logError(`failed to add widget ${widget.id}: ${err}`);
  }
}

export function Sources({ citations, widgets = [] }: { citations: Record<string, unknown>[]; widgets?: WidgetDef[] }) {
  const links = citations.map(citationLink).filter((l): l is NonNullable<typeof l> => l !== null);
  if (links.length === 0 && widgets.length === 0) return null;
  return (
    <p className="chat-sources">
      Sources:{" "}
      {links.map((l, i) =>
        l.url === null ? (
          <span key={i}>{l.name}</span>
        ) : (
          <button key={i} type="button" onClick={() => void openUrl(l.url as string)}>
            {l.name}
          </button>
        ),
      )}
      {widgets.map((w) => (
        <button key={`${w.backendId}/${w.id}`} type="button" title={`Add ${w.name} to the dashboard, or show its card`} onClick={() => void openCitedWidget(w)}>
          {w.name}
        </button>
      ))}
    </p>
  );
}
