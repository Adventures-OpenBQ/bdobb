// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Art's Charts server as a Connection (spec B3). No package import and no widget id here:
 * this file ships in every build, including VITE_ARTS_CHARTS=0, where an imported
 * arts-charts connection must still be recognised (and shown offline) rather than probed
 * for widgets.json.
 */
import type { BackendConfig } from "../types";

export const ARTS_CHARTS_KIND = "arts-charts";
/** Gateway: the public door, Bearer token, sockets on tickets. Tailnet: the stack pair, no study socket (B4). */
export type ChartsDoor = "gateway" | "tailnet";

export const isArtsCharts = (b: Pick<BackendConfig, "kind">): boolean => b.kind === ARTS_CHARTS_KIND;

/** At most one is used (B3): the first in the list. The rest are reported, never deleted. */
export function artsChartsConnections(backends: BackendConfig[]): { active: BackendConfig | null; ignored: BackendConfig[] } {
  const all = backends.filter(isArtsCharts);
  return { active: all[0] ?? null, ignored: all.slice(1) };
}
