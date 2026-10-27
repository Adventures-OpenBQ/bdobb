// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
/** Gated: loaded only through ./load (spec B2). */
export { discoverArtsCharts } from "./widget";

import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useArtsChartsStore } from "../../stores/artsChartsStore";
import { useBackendsStore } from "../../stores/backendsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import { logError } from "../logger";
import { openChartCard, reconfigure } from "../artsChartsHost";
import { artsChartsConnections } from "./connection";
import { installChartsSocketShim } from "./desktopSocket";
import { type ArtsLink, parseDeepLink, parseWebLink } from "./links";
import { ensureArtsChartsSkill, syncArtsChartsMcp } from "./mcp";

const activeConnection = () => artsChartsConnections(useBackendsStore.getState().backends).active;

/**
 * B12: a link only opens. It focuses the inbox item or the chart and does nothing else (no add, delete or
 * mark beyond the read mark the inbox sets on an item it opens). Held until the dashboards have loaded, since
 * openChart looks through them.
 */
export async function handleArtsLink(link: ArtsLink): Promise<void> {
  if (!useDashboardStore.getState().loaded) {
    await new Promise<void>((resolve) => {
      const stop = useDashboardStore.subscribe((s) => { if (s.loaded) { stop(); resolve(); } });
    });
  }
  if (activeConnection() === null) { useArtsChartsStore.getState().setNotice("This link needs an Art's Charts connection."); return; }
  if (link.kind === "inbox") useArtsChartsStore.getState().focusInbox(link.id);
  else await openChartCard(link.id);
}

/** Configure once at startup and again on every backends change (spec §2). Returns the unsubscribe. */
export function startArtsCharts(options: { viewer: boolean }): () => void {
  const uninstall = import.meta.env.MODE === "browser" ? () => {} : installChartsSocketShim();
  reconfigure(options);
  // B10/B11: desktop main window only. The browser preview's MCP list is owned by web/bootstrap.mjs
  // (its PREVIEW_RITA gate and the Q8 default); a viewer window never writes settings. Always the
  // first Art's Charts connection (the rest are ignored, B3). At start the sync only UPDATES an
  // existing server: one the user deleted is not brought back on every launch.
  const manage = !options.viewer && import.meta.env.MODE !== "browser";
  let last = manage ? activeConnection() : null;
  // One chain, so two quick backends changes cannot interleave their settings writes.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (job: () => Promise<unknown>) => { queue = queue.then(job).catch((e) => { void logError(`Art's Charts settings sync failed: ${e instanceof Error ? e.message : String(e)}`); }); };
  if (last !== null) { const c = last; enqueue(() => syncArtsChartsMcp(c, c)); }
  const unsubscribe = useBackendsStore.subscribe((s, prev) => {
    if (s.backends === prev.backends) return;
    reconfigure(options);
    if (!manage) return;
    const next = artsChartsConnections(s.backends).active, before = last;
    last = next;
    enqueue(async () => {
      await syncArtsChartsMcp(before, next);
      if (before === null && next !== null) await ensureArtsChartsSkill();
    });
  });
  // B12: links. Main window only; a viewer window never opens one.
  let stopLinks = () => {};
  let stopped = false;
  if (!options.viewer) {
    const opened = (urls: string[]) => urls.forEach((u) => { const l = parseDeepLink(u); if (l) void handleArtsLink(l); });
    if (import.meta.env.MODE === "browser") {
      const l = parseWebLink(window.location.search);
      if (l) { void handleArtsLink(l); history.replaceState(null, "", "/"); }
    } else {
      void getCurrent().then((urls) => { if (urls) opened(urls); }).catch(() => {});
      void onOpenUrl(opened).then((off) => { if (stopped) off(); else stopLinks = off; }).catch(() => {});
    }
  }
  return () => { stopped = true; stopLinks(); unsubscribe(); uninstall(); };
}
