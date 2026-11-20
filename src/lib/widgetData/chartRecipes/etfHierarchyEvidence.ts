// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChartSourceAdapter, ChartSourceReceipt } from './chartSourceContracts';
import { isChartSourceArray, isChartSourceRecord } from './chartSourceShape';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';

const unsafeKeys = ['fund_conflict', 'basis_conflict', 'duplicate_conflict', 'classification_conflict',
  'negative_weight', 'excess_weight'] as const;
type Unsafe = typeof unsafeKeys[number];
type Diagnostic = Unsafe | 'exact_duplicate';
type Coverage = 'complete' | 'bounded' | 'partial' | 'sample' | 'unknown';
type Missing = { status: 'unknown' } | { status: 'verified'; reference: string; fraction: number };
type Common = ChartSourceReceipt & {
  kind: 'etf-hierarchy'; fund: string; snapshot: string; weight_basis: 'fund-assets-fraction'; holding_keys: string[];
  diagnostics: Diagnostic[]; unsafe: Record<Unsafe, boolean>;
};
export type EtfHierarchySource = Common & ({
  origin: 'eodhd-etf-holdings'; as_of: null; coverage: 'unknown'; coverage_reference: null;
  rounding_bound_fraction: null; rounding_reference: null; missing_mass: { status: 'unknown' };
} | {
  origin: 'acquired-snapshot'; as_of: string | null; coverage: Coverage; coverage_reference: string | null;
  rounding_bound_fraction: number | null; rounding_reference: string | null; missing_mass: Missing;
});

const receiptKeys = ['version', 'kind', 'origin', 'retrieved_at', 'raw_count', 'normalized_count', 'delivered_count',
  'diagnostics', 'unsafe', 'fund', 'snapshot', 'as_of', 'weight_basis', 'holding_keys', 'coverage', 'coverage_reference',
  'rounding_bound_fraction', 'rounding_reference', 'missing_mass'];
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  isChartSourceRecord(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const qualified = (v: unknown): v is string => qualifiedSymbol(v) && !/^\d+\.\d+(?:E[+-]?\d+)?$/.test(v);
const reference = (v: unknown): v is string => typeof v === 'string'
  && /^[A-Za-z][A-Za-z0-9._:/-]{0,255}$/.test(v)
  && !/^(?:na|none|null|unknown|unavailable|unspecified|missing|notavailable|notprovided)$/i.test(v.replace(/[^a-z0-9]/gi, ''));
const fraction = (v: unknown, max: number): v is number => typeof v === 'number' && v >= 0 && v <= max;
const stampKey = (v: string) => v.slice(0, 19) + (v.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');

function validMass(value: unknown): value is Missing {
  return (exact(value, ['status']) && value.status === 'unknown')
    || (exact(value, ['status', 'fraction', 'reference']) && value.status === 'verified'
      && reference(value.reference) && fraction(value.fraction, 1) && value.fraction > 0);
}

export function parseEtfHierarchySource(value: unknown): EtfHierarchySource | undefined {
  if (!exact(value, receiptKeys) || value.kind !== 'etf-hierarchy' || value.version !== 1
    || (value.origin !== 'eodhd-etf-holdings' && value.origin !== 'acquired-snapshot')
    || !qualified(value.fund) || !utcTimestamp(value.retrieved_at) || value.weight_basis !== 'fund-assets-fraction'
    || !count(value.raw_count) || !count(value.normalized_count) || !count(value.delivered_count) || !value.delivered_count
    || value.normalized_count !== value.delivered_count || value.raw_count < value.normalized_count
    || !isChartSourceArray(value.holding_keys) || value.holding_keys.length !== value.delivered_count
    || !value.holding_keys.every(qualified) || new Set(value.holding_keys).size !== value.delivered_count
    || !isChartSourceArray(value.diagnostics) || !exact(value.unsafe, unsafeKeys)) return;
  const { diagnostics, unsafe } = value;
  if (new Set(diagnostics).size !== diagnostics.length
    || diagnostics.some(d => d !== 'exact_duplicate' && !unsafeKeys.some(key => key === d))
    || unsafeKeys.some(key => unsafe[key] !== diagnostics.includes(key))
    || (!diagnostics.some(d => d !== 'excess_weight') && value.raw_count > value.normalized_count)
    || (diagnostics.includes('exact_duplicate') && value.raw_count === value.normalized_count)) return;
  if (value.as_of !== null && (!isoDate(value.as_of) || value.as_of > value.retrieved_at.slice(0, 10))) return;
  if (typeof value.snapshot !== 'string' || (value.snapshot !== value.as_of
    && (!utcTimestamp(value.snapshot) || stampKey(value.snapshot) !== stampKey(value.retrieved_at)))) return;
  if (!['complete', 'bounded', 'partial', 'sample', 'unknown'].some(scope => scope === value.coverage)
    || (value.coverage === 'unknown' ? value.coverage_reference !== null : !reference(value.coverage_reference))
    || (value.rounding_bound_fraction === null ? value.rounding_reference !== null
      : !fraction(value.rounding_bound_fraction, .0001) || !reference(value.rounding_reference))
    || !validMass(value.missing_mass) || (value.missing_mass.status === 'verified'
      && (value.coverage === 'complete' || value.coverage === 'unknown'))) return;
  if (value.origin === 'eodhd-etf-holdings' && (!value.fund.endsWith('.US') || value.as_of !== null
    || value.coverage !== 'unknown' || value.rounding_bound_fraction !== null || value.missing_mass.status !== 'unknown')) return;
  return value as EtfHierarchySource;
}

// Accept the canonical acquired columns and descriptive fields. An unrelated feed or a contradictory
// semantic field in a wide table must be explicitly prepared as a holdings snapshot first.
const rowKeys = new Set(['symbol', 'fund_symbol', 'snapshot', 'weight', 'sector', 'weight_basis', 'weight_unit',
  'name', 'description', 'industry', 'country', 'region', 'as_of', 'holdings_coverage', 'etf_kind', 'unit', 'basis']);
function rowsAgree(source: EtfHierarchySource, rows: readonly Record<string, unknown>[], scope: unknown): boolean {
  if ((scope !== undefined && scope !== 'unknown' && scope !== source.coverage) || rows.length !== source.delivered_count) return false;
  const remaining = new Set(source.holding_keys);
  let sum = 0;
  let correction = 0;
  for (const row of rows) {
    if (!isChartSourceRecord(row) || Object.keys(row).some(k => !rowKeys.has(k)) || row.fund_symbol !== source.fund || row.snapshot !== source.snapshot
      || typeof row.symbol !== 'string' || !remaining.delete(row.symbol)
      || (row.sector !== null && (typeof row.sector !== 'string' || !row.sector.trim() || row.sector.trim() !== row.sector))
      || row.weight_basis !== 'fund-assets' || row.weight_unit !== 'fraction'
      || typeof row.weight !== 'number' || !Number.isFinite(row.weight) || row.weight < 0
      || (Object.hasOwn(row, 'etf_kind') && row.etf_kind !== 'holdings')
      || (Object.hasOwn(row, 'basis') && row.basis !== row.weight_basis)
      || (Object.hasOwn(row, 'unit') && row.unit !== row.weight_unit)
      || (Object.hasOwn(row, 'holdings_coverage') && row.holdings_coverage !== source.coverage)
      || (Object.hasOwn(row, 'as_of') && row.as_of !== source.as_of)
      || (source.as_of !== null && source.snapshot !== source.as_of && row.as_of !== source.as_of)) return false;
    // Every admission bound is at most 1.0001. A contribution of 2 proves excess
    // while keeping this check finite even across many extreme original weights.
    const add = Math.min(row.weight, 2) - correction;
    const next = sum + add;
    correction = (next - sum) - add;
    sum = next;
  }
  const bound = source.rounding_bound_fraction ?? 1e-12;
  if (sum > 1 + bound && !source.unsafe.excess_weight) return false;
  if (source.coverage === 'complete' && (sum < 1 - bound || sum > 1 + bound)) return false;
  if (source.missing_mass.status === 'verified') {
    const whole = sum + source.missing_mass.fraction;
    if (whole < 1 - bound || whole > 1 + bound) return false;
  }
  return true;
}

const fundKeys = new Set(['fund', 'fundsymbol', 'fundticker', 'etfsymbol', 'etfticker']);
const etfKeys = new Set([...fundKeys, 'etfkind', 'exposurekind', 'weightbasis', 'weightunit', 'holdingscoverage']);

function legacyReceiptAgrees(source: EtfHierarchySource, legacy: unknown): boolean {
  if (!isChartSourceRecord(legacy)) return false;
  const fields = Object.entries(legacy).map(([key, value]) => [key.replace(/_/g, '').toLowerCase(), value] as const);
  // An independent price receipt may also have a unit, observation date and retrieval time.
  if (!fields.some(([key, value]) => etfKeys.has(key)
    || (key === 'basis' && (value === 'equity-exposure' || value === 'fund-assets')))) return true;
  return fields.every(([key, value]) => {
    if (fundKeys.has(key) || key === 'symbol' || key === 'ticker') return value === source.fund;
    switch (key) {
      case 'etfkind': case 'exposurekind': return value === 'holdings';
      case 'basis': case 'weightbasis': return value === 'fund-assets';
      case 'unit': case 'weightunit': return value === 'fraction' || value === 'fractional' || value === 'ratio';
      case 'holdingscoverage': return value === source.coverage;
      case 'asof': return value === source.as_of;
      case 'retrievedat': return utcTimestamp(value) && stampKey(value) === stampKey(source.retrieved_at);
      case 'currency': return true; // Currency denomination does not determine the unit of a weight.
      default: return false;
    }
  });
}

function matches(source: EtfHierarchySource, params: Readonly<Record<string, string>>, mirror: boolean): boolean {
  if (source.origin !== 'eodhd-etf-holdings' || (params.provider ?? (mirror ? 'eodhd' : undefined)) !== 'eodhd'
    || (params.exchange ?? 'US').toUpperCase() !== 'US') return false;
  const symbol = params.symbol?.trim().toUpperCase();
  return !!symbol && (symbol.includes('.') ? symbol : symbol + '.US') === source.fund;
}

const parameters = ['symbol', 'provider', 'exchange'] as const;
export const etfHierarchyAdapter: ChartSourceAdapter<EtfHierarchySource> = {
  kind: 'etf-hierarchy', decode: parseEtfHierarchySource, allowsLocal: source => source.origin === 'acquired-snapshot',
  rowsAgree, legacyReceiptAgrees, routes: [
    { endpoint: '/api/v1/etf/holdings', selector: 'results', parameters, matches: (s, p) => matches(s, p, false) },
    { endpoint: '/api/v1/eodhd/etf/holdings', selector: 'results', parameters, matches: (s, p) => matches(s, p, true) },
  ],
  coordinates: source => [{ fields: ['fund_symbol', 'snapshot', 'symbol'],
    points: source.holding_keys.map(id => ({ id, values: [source.fund, source.snapshot, id] })) }],
};
