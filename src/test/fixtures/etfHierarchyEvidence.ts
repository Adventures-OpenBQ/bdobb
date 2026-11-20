// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
export const stamp = '2026-11-20T04:16:45Z';
export const live = {
  version: 1, kind: 'etf-hierarchy', origin: 'eodhd-etf-holdings', fund: 'VTI.US',
  snapshot: stamp, retrieved_at: stamp, as_of: null, weight_basis: 'fund-assets-fraction', coverage: 'unknown',
  coverage_reference: null, rounding_bound_fraction: null, rounding_reference: null, missing_mass: { status: 'unknown' },
  raw_count: 2, normalized_count: 2, delivered_count: 2, holding_keys: ['AAPL.US', 'AAYA.F'],
  diagnostics: [], unsafe: { fund_conflict: false, basis_conflict: false, duplicate_conflict: false,
    classification_conflict: false, negative_weight: false, excess_weight: false },
};
export const rows = [
  { symbol: 'AAPL.US', fund_symbol: 'VTI.US', snapshot: stamp, sector: 'Technology', weight: .069985,
    weight_basis: 'fund-assets', weight_unit: 'fraction', name: 'keep this' },
  { symbol: 'AAYA.F', fund_symbol: 'VTI.US', snapshot: stamp, sector: null, weight: .002345,
    weight_basis: 'fund-assets', weight_unit: 'fraction', name: 'filter out' },
];
export const local = { ...live, origin: 'acquired-snapshot', coverage: 'partial', coverage_reference: 'issuer:holdings' };
export const context = { endpoint: '/api/v1/eodhd/etf/holdings', selector: 'results', retrievedAt: 1,
  parameters: { symbol: 'vti', chart_source: 'true' } };
export const rawUnsafe = { ...live, raw_count: 5, diagnostics: Object.keys(live.unsafe),
  unsafe: Object.fromEntries(Object.keys(live.unsafe).map(key => [key, true])) };

export const extremeRows = [
  ...Array.from({ length: 106 }, (_, i) => ({ ...rows[1], symbol: 'EXT' + i + '.US', weight: 1.7e306 })),
  rows[0],
];
export const extremeSource = { ...live, raw_count: 107, normalized_count: 107, delivered_count: 107,
  holding_keys: extremeRows.map(row => row.symbol), diagnostics: ['excess_weight'],
  unsafe: { ...live.unsafe, excess_weight: true } };
