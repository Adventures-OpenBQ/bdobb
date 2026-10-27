// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
/** Gated: loaded only through ./load (spec B2). */
export { discoverArtsCharts } from "./widget";

import { useBackendsStore } from "../../stores/backendsStore";
import { reconfigure } from "../artsChartsHost";
import { artsChartsConnections } from "./connection";
import { installChartsSocketShim } from "./desktopSocket";
import { ensureArtsChartsSkill, syncArtsChartsMcp } from "./mcp";

const activeConnection = () => artsChartsConnections(useBackendsStore.getState().backends).active;

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
  const enqueue = (job: () => Promise<unknown>) => { queue = queue.then(job).catch(() => {}); };
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
  return () => { unsubscribe(); uninstall(); };
}
