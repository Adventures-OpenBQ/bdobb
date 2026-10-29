// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one door into Art's Charts (spec B2). Everything that imports the BUSL package lives
 * behind this import(): under VITE_ARTS_CHARTS=0 the condition is the literal `false`, the
 * import is dead code, and Rollup never adds ./runtime (or anything it imports) to the graph.
 */
export type ArtsChartsRuntime = typeof import("./runtime");

export function loadArtsCharts(): Promise<ArtsChartsRuntime | null> {
  return __ARTS_CHARTS__ ? import("./runtime") : Promise.resolve(null);
}
