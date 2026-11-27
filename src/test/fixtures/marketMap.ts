// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { MarketMapOptions } from '../../lib/widgetData/chartRecipes/types';
import cap from './marketMapCap.json' with { type: 'json' };

export const capMap: MarketMapOptions = {
  kind: 'market-map', version: 1, mode: 'delivered-cap', universe: 'delivered-sample', session: 'latest',
  fields: { listing: 'listing', sector: 'sector', area: 'area', change: 'change', session: 'session' },
};
export const indexMap: MarketMapOptions = { ...capMap, mode: 'index-weight', universe: 'EXAMPLE.INDX' };

export function marketSession(session = '2026-11-13', prior_session = '2026-11-12') {
  const copy = structuredClone(cap);
  Object.assign(copy.chart_sources.receipts[0], { session, prior_session });
  for (const row of copy.rows) Object.assign(row, { session, prior_session });
  return copy;
}
