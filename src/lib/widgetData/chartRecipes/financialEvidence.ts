// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { asRecord } from '../../isRecord';
import type { DatasetColumn, DatasetProvenance, DatasetRow } from '../types';
import type { BackendEtfAcquisition } from './etfEvidence';
import { calendarDate } from './priceEvidence';

type Check<T> = (value: unknown) => value is T;
type Checked<T> = T extends Check<infer Value> ? Value : never;

/** Each wire object is closed, including nested variants. Read own JSON data only. */
function shape<const Fields extends Record<string, Check<unknown>>>(fields: Fields): Check<{ -readonly [K in keyof Fields]: Checked<Fields[K]> }> {
  const entries = Object.entries(fields);
  return (value): value is { -readonly [K in keyof Fields]: Checked<Fields[K]> } => {
    const record = asRecord(value);
    if (!record || ![Object.prototype, null].includes(Object.getPrototypeOf(record))
      || Reflect.ownKeys(record).length !== entries.length) return false;
    return entries.every(([key, check]) => {
      const field = Object.getOwnPropertyDescriptor(record, key);
      return !!field?.enumerable && 'value' in field && check(field.value);
    });
  };
}

function oneOf<const T extends string | number>(...choices: T[]): Check<T> {
  return (value): value is T => choices.includes(value as T);
}

function list<T>(check: Check<T>): Check<T[]> {
  return (value): value is T[] => {
    if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let i = 0; i < value.length; i++) {
      const item = Object.getOwnPropertyDescriptor(value, i);
      if (!item?.enumerable || !('value' in item) || !check(item.value)) return false;
    }
    return true;
  };
}

function nullable<T>(check: Check<T>): Check<T | null> {
  return (value): value is T | null => value === null || check(value);
}

const text: Check<string> = (value): value is string => typeof value === 'string';
const bool: Check<boolean> = (value): value is boolean => typeof value === 'boolean';
const finite: Check<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value);
const integer: Check<number> = (value): value is number => finite(value) && Number.isSafeInteger(value);
const count: Check<number> = (value): value is number => integer(value) && value >= 0;
const positive: Check<number> = (value): value is number => finite(value) && value > 0;
export const isoDate: Check<string> = (value): value is string => text(value) && value.length === 10 && !value.startsWith('0000') && calendarDate(value) === value;
const utcTimestamp: Check<string> = (value): value is string => text(value)
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)
  && isoDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const currency: Check<string> = (value): value is string => text(value) && /^[A-Z]{3}$/.test(value);
export const qualifiedSymbol: Check<string> = (value): value is string => text(value) && value.length <= 128
  && /^[A-Z0-9^][A-Z0-9^_/-]*(?:\.[A-Z0-9^_/-]+)*\.[A-Z0-9][A-Z0-9_-]*$/.test(value);
const reference: Check<string> = (value): value is string => text(value) && value.length >= 1 && value.length <= 256;
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const dates = list(isoDate);

const diagnostic = oneOf(
  'unassignable_identity', 'unassignable_date', 'unit_conflict',
  'invalid_price_change_5d', 'missing_price_change_5d', 'unknown_denomination',
  'mixed_denomination', 'screener_duplicate_conflict', 'screener_exact_duplicate',
  'invalid_ex_date', 'invalid_amount', 'duplicate_ex_date', 'currency_conflict',
  'unknown_payment_currency', 'instrument_conflict', 'amount_basis_conflict',
  'outside_requested_window', 'unknown_coverage', 'clipped_coverage',
  'unknown_reporting_currency', 'unknown_scale', 'scale_conflict',
  'invalid_period_identity', 'period_identity_conflict', 'field_origin_conflict',
  'unknown_record_coverage',
);
const common = {
  version: oneOf(1),
  retrieved_at: utcTimestamp,
  raw_count: count,
  normalized_count: count,
  delivered_count: count,
  diagnostics: list(diagnostic),
};

const screenFilterField = oneOf('exchange', 'sector', 'industry', 'market_capitalization', 'adjusted_close', 'dividend_yield', 'avgvol_1d');
const screenFilterOperator = oneOf('=', '>=', '<=');
type ScreenFilter = [Checked<typeof screenFilterField>, Checked<typeof screenFilterOperator>, string | number];
const screenFilterValues = list((item): item is string | number => text(item) || finite(item));
const screenFilter: Check<ScreenFilter> = (value): value is ScreenFilter =>
  screenFilterValues(value) && value.length === 3 && screenFilterField(value[0]) && screenFilterOperator(value[1]);
const screener = shape({
  ...common,
  kind: oneOf('screener'),
  field_origins: shape({
    symbol: oneOf('code+exchange'), exchange: oneOf('exchange'), currency_symbol: oneOf('currency_symbol'),
    last_day_data_date: oneOf('last_day_data_date'), market_cap: oneOf('market_capitalization'),
    dividend_yield: oneOf('dividend_yield'), price_change_5d: oneOf('refund_5d_p'),
  }),
  units: shape({ market_cap: oneOf('listing-currency'), dividend_yield: oneOf('fraction'), price_change_5d: oneOf('fraction') }),
  scope: shape({ sort: text, limit: integer, offset: integer, signals: nullable(text), filters: list(screenFilter) }),
  unsafe: shape({ unassignable_identity: bool, unassignable_date: bool, unit_conflict: bool }),
  cohorts: list(shape({
    price_date: isoDate, raw_count: count, denominations: list(currency), unknown_denomination: bool,
    conflicting_duplicates: bool, exact_duplicate_count: count,
  })),
});

const unknownStatus = shape({ status: oneOf('unknown') });
const acquiredCoverage = shape({
  status: oneOf('verified', 'clipped'), authority: oneOf('explicit-snapshot'),
  reference, start: isoDate, end: isoDate,
});
const dividendCoverage: Check<Checked<typeof unknownStatus> | Checked<typeof acquiredCoverage>> =
  (value): value is Checked<typeof unknownStatus> | Checked<typeof acquiredCoverage> => unknownStatus(value) || acquiredCoverage(value);
const dividends = shape({
  ...common,
  kind: oneOf('dividends'),
  field_origins: shape({ ex_dividend_date: oneOf('date'), amount: oneOf('value'), currency: oneOf('currency'), frequency: oneOf('period') }),
  qualified_symbol: qualifiedSymbol, amount_basis: oneOf('split-adjusted-current-share'),
  requested_start: nullable(isoDate), requested_end: nullable(isoDate), coverage: dividendCoverage,
  unsafe: shape({
    invalid_ex_date: bool, currency_conflict: bool, unknown_payment_currency: bool,
    instrument_conflict: bool, amount_basis_conflict: bool, outside_requested_window: bool,
  }),
  event_dates: dates, invalid_amount_dates: dates, duplicate_dates: dates, payment_currencies: list(currency),
});

/** The canonical acquired field survives an alias, but cannot survive a calculation. */
export function acquiredColumnOrigin(column: DatasetColumn | undefined): string | undefined {
  if (!column || column.analytical || column.measureId || column.aggregation || column.splitPath?.length) return undefined;
  return column.sourceFieldId ?? column.id;
}

const incomeFieldOrigins = {
  revenue: oneOf('totalRevenue'), cost_of_revenue: oneOf('costOfRevenue'), gross_profit: oneOf('grossProfit'),
  operating_income: oneOf('operatingIncome'), income_before_tax: oneOf('incomeBeforeTax'),
  net_income: oneOf('netIncome'), income_tax_expense: oneOf('incomeTaxExpense'),
};

export type IncomeEvidenceField = keyof typeof incomeFieldOrigins;
export const incomeEvidenceFields = Object.keys(incomeFieldOrigins) as IncomeEvidenceField[];
const incomeField: Check<IncomeEvidenceField> = (value): value is IncomeEvidenceField =>
  text(value) && Object.hasOwn(incomeFieldOrigins, value);
const periodKind = oneOf('FY', 'FQ');
const verifiedScale = shape({ status: oneOf('verified'), authority: oneOf('explicit-snapshot'), multiplier: positive, reference });
const incomeScale: Check<Checked<typeof unknownStatus> | Checked<typeof verifiedScale>> =
  (value): value is Checked<typeof unknownStatus> | Checked<typeof verifiedScale> => unknownStatus(value) || verifiedScale(value);
const income = shape({
  ...common,
  kind: oneOf('income'),
  field_origins: shape({
    period_ending: oneOf('date'), reporting_currency: oneOf('Financials.Income_Statement.currency_symbol'), ...incomeFieldOrigins,
  }),
  qualified_symbol: qualifiedSymbol, period_kind: periodKind, reporting_currency: nullable(currency),
  scale: incomeScale, requested_limit: nullable(count), available_period_count: count,
  unsafe: shape({ invalid_period_identity: bool, scale_conflict: bool }),
  periods: list(shape({
    period_end: isoDate, period_kind: periodKind, fiscal_year: nullable(integer),
    fiscal_period: nullable(oneOf('FY', 'Q1', 'Q2', 'Q3', 'Q4')),
    record_coverage: oneOf('full-record', 'unknown'), declared_currency: nullable(currency),
    currency_conflict: bool, scale_conflict: bool, identity_conflict: bool, field_origin_conflict: bool,
    present_fields: list(incomeField),
  })),
});

export type ScreenerFinancialEvidence = Checked<typeof screener>;
export type DividendFinancialEvidence = Checked<typeof dividends> & {
  /** Runtime projection only. A source receipt cannot declare omissions from table presentation. */
  omitted_event_dates?: string[];
};
export type IncomeFinancialEvidence = Checked<typeof income>;
export type FinancialEvidence = ScreenerFinancialEvidence | DividendFinancialEvidence | IncomeFinancialEvidence;
export type BackendAcquisition = BackendEtfAcquisition & { financialEvidence?: FinancialEvidence };

function screenerFactsAgree(evidence: ScreenerFinancialEvidence): boolean {
  const { cohorts, raw_count, normalized_count, delivered_count, unsafe } = evidence;
  const dated = cohorts.reduce((total, cohort) => total + cohort.raw_count, 0);
  const diagnostics = new Set<string>(evidence.diagnostics);
  const safetyFacts = {
    ...unsafe,
    unknown_denomination: cohorts.some(cohort => cohort.unknown_denomination),
    mixed_denomination: cohorts.some(cohort => cohort.denominations.length > 1),
    screener_duplicate_conflict: cohorts.some(cohort => cohort.conflicting_duplicates),
    screener_exact_duplicate: cohorts.some(cohort => cohort.exact_duplicate_count > 0),
  };
  // The v1 screener delivers every normalized record. Only presentation can reduce that list.
  return normalized_count === delivered_count
    && (normalized_count === raw_count || unsafe.unassignable_identity)
    && (unsafe.unassignable_date ? dated < raw_count : dated === raw_count)
    && Object.entries(safetyFacts).every(([code, fact]) => diagnostics.has(code) === fact)
    && unique(cohorts.map(cohort => cohort.price_date))
    && cohorts.every(cohort => cohort.raw_count > cohort.exact_duplicate_count
      && cohort.denominations.length <= cohort.raw_count && unique(cohort.denominations)
      && (cohort.denominations.length > 0 || cohort.unknown_denomination));
}

function dividendFactsAgree(evidence: DividendFinancialEvidence): boolean {
  const { requested_start: start, requested_end: end, coverage, event_dates, invalid_amount_dates, duplicate_dates, payment_currencies, raw_count, unsafe } = evidence;
  const diagnostics = new Set<string>(evidence.diagnostics);
  const facts = { ...unsafe, duplicate_ex_date: duplicate_dates.length > 0, invalid_amount: invalid_amount_dates.length > 0,
    clipped_coverage: coverage.status === 'clipped', unknown_coverage: coverage.status === 'unknown' };
  if (!Object.entries(facts).every(([code, fact]) => diagnostics.has(code) === fact)) return false;
  const events = new Set(event_dates);
  if (event_dates.length + duplicate_dates.length > raw_count || payment_currencies.length > raw_count
    || ![event_dates, invalid_amount_dates, duplicate_dates, payment_currencies].every(unique)
    || ![...invalid_amount_dates, ...duplicate_dates].every(date => events.has(date))
    || (payment_currencies.length > 1 && !unsafe.currency_conflict)
    || (!unsafe.invalid_ex_date && !duplicate_dates.length && raw_count !== event_dates.length)) return false;
  if (coverage.status !== 'unknown') {
    if (!start || !end || start > end || coverage.start > coverage.end
      || (coverage.start <= start && end <= coverage.end) !== (coverage.status === 'verified')) return false;
  }
  return unsafe.outside_requested_window || event_dates.every(day =>
    (!start || day >= start) && (!end || day <= end)
    && (coverage.status === 'unknown' || (day >= coverage.start && day <= coverage.end)));
}

function incomeFactsAgree(evidence: IncomeFinancialEvidence): boolean {
  const { periods, raw_count, available_period_count, requested_limit, period_kind, reporting_currency } = evidence;
  return raw_count === (requested_limit ? Math.min(requested_limit, available_period_count) : available_period_count)
    && periods.length <= raw_count && unique(periods.map(period => period.period_end))
    && periods.every(period => period.period_kind === period_kind && unique(period.present_fields)
      && (period.fiscal_period === null || (period.fiscal_period === 'FY') === (period_kind === 'FY'))
      && (!period.identity_conflict || period.record_coverage === 'unknown')
      && (!period.declared_currency || period.declared_currency === reporting_currency || period.currency_conflict));
}

/** Decode the provider's canonical snake_case receipt. Unknown keys and variants fail closed. */
export function parseFinancialEvidence(value: unknown): FinancialEvidence | undefined {
  const evidence = screener(value) && screenerFactsAgree(value) ? value :
    dividends(value) && dividendFactsAgree(value) ? value : income(value) && incomeFactsAgree(value) ? value : undefined;
  if (!evidence || evidence.delivered_count > evidence.normalized_count || evidence.normalized_count > evidence.raw_count
    || !unique(evidence.diagnostics)) return undefined;
  return evidence;
}

/** Preserve acquisition facts even if successive presentations hide all rows or columns. */
export function projectFinancialEvidence(evidence: FinancialEvidence, visibleCoordinates: readonly string[]): FinancialEvidence {
  if (evidence.kind !== 'dividends') return evidence;
  const visible = new Set(visibleCoordinates);
  const previous = new Set(evidence.omitted_event_dates);
  const omitted_event_dates = evidence.event_dates.filter(day => !visible.has(day) || previous.has(day));
  return omitted_event_dates.length ? { ...evidence, omitted_event_dates } : evidence;
}

/** Revalidate the receipt in recipe workers and linked consumers. */
export function readFinancialEvidence(provenance: DatasetProvenance): FinancialEvidence | undefined {
  const evidence = parseFinancialEvidence(provenance.metadata?.financialEvidence);
  const omitted = provenance.metadata?.financialOmittedEventDates;
  if (omitted === undefined) return evidence;
  if (evidence?.kind !== 'dividends' || !dates(omitted) || !unique(omitted)) return undefined;
  const acquiredDates = new Set(evidence.event_dates);
  if (omitted.some(day => !acquiredDates.has(day))) return undefined;
  return { ...evidence, omitted_event_dates: omitted };
}

/** Validate the reserved metadata before a worker transports it. */
export function validatedFinancialProvenance(provenance: DatasetProvenance): DatasetProvenance {
  const metadata = provenance.metadata;
  if (!metadata || (!Object.hasOwn(metadata, 'financialEvidence') && !Object.hasOwn(metadata, 'financialOmittedEventDates')
    && !Object.hasOwn(metadata, 'financialSourceFiltered'))) return provenance;
  if (readFinancialEvidence(provenance) && (metadata.financialSourceFiltered === undefined || metadata.financialSourceFiltered === true))
    return provenance;
  const { financialEvidence: _evidence, financialOmittedEventDates: _omitted, financialSourceFiltered: _filtered, ...other } = metadata;
  return { ...provenance, metadata: other };
}

export function financialPresentationProvenance(provenance: DatasetProvenance, filtered: boolean): DatasetProvenance {
  return filtered && provenance.metadata?.financialEvidence !== undefined
    ? { ...provenance, metadata: { ...provenance.metadata, financialSourceFiltered: true } } : provenance;
}

export function financialProjectionProvenance(provenance: DatasetProvenance, rows: readonly DatasetRow[], columns: readonly DatasetColumn[]): DatasetProvenance {
  const evidence = readFinancialEvidence(provenance);
  if (evidence?.kind !== 'dividends') return provenance;
  const coordinates: string[] = [];
  if (!provenance.inputMayContainAggregates) {
    const aliases = columns.filter(column => acquiredColumnOrigin(column) === 'ex_dividend_date').map(column => column.id);
    if (aliases.length) for (const row of rows) for (const field of aliases) {
      const day = row.values[field];
      if (isoDate(day) && !row.cellErrors?.[field]) coordinates.push(day);
    }
  }
  const projected = projectFinancialEvidence(evidence, coordinates);
  return projected.kind === 'dividends' && projected.omitted_event_dates?.length
    ? { ...provenance, metadata: { ...provenance.metadata, financialOmittedEventDates: projected.omitted_event_dates } } : provenance;
}

/** Explicit delivery limits contradict a receipt certifying the entire event window. */
export function financialScopeAgrees(evidence: FinancialEvidence, scope: unknown): boolean {
  return evidence.kind !== 'dividends' || evidence.coverage.status !== 'verified'
    || (scope !== 'paged' && scope !== 'partial' && scope !== 'sample');
}

/** Check that the source's evidence and actual delivered rows describe the same acquisition. */
export function financialRowsAgree(evidence: FinancialEvidence, rows: readonly Record<string, unknown>[]): boolean {
  if (rows.length !== evidence.delivered_count) return false;
  if (evidence.kind === 'screener') {
    const cohorts = new Map(evidence.cohorts.map(cohort => [cohort.price_date, { cohort, count: 0, first: new Map<string, unknown[]>() }]));
    return rows.every(row => {
      const day = row.last_day_data_date, instrument = row.symbol;
      if ((!qualifiedSymbol(instrument) || !text(row.exchange) || !instrument.endsWith('.' + row.exchange.toUpperCase()))
        && !evidence.unsafe.unassignable_identity) return false;
      if (!isoDate(day)) return evidence.unsafe.unassignable_date;
      const observed = cohorts.get(day);
      if (!observed || ++observed.count > observed.cohort.raw_count) return false;
      const denomination = text(row.exchange) && row.exchange.toUpperCase() === 'US' && row.currency_symbol === '$' ? 'USD' : row.currency_symbol;
      if (currency(denomination) ? !observed.cohort.denominations.includes(denomination) : !observed.cohort.unknown_denomination)
        return false;
      if (!qualifiedSymbol(instrument) || observed.cohort.conflicting_duplicates) return true;
      const values = [denomination ?? null, row.market_cap ?? null, row.dividend_yield ?? null, row.price_change_5d ?? null];
      const first = observed.first.get(instrument);
      if (first) return first.every((value, index) => value === values[index]);
      observed.first.set(instrument, values);
      return true;
    });
  }
  if (evidence.kind === 'dividends') {
    const eventDates = new Set(evidence.event_dates);
    const invalidAmounts = new Set(evidence.invalid_amount_dates);
    const duplicates = new Set(evidence.duplicate_dates);
    const delivered = new Set<unknown>();
    for (const row of rows) {
      const day = row.ex_dividend_date, paymentCurrency = row.currency;
      if (!isoDate(day) || !eventDates.has(day) || !finite(row.amount) || row.amount < 0
        || (delivered.has(day) && !duplicates.has(day))
        || (Object.hasOwn(row, 'amount_basis') && row.amount_basis !== evidence.amount_basis && !evidence.unsafe.amount_basis_conflict)
        || (row.symbol != null && row.symbol !== evidence.qualified_symbol && !evidence.unsafe.instrument_conflict)
        || (currency(paymentCurrency) ? !evidence.payment_currencies.includes(paymentCurrency) : !evidence.unsafe.unknown_payment_currency))
        return false;
      delivered.add(day);
    }
    return evidence.event_dates.every(day => delivered.has(day) || invalidAmounts.has(day));
  }
  const periods = new Map(evidence.periods.map(period => [period.period_end, period]));
  const delivered = new Set<unknown>();
  for (const row of rows) {
    const day = row.period_ending;
    const period = isoDate(day) && periods.get(day);
    if (!period || (delivered.has(day) && !period.identity_conflict)
      || (row.symbol != null && row.symbol !== evidence.qualified_symbol)
      || (row.period_kind != null && row.period_kind !== evidence.period_kind)
      || (row.fiscal_year != null && row.fiscal_year !== period.fiscal_year)
      || (row.fiscal_period != null && row.fiscal_period !== period.fiscal_period)
      || (row.reporting_currency != null && row.reporting_currency !== evidence.reporting_currency && !period.currency_conflict)
      || (row.scale_multiplier != null && evidence.scale.status === 'verified'
        && row.scale_multiplier !== evidence.scale.multiplier && !period.scale_conflict && !evidence.unsafe.scale_conflict)
      || incomeEvidenceFields.some(field => finite(row[field]) !== period.present_fields.includes(field))) return false;
    delivered.add(day);
  }
  return delivered.size === periods.size;
}

const filterParameters = [
  ['exchange', 'exchange', '=', text], ['sector', 'sector', '=', text], ['industry', 'industry', '=', text],
  ['market_cap_min', 'market_capitalization', '>=', finite], ['market_cap_max', 'market_capitalization', '<=', finite],
  ['price_min', 'adjusted_close', '>=', finite], ['price_max', 'adjusted_close', '<=', finite],
  ['dividend_yield_min', 'dividend_yield', '>=', finite], ['volume_min', 'avgvol_1d', '>=', finite],
] as const;
const routeKinds: Record<string, FinancialEvidence['kind']> = {
  '/equity/screener': 'screener',
  '/equity/fundamental/dividends': 'dividends',
  '/equity/fundamental/income': 'income',
};
const parseNumber = (value: string) => value.trim() ? Number(value) : NaN;

function requestAgrees(evidence: FinancialEvidence, url: URL, credentialKey?: string): boolean {
  const match = /^\/(?:api\/v1\/)?(eodhd\/)?(equity\/(?:screener|fundamental\/(?:dividends|income)))\/?$/.exec(url.pathname);
  if (!match || routeKinds['/' + match[2]] !== evidence.kind) return false;
  const keys = ['provider', 'chart_source', ...(evidence.kind === 'screener'
    ? ['sort', 'limit', 'offset', 'signals', ...filterParameters.map(([key]) => key)]
    : ['symbol', 'exchange', ...(evidence.kind === 'dividends' ? ['start_date', 'end_date'] : ['period', 'limit'])])];
  const params = url.searchParams;
  if (keys.some(key => key === credentialKey || params.getAll(key).length > 1)
    || !/^(?:1|true|t|on|yes|y)$/i.test(params.get('chart_source') ?? '')
    || (params.get('provider') ?? (match[1] ? 'eodhd' : null)) !== 'eodhd') return false;
  if (evidence.kind === 'screener') {
    const { scope } = evidence;
    const filters = filterParameters.flatMap(([key, field, operator, check]) => {
      const value = params.get(key);
      return value === null ? [] : [[field, operator, check === text ? value : parseNumber(value)]];
    });
    return scope.sort === (params.get('sort') ?? 'market_capitalization.desc')
      && scope.limit === parseNumber(params.get('limit') ?? '50') && scope.offset === parseNumber(params.get('offset') ?? '0')
      && scope.signals === params.get('signals')
      && scope.filters.length === filters.length && scope.filters.every((tuple, index) => tuple.every((value, column) => value === filters[index][column]));
  }
  const symbol = params.get('symbol')?.trim().toUpperCase();
  const qualified = symbol && (symbol.includes('.') ? symbol : symbol + '.' + (params.get('exchange') ?? 'US').toUpperCase());
  if (qualified !== evidence.qualified_symbol) return false;
  if (evidence.kind === 'dividends')
    return evidence.requested_start === params.get('start_date') && evidence.requested_end === params.get('end_date');
  const period = params.get('period') ?? 'annual';
  return (period === 'annual' ? 'FY' : period === 'quarter' ? 'FQ' : undefined) === evidence.period_kind
    && evidence.requested_limit === (params.has('limit') ? parseNumber(params.get('limit')!) : null);
}

/** Capture the validated receipt and full row array from the unselected OBBject. */
export function backendFinancialResponse(payload: unknown, url: URL, credentialKey?: string) {
  const envelope = asRecord(payload);
  const evidence = parseFinancialEvidence(asRecord(asRecord(envelope?.extra)?.results_metadata)?.chart_evidence);
  if (!evidence || !requestAgrees(evidence, url, credentialKey)) return undefined;
  const result = envelope?.results;
  if (!financialScopeAgrees(evidence, envelope?.completeness) || !financialScopeAgrees(evidence, asRecord(result)?.completeness)) return undefined;
  const rows = Array.isArray(result) ? result : asRecord(result)?.rows;
  if (!Array.isArray(rows) || !rows.every(row => asRecord(row) !== undefined) || !financialRowsAgree(evidence, rows)) return undefined;
  return { evidence, rows };
}
