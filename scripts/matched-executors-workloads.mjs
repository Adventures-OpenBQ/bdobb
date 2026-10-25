// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from "node:fs/promises";
import {join} from "node:path";
const root=new URL("..",import.meta.url).pathname;
export async function workloads(tools) {
    const frozen = async (name) => tools.decodeWire(JSON.parse(await readFile(join(root, 'src/test/fixtures/rust-pivot', `${name}.json`), 'utf8'))).case;
    const scale = (c, count) => ({ ...c, dataset: { ...c.dataset, rows: Array.from({ length: count }, (_, i) => ({ ...c.dataset.rows[i % c.dataset.rows.length], values: structuredClone(c.dataset.rows[i % c.dataset.rows.length].values), id: `bench-${i}` })) } });
    const synthetic = count => ({ dataset: { rows: Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, values: { region: `item${i % 20}`, bucket: `item${i % 100}`, revenue: i % 1000, cost: i % 700, profit: i % 300 } })), columns: ['region', 'bucket', 'revenue', 'cost', 'profit'].map(id => ({ id, label: id, dtype: id === 'region' || id === 'bucket' ? 'text' : 'number' })), resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: 'source' }, completeness: { kind: 'complete', warnings: [] }, freshness: { availability: 'available', stale: false } }, definition: { table: { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum', cost: 'sum', profit: 'sum' } } }, search: '' }, runtimeParams: {} });
    const small = synthetic(100), large = synthetic(10000), representative = synthetic(20000), wide = synthetic(2000);
    wide.definition.table.pivot.split = ['bucket'];
    const largeRaw = { ...large, definition: { table: {}, search: '' } };
    const formula = scale(await frozen('ratio-source-scope'), 500);
    const model = formula.definition.analytical;
    const ratio = model.formulas[0];
    model.formulas = Array.from({ length: 20 }, (_, i) => ({ ...ratio, id: `ratio${i}`, name: `Ratio ${i}` }));
    model.layout.values = model.formulas.map(f => f.id);
    model.formulas.push(...Array.from({ length: 20 }, (_, i) => ({ id: `source${i}`, name: `Source ${i}`, scope: 'source', expression: '', ast: { kind: 'binary', operator: '+', left: { kind: 'reference', target: 'field', id: 'x' }, right: { kind: 'literal', value: i } } })));
    const scaled = {};
    for (const n of [1000,5000,10000]) { scaled[`grouped${n}`] = synthetic(n); scaled[`grouped${n}`].dataset.rows.forEach((r,i)=>{r.values.revenue=i;}); }
    for (const n of [1,5,20]) { const c=structuredClone(formula); c.definition.analytical.formulas=c.definition.analytical.formulas.filter(f=>f.scope==='source'||Number(f.id.slice(5))<n); c.definition.analytical.layout.values=Array.from({length:n},(_,i)=>`ratio${i}`); scaled[`formula${n}`]=c; }
    return { ...scaled, small, large, representative, largeRaw, wide, mixedOriginal: await frozen('typed-blanks'), mixed: scale(await frozen('typed-blanks'), 1000), fiscal: scale(await frozen('mixed-fiscal-calendars'), 120), formula };
}