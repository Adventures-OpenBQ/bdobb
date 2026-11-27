// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Prepared local observations. These are independent acquisitions of the same reporting period.
export const firstEps = {
  observation_id: 'first-report', vintage: '2026-11-02T13:00:00Z', origin: 'eps_ttm',
  unit: { kind: 'money-per-share', currency: 'USD' }, as_of: null, as_of_unknown: true,
  period_start: '2025-10-01', period_end: '2026-09-30', period_kind: 'TTM',
  adjustment_basis: 'diluted-as-reported', reporting_basis: 'US-GAAP', basis_reference: 'ordinary-2024',
};
export const revisedEps = { ...firstEps, observation_id: 'revised-report', vintage: '2026-11-12T13:00:00Z' };
export const metricReceipt = {
  version: 1, kind: 'metric', origin: 'acquired-snapshot', retrieved_at: '2026-11-20T04:16:46Z',
  issuer: 'EXAMPLE.US', listing: 'EXMPL.NYSE', share_class: 'Ordinary-A',
  raw_count: 2, normalized_count: 2, delivered_count: 2, diagnostics: [] as string[],
  unsafe: { identity_conflict: false, unit_conflict: false, period_conflict: false, basis_conflict: false, duplicate_conflict: false },
  metrics: { eps_ttm: { ...firstEps, additional_observations: [revisedEps] } },
};
export const metricRows = [revisedEps, firstEps].map((obs, index) => ({
  issuer: 'EXAMPLE.US', listing: 'EXMPL.NYSE', share_class: 'Ordinary-A', metric: 'eps_ttm',
  observation_id: obs.observation_id, vintage: obs.vintage, as_of: null,
  period_start: obs.period_start, period_end: obs.period_end, period_kind: 'TTM',
  unit_kind: 'money-per-share', currency: 'USD', adjustment_basis: 'diluted-as-reported',
  reporting_basis: 'US-GAAP', basis_reference: 'ordinary-2024', eps_ttm: index ? 76.544 : 0,
}));
export const liveMetricVintage = '2026-11-20T04:16:46Z';
function headline(name: string, kind: string) {
  return { origin: name, unit: { kind }, observation_id: name + ':' + liveMetricVintage, vintage: liveMetricVintage,
    as_of: null, as_of_unknown: true, period_start: null, period_end: null, period_kind: 'TTM',
    reporting_basis: null, adjustment_basis: null, basis_reference: null, additional_observations: [] };
}
export const liveMetricReceipt = { ...metricReceipt, origin: 'eodhd-key-metrics', issuer: 'AAPL.US', listing: 'AAPL.US',
  share_class: null, raw_count: 1, normalized_count: 1, delivered_count: 1,
  metrics: { dividend_yield: headline('dividend_yield', 'fraction'), pe_ratio: headline('pe_ratio', 'multiple') } };
export const liveMetricRows = [{ symbol: 'AAPL.US', metric_vintage: liveMetricVintage,
  dividend_yield: 0.003, pe_ratio: 39.2483, currency: 'USD', period_ending: '2026-09-30' }];
