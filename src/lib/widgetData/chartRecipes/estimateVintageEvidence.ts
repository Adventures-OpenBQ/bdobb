// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChartSourceAdapter, ChartSourceReceipt } from './chartSourceContracts';
import { isChartSourceArray, isChartSourceRecord } from './chartSourceShape';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';
import { isChartCurrency, metricVintageKey } from './metricEvidence';
import { isOverlayReference as reference, isSupportedOverlayQuarter } from './overlayEvidence';

export const estimateVintageSourceIssue = 'Load a verified local history of independently recorded consensus snapshots. Fiscal target dates and live estimate rows do not establish vintages.';

const flags = ['identity_conflict', 'vintage_conflict', 'target_conflict', 'unit_conflict', 'duplicate_conflict'] as const;
type Flag = typeof flags[number];
type Target = { start: string; end: string; kind: 'FQ' | 'FY' };
type Vintage = { id: string; observed_at: string; batch: string };
type BatchInput = { batch: string; reference: string; universe_id: string | null; members: string[] | null };
type Issuer = { issuer: string; entity_ref: string; currency: string; unit: 'money' | 'money-per-share';
  basis: 'current-split-adjusted-share' | 'currency-units'; basis_ref: string | null };
type Coordinate = { issuer: string; vintage: string };
type Universe = { status: 'unknown' } | { status: 'complete'; id: string; members: string[]; baseline_batch: string; current_batch: string };
export type EstimateVintageSource = ChartSourceReceipt & {
  kind: 'estimate-vintages'; origin: 'acquired-snapshot'; metric: 'eps' | 'revenue'; target: Target;
  vintages: Vintage[]; issuers: Issuer[]; inputs: BatchInput[]; universe: Universe; coordinates: Coordinate[];
  exact_repeats: number; diagnostics: Flag[]; unsafe: Record<Flag, boolean>;
};
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  isChartSourceRecord(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const listing = (v: unknown): v is string => qualifiedSymbol(v) && !/^\d+\.\d+(?:E[+-]?\d+)?$/.test(v);

function validTarget(v: unknown): v is Target {
  if (!exact(v, ['start', 'end', 'kind']) || !isoDate(v.start) || !isoDate(v.end)) return false;
  if (v.kind === 'FQ') return isSupportedOverlayQuarter(v.start, v.end);
  if (v.kind !== 'FY') return false;
  const start = new Date(v.start), exclusiveEnd = Date.parse(v.end) + 86_400_000;
  const days = (exclusiveEnd - start.getTime()) / 86_400_000;
  const anniversary = new Date(start);
  anniversary.setUTCFullYear(start.getUTCFullYear() + 1, start.getUTCMonth() + 1, 0);
  anniversary.setUTCDate(Math.min(start.getUTCDate(), anniversary.getUTCDate()));
  return days === 364 || days === 371 || anniversary.getTime() === exclusiveEnd;
}

function validIssuer(v: unknown, eps: boolean): v is Issuer {
  return exact(v, ['issuer', 'entity_ref', 'unit', 'currency', 'basis', 'basis_ref'])
    && listing(v.issuer) && reference(v.entity_ref) && isChartCurrency(v.currency)
    && (eps ? v.unit === 'money-per-share' && v.basis === 'current-split-adjusted-share' && reference(v.basis_ref)
      : v.unit === 'money' && v.basis === 'currency-units' && v.basis_ref === null);
}

function validVintage(v: unknown, retrieval: string): v is Vintage {
  return exact(v, ['id', 'observed_at', 'batch']) && reference(v.id) && reference(v.batch) && utcTimestamp(v.observed_at)
    && metricVintageKey(v.observed_at) <= metricVintageKey(retrieval);
}

function sameMembers(values: unknown, members: Set<string>): boolean {
  return isChartSourceArray(values) && values.length === members.size && new Set(values).size === members.size
    && values.every(v => typeof v === 'string' && members.has(v));
}

function validScope(universe: unknown, inputs: unknown, issuers: Issuer[], vintages: Vintage[]): boolean {
  const batches = new Map(vintages.map(v => [v.batch, metricVintageKey(v.observed_at)]));
  const members = new Set(issuers.map(i => i.issuer));
  if (!isChartSourceRecord(universe) || !isChartSourceArray(inputs) || inputs.length !== batches.size) return false;
  const complete = universe.status === 'complete';
  if (complete) {
    if (!exact(universe, ['status', 'id', 'members', 'baseline_batch', 'current_batch']) || !reference(universe.id)
      || !sameMembers(universe.members, members) || !reference(universe.baseline_batch) || !reference(universe.current_batch)) return false;
    const baseline = batches.get(universe.baseline_batch), current = batches.get(universe.current_batch);
    if (!baseline || !current || baseline >= current) return false;
  } else if (!exact(universe, ['status']) || universe.status !== 'unknown') return false;
  const refs = new Set<string>();
  return inputs.every(i => {
    if (!exact(i, ['batch', 'reference', 'universe_id', 'members']) || !reference(i.batch) || !batches.delete(i.batch)
      || !reference(i.reference) || refs.has(i.reference)) return false;
    refs.add(i.reference);
    return complete ? i.universe_id === universe.id && sameMembers(i.members, members) : i.universe_id === null && i.members === null;
  });
}

const keys = ['version', 'kind', 'origin', 'retrieved_at', 'metric', 'target', 'vintages', 'inputs', 'issuers', 'universe',
  'coordinates', 'raw_count', 'normalized_count', 'delivered_count', 'exact_repeats', 'diagnostics', 'unsafe'];
export function parseEstimateVintageSource(value: unknown): EstimateVintageSource | undefined {
  if (!exact(value, keys) || value.version !== 1 || value.kind !== 'estimate-vintages' || value.origin !== 'acquired-snapshot'
    || !utcTimestamp(value.retrieved_at) || !validTarget(value.target) || (value.metric !== 'eps' && value.metric !== 'revenue')
    || !count(value.raw_count) || !count(value.delivered_count) || value.normalized_count !== value.delivered_count
    || !count(value.exact_repeats) || !isChartSourceArray(value.coordinates) || value.delivered_count !== value.coordinates.length
    || !isChartSourceArray(value.diagnostics) || !exact(value.unsafe, flags)) return;
  const { vintages, issuers, retrieved_at, diagnostics, unsafe, coordinates, exact_repeats } = value;
  const rejected = value.raw_count - exact_repeats - value.delivered_count;
  if (rejected < 0 || (rejected > 0) !== !!diagnostics.length || (exact_repeats && !coordinates.length)
    || new Set(diagnostics).size !== diagnostics.length || diagnostics.some(d => !flags.some(k => k === d))
    || flags.some(k => unsafe[k] !== diagnostics.includes(k))) return;
  if (!isChartSourceArray(vintages) || vintages.length < 2 || !vintages.every((v): v is Vintage => validVintage(v, retrieved_at))
    || !unique(vintages.map(v => v.id)) || !unique(vintages.map(v => v.batch)) || !unique(vintages.map(v => metricVintageKey(v.observed_at)))
    || !isChartSourceArray(issuers) || !issuers.length || !issuers.every((i): i is Issuer => validIssuer(i, value.metric === 'eps'))
    || !unique(issuers.map(i => i.issuer)) || !unique(issuers.map(i => i.entity_ref)) || !validScope(value.universe, value.inputs, issuers, vintages)) return;
  const listings = new Set(issuers.map(i => i.issuer)), ids = new Set(vintages.map(v => v.id)), seen = new Set<string>();
  for (const c of coordinates) {
    if (!exact(c, ['issuer', 'vintage']) || !listing(c.issuer) || !listings.has(c.issuer) || !reference(c.vintage) || !ids.has(c.vintage)) return;
    const key = c.issuer + '|' + c.vintage;
    if (seen.has(key)) return;
    seen.add(key);
  }
  return value as EstimateVintageSource;
}

const rowKeys = ['issuer', 'entity_ref', 'currency', 'unit', 'basis', 'basis_ref', 'vintage', 'observed_at', 'batch', 'input_ref',
  'source_contract', 'metric', 'target_start', 'target_end', 'target_kind', 'value'];
function rowsAgree(s: EstimateVintageSource, rows: readonly Record<string, unknown>[], scope: unknown) {
  if (rows.length !== s.delivered_count || (s.universe.status === 'complete' && scope !== 'complete')) return false;
  const issuers = new Map(s.issuers.map(i => [i.issuer, i])), vintages = new Map(s.vintages.map(v => [v.id, v]));
  const inputs = new Map(s.inputs.map(i => [i.batch, i.reference])), remaining = new Set(s.coordinates.map(c => c.issuer + '|' + c.vintage));
  return rows.every(row => {
    if (!exact(row, rowKeys) || !listing(row.issuer) || !reference(row.vintage)) return false;
    const i = issuers.get(row.issuer), v = vintages.get(row.vintage);
    return !!i && !!v && row.entity_ref === i.entity_ref && row.currency === i.currency && row.unit === i.unit
      && row.basis === i.basis && row.basis_ref === i.basis_ref && row.observed_at === v.observed_at && row.batch === v.batch
      && row.input_ref === inputs.get(v.batch) && row.source_contract === 'independently-recorded-consensus-mean'
      && row.metric === s.metric && row.target_start === s.target.start && row.target_end === s.target.end && row.target_kind === s.target.kind
      && (row.value === null || (typeof row.value === 'number' && Number.isFinite(row.value))) && remaining.delete(row.issuer + '|' + row.vintage);
  });
}

export const estimateVintageAdapter: ChartSourceAdapter<EstimateVintageSource> = {
  kind: 'estimate-vintages', decode: parseEstimateVintageSource, allowsLocal: s => s.origin === 'acquired-snapshot', routes: [], rowsAgree,
  legacyReceiptAgrees: (s, legacy) => isChartSourceRecord(legacy) && Object.entries(legacy).every(([k, v]) => {
    switch (k) {
      case 'symbol': return s.issuers.every(i => i.issuer === v);
      case 'unit': return s.issuers.every(i => i.unit === v);
      case 'currency': return s.issuers.every(i => i.currency === v);
      case 'retrieved_at': return utcTimestamp(v) && metricVintageKey(v) === metricVintageKey(s.retrieved_at);
      default: return false;
    }
  }),
  coordinates: s => [{ fields: ['issuer', 'target_start', 'target_end', 'target_kind', 'vintage'], points: s.coordinates.map(c => {
    const values = [c.issuer, s.target.start, s.target.end, s.target.kind, c.vintage];
    return { id: values.join('|'), values };
  }) }],
};
