// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { calculateView } from './engine';
import { createResultStore } from './resultStore';
import { validateExecutionRequest, validateExecutionResponse } from './validation';
import { input, revision } from './fixtures';
import { LABEL_FIELD } from '../pivotTable';
import type { TableModelV1 } from '../tableModel/types';
const analytical: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [{ id: 'regionCategory', name: 'Region', sourceFieldId: 'region', transform: 'native' }], measures: [{ id: 'sum', sourceFieldId: 'revenue', aggregation: 'sum' }], formulas: [{ id: 'broken', name: 'Broken', scope: 'aggregate', expression: '1/0', ast: { kind: 'binary', operator: '/', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 0 } } }], layout: { rows: ['regionCategory'], columns: [], values: ['broken'] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: true } };
it('validates analytical requests and serves one scoped revision across blocks, facets, totals, charts', () => {
    const definition = { table: {}, search: '', analytical };
    expect(validateExecutionRequest({ kind: 'applyModel', requestId: 'r', revision, definition, selection: { kind: 'none' } })).toMatchObject({ kind: 'applyModel' });
    const view = calculateView(input, definition, { kind: 'none' });
    const store = createResultStore(view, revision);
    const ready = store.ready('ready', revision);
    expect(ready.topLevelCount).toBe(2);
    expect(JSON.stringify(ready)).not.toContain('sourceDependencies');
    expect(validateExecutionResponse(ready, revision, 'ready')).toEqual(ready);
    const block = store.rows('block', revision, { groupPath: [], offset: 0, limit: 1 });
    expect(block.rows).toHaveLength(1);
    expect(block.rows[0].values.sum).toBe(30);
    expect(block.rows[0].values.broken).toBe('#ERROR');
    expect(block.rows[0].cellErrors?.broken.code).toBe('division-by-zero');
    expect(validateExecutionResponse(block, revision, 'block')).toEqual(block);
    expect(store.totals('t', revision).values.sum).toBe(120);
    expect(store.facets('f', revision, 'regionCategory').members).toHaveLength(2);
    expect(store.chartData('chart', revision, ['sum']).rows).toHaveLength(2);
    expect(store.selection('sel', revision, { kind: 'all' }, []).eligibleCount).toBe(2);
    expect(store.totals('t2', revision).values.sum).toBe(120);
});
it('changes canonical namespace when temporal recipe changes and preserves totals under folding', () => {
    const first = { ...analytical, categories: [{ id: 'regionCategory', name: 'Region', sourceFieldId: 'date', transform: 'Y' as const }] };
    const year = calculateView(input, { table: {}, search: '', analytical: first }, { kind: 'none' });
    const quarter = calculateView(input, { table: {}, search: '', analytical: { ...first, categories: [{ ...first.categories[0], transform: 'Q' }] } }, { kind: 'none' });
    expect(year.selectionNamespace).not.toBe(quarter.selectionNamespace);
    const selected = calculateView(input, { table: { pivot: { enabled: true, grouping: [], split: [], expanded: {} } }, search: '', analytical: first }, { kind: 'explicit', ids: [year.groups[0].id] });
    expect(selected.totals).toEqual(year.totals);
});
it('carries incoming field errors through child formulas and preserves numeric formula formatting overrides', () => {
    const data = structuredClone(input);
    data.rows[0].cellErrors = { revenue: { code: 'division-by-zero', message: 'Producer failed' } };
    data.columns[0].format = { formatterFn: 'normalizedPercent' };
    const raw = structuredClone(analytical);
    raw.formulas = [{ id: 'counted', name: 'Count', scope: 'aggregate', expression: '', format: 'decimal', ast: { kind: 'call', function: 'count', args: [{ kind: 'reference', target: 'field', id: 'revenue' }] } }, { id: 'rowFormula', name: 'Row', scope: 'source', expression: '', ast: { kind: 'reference', target: 'field', id: 'revenue' } }];
    raw.layout.values = ['sum', 'counted'];
    const view = calculateView(data, { table: {}, search: '', analytical: raw }, { kind: 'none' });
    expect(view.groups[0].rows[0].cellErrors?.sum.code).toBe('blocked-dependency');
    expect(view.analytical?.pool.formulaCells.get('r0')?.get('rowFormula')).toMatchObject({ ok: false });
    expect(view.columns.find(c => c.id === 'counted')?.format?.formatterFn).toBe('none');
});
it('publishes split totals under output column bindings and preserves error metadata on bounded leaves', () => {
    const raw = structuredClone(analytical);
    raw.layout = { rows: [], columns: ['regionCategory'], values: [] };
    const view = calculateView(input, { table: {}, search: '', analytical: raw }, { kind: 'none' });
    const sumColumns = view.columns.filter(c => c.measureId === 'sum');
    expect(sumColumns).toHaveLength(2);
    expect(sumColumns.map(c => view.totals.values[c.id])).toEqual([30, 90]);
});
it('carries failed source-measure cells into leaf delivery without object displays', () => {
 const raw=structuredClone(analytical);raw.formulas=[{id:'failed',name:'Failed',scope:'source',expression:'',ast:{kind:'binary',operator:'/',left:{kind:'literal',value:1},right:{kind:'literal',value:0}}}];raw.measures=[{id:'computed',sourceFieldId:'failed',aggregation:'sum'}];
 const view=calculateView(input,{table:{},search:'',analytical:raw},{kind:'none'});const store=createResultStore(view,revision);
 const leaf=store.rows('leaf',revision,{groupPath:[view.groups[0].id],offset:0,limit:1}).rows[0];expect(leaf.values.computed).toBe('#ERROR');expect(leaf.cellErrors?.computed.code).toBe('division-by-zero');
});
it('keeps column-only grand totals out of root rows, Select all, charts and subsets', () => {
    const raw = structuredClone(analytical); raw.layout = {rows:[],columns:['regionCategory'], values: []};
    const view = calculateView(input,{table:{},search:'',analytical:raw},{kind:'none'});
    const store = createResultStore(view,revision);
    expect(store.ready('ready',revision).topLevelCount).toBe(0);
    expect(store.rows('rows',revision,{groupPath:[],offset:0,limit:10}).rows).toEqual([]);
    expect(store.selection('all',revision,{kind:'all'},[])).toMatchObject({eligibleCount:0,selectedCount:0});
    expect(store.chartData('chart',revision,view.columns.map(c=>c.id)).rows).toEqual([]);
    expect([...store.presented('subset',revision,'transfer')].flatMap(batch=>batch.rows)).toEqual([]);
    expect(view.columns.filter(c=>c.measureId==='sum').map(c=>store.totals('totals',revision).values[c.id])).toEqual([30,90]);
});

it('disabled adversarial report retains source filters errors identities and private calculation inputs across deliveries',async()=>{
 const {pivotOffData,pivotOffDefinition,pivotOffModel}=await import('./testContract');
 const view=calculateView(pivotOffData,pivotOffDefinition,{kind:'explicit',ids:['keep']});const store=createResultStore(view,revision);
 expect(view.logicalRows.map(row=>row.id)).toEqual(['keep']);expect(view.groups).toEqual([]);
 expect(view.logicalRows[0].values.sourceComputed).toBe(15);expect(view.logicalRows[0].cellErrors?.sourceError.code).toBe('division-by-zero');
 expect(view.columns.map(c=>c.id)).not.toContain('secret');expect(view.columns.some(c=>c.splitPath||c.measureId)).toBe(false);
 expect(view.analytical?.errors).toEqual([]);expect(view.analytical?.complete).toBe(true);expect(view.analytical?.compiled.model.layout).toEqual(pivotOffModel.layout);
 expect(store.totals('off',revision).values).toEqual({});expect(store.chartData('chart',revision,['sourceComputed']).rows).toMatchObject([{id:'keep',values:{sourceComputed:15}}]);
 expect(store.rows('rows',revision,{groupPath:[],offset:0,limit:10}).rows.map(r=>r.id)).toEqual(['keep']);
 const invalid=calculateView(pivotOffData,{...pivotOffDefinition,analytical:{...pivotOffModel,layout:{...pivotOffModel.layout,values:['unknown']}}},{kind:'none'});
 expect(invalid.diagnostics).toContainEqual(expect.objectContaining({severity:'error'}));expect(invalid.analytical?.complete).toBe(false);
 const on=calculateView(pivotOffData,{...pivotOffDefinition,analytical:{...pivotOffModel,enabled:true}},{kind:'none'});
 expect(on.logicalRows).toEqual([]);expect(on.analytical?.compiled.model.layout).toEqual(pivotOffModel.layout);
});
it('echoes exact authored params and bounded unmatched diagnostics through the result boundary',()=>{
 const model={...analytical,formulas:[],layout:{...analytical.layout,values:['sum']},params:{promotePage:false,filters:[{id:'region-param',categoryId:'regionCategory',label:'Region',multiSelect:true}]},checklists:[{categoryId:'regionCategory',memberKeys:Array.from({length:20},(_,i)=>`["string","${'x'.repeat(300)}${i}"]`)}]};
 const definition={table:{},search:'',analytical:model};const view=calculateView(input,definition,{kind:'none'});const ready=createResultStore(view,revision).ready('r',revision);
 expect(ready.inspection.definition).toEqual(definition);expect(ready.topLevelCount).toBe(0);
 const diagnostic=ready.diagnostics.find(d=>d.code==='PIVOT_PARAM_UNMATCHED')!;expect(diagnostic).toMatchObject({key:'pivot:filter:regionCategory',unmatchedCount:20,truncated:true});expect(diagnostic.memberKeys).toHaveLength(8);expect(diagnostic.memberKeys!.every(k=>k.length<=256)).toBe(true);expect(diagnostic.message.length).toBeLessThanOrEqual(1024);
 expect(validateExecutionResponse(ready,revision,'r')).toEqual(ready);
 for(const patch of [{memberKeys:Array(9).fill('a')},{memberKeys:['x'.repeat(257)]},{key:'x'.repeat(513)},{message:'x'.repeat(1025)},{unmatchedCount:-1},{truncated:'yes'}])expect(()=>validateExecutionResponse({...ready,diagnostics:[{...diagnostic,...patch}]},revision,'r')).toThrow();
});
it('groups object category cells by the column-declared display field, and refuses undeclared objects (#17)', () => {
    const names = [['Ethereum', 45], ['Bitcoin', 35], ['Solana', 8]] as const;
    const data = structuredClone(input);
    data.rows = names.map(([value, tvl], i) => ({ id: `h${i}`, values: { name: { value, url: `https://example.test/${i}` }, tvl } }));
    data.columns = [{ id: 'name', label: 'Name', dtype: 'object', metadata: { cellField: 'value' } }, { id: 'tvl', label: 'TVL', dtype: 'number' }];
    const model: TableModelV1 = { ...analytical, formulas: [], categories: [{ id: 'nameCategory', name: 'Name', sourceFieldId: 'name', transform: 'native' }], measures: [{ id: 'total', sourceFieldId: 'tvl', aggregation: 'sum' }], layout: { rows: ['nameCategory'], columns: [], values: ['total'] } };
    const definition = { table: {}, search: '', analytical: model };
    const view = calculateView(data, definition, { kind: 'none' });
    const block = createResultStore(view, revision).rows('block', revision, { groupPath: [], offset: 0, limit: 10 });
    expect(validateExecutionResponse(block, revision, 'block')).toEqual(block);
    expect(JSON.stringify(block)).not.toContain('[object Object]');
    expect(Object.fromEntries(block.rows.map(row => [row.values[LABEL_FIELD], row.values.total]))).toEqual({ Ethereum: 45, Bitcoin: 35, Solana: 8 });
    // No declared key (a local file): an object with a scalar `value` groups
    // by it, as the reference Hover Card shape reads (user ruling 2026-10-09).
    const undeclared = structuredClone(data);
    delete undeclared.columns[0].metadata;
    const local = calculateView(undeclared, definition, { kind: 'none' });
    const localBlock = createResultStore(local, revision).rows('block', revision, { groupPath: [], offset: 0, limit: 10 });
    expect(Object.fromEntries(localBlock.rows.map(row => [row.values[LABEL_FIELD], row.values.total]))).toEqual({ Ethereum: 45, Bitcoin: 35, Solana: 8 });
    // Any other object shape with no declared key is still refused.
    const shapeless = structuredClone(undeclared);
    shapeless.rows = shapeless.rows.map(row => ({ ...row, values: { ...row.values, name: { label: 'x' } } }));
    const refused = calculateView(shapeless, definition, { kind: 'none' });
    expect(refused.groups).toHaveLength(0);
    expect(JSON.stringify(refused.diagnostics)).toContain('declares no display field');
});
