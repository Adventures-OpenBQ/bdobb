// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Art's Charts host (spec §2). Gated: reached only through ./artsCharts/runtime.
 *
 * chartsFetch is ONE module-level function, so its reference never changes, and it reads the
 * connection at call time. Desktop and iPad go through plugin-http (an Authorization header
 * never meets a webview CORS preflight); in `vite --mode browser` the same import is the http
 * shim, same-origin. The gateway door tickets the socket (B6 on desktop, TicketSocket on the web),
 * so no credential rides its URL; but a query-location credential can still reach a socket URL
 * through bdobbWsUrl -> applyAuthQuery. The tailnet door gets no study socket (B4).
 */
import { configureArtsCharts, type ArtsChartsHost, type ChartsFetch, type GroupLinkProps } from "@adventures-openbq/arts-charts";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import * as dialog from "@tauri-apps/plugin-dialog";
import { BaseDirectory, exists, mkdir, readDir, readTextFile, remove, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GroupLink } from "../components/GroupLink";
import { DatetimePicker } from "../components/pickers/DatetimePicker";
import { RelativeTab } from "../components/pickers/RelativeTab";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import { useArtsChartsStore } from "../stores/artsChartsStore";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { artsChartsConnections } from "./artsCharts/connection";
import { artsChartWidget } from "./artsCharts/widget";
import { applyAuthQuery, authHeaders, buildWidgetWsUrl as bdobbWsUrl, fetchWidgetPath, joinUrl } from "./dataClient";
import { logError, logInfo } from "./logger";
import { wireParams } from "./params";
import { safeUrl } from "./safeUrl";
import { saveBinaryFile, saveTextFile } from "./saveTextFile";
import type { BackendConfig, DashboardCard, WidgetDef } from "./types";

const CONNECT_TIMEOUT_MS = 10_000;
const active = (): BackendConfig | null => artsChartsConnections(useBackendsStore.getState().backends).active;

/** `path` under the connection's base, or a throw: server-relative, no dot segment, never outside the base. */
function checkedUrl(b: BackendConfig, path: string): URL {
  const refuse = () => new Error(`chartsFetch takes a server-relative path under the chart server: ${JSON.stringify(path)}`);
  if (!path.startsWith("/") || path.startsWith("//")) throw refuse();
  const pathname = path.split(/[?#]/)[0];
  if (pathname.split("/").some((s) => s === "." || s === ".." || /%2e/i.test(s) || /%2f/i.test(s))) throw refuse();
  const base = new URL(joinUrl(b.baseUrl, ""));
  const url = new URL(joinUrl(b.baseUrl, path));
  const root = base.pathname.replace(/\/$/, "");
  if (url.origin !== base.origin || !(url.pathname === root || url.pathname.startsWith(root + "/"))) throw refuse();
  return url;
}

export const chartsFetch: ChartsFetch = async (path, init) => {
  const b = active();
  if (b === null) throw new Error("Art's Charts is not connected");
  const url = checkedUrl(b, path);
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(authHeaders(b))) headers.set(name, value);
  return httpFetch(applyAuthQuery(url, b).toString(), { ...init, headers, connectTimeout: CONNECT_TIMEOUT_MS } as RequestInit);
};

export function chartsSocketUrl(path: string): string {
  const b = active();
  if (b === null) throw new Error("Art's Charts is not connected");
  if (path.includes("?")) throw new Error("chartsSocketUrl takes a path with no query");
  const url = checkedUrl(b, path);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/** The package types the card as its structural subset; at runtime it is the app's full card. */
const Link = (p: GroupLinkProps) => <GroupLink {...p} card={p.card as DashboardCard} />;

const fsOpts = { baseDir: BaseDirectory.AppData } as const;
const rel = (p: string) => (p.startsWith("/") ? {} : fsOpts);

/** B8: the dashboard in view in the main window; none open -> a new one called "Art's Charts". */
export async function addChartToDashboard(chartId: string, options: { live?: boolean } = {}): Promise<void> {
  const b = active();
  if (b === null) return;
  const store = useDashboardStore.getState();
  if (store.activeDashboard() === undefined) {
    const id = await store.addDashboard("Art's Charts");
    if (id === null) return;
    store.setActive(id);
  }
  await useDashboardStore.getState().addCard(artsChartWidget(b), options.live ? { chart_id: chartId, live: "true" } : { chart_id: chartId });
}

/** B8: focus a card with this chart_id in any dashboard (switch dashboard and tab, reveal), else add one. */
export async function openChartCard(chartId: string): Promise<void> {
  const { dashboards, setActive, setActiveTab } = useDashboardStore.getState();
  for (const d of dashboards) for (const t of d.tabs) {
    const card = t.cards.find((c) => c.widgetId === "arts_chart" && c.params.chart_id === chartId);
    if (card) { setActive(d.id); setActiveTab(d.id, t.id); useArtsChartsStore.getState().revealCard(card.id); return; }
  }
  // B12: a link can name a chart that is not there. Ask first, so the add path never makes a card for a 404.
  try {
    if ((await chartsFetch(`/charts/${chartId}`)).status === 404) { useArtsChartsStore.getState().setNotice("That chart is not on the Art's Charts server."); return; }
  } catch { /* unreachable: add it, and the card reports its own error */ }
  await addChartToDashboard(chartId);
}

export function buildHost({ viewer }: { viewer: boolean }): ArtsChartsHost {
  const b = active();
  const store = useDashboardStore.getState();
  return {
    fetchWidgetPath: (backend, path, params) => fetchWidgetPath(backend as BackendConfig, path, params),
    buildWidgetWsUrl: (backend, widget, params = {}) => {
      const full = useBackendsStore.getState().backends.find((x) => x.id === backend.id);
      if (!full || full.door === "tailnet") return null;
      const plain = bdobbWsUrl(full, widget as WidgetDef);
      if (plain === null) return null;
      const url = new URL(plain);
      for (const [k, v] of Object.entries(wireParams(widget as WidgetDef, params))) if (v !== "") url.searchParams.set(k, v);
      return url.toString();
    },
    fs: {
      exists: (p) => exists(p, rel(p)), readTextFile: (p) => readTextFile(p, rel(p)),
      writeTextFile: (p, d, o) => writeTextFile(p, d, { ...rel(p), ...o }), readDir: (p) => readDir(p, rel(p)),
      rename: (a, c) => rename(a, c, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData }),
      remove: (p) => remove(p, rel(p)), mkdir: (p, o) => mkdir(p, { ...rel(p), ...o }), stat: (p) => stat(p, rel(p)),
    },
    dialog: { open: (o) => dialog.open(o), confirm: (m, o) => dialog.confirm(m, o) },
    saveTextFile, saveBinaryFile,
    openUrl: async (raw) => { const safe = safeUrl(raw); if (safe !== null) await openUrl(safe); },
    log: (level, message) => (level === "error" ? logError(message) : logInfo(message)),
    useResolvedTheme,
    groups: { createGroup: store.createGroup, joinGroup: store.joinGroup, dropUngroupable: store.dropUngroupable },
    components: { DatetimePicker, RelativeTab, AnchorChips: () => null, GroupLink: Link },
    ...(b === null ? {} : { chartsFetch }),
    ...(b === null || b.door === "tailnet" ? {} : { chartsSocketUrl }),
    ...(viewer || b === null ? {} : { addToDashboard: (id: string, o?: { live?: boolean }) => void addChartToDashboard(id, o), openChart: (id: string) => void openChartCard(id) }),
  };
}

let last: string | null = null;
/** Configure for the current connection; remount cards and inbox when it changed (spec §2). */
export function reconfigure({ viewer }: { viewer: boolean }): void {
  const b = active();
  const key = b === null ? "" : JSON.stringify([b.id, b.baseUrl, b.headerName, b.headerValue, b.authLocation, b.door]);
  configureArtsCharts(buildHost({ viewer }));
  if (last !== null && key !== last) useArtsChartsStore.getState().bump();
  last = key;
}
