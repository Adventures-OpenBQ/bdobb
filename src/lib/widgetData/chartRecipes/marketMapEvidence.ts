// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChartSourceAdapter, ChartSourceReceipt } from './chartSourceContracts';
import { isChartSourceArray, isChartSourceRecord } from './chartSourceShape';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';
import { sumMarketMapAreas } from './marketMapAreaSum';
import { isChartCurrency, metricVintageKey } from './metricEvidence';
import { isOverlayReference as reference } from './overlayEvidence';

const flags = ['identity_conflict', 'session_conflict', 'denomination_conflict', 'membership_conflict',
  'duplicate_conflict', 'excess_weight'] as const;
type Flag = typeof flags[number];
type Cap = {
  mode: 'delivered-cap'; universe: 'delivered-sample'; area_basis: 'listing-currency-cap'; denomination: string;
  cap_retrieved_at: string; membership_as_of: null; weight_valid_for: null; weight_reference: null; members: null;
  coverage: 'sample'; rounding_bound_fraction: null; rounding_reference: null;
};
type Index = {
  mode: 'index-weight'; universe: string; area_basis: 'index-weight-fraction'; denomination: null; cap_retrieved_at: null;
  membership_as_of: string; weight_valid_for: string; weight_reference: string; members: string[];
  coverage: 'complete' | 'bounded' | 'partial'; rounding_bound_fraction: number | null; rounding_reference: string | null;
};
export type MarketMapSource = ChartSourceReceipt & (Cap | Index) & {
  kind: 'market-map'; origin: 'acquired-snapshot'; acquisition_ref: string; session: string; prior_session: string;
  return_basis: 'completed-close-to-close-fraction'; price_basis: 'split-adjusted-price' | 'as-traded-price';
  session_ref: string; area_ref: string; coverage_reference: string; listing_keys: string[]; exact_repeats: number;
  rejected_count: number; excluded_areas: { zero: number; negative: number; invalid: number }; diagnostics: Flag[]; unsafe: Record<Flag, boolean>;
};
const identityFields = ['universe', 'acquisition_ref', 'prior_session', 'session', 'return_basis', 'price_basis', 'session_ref',
  'area_basis', 'area_ref', 'denomination', 'cap_retrieved_at', 'membership_as_of', 'weight_valid_for', 'weight_reference'] as const;
const keys = ['version', 'kind', 'origin', 'retrieved_at', 'mode', ...identityFields, 'members', 'coverage', 'coverage_reference',
  'rounding_bound_fraction', 'rounding_reference', 'listing_keys', 'raw_count', 'normalized_count', 'delivered_count', 'exact_repeats',
  'rejected_count', 'excluded_areas', 'diagnostics', 'unsafe'];
const rowKeys = ['listing', 'sector', 'area', 'change', ...identityFields];
const exact = (v: unknown, fields: readonly string[]): v is Record<string, unknown> => isChartSourceRecord(v)
  && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const listing = (v: unknown): v is string => qualifiedSymbol(v) && !/^\d+\.\d+(?:E[+-]?\d+)?$/.test(v);
const listings = (v: unknown): v is string[] => isChartSourceArray(v) && v.every(listing) && new Set(v).size === v.length;
const sameInstant = (a: unknown, b: string) => utcTimestamp(a) && metricVintageKey(a) === metricVintageKey(b);

function validCounts(v: Record<string, unknown>) {
  if (!count(v.raw_count) || !count(v.delivered_count) || v.normalized_count !== v.delivered_count || !count(v.exact_repeats)
    || !count(v.rejected_count) || !listings(v.listing_keys) || v.listing_keys.length !== v.delivered_count
    || !exact(v.excluded_areas, ['zero', 'negative', 'invalid']) || !isChartSourceArray(v.diagnostics) || !exact(v.unsafe, flags)) return false;
  const { zero, negative, invalid } = v.excluded_areas;
  const { diagnostics, unsafe } = v;
  return count(zero) && count(negative) && count(invalid)
    && v.raw_count === v.delivered_count + v.rejected_count + v.exact_repeats + zero + negative + invalid
    && (!v.exact_repeats || v.exact_repeats + v.rejected_count < v.raw_count) && new Set(diagnostics).size === diagnostics.length
    && (!unsafe.duplicate_conflict || v.raw_count >= 2)
    && (!unsafe.excess_weight || v.delivered_count > 0 || v.rejected_count > 0 || invalid > 0)
    && diagnostics.every(d => flags.some(k => k === d)) && flags.every(k => unsafe[k] === diagnostics.includes(k))
    && (!v.rejected_count || diagnostics.some(d => d !== 'excess_weight'))
    && (v.rejected_count > 0 || diagnostics.every(d => d === 'membership_conflict' || d === 'excess_weight'));
}

export function parseMarketMapSource(value: unknown): MarketMapSource | undefined {
  if (!exact(value, keys) || value.kind !== 'market-map' || value.version !== 1 || value.origin !== 'acquired-snapshot'
    || !utcTimestamp(value.retrieved_at) || !isoDate(value.session) || !isoDate(value.prior_session)
    || value.session > value.retrieved_at.slice(0, 10) || value.prior_session >= value.session
    || value.return_basis !== 'completed-close-to-close-fraction' || !['split-adjusted-price', 'as-traded-price'].some(v => v === value.price_basis)
    || ![value.session_ref, value.area_ref, value.acquisition_ref, value.coverage_reference].every(reference) || !validCounts(value)) return;
  const s = value as MarketMapSource;
  if (s.mode === 'delivered-cap') {
    if (s.universe !== 'delivered-sample' || s.coverage !== 'sample' || s.area_basis !== 'listing-currency-cap'
      || !isChartCurrency(s.denomination) || !sameInstant(s.cap_retrieved_at, s.retrieved_at)
      || [s.membership_as_of, s.weight_valid_for, s.weight_reference, s.members, s.rounding_bound_fraction, s.rounding_reference].some(v => v !== null)
      || s.unsafe.excess_weight || (s.unsafe.membership_conflict && !s.rejected_count)) return;
  } else if (s.mode === 'index-weight') {
    if (!reference(s.universe) || s.universe === 'delivered-sample' || s.area_basis !== 'index-weight-fraction'
      || s.denomination !== null || s.cap_retrieved_at !== null || !isoDate(s.membership_as_of) || s.membership_as_of > s.session
      || s.weight_valid_for !== s.session || !reference(s.weight_reference) || !['complete', 'partial', 'bounded'].includes(s.coverage)
      || !listings(s.members) || !s.members.length || (s.rounding_bound_fraction === null ? s.rounding_reference !== null
        : !finite(s.rounding_bound_fraction) || s.rounding_bound_fraction < 0 || s.rounding_bound_fraction > .0001 || !reference(s.rounding_reference))) return;
    const members = new Set(s.members);
    if (!s.listing_keys.every(k => members.has(k)) || (s.coverage !== 'complete' && s.unsafe.membership_conflict && !s.rejected_count)
      || (s.coverage === 'complete' && members.size !== s.delivered_count && !s.unsafe.membership_conflict)) return;
  } else return;
  return s;
}

function rowsAgree(s: MarketMapSource, rows: readonly Record<string, unknown>[], scope: unknown): boolean {
  if (scope !== s.coverage || rows.length !== s.delivered_count) return false;
  const remaining = new Set(s.listing_keys);
  const weights: number[] = [];
  for (const row of rows) {
    if (!exact(row, rowKeys) || !listing(row.listing) || !remaining.delete(row.listing)
      || !identityFields.every(k => row[k] === s[k])
      || (row.sector !== null && (typeof row.sector !== 'string' || !row.sector || row.sector.trim() !== row.sector))
      || !finite(row.area) || row.area <= 0 || (row.change !== null && (!finite(row.change) || row.change < -1))) return false;
    // A contribution of two already proves excess. Preserve the original value in the row.
    if (s.mode === 'index-weight') weights.push(Math.min(2, row.area));
  }
  if (s.mode === 'delivered-cap') return true;
  const sum = sumMarketMapAreas(weights);
  const bound = s.rounding_bound_fraction ?? 1e-12;
  return (sum <= 1 + bound || s.unsafe.excess_weight)
    && (s.coverage !== 'complete' || sum >= 1 - bound || s.unsafe.membership_conflict);
}

export const marketMapAdapter: ChartSourceAdapter<MarketMapSource> = {
  kind: 'market-map', decode: parseMarketMapSource, allowsLocal: s => s.origin === 'acquired-snapshot', routes: [], rowsAgree,
  coordinates: s => [{ fields: ['universe', 'session', 'listing'], points: s.listing_keys.map(id => ({ id, values: [s.universe, s.session, id] })) }],
  legacyReceiptAgrees: (s, legacy) => isChartSourceRecord(legacy) && Object.entries(legacy).every(([k, v]) => {
    switch (k) {
      case 'currency': return v === s.denomination;
      case 'unit': return v === (s.mode === 'delivered-cap' ? 'money' : 'fraction');
      case 'date': return v === s.session;
      case 'retrieved_at': return sameInstant(v, s.retrieved_at);
      default: return false;
    }
  }),
};
