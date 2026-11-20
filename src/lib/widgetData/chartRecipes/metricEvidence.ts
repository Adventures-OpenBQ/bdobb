// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { ChartSourceAdapter, ChartSourceReceipt } from './chartSourceContracts';
import { isChartSourceArray, isChartSourceRecord } from './chartSourceShape';
import { isoDate, qualifiedSymbol, utcTimestamp } from './financialEvidence';

const contract = {
  price: ['money-per-share', 'as-traded', 'split-adjusted'],
  market_cap: ['money', 'issuer-all-classes'],
  dividend_yield: ['fraction', 'trailing-dividend-per-share'],
  pe_ratio: ['multiple', 'trailing-diluted-earnings'],
  eps_ttm: ['money-per-share', 'diluted-as-reported', 'diluted-split-adjusted'],
  revenue_ttm: ['money', 'as-reported'],
} as const;
export type MetricPreset = keyof typeof contract;
export type MetricUnit = { kind: 'money' | 'money-per-share'; currency: string } | { kind: 'count' | 'fraction' | 'multiple' };
export type MetricObservation = {
  observation_id: string; vintage: string; origin: MetricPreset; unit: MetricUnit; as_of: string | null;
  as_of_unknown: boolean; period_start: string | null; period_end: string | null; period_kind: 'FY' | 'FQ' | 'TTM' | null;
  adjustment_basis: string | null; reporting_basis: 'US-GAAP' | 'IFRS' | 'local-GAAP' | null; basis_reference: string | null;
};
const unsafeKeys = ['identity_conflict', 'unit_conflict', 'period_conflict', 'basis_conflict', 'duplicate_conflict'] as const;
type Diagnostic = typeof unsafeKeys[number];
type LiveOrigin = 'eodhd-key-metrics' | 'eodhd-financial-ratios';
export type MetricSource = ChartSourceReceipt & {
  kind: 'metric'; origin: 'acquired-snapshot' | LiveOrigin; issuer: string; listing: string; share_class: string | null;
  diagnostics: Diagnostic[]; unsafe: Record<Diagnostic, boolean>;
  metrics: Partial<Record<MetricPreset, MetricObservation & { additional_observations: MetricObservation[] }>>;
};

const receiptKeys = ['version', 'kind', 'origin', 'issuer', 'listing', 'share_class', 'retrieved_at',
  'raw_count', 'normalized_count', 'delivered_count', 'diagnostics', 'unsafe', 'metrics'];
const observationKeys = ['observation_id', 'vintage', 'origin', 'unit', 'as_of', 'as_of_unknown', 'period_start', 'period_end',
  'period_kind', 'adjustment_basis', 'reporting_basis', 'basis_reference'];
const firstKeys = [...observationKeys, 'additional_observations'];
const isPreset = (value: string): value is MetricPreset => Object.hasOwn(contract, value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,127}$/.test(value);
const coordinateId = (value: unknown): value is string => identifier(value) && /^[A-Za-z]/.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const reported = (metric: MetricPreset) => metric === 'eps_ttm' || metric === 'revenue_ttm';
const headline = (metric: MetricPreset) => metric === 'pe_ratio' || metric === 'dividend_yield';
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  isChartSourceRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// Fixed-width UTC keys preserve the source's full six-place fractional precision.
export function metricVintageKey(stamp: string): string {
  return stamp.slice(0, 19) + '.' + (stamp.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0');
}

// ISO 4217 current and historical denominations, plus EODHD's GBX (British pence).
const currencies = new Set(`
ADP AED AFA AFN ALK ALL AMD ANG AOA AOK AON AOR ARA ARP ARS ARY ATS AUD AWG AYM AZM AZN BAD BAM BBD BDT BEC
BEF BEL BGJ BGK BGL BGN BHD BIF BMD BND BOB BOP BOV BRB BRC BRE BRL BRN BRR BSD BTN BUK BWP BYB BYN BYR BZD
CAD CDF CHC CHE CHF CHW CLF CLP CNY COP COU CRC CSD CSJ CSK CUC CUP CVE CYP CZK DDM DEM DJF DKK DOP DZD ECS
ECV EEK EGP ERN ESA ESB ESP ETB EUR FIM FJD FKP FRF GBP GBX GEK GEL GHC GHP GHS GIP GMD GNE GNF GNS GQE GRD
GTQ GWE GWP GYD HKD HNL HRD HRK HTG HUF IDR IEP ILP ILR ILS INR IQD IRR ISJ ISK ITL JMD JOD JPY KES KGS KHR
KMF KPW KRW KWD KYD KZT LAJ LAK LBP LKR LRD LSL LSM LTL LTT LUC LUF LUL LVL LVR LYD MAD MDL MGA MGF MKD MLF
MMK MNT MOP MRO MRU MTL MTP MUR MVQ MVR MWK MXN MXP MXV MYR MZE MZM MZN NAD NGN NIC NIO NLG NOK NPR NZD OMR
PAB PEH PEI PEN PES PGK PHP PKR PLN PLZ PTE PYG QAR RHD ROK ROL RON RSD RUB RUR RWF SAR SBD SCR SDD SDG SDP
SEK SGD SHP SIT SKK SLE SLL SOS SRD SRG SSP STD STN SUR SVC SYP SZL THB TJR TJS TMM TMT TND TOP TPE TRL TRY
TTD TWD TZS UAH UAK UGS UGW UGX USD USN USS UYI UYN UYP UYU UYW UZS VEB VED VEF VES VNC VND VUV WST XAD XAF
XCD XCG XDR XEU XFO XFU XOF XPF XRE XSU XUA YDD YER YUD YUM YUN ZAL ZAR ZMK ZMW ZRN ZRZ ZWC ZWD ZWG ZWL ZWN
ZWR
`.trim().split(/\s+/));

function validUnit(value: unknown, metric: MetricPreset): value is MetricUnit {
  const kind = contract[metric][0];
  if (kind === 'money' || kind === 'money-per-share')
    return exact(value, ['kind', 'currency']) && value.kind === kind && typeof value.currency === 'string' && currencies.has(value.currency);
  return exact(value, ['kind']) && value.kind === kind;
}

function validObservation(value: unknown, metric: MetricPreset, first: boolean): value is MetricObservation {
  if (!exact(value, first ? firstKeys : observationKeys) || !coordinateId(value.observation_id)
    || value.origin !== metric || !utcTimestamp(value.vintage) || !validUnit(value.unit, metric)
    || value.as_of_unknown !== (value.as_of === null)
    || (value.basis_reference !== null && (!coordinateId(value.basis_reference) || value.adjustment_basis === null))
    || (value.adjustment_basis !== null && !contract[metric].slice(1).some(basis => value.adjustment_basis === basis))) return false;
  if (value.as_of !== null && !(isoDate(value.as_of) ? value.as_of <= value.vintage.slice(0, 10)
    : utcTimestamp(value.as_of) && metricVintageKey(value.as_of) <= metricVintageKey(value.vintage))) return false;
  if (reported(metric)) {
    if (value.period_kind !== 'TTM' || !isoDate(value.period_start) || !isoDate(value.period_end)
      || value.period_end > (typeof value.as_of === 'string' ? value.as_of : value.vintage).slice(0, 10)
      || value.adjustment_basis === null || !['US-GAAP', 'IFRS', 'local-GAAP'].some(basis => value.reporting_basis === basis)) return false;
    const days = 1 + (Date.parse(value.period_end) - Date.parse(value.period_start)) / 86400000;
    return [364, 365, 366, 371].includes(days);
  }
  return value.period_kind === (headline(metric) ? 'TTM' : null)
    && value.period_start === null && value.period_end === null && value.reporting_basis === null;
}

export function parseMetricSource(value: unknown): MetricSource | undefined {
  if (!exact(value, receiptKeys) || value.kind !== 'metric' || value.version !== 1
    || !['acquired-snapshot', 'eodhd-key-metrics', 'eodhd-financial-ratios'].some(o => o === value.origin)
    || !qualifiedSymbol(value.issuer) || !qualifiedSymbol(value.listing) || (value.share_class !== null && !identifier(value.share_class))
    || !utcTimestamp(value.retrieved_at) || !count(value.raw_count) || !count(value.normalized_count) || !count(value.delivered_count)
    || value.raw_count < value.normalized_count || value.normalized_count !== value.delivered_count || !value.delivered_count
    || !isChartSourceRecord(value.metrics) || !Object.keys(value.metrics).length || !exact(value.unsafe, unsafeKeys)
    || !isChartSourceArray(value.diagnostics)) return;
  const { unsafe, diagnostics } = value;
  if (new Set(diagnostics).size !== diagnostics.length || diagnostics.some(d => !unsafeKeys.some(key => key === d))
    || unsafeKeys.some(key => unsafe[key] !== diagnostics.includes(key))
    || (value.raw_count > value.normalized_count && !diagnostics.length)) return;

  const live = value.origin !== 'acquired-snapshot';
  if (live && (!value.issuer.endsWith('.US') || value.issuer !== value.listing || value.share_class !== null
    || value.raw_count !== 1 || value.delivered_count !== 1 || diagnostics.some(d => d !== 'unit_conflict'))) return;
  const ids = new Set<string>();
  const coordinates = new Set<string>();
  for (const [metric, first] of Object.entries(value.metrics)) {
    if (!isPreset(metric) || !isChartSourceRecord(first)) return;
    const additional = first.additional_observations;
    if (!validObservation(first, metric, true) || !isChartSourceArray(additional)
      || !additional.every(obs => validObservation(obs, metric, false))) return;
    if (live && (!headline(metric) || additional.length || !first.as_of_unknown || first.adjustment_basis !== null
      || first.vintage !== value.retrieved_at || first.observation_id !== metric + ':' + first.vintage)) return;
    for (const obs of [first, ...additional]) {
      const event = obs.as_of && utcTimestamp(obs.as_of) ? metricVintageKey(obs.as_of) : obs.as_of;
      const coordinate = JSON.stringify([metric, metricVintageKey(obs.vintage), event, obs.period_start, obs.period_end]);
      if (metricVintageKey(obs.vintage) > metricVintageKey(value.retrieved_at) || ids.has(obs.observation_id) || coordinates.has(coordinate)) return;
      ids.add(obs.observation_id);
      coordinates.add(coordinate);
    }
  }
  if (!live && ids.size !== value.delivered_count) return;
  return value as MetricSource;
}

/** All entries have equal standing. Neither the wire array nor table order selects an observation. */
export function metricObservations(source: MetricSource, metric: MetricPreset): MetricObservation[] {
  const first = source.metrics[metric];
  if (!first) return [];
  const { additional_observations, ...observation } = first;
  return [observation, ...additional_observations];
}

export function metricReferencesComparable(source: MetricSource, metric: MetricPreset, id: string, referenceId: string): boolean {
  if (source.share_class === null || source.diagnostics.length || id === referenceId) return false;
  const observations = metricObservations(source, metric);
  const current = observations.find(obs => obs.observation_id === id);
  const reference = observations.find(obs => obs.observation_id === referenceId);
  if (!current || !reference || current.unit.kind !== reference.unit.kind
    || ('currency' in current.unit && (!('currency' in reference.unit) || current.unit.currency !== reference.unit.currency))
    || !current.adjustment_basis || current.adjustment_basis !== reference.adjustment_basis
    || !current.basis_reference || current.basis_reference !== reference.basis_reference) return false;
  if (!reported(metric)) return current.as_of !== null && reference.as_of !== null;
  return metricVintageKey(current.vintage) !== metricVintageKey(reference.vintage) && current.period_start === reference.period_start
    && current.period_end === reference.period_end && current.reporting_basis === reference.reporting_basis;
}

const validValue = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
function rowsAgree(source: MetricSource, rows: readonly Record<string, unknown>[], scope: unknown): boolean {
  if ((scope !== undefined && scope !== 'complete' && scope !== 'unknown') || rows.length !== source.delivered_count) return false;
  if (source.origin !== 'acquired-snapshot') {
    const [row] = rows;
    return row.symbol === source.listing && row.metric_vintage === source.retrieved_at
      && (row.issuer === undefined || row.issuer === source.issuer) && (row.listing === undefined || row.listing === source.listing)
      && (row.share_class === undefined || row.share_class === null) && (row.as_of === undefined || row.as_of === null)
      && Object.keys(source.metrics).every(metric => validValue(row[metric]));
  }
  const remaining = new Map<string, MetricObservation>();
  for (const metric of Object.keys(source.metrics).filter(isPreset))
    for (const obs of metricObservations(source, metric)) remaining.set(obs.observation_id, obs);
  return rows.every(row => {
    const obs = typeof row.observation_id === 'string' && remaining.get(row.observation_id);
    if (!obs || row.issuer !== source.issuer || row.listing !== source.listing || row.share_class !== source.share_class
      || (row.symbol !== undefined && row.symbol !== source.listing)
      || (row.as_of_unknown !== undefined && row.as_of_unknown !== obs.as_of_unknown)
      || row.metric !== obs.origin || row.vintage !== obs.vintage || row.as_of !== obs.as_of || row.period_kind !== obs.period_kind
      || row.period_start !== obs.period_start || row.period_end !== obs.period_end || row.adjustment_basis !== obs.adjustment_basis
      || row.reporting_basis !== obs.reporting_basis || row.basis_reference !== obs.basis_reference || row.unit_kind !== obs.unit.kind
      || row.currency !== ('currency' in obs.unit ? obs.unit.currency : null) || !validValue(row[obs.origin])) return false;
    return remaining.delete(obs.observation_id);
  });
}

function routes(origin: LiveOrigin, path: string): ChartSourceAdapter<MetricSource>['routes'] {
  return ['', '/eodhd'].map(prefix => ({
    endpoint: '/api/v1' + prefix + '/equity/fundamental/' + path, selector: 'results', parameters: ['symbol', 'exchange', 'provider'],
    matches(source, params) {
      const symbol = params.symbol?.trim().toUpperCase();
      return source.origin === origin && !!symbol && (params.exchange ?? 'US').toUpperCase() === 'US'
        && (params.provider ?? (prefix && 'eodhd')) === 'eodhd'
        && source.listing === (symbol.includes('.') ? symbol : symbol + '.US');
    },
  }));
}

export const metricSourceAdapter: ChartSourceAdapter<MetricSource> = {
  kind: 'metric', decode: parseMetricSource, allowsLocal: source => source.origin === 'acquired-snapshot', rowsAgree,
  routes: [...routes('eodhd-key-metrics', 'metrics'), ...routes('eodhd-financial-ratios', 'ratios')],
  coordinates(source) {
    const live = source.origin !== 'acquired-snapshot';
    const classFields = source.share_class === null ? [] : ['share_class'];
    const classValues = source.share_class === null ? [] : [source.share_class];
    const fields = live ? ['symbol', 'metric_vintage'] : ['issuer', 'listing', ...classFields, 'metric', 'observation_id', 'vintage'];
    return [{ fields, points: Object.keys(source.metrics).filter(isPreset).flatMap(metric => metricObservations(source, metric).map(obs => ({
      id: obs.observation_id, values: live ? [source.listing, obs.vintage]
        : [source.issuer, source.listing, ...classValues, metric, obs.observation_id, obs.vintage],
    }))) }];
  },
};
