// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChartSourceAdapter, ChartSourceReceipt } from './chartSourceContracts';
import { isChartSourceArray, isChartSourceRecord } from './chartSourceShape';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';
import { isChartCurrency, metricVintageKey as stampKey } from './metricEvidence';

const definitions = {
  'price-eps': {
    left: { id: 'adjusted_close', unit: 'money-per-share', basis: 'splits-and-dividends-adjusted-close',
      coordinate: 'observation-date', period_kind: null, contract: 'eodhd-eod-adjusted-close' },
    right: { id: 'reported_diluted_eps', unit: 'money-per-share', basis: 'current-split-adjusted-diluted-fq',
      coordinate: 'availability-date', period_kind: 'FQ', contract: 'issuer-reported-diluted-fq-eps' },
  },
  'cpi-ten-year': {
    left: { id: 'CUSR0000SA0', unit: 'index', basis: 'monthly-sa-us-cpi-u-all-items-1982-84=100',
      coordinate: 'observation-date', period_kind: null, contract: 'BLS:CUSR0000SA0/FRED:CPIAUCSL' },
    right: { id: 'DGS10', unit: 'yield-fraction', basis: 'daily-nominal-us-ten-year-constant-maturity',
      coordinate: 'observation-date', period_kind: null, contract: 'Fed:H15/FRED:DGS10' },
  },
} as const;
type Recipe = keyof typeof definitions;
const sides = ['left', 'right'] as const;
type Side = typeof sides[number];
type Definition = typeof definitions[Recipe][Side];
export type OverlaySeriesFact = Omit<Definition, 'contract'> & { currency: string | null; restated: boolean };
const flags = ['identity_conflict', 'unit_conflict', 'coordinate_conflict', 'basis_conflict', 'untraced_omission'] as const;
type Flag = typeof flags[number];
export type OverlaySource = ChartSourceReceipt & {
  kind: 'overlay'; recipe: Recipe; origin: 'acquired-snapshot';
  series: Record<Side, OverlaySeriesFact>; identity: { issuer: string; listing: string; share_basis_ref: string } | null;
  preparation: { input_refs: [string, string]; reference: string };
  vintages: Record<Side, string>; coordinates: Record<Side, string[]>;
  unsafe: Record<Flag, boolean>; diagnostics: Flag[];
};

const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  isChartSourceRecord(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const isOverlayReference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9._:/-]{0,255}$/.test(v)
  && !/^(?:na|unknown|none|null|missing|unspecified|unavailable|notprovided|notavailable)$/i.test(v.replace(/[^a-z0-9]/gi, ''));
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Date precision is semantic. Normalize only equivalent spellings of the same UTC instant for comparison.
export const overlayCoordinateKey = (v: string) => v.length === 10 ? v : stampKey(v);
export const overlayCoordinateByVintage = (v: unknown, vintage: string, allowTime: boolean): v is string =>
  isoDate(v) ? v <= vintage.slice(0, 10) : allowTime && utcTimestamp(v) && stampKey(v) <= stampKey(vintage);

const sourceKeys = ['version', 'kind', 'origin', 'recipe', 'retrieved_at', 'raw_count', 'normalized_count', 'delivered_count',
  'diagnostics', 'unsafe', 'identity', 'preparation', 'vintages', 'series', 'coordinates'];
const seriesKeys = ['id', 'unit', 'currency', 'basis', 'coordinate', 'period_kind', 'restated'];

export function parseOverlaySource(value: unknown): OverlaySource | undefined {
  if (!exact(value, sourceKeys) || value.version !== 1 || value.kind !== 'overlay' || value.origin !== 'acquired-snapshot'
    || (value.recipe !== 'price-eps' && value.recipe !== 'cpi-ten-year') || !utcTimestamp(value.retrieved_at)
    || !count(value.raw_count) || !count(value.delivered_count) || value.normalized_count !== value.delivered_count
    || value.raw_count < value.delivered_count || !isChartSourceArray(value.diagnostics) || !exact(value.unsafe, flags)
    || !exact(value.series, sides) || !exact(value.vintages, sides) || !exact(value.coordinates, sides)
    || !exact(value.preparation, ['input_refs', 'reference'])) return;
  const { diagnostics, unsafe, preparation, identity, recipe } = value;
  if (new Set(diagnostics).size !== diagnostics.length || diagnostics.some(d => !flags.some(k => k === d))
    || flags.some(k => unsafe[k] !== diagnostics.includes(k))
    || (value.raw_count > value.delivered_count) !== !!diagnostics.length
    || !isOverlayReference(preparation.reference) || !isChartSourceArray(preparation.input_refs)
    || preparation.input_refs.length !== 2 || !preparation.input_refs.every(isOverlayReference)
    || new Set([...preparation.input_refs, preparation.reference]).size !== 3) return;
  if (recipe === 'price-eps' ? !exact(identity, ['issuer', 'listing', 'share_basis_ref'])
    || !isOverlayReference(identity.issuer) || !isOverlayReference(identity.share_basis_ref) || !qualifiedSymbol(identity.listing)
    || /^\d+\.\d+(?:E[+-]?\d+)?$/.test(identity.listing) : identity !== null) return;
  let n = 0;
  for (const side of sides) {
    const s = value.series[side], def = definitions[recipe][side], vintage = value.vintages[side], points = value.coordinates[side];
    if (!exact(s, seriesKeys) || s.id !== def.id || s.unit !== def.unit || s.basis !== def.basis
      || s.coordinate !== def.coordinate || s.period_kind !== def.period_kind || typeof s.restated !== 'boolean'
      || (s.restated && s.id !== 'reported_diluted_eps') || (recipe === 'price-eps' ? !isChartCurrency(s.currency) : s.currency !== null)
      || !utcTimestamp(vintage) || stampKey(vintage) > stampKey(value.retrieved_at) || !isChartSourceArray(points) || !points.length
      || !points.every((c): c is string => overlayCoordinateByVintage(c, vintage, s.coordinate === 'availability-date')
        && (s.id !== 'CUSR0000SA0' || c.endsWith('-01'))) || new Set(points.map(overlayCoordinateKey)).size !== points.length) return;
    n += points.length;
  }
  if (n !== value.delivered_count || (value.series.left as OverlaySeriesFact).currency !== (value.series.right as OverlaySeriesFact).currency) return;
  return value as OverlaySource;
}

const rowKeys = ['series', 'date', 'value', 'source_value', 'unit', 'currency', 'basis', 'period_kind', 'restated', 'issuer',
  'listing', 'share_basis_ref', 'source_contract', 'input_ref', 'input_vintage', 'available_at', 'release_ref', 'session_timing',
  'target_start', 'target_end'];

function valueAgrees(id: string, raw: unknown, value: unknown) {
  if (raw === null) return value === null;
  if (!finite(raw) || !finite(value)) return false;
  if (id === 'DGS10') {
    // A file may have converted percent using decimal or binary arithmetic.
    const [mantissa, exponent] = raw.toExponential().split('e');
    const decimalFraction = Number(mantissa + 'e' + (Number(exponent) - 2));
    return (value === raw / 100 || value === decimalFraction) && (raw === 0 || value !== 0);
  }
  return value === raw && ((id !== 'CUSR0000SA0' && id !== 'adjusted_close') || value > 0);
}

export function isSupportedOverlayQuarter(start: string, end: string): boolean {
  const first = new Date(start), exclusiveEnd = Date.parse(end) + 86_400_000;
  const days = (exclusiveEnd - first.getTime()) / 86_400_000;
  if (days === 13 * 7 || days === 14 * 7) return true;
  // Day zero of the fourth following month is the last day of the anniversary month.
  const anniversary = new Date(first);
  anniversary.setUTCMonth(first.getUTCMonth() + 4, 0);
  anniversary.setUTCDate(Math.min(first.getUTCDate(), anniversary.getUTCDate()));
  return exclusiveEnd === anniversary.getTime();
}

/** Source-owned declarations can be cross-checked wherever their physical fields remain visible. */
export const overlayBindingOrigins = {
  series: 'series', date: 'date', value: 'value', availableAt: 'available_at',
  targetStart: 'target_start', targetEnd: 'target_end',
} as const;

export const overlaySourceIssue = 'Acquire an explicitly prepared overlay snapshot with verified pair, series and availability evidence.';
export const overlayPairIssue = 'Choose the recipe certified by this prepared snapshot or relink the appropriate source.';

export function overlayRowFacts(source: OverlaySource, side: Side) {
  const series = source.series[side];
  return {
    source_contract: definitions[source.recipe][side].contract,
    input_ref: source.preparation.input_refs[side === 'left' ? 0 : 1], input_vintage: source.vintages[side],
    issuer: source.identity?.issuer ?? null, listing: source.identity?.listing ?? null,
    share_basis_ref: source.identity?.share_basis_ref ?? null, unit: series.unit, basis: series.basis,
    currency: series.currency, period_kind: series.period_kind, restated: series.restated,
  };
}

function rowsAgree(source: OverlaySource, rows: readonly Record<string, unknown>[]): boolean {
  if (rows.length !== source.delivered_count) return false;
  const remaining = { left: new Set(source.coordinates.left), right: new Set(source.coordinates.right) };
  const fiscalEnds = new Set<string>();
  const expectedFacts = { left: Object.entries(overlayRowFacts(source, 'left')), right: Object.entries(overlayRowFacts(source, 'right')) };
  for (const row of rows) {
    if (!exact(row, rowKeys)) return false;
    const side = row.series === source.series.left.id ? 'left' : row.series === source.series.right.id ? 'right' : undefined;
    if (!side) return false;
    const s = source.series[side], vintage = source.vintages[side], eps = s.coordinate === 'availability-date';
    if (expectedFacts[side].some(([field, expected]) => row[field] !== expected)
      || !valueAgrees(s.id, row.source_value, row.value) || !overlayCoordinateByVintage(row.date, vintage, false)) return false;
    const at = row.available_at;
    if (at === null ? row.release_ref !== null :
      !overlayCoordinateByVintage(at, vintage, true) || !isOverlayReference(row.release_ref) || at.slice(0, 10) < row.date) return false;
    if (s.id === 'CUSR0000SA0') {
      const month = row.date.slice(0, 7);
      if (!row.date.endsWith('-01') || (row.value !== null && vintage.slice(0, 7) <= month)
        || (typeof at === 'string' && at.slice(0, 7) <= month)) return false;
    }
    if (eps) {
      if (typeof at !== 'string' || !isoDate(row.target_start) || row.target_end !== row.date || !isSupportedOverlayQuarter(row.target_start, row.date)
        || fiscalEnds.has(row.date) || ![null, 'before-market', 'during-market', 'after-market'].some(v => v === row.session_timing)) return false;
      fiscalEnds.add(row.date);
    } else if (row.target_start !== null || row.target_end !== null || row.session_timing !== null) return false;
    const coordinate = eps ? at : row.date;
    if (typeof coordinate !== 'string' || !remaining[side].delete(coordinate)) return false;
  }
  return true;
}

export const overlayAdapter: ChartSourceAdapter<OverlaySource> = {
  kind: 'overlay', decode: parseOverlaySource, allowsLocal: s => s.origin === 'acquired-snapshot', routes: [], rowsAgree,
  legacyReceiptAgrees: (s, legacy) => isChartSourceRecord(legacy) && Object.entries(legacy).every(([k, v]) => {
    switch (k) {
      case 'symbol': return v === s.identity?.listing;
      case 'currency': return s.recipe === 'price-eps' && v === s.series.left.currency;
      case 'unit': return s.series.left.unit === s.series.right.unit && v === s.series.left.unit;
      case 'retrieved_at': return utcTimestamp(v) && stampKey(v) === stampKey(s.retrieved_at);
      default: return false;
    }
  }),
  coordinates: s => sides.map(side => {
    const { id, coordinate } = s.series[side];
    return { fields: ['series', coordinate === 'availability-date' ? 'available_at' : 'date'],
      points: s.coordinates[side].map(c => ({ id: id + '|' + c, values: [id, c] })) };
  }),
};
