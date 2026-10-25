// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import type { ResolvedFiscalPeriod } from '../tableModel/fiscalContext';
import { evaluateStatementLine } from './linePolicy';
const request = (year: number, quarter?: number, start = `${year}-01-01`, end = `${year}-12-31`): ResolvedFiscalPeriod => ({
    kind: quarter ? 'FQ' : 'FY', year, ...(quarter ? {
        quarter
    } : {}), start, end,
    companyKey: 'A', source: 'test authoritative request', precision: 'authoritative', label: String(year), key: String(year),
});
const context = {
    requestedPeriods: [request(2024), request(2025)], periodKind: 'FY' as const, companyFieldId: 'company', currencyFieldId: 'currency', unitFieldId: 'unit', fiscal: {
        companyFieldId: 'company', dateFieldId: 'date', periodKind: 'FY' as const, fiscalYearFieldId: 'year', periodStartFieldId: 'start', periodEndFieldId: 'end'
    }
};
const row = (year: number, value: number) => ({
    id: String(year), values: {
        company: 'A', currency: 'USD', unit: 'dollars', year, date: `${year}-12-31`, start: `${year}-01-01`, end: `${year}-12-31`, value
    }
});
it('stockFlowRatioScopesDiffer: flow sums, stock selects latest explicit endpoint, single refuses rollup', () => {
    const rows = [row(2024, 100), row(2025, 60)];
    expect(evaluateStatementLine('flow', rows, 'value', context)).toEqual({
        ok: true, value: 160
    });
    expect(evaluateStatementLine('stock', rows.reverse(), 'value', context)).toEqual({
        ok: true, value: 60
    });
    expect(evaluateStatementLine('single', rows, 'value', context).ok).toBe(false);
});
it('rejects duplicate stock facts before endpoint selection and incomplete flow spans', () => {
    expect(evaluateStatementLine('stock', [row(2024, 1), {
            ...row(2024, 2), id: 'other'
        }, row(2025, 3)], 'value', context).ok).toBe(false);
    expect(evaluateStatementLine('flow', [row(2023, 1), row(2025, 3)], 'value', context).ok).toBe(false);
});
it('refuses mixed company currency and unit and preserves incoming errors', () => {
    for (const field of ['company', 'currency', 'unit']) {
        const b = row(2025, 3);
        b.values = {
            ...b.values, [field]: 'different'
        };
        expect(evaluateStatementLine('flow', [row(2024, 1), b], 'value', context).ok).toBe(false);
    }
    expect(evaluateStatementLine('flow', [{
            ...row(2024, 1), cellErrors: {
                value: {
                    code: 'blocked-dependency', message: 'upstream'
                }
            }
        }], 'value', context)).toMatchObject({
        ok: false, error: {
            message: 'upstream'
        }
    });
});
it('rejects overlapping authoritative stock intervals with different fiscal labels', () => {
    const b = row(2025, 2);
    b.values.start = '2024-06-01';
    expect(evaluateStatementLine('stock', [row(2024, 1), b], 'value', context).ok).toBe(false);
});
it('FQ flows require disjoint contiguous authoritative quarters', () => {
    const quarterContext = {
        ...context, requestedPeriods: [request(2025, 1, '2025-01-01', '2025-03-31'), request(2025, 2, '2025-04-01', '2025-06-30')], periodKind: 'FQ' as const, fiscal: {
            ...context.fiscal, periodKind: 'FQ' as const, fiscalQuarterFieldId: 'quarter'
        }
    };
    const a = {
        id: 'q1', values: {
            ...row(2025, 10).values, quarter: 1, date: '2025-03-31', start: '2025-01-01', end: '2025-03-31'
        }
    };
    const b = {
        id: 'q2', values: {
            ...row(2025, 20).values, quarter: 2, date: '2025-06-30', start: '2025-04-01', end: '2025-06-30'
        }
    };
    expect(evaluateStatementLine('flow', [a, b], 'value', quarterContext)).toEqual({
        ok: true, value: 30
    });
    b.values.start = '2025-03-01';
    expect(evaluateStatementLine('flow', [a, b], 'value', quarterContext).ok).toBe(false);
    b.values.start = '2025-05-01';
    expect(evaluateStatementLine('flow', [a, b], 'value', quarterContext).ok).toBe(false);
});
// #19: blank unless required. Missing = no facts, or a null/undefined/'' value.
it('an optional line with no facts is blank; a required one is an error', () => {
    expect(evaluateStatementLine('flow', [], 'value', { ...context, required: false })).toEqual({ ok: true, value: null });
    expect(evaluateStatementLine('flow', [], 'value', { ...context, required: true })).toMatchObject({
        ok: false, error: { code: 'missing-input', message: 'The required line has no facts.' }
    });
});
it('an optional line whose values are null, undefined or empty is blank', () => {
    for (const blank of [null, undefined, '']) {
        const b = row(2025, 0) as { id: string; values: Record<string, unknown> };
        b.values.value = blank;
        expect(evaluateStatementLine('flow', [b as never], 'value', { ...context, required: false })).toEqual({ ok: true, value: null });
    }
});
it('real calculation errors on an optional line stay errors', () => {
    const text = row(2025, 0) as { id: string; values: Record<string, unknown> };
    text.values.value = 'n/a';
    expect(evaluateStatementLine('flow', [text as never], 'value', { ...context, required: false }).ok).toBe(false);
    const blocked = { ...row(2025, 0), values: { ...row(2025, 0).values, value: null }, cellErrors: { value: { code: 'blocked-dependency' as const, message: 'upstream' } } };
    expect(evaluateStatementLine('flow', [blocked as never], 'value', { ...context, required: false })).toMatchObject({ ok: false, error: { message: 'upstream' } });
    const noCompany = { ...row(2025, 0), values: { ...row(2025, 0).values, value: null, company: null } };
    expect(evaluateStatementLine('flow', [noCompany as never], 'value', { ...context, required: false }).ok).toBe(false);
});
