// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord as object } from '../isRecord';
import { boundedPlainData } from './validation';
import { parseDate } from '@internationalized/date';
import { fiscalPeriod, fiscalYearSpan, formatFiscalLabel, quarterSpan } from '../periods';
import type { DatasetRow } from '../widgetData/types';
import type { FiscalBinding, ModelError, ModelWarning } from './types';

export type FiscalPeriod = { kind: 'FY' | 'FQ'; year: number; quarter?: number; start: string; end: string; source: string };
export type FiscalCompanyContext = {
  /** Month calendars label fiscal years by the year in which they END. */
  yearEndMonth?: number;
  calendar?: 'month' | 'week';
  source: string;
  periods?: FiscalPeriod[];
};
/** Provider-neutral acquired metadata. No parameter/single-symbol fallback or fetching. */
export type FiscalContext = {
  companies?: Record<string, FiscalCompanyContext>;
  metadata?: Record<string, Record<string, FiscalCompanyContext>>;
  /** Explicit file/company settings fill missing metadata; authoritative periods win. */
  overrides?: Record<string, FiscalCompanyContext>;
};
export type ResolvedFiscalPeriod = FiscalPeriod & {
  companyKey: string;
  label: string;
  key: string;
  precision: 'authoritative' | 'month-calendar';
};
type PeriodResult = { ok: true; value: ResolvedFiscalPeriod } | { ok: false; error: ModelError };
/** Independent results: unavailable quarters never invalidate a known annual period. */
export type FiscalPeriodResult = { year: PeriodResult; quarter: PeriodResult };

const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined => map && Object.hasOwn(map, key) ? map[key] : undefined;
const read = (row: DatasetRow, field?: string): unknown => field === undefined ? undefined : own(row.values, field);

/** Validate the date PART as written, matching maintained bucket semantics without overflow. */
export function periodDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2})/.test(value)) return undefined;
  const date = value.slice(0, 10);
  const [y, m, d] = date.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const parsed = new Date(0);
  parsed.setUTCFullYear(y, m - 1, d);
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d ? date : undefined;
}

/** Month boundaries are shared by fiscal and calendar categories, with UTC overflow intentional. */
export function monthBounds(year: number, month: number, length: number): { start: string; end: string } {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  const start = date.toISOString().slice(0, 10);
  date.setUTCMonth(date.getUTCMonth() + length, 0);
  return { start, end: date.toISOString().slice(0, 10) };
}
const fiscalNumber = (value: unknown, kind: 'FY' | 'FQ'): number | undefined => {
  const text = String(value ?? '');
  const match = (kind === 'FY' ? /^(?:FY)?(\d{4})$/ : /^(?:F?Q)?([1-4])$/).exec(text);
  const number = match ? Number(match[1]) : undefined;
  return number && Number.isInteger(number) ? number : undefined;
};

/** Canonical context evidence for group compatibility; company object insertion order is irrelevant. */
export function fiscalContextRecipe(binding: FiscalBinding | undefined, context: FiscalContext): string {
  const metadata = binding?.metadataKey === undefined ? context.companies : own(context.metadata, binding.metadataKey);
  const entries = (map: Record<string, FiscalCompanyContext> | undefined) => Object.entries(map ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([company, info]) =>
    [company, info.yearEndMonth ?? null, info.calendar ?? null, info.source, (info.periods ?? []).map(p => [p.kind, p.year, p.quarter ?? null, p.start, p.end, p.source]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
  return JSON.stringify([entries(metadata), entries(context.overrides)]);
}

export function resolveFiscalPeriod(row: DatasetRow, binding: FiscalBinding, context: FiscalContext): FiscalPeriodResult {
  const fail = (code: ModelError['code'], message: string): PeriodResult => ({ ok: false, error: { code, message, recordIds: [row.id] } });
  const both = (code: ModelError['code'], message: string): FiscalPeriodResult => ({ year: fail(code, message), quarter: fail(code, message) });
  const company = read(row, binding.companyFieldId);
  if (typeof company !== 'string' || company === '' || !binding.dateFieldId) return both('fiscal-context', 'Bind a company and report date for fiscal categories.');
  const date = periodDate(read(row, binding.dateFieldId));
  if (!date) return both('invalid-date', 'The bound report date is missing or invalid.');
  const metadata = binding.metadataKey === undefined ? context.companies : own(context.metadata, binding.metadataKey);
  const info = own(metadata, company);
  const override = own(context.overrides, company);
  const periods = [...(info?.periods ?? []), ...(override?.periods ?? [])];
  // Explicit field mappings are authoritative hints. Quarter bounds never stand in for annual bounds.
  const hasFields = [binding.periodKind, binding.fiscalYearFieldId, binding.fiscalQuarterFieldId, binding.periodStartFieldId, binding.periodEndFieldId].some(f => f !== undefined);
  let bound: FiscalPeriod | undefined;
  const boundErrors: Partial<Record<'FY' | 'FQ', PeriodResult>> = {};
  if (hasFields) {
    const year = fiscalNumber(read(row, binding.fiscalYearFieldId), 'FY');
    const quarter = binding.fiscalQuarterFieldId ? fiscalNumber(read(row, binding.fiscalQuarterFieldId), 'FQ') : undefined;
    const start = periodDate(read(row, binding.periodStartFieldId));
    const end = periodDate(read(row, binding.periodEndFieldId));
    if (!year) boundErrors.FY = boundErrors.FQ = fail('fiscal-context', 'The bound fiscal year label is missing or invalid.');
    else if (!start || !end || start > end || date < start || date > end) boundErrors.FY = boundErrors.FQ = fail('invalid-date', 'The bound fiscal period dates are invalid or do not contain the report date.');
    else {
      // Older mixed mappings lack a kind. Only a recognizable full-year span can
      // supply FY when their quarter is invalid; short/stub years require explicit FY.
      const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
      const annualSpan = [364, 365, 366, 371].includes(days);
      const kind = binding.periodKind ?? (quarter ? 'FQ' : !binding.fiscalQuarterFieldId || annualSpan ? 'FY' : undefined);
      if (kind === 'FY') bound = { kind, year, start, end, source: 'bound period fields' };
      else if (kind === 'FQ' && quarter) bound = { kind, year, quarter, start, end, source: 'bound period fields' };
      else boundErrors.FY = fail('fiscal-context', 'The bound dates do not identify an annual period. Declare their period kind.');
      if (!quarter) boundErrors.FQ = fail('fiscal-context', 'The bound fiscal quarter label is missing or invalid.');
    }
  }
  const resolved = (period: FiscalPeriod, precision: ResolvedFiscalPeriod['precision']): PeriodResult => {
    // The key stays `FY2026 Q3`: it is the member value formulas and saved views store. Only the label is display.
    const key = `FY${period.year}${period.kind === 'FQ' ? ` Q${period.quarter}` : ''}`;
    const label = formatFiscalLabel(period.year, period.kind === 'FQ' ? period.quarter : undefined);
    return { ok: true, value: { ...period, companyKey: company, label, key, precision } };
  };
  const resolve = (kind: 'FY' | 'FQ'): PeriodResult => {
    const candidates = periods.filter(p => p.kind === kind);
    for (const p of candidates) {
      if (!periodDate(p.start) || !periodDate(p.end) || periodDate(p.start)! > periodDate(p.end)!) return fail('invalid-date', 'Authoritative fiscal period bounds are invalid.');
      if (!Number.isInteger(p.year) || p.year < 1 || p.year > 9999 || (kind === 'FQ' && (!Number.isInteger(p.quarter) || p.quarter! < 1 || p.quarter! > 4))) return fail('fiscal-context', 'Authoritative fiscal period labels are invalid.');
    }
    const normalized = candidates.map(p => ({ ...p, start: periodDate(p.start)!, end: periodDate(p.end)! }));
    const matches = normalized.filter(p => p.start <= date && p.end >= date);
    if (matches.length > 1 && matches.some(p => p.year !== matches[0].year || p.quarter !== matches[0].quarter || p.start !== matches[0].start || p.end !== matches[0].end)) return fail('fiscal-context', 'Authoritative fiscal periods overlap ambiguously.');
    if (matches[0]) return resolved(matches[0], 'authoritative');
    if (boundErrors[kind]) return boundErrors[kind];
    if (bound?.kind === kind) return resolved(bound, 'authoritative');
    // An authoritative calendar cannot be extended from a year-end month alone.
    if (periods.length || hasFields || info?.calendar === 'week' || override?.calendar === 'week') return fail('fiscal-context', `Authoritative ${kind} bounds are unavailable for ${company} on ${date}.`);
    const setting = override ?? info;
    const endMonth = setting?.yearEndMonth;
    if (!setting || !Number.isInteger(endMonth) || endMonth! < 1 || endMonth! > 12) return fail('fiscal-context', `Fiscal calendar is unavailable for ${company}.`);
    const { fy, q } = fiscalPeriod(parseDate(date), endMonth!);
    const span = kind === 'FY' ? fiscalYearSpan(fy, endMonth!) : quarterSpan({ fy, q }, endMonth!);
    return resolved({ kind, year: fy, ...(kind === 'FQ' ? { quarter: q } : {}), start: span.start.toString(), end: span.end.toString(), source: setting.source }, 'month-calendar');
  };
  return { year: resolve('FY'), quarter: resolve('FQ') };
}

export function alignmentWarnings(periods: ResolvedFiscalPeriod[]): ModelWarning[] {
  const groups = new Map<string, ResolvedFiscalPeriod[]>();
  for (const period of periods) {
    const key = JSON.stringify([period.kind, period.key]);
    const group = groups.get(key) ?? [];
    if (!group.some(p => p.companyKey === period.companyKey && p.start === period.start && p.end === period.end && p.source === period.source)) group.push(period);
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => new Set(group.map(p => p.companyKey)).size > 1 && new Set(group.map(p => `${p.start}/${p.end}`)).size > 1).map(group => ({
    code: 'fiscal-alignment', message: `Fiscal periods do not align across companies. ${group[0].label} represents different date ranges.`,
    periods: group.map(({ companyKey, start, end, source }) => ({ companyKey, start, end, source })),
  }));
}

/** Explicit generic metadata seam: bounded plain data and exact fiscal setting shapes. */
export function validateFiscalContext(raw: unknown): {context: FiscalContext; error?: ModelError} {
  const invalid = () => ({context: {}, error: {code:'fiscal-context' as const,message:'Explicit fiscal context metadata is invalid; repair the company calendar mapping.'}});
  if (raw === undefined) return {context:{}};
  if (!boundedPlainData(raw)) return invalid();
  const company = (v: unknown): boolean => {
    if (!object(v) || typeof v.source !== 'string' || !v.source || Object.keys(v).some(k=>!['source','yearEndMonth','calendar','periods'].includes(k))) return false;
    if (v.yearEndMonth !== undefined && (!Number.isInteger(v.yearEndMonth) || (v.yearEndMonth as number)<1 || (v.yearEndMonth as number)>12)) return false;
    if (v.calendar !== undefined && v.calendar !== 'month' && v.calendar !== 'week') return false;
    return v.periods === undefined || (Array.isArray(v.periods) && v.periods.every(p=>object(p) && (p.kind==='FY'||p.kind==='FQ') && Number.isInteger(p.year) && (p.year as number)>0 && (p.year as number)<=9999 && (p.kind==='FY'||Number.isInteger(p.quarter)&&(p.quarter as number)>=1&&(p.quarter as number)<=4) && typeof p.source==='string' && !!periodDate(p.start) && !!periodDate(p.end) && String(p.start)<=String(p.end)));
  };
  const companies = (v: unknown) => object(v) && Object.values(v).every(company);
  if (!object(raw) || Object.keys(raw).some(k=>!['companies','metadata','overrides'].includes(k)) || raw.companies!==undefined&&!companies(raw.companies) || raw.overrides!==undefined&&!companies(raw.overrides) || raw.metadata!==undefined&&(!object(raw.metadata)||!Object.values(raw.metadata).every(companies))) return invalid();
  return {context:raw as FiscalContext};
}
