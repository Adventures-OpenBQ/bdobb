// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DatasetRow } from '../widgetData/types';
import type { CellResult, FiscalBinding, ModelError } from '../tableModel/types';
import { resolveFiscalPeriod, type FiscalContext, type ResolvedFiscalPeriod } from '../tableModel/fiscalContext';
import type { LinePolicy } from './types';
/** A policy for one resolved measure/member scope, shared by cells and formula dependencies. */
export function evaluateStatementLine(policy: LinePolicy, records: readonly DatasetRow[], valueFieldId: string, context: {
    periodKind: 'FY' | 'FQ';
    companyFieldId: string;
    currencyFieldId?: string;
    unitFieldId?: string;
    fiscal: FiscalBinding;
    fiscalContext?: FiscalContext;
    requestedPeriods?: readonly ResolvedFiscalPeriod[];
    /** Template `required`. Absent = required, the pre-#19 behaviour. */
    required?: boolean;
}): CellResult {
    const fail = (message: string, code: ModelError['code'] = 'scope'): CellResult => ({ ok: false, error: { code, message, recordIds: records.map(r => r.id) } });
    if (policy === 'formula')
        return fail('Formula policies require the bound aggregate evaluator.');
    // #19: a missing value on an optional line is blank ({ok, value: null}), not an error.
    const blank: CellResult = { ok: true, value: null };
    if (!records.length)
        return context.required === false ? blank : fail('The required line has no facts.', 'missing-input');
    for (const field of [context.companyFieldId, context.currencyFieldId, context.unitFieldId].filter((f): f is string => !!f)) {
        if (records.some(r => r.values[field] === undefined || r.values[field] === null))
            return fail(`Required context ${field} is missing.`, 'missing-input');
        if (new Set(records.map(r => JSON.stringify(r.values[field]))).size !== 1)
            return fail(`Mixed ${field} contexts cannot be aggregated.`);
    }
    const checked = [valueFieldId, context.companyFieldId, context.currencyFieldId, context.unitFieldId, ...Object.entries(context.fiscal).filter(([k]) => k.endsWith('FieldId')).map(([, v]) => v)].filter((f): f is string => !!f);
    for (const row of records) {
        for (const field of checked) {
            const error = row.cellErrors?.[field];
            if (error)
                return fail(error.message, 'blocked-dependency');
        }
    }
    // Only when every fact is missing: a partly missing scope is a coverage gap and stays an error below.
    if (context.required === false && records.every(r => [null, undefined, ''].includes(r.values[valueFieldId] as never)))
        return blank;
    const facts: { value: number; period: ResolvedFiscalPeriod }[] = [];
    for (const row of records) {
        const value = row.values[valueFieldId];
        if (typeof value !== 'number')
            return fail('Line value is missing or nonnumeric.', 'missing-input');
        if (!Number.isFinite(value))
            return fail('Line value must be finite.', 'nonfinite');
        const resolved = resolveFiscalPeriod(row, context.fiscal, context.fiscalContext ?? {});
        const period = context.periodKind === 'FY' ? resolved.year : resolved.quarter;
        if (!period.ok)
            return period;
        if (period.value.precision !== 'authoritative')
            return fail('Authoritative fiscal bounds are required for Statement facts.', 'fiscal-context');
        facts.push({ value, period: period.value });
    }
    const coordinates = new Set<string>();
    for (const fact of facts) {
        const key = JSON.stringify([fact.period.year, fact.period.quarter]);
        if (coordinates.has(key))
            return fail('Duplicate facts for the same company, line and fiscal period.');
        coordinates.add(key);
    }
    facts.sort((a, b) => a.period.end.localeCompare(b.period.end));
    if (policy === 'single' && facts.length !== 1)
        return fail('Single-observation policy requires exactly one fact.');
    for (let i = 1; i < facts.length; i++) {
        const previous = facts[i - 1].period, current = facts[i].period;
        if (current.start <= previous.end)
            return fail('Authoritative fact periods overlap.');
        if (policy === 'flow' && Date.parse(current.start) - Date.parse(previous.end) !== 86400000)
            return fail('Flow periods have incomplete coverage.');
    }
    const requested = context.requestedPeriods;
    if (!requested?.length)
        return fail('The requested fiscal scope is unavailable; bind authoritative request periods.', 'fiscal-context');
    const expected = [...requested].sort((a, b) => a.end.localeCompare(b.end));
    if (expected.some(period => period.kind !== context.periodKind || period.precision !== 'authoritative'))
        return fail('The requested fiscal scope lacks authoritative bounds.', 'fiscal-context');
    if (new Set(expected.map(period => period.companyKey)).size !== 1 || expected[0].companyKey !== facts[0].period.companyKey)
        return fail('Requested fiscal scope crosses company contexts.');
    const samePeriod = (a: ResolvedFiscalPeriod, b: ResolvedFiscalPeriod) =>
        a.companyKey === b.companyKey && a.kind === b.kind && a.year === b.year && a.quarter === b.quarter && a.start === b.start && a.end === b.end;
    if (policy === 'stock') {
        if (!samePeriod(facts.at(-1)!.period, expected.at(-1)!))
            return fail('Stock has no fact at the requested latest fiscal endpoint.', 'missing-input');
    } else {
        if (facts.length !== expected.length || expected.some(period => !facts.some(fact => samePeriod(fact.period, period))))
            return fail('Flow or single-observation facts do not cover the requested fiscal scope.', 'missing-input');
    }
    const value = policy === 'flow' ? facts.reduce((sum, f) => sum + f.value, 0) : facts.at(-1)!.value;
    return Number.isFinite(value) ? { ok: true, value } : fail('Policy result must be finite.', 'nonfinite');
}
