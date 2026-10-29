// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Gated (reached only through ./runtime): the one built-in widget an Art's Charts connection contributes (B5). */
import { fetchWidgetPath, HttpError } from "../dataClient";
import type { DiscoveryResult } from "../discovery";
import type { BackendConfig, WidgetDef } from "../types";

export const ARTS_CHART_TYPE = "arts_chart";

export function artsChartWidget(backend: BackendConfig): WidgetDef {
  const hidden = (paramName: string) => ({ paramName, label: paramName, type: "text", value: "", show: false });
  return {
    id: ARTS_CHART_TYPE, backendId: backend.id, name: "Art's Charts",
    description: "A chart kept on the Art's Charts server: studies, drawings and history, shared with Rita.",
    type: ARTS_CHART_TYPE, category: "Charts", subCategory: "", endpoint: "", source: [],
    wsEndpoint: "ta_series_ws", gridData: { w: 40, h: 20 },
    params: [
      { paramName: "symbol", label: "Symbol", type: "text", value: "AAPL", groupType: "symbol" },
      { paramName: "interval", label: "Interval", type: "text", value: "1d" },
      { paramName: "provider", label: "Provider", type: "text", value: "yfinance", options: [
        { label: "yfinance", value: "yfinance" }, { label: "EODHD", value: "eodhd" }, { label: "TemporalDB", value: "temporaldb" },
      ] },
      { paramName: "start", label: "Start", type: "date", value: "" },
      { paramName: "end", label: "End", type: "date", value: "" },
      hidden("chart_id"), hidden("live"), hidden("panels"), hidden("macro"), hidden("indicators"),
    ],
  };
}

/** GET /ta_registry: 200 online, 404 "not an Art's Charts server", anything else offline with why. Never rejects. */
export async function discoverArtsCharts(backend: BackendConfig): Promise<DiscoveryResult> {
  try {
    await fetchWidgetPath(backend, "ta_registry", {});
    return { backendId: backend.id, widgets: [artsChartWidget(backend)], apps: [], status: "online", issues: [] };
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 0;
    const error = status === 404 ? "Not an Art's Charts server"
      : status === 401 || status === 403 ? `The server refused the credential (${status})`
      : err instanceof Error ? err.message : String(err);
    return { backendId: backend.id, widgets: [], apps: [], status: "offline", issues: [], error };
  }
}
