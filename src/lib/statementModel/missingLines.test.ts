// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// #19: a missing value on an optional Statement line is blank on screen and in
// exports; a required line with no facts and real calculation errors stay #ERROR.
import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { calculateView } from '../tableExecution/engine';
import { toCsv, toJsonRows, toXlsx } from '../export';
import type { WidgetDataset } from '../widgetData/types';
import { fixture } from './compileFixtures';

const FY2026 = '["string","FY2026"]\u001fstatement/income/1.0.0/measure/value';
const period = (year: number) => ({ symbol: 'ACME', period: 'FY', year, start: `${year}-01-01`, end: `${year}-12-31`, date: `${year}-12-31` });

function run(f: ReturnType<typeof fixture>, rows: WidgetDataset['rows']) {
    const source: WidgetDataset = { ...f.source, rows, columns: [...new Set(rows.flatMap(r => Object.keys(r.values)))].map(id => ({ id, label: id })) };
    const view = calculateView(source, { table: {}, search: '', analytical: f.statement }, { kind: 'none' });
    const line = (label: string) => view.logicalRows.find(r => r.values['\u001egroup'] === label)!;
    return { view, line };
}

// cost_of_revenue has a fact in FY2025 but none in FY2026.
function longShape(required: boolean) {
    const f = fixture();
    f.statement.template = structuredClone(f.statement.template);
    f.statement.template.lines.find(l => l.id === f.ids.line('cost_of_revenue'))!.required = required;
    f.statement.bindings.shape = 'long';
    f.statement.bindings.mappings = [];
    f.statement.bindings.longFields = { itemFieldId: 'item', valueFieldId: 'amount' };
    return run(f, [
        { id: 'r25', values: { ...period(2025), item: f.ids.line('revenue'), amount: 100 } },
        { id: 'c25', values: { ...period(2025), item: f.ids.line('cost_of_revenue'), amount: 60 } },
        { id: 'r26', values: { ...period(2026), item: f.ids.line('revenue'), amount: 120 } },
    ]);
}

it('long shape: an optional line with no facts is blank, not #ERROR', () => {
    const cost = longShape(false).line('cost_of_revenue');
    expect(Object.hasOwn(cost.values, FY2026)).toBe(false);
    expect(cost.cellErrors?.[FY2026]).toBeUndefined();
});

it('long shape: a required line with no facts stays #ERROR', () => {
    const cost = longShape(true).line('cost_of_revenue');
    expect(cost.values[FY2026]).toBe('#ERROR');
    expect(cost.cellErrors?.[FY2026]).toMatchObject({ code: 'missing-input', message: 'The required line has no facts.' });
});

it('a formula that depends on a blank optional line keeps the existing missing-input error', () => {
    const gross = longShape(false).line('Calculated gross profit');
    expect(gross.values[FY2026]).toBe('#ERROR');
});

function wideShape(cost: unknown) {
    const f = fixture();
    return run(f, [
        { id: 'a', values: { ...period(2025), revenue: 100, cost_of_revenue: 60 } },
        { id: 'b', values: { ...period(2026), revenue: 120, cost_of_revenue: cost as number } },
    ]);
}

it('wide shape: a blank cell on an optional line is blank, not #ERROR', () => {
    const { line } = wideShape(null);
    expect(Object.hasOwn(line('cost_of_revenue').values, FY2026)).toBe(false);
    expect(line('cost_of_revenue').cellErrors?.[FY2026]).toBeUndefined();
    expect(line('Calculated gross profit').values[FY2026]).toBe('#ERROR');
});

it('long shape: a nonnumeric value on an optional line stays #ERROR', () => {
    const f = fixture();
    f.statement.bindings.shape = 'long';
    f.statement.bindings.mappings = [];
    f.statement.bindings.longFields = { itemFieldId: 'item', valueFieldId: 'amount' };
    const { line } = run(f, [
        { id: 'r26', values: { ...period(2026), item: f.ids.line('revenue'), amount: 120 } },
        { id: 'c26', values: { ...period(2026), item: f.ids.line('cost_of_revenue'), amount: 'n/a' } },
    ]);
    expect(line('cost_of_revenue').values[FY2026]).toBe('#ERROR');
    expect(line('cost_of_revenue').cellErrors?.[FY2026]).toMatchObject({ message: 'Line value is missing or nonnumeric.' });
});

it('exports the blank as empty in CSV, JSON and XLSX', async () => {
    const { view } = wideShape(null);
    const rows = view.logicalRows.map(r => r.values);
    const columns = view.columns.map(c => c.id);
    const costIndex = rows.findIndex(r => r['\u001egroup'] === 'cost_of_revenue');

    const csv = toCsv(rows, columns).split('\r\n');
    expect(csv[costIndex + 1]).toBe('cost_of_revenue,60,');

    const json = JSON.parse(toJsonRows(rows, columns)) as Record<string, unknown>[];
    expect(json[costIndex]).not.toHaveProperty([FY2026]);

    const sheet = XLSX.read(await toXlsx(rows, columns)).Sheets.Data;
    const cell = XLSX.utils.encode_cell({ r: costIndex + 1, c: columns.indexOf(FY2026) });
    expect(sheet[cell]).toBeUndefined();
});
