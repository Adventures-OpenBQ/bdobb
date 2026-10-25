// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { alignmentWarnings, resolveFiscalPeriod, type FiscalContext } from './fiscalContext';
import type { FiscalBinding } from './types';
const binding: FiscalBinding = { companyFieldId: 'company', dateFieldId: 'date' };
const row = (company: string, date: string, extra = {}) => ({ id: company, values: { company, date, ...extra } });
const fiscal: FiscalContext = { companies: { SEP: { yearEndMonth: 9, source: 'file override' }, DEC: { yearEndMonth: 12, source: 'company metadata' } } };

describe('per-company fiscal context', () => {
  it('fiscalContextResolvesPerCompany', () => {
    expect(resolveFiscalPeriod(row('SEP', '2025-10-01'), binding, fiscal)).toMatchObject({ year: { ok: true, value: { label: 'FY2026', start: '2025-10-01', end: '2026-09-30' } }, quarter: { ok: true, value: { label: 'FY2026-Q1', start: '2025-10-01', end: '2025-12-31' } } });
    expect(resolveFiscalPeriod(row('DEC', '2025-10-01'), binding, fiscal)).toMatchObject({ year: { ok: true, value: { label: 'FY2025', start: '2025-01-01', end: '2025-12-31' } }, quarter: { ok: true, value: { label: 'FY2025-Q4' } } });
  });
  it('missingFiscalContextDoesNotDefaultToDecember', () => {
    expect(resolveFiscalPeriod(row('UNKNOWN', '2026-01-01'), binding, fiscal).year).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
    expect(resolveFiscalPeriod(row('DEC', '2026-01-01'), { companyFieldId: 'company' }, fiscal).year).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
  });
  it('warnsOnDifferentActualBounds', () => {
    const a = resolveFiscalPeriod(row('SEP', '2026-01-01'), binding, fiscal).year;
    const b = resolveFiscalPeriod(row('DEC', '2026-01-01'), binding, fiscal).year;
    if (!a.ok || !b.ok) throw new Error('expected resolved years');
    const warnings = alignmentWarnings([a.value, b.value, a.value]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'fiscal-alignment', periods: [ { companyKey: 'SEP', start: '2025-10-01', end: '2026-09-30', source: 'file override' }, { companyKey: 'DEC', start: '2026-01-01', end: '2026-12-31', source: 'company metadata' } ] });
    expect(warnings[0].message).toContain('FY2026');
    expect(alignmentWarnings([a.value, a.value])).toEqual([]);
  });
  it('authoritativeWeekCalendarOverridesMonthApproximation', () => {
    const context: FiscalContext = { companies: { SEP: { yearEndMonth: 9, calendar: 'week', source: 'provider', periods: [ { kind: 'FY', year: 2026, start: '2025-09-28', end: '2026-09-26', source: 'provider annual' }, { kind: 'FQ', year: 2026, quarter: 1, start: '2025-09-28', end: '2025-12-27', source: 'provider quarter' } ] } } };
    expect(resolveFiscalPeriod(row('SEP', '2025-09-29'), binding, context)).toMatchObject({ year: { ok: true, value: { label: 'FY2026', start: '2025-09-28', end: '2026-09-26', precision: 'authoritative' } }, quarter: { ok: true, value: { label: 'FY2026-Q1', end: '2025-12-27', source: 'provider quarter' } } });
    const annualOnly: FiscalContext = { companies: { SEP: { ...context.companies!.SEP, periods: context.companies!.SEP.periods!.slice(0, 1) } } };
    const partial = resolveFiscalPeriod(row('SEP', '2025-09-29'), binding, annualOnly);
    expect(partial.year.ok).toBe(true);
    expect(partial.quarter).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
    expect(resolveFiscalPeriod(row('SEP', '2027-01-01'), binding, context).year.ok).toBe(false);
  });
  it('uses explicit file period fields and mapped company context', () => {
    const mapped = { ...binding, fiscalYearFieldId: 'FY', fiscalQuarterFieldId: 'FQ', periodStartFieldId: 'start', periodEndFieldId: 'end', metadataKey: 'files' };
    const result = resolveFiscalPeriod(row('SEP', '2025-09-29', { FY: 'FY2026', FQ: 'Q1', start: '2025-09-28', end: '2025-12-27' }), mapped, { metadata: { files: fiscal.companies! } });
    expect(result.quarter).toMatchObject({ ok: true, value: { label: 'FY2026-Q1', start: '2025-09-28', end: '2025-12-27', source: 'bound period fields' } });
    expect(result.year).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
  });
  it('validates leap days and does not roll invalid dates into another period', () => {
    expect(resolveFiscalPeriod(row('DEC', '2024-02-29T23:00:00-05:00'), binding, fiscal).quarter).toMatchObject({ ok: true, value: { start: '2024-01-01', end: '2024-03-31' } });
    for (const date of ['2025-02-29', '2026-13-01', '2026-04-31', 'nonsense']) expect(resolveFiscalPeriod(row('DEC', date), binding, fiscal).year).toMatchObject({ ok: false, error: { code: 'invalid-date' } });
  });
  it('rejects invalid authoritative bounds instead of substituting a month estimate', () => {
    const context: FiscalContext = { companies: { DEC: { yearEndMonth: 12, source: 'provider', periods: [{ kind: 'FY', year: 2026, start: '2026-02-30', end: '2026-12-31', source: 'bad provider' }] } } };
    expect(resolveFiscalPeriod(row('DEC', '2026-06-01'), binding, context).year).toMatchObject({ ok: false, error: { code: 'invalid-date' } });
  });
});

it('uses explicit overrides for month calendars but preserves authoritative provider bounds', () => {
  const overrides = { SEP: { yearEndMonth: 12, source: 'file override' } };
  expect(resolveFiscalPeriod(row('SEP', '2025-10-01'), binding, { ...fiscal, overrides }).year).toMatchObject({ ok: true, value: { label: 'FY2025', source: 'file override' } });
  const authoritative: FiscalContext = { companies: { SEP: { source: 'provider', periods: [{ kind: 'FY', year: 2026, start: '2025-09-28', end: '2026-09-26', source: 'provider annual' }] } }, overrides };
  expect(resolveFiscalPeriod(row('SEP', '2025-10-01'), binding, authoritative).year).toMatchObject({ ok: true, value: { label: 'FY2026', source: 'provider annual' } });
});

it('normalizes authoritative timestamp bounds by date as written', () => {
  const context: FiscalContext = { companies: { DEC: { source: 'provider', periods: [{ kind: 'FY', year: 2026, start: '2026-01-01T00:00:00+12:00', end: '2026-12-31T23:00:00-05:00', source: 'provider dates' }] } } };
  expect(resolveFiscalPeriod(row('DEC', '2026-01-01'), binding, context).year).toMatchObject({ ok: true, value: { start: '2026-01-01', end: '2026-12-31' } });
});

it.each([undefined, '', 'Q5'])('resolves bound annual inputs independently of missing or invalid mapped quarter %s', FQ => {
  const mapped: FiscalBinding = { ...binding, fiscalYearFieldId: 'FY', fiscalQuarterFieldId: 'FQ', periodStartFieldId: 'start', periodEndFieldId: 'end' };
  const result = resolveFiscalPeriod(row('A', '2026-06-01', { FY: 'FY2026', FQ, start: '2026-01-01', end: '2026-12-31' }), mapped, {});
  expect(result.year).toMatchObject({ ok: true, value: { kind: 'FY', label: 'FY2026', start: '2026-01-01', end: '2026-12-31', source: 'bound period fields', precision: 'authoritative' } });
  expect(result.quarter).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
});

it('keeps ambiguous authoritative overlaps as fiscal errors independently by period kind', () => {
  const context: FiscalContext = { companies: { A: { source: 'provider', periods: [
    { kind: 'FY', year: 2026, start: '2026-01-01', end: '2026-12-31', source: 'annual' },
    { kind: 'FQ', year: 2026, quarter: 2, start: '2026-04-01', end: '2026-06-30', source: 'quarter' },
    { kind: 'FQ', year: 2026, quarter: 3, start: '2026-06-01', end: '2026-08-31', source: 'overlap' },
  ] } } };
  const result = resolveFiscalPeriod(row('A', '2026-06-01'), binding, context);
  expect(result.year).toMatchObject({ ok: true, value: { label: 'FY2026', start: '2026-01-01', end: '2026-12-31', source: 'annual' } });
  expect(result.quarter).toMatchObject({ ok: false, error: { code: 'fiscal-context', message: expect.stringContaining('overlap') } });
});

it.each(['', 'Q5'])('resolves an explicitly annual stub period independently of invalid quarter %s', FQ => {
  const mapped: FiscalBinding = { ...binding, periodKind: 'FY', fiscalYearFieldId: 'FY', fiscalQuarterFieldId: 'FQ', periodStartFieldId: 'start', periodEndFieldId: 'end' };
  const result = resolveFiscalPeriod(row('A', '2026-06-01', { FY: 'FY2026', FQ, start: '2026-04-01', end: '2026-09-30' }), mapped, {});
  expect(result.year).toMatchObject({ ok: true, value: { kind: 'FY', label: 'FY2026', start: '2026-04-01', end: '2026-09-30', source: 'bound period fields' } });
  expect(result.quarter).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
});

it('never interprets declared quarterly bounds or ambiguous old bounds as annual', () => {
  const mapped: FiscalBinding = { ...binding, fiscalYearFieldId: 'FY', fiscalQuarterFieldId: 'FQ', periodStartFieldId: 'start', periodEndFieldId: 'end' };
  const input = row('A', '2026-06-01', { FY: 'FY2026', FQ: 'Q2', start: '2026-04-01', end: '2026-06-30' });
  expect(resolveFiscalPeriod(input, { ...mapped, periodKind: 'FQ' }, {}).year).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
  const invalidQuarter = { ...input, values: { ...input.values, FQ: 'Q5' } };
  expect(resolveFiscalPeriod(invalidQuarter, mapped, {}).year).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
  expect(resolveFiscalPeriod(invalidQuarter, { ...mapped, periodKind: 'FQ' }, {}).quarter).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
});

it('does not use declared annual bounds as quarter bounds even with a valid quarter label', () => {
  const mapped: FiscalBinding = { ...binding, periodKind: 'FY', fiscalYearFieldId: 'FY', fiscalQuarterFieldId: 'FQ', periodStartFieldId: 'start', periodEndFieldId: 'end' };
  const result = resolveFiscalPeriod(row('A', '2026-06-01', { FY: 'FY2026', FQ: 'Q2', start: '2026-01-01', end: '2026-12-31' }), mapped, {});
  expect(result.year.ok).toBe(true);
  expect(result.quarter).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
});

it('does not approximate an explicitly declared bound period when its fields are missing', () => {
  const result = resolveFiscalPeriod(row('DEC', '2026-06-01'), { ...binding, periodKind: 'FY' }, fiscal);
  expect(result.year).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
  expect(result.quarter).toMatchObject({ ok: false, error: { code: 'fiscal-context' } });
});
