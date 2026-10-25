// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it, vi } from 'vitest';
import { compileAnalyticalModel, calculateTable } from './calculate';
import { evaluateSourceFormulas } from './formulaEvaluation';
import { bindFormula } from './formulaBinding';
import type { TableModelV1 } from './types';
import type { WidgetDataset } from '../widgetData/types';
export const model = (): TableModelV1 => ({ schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [{ id: 'year', name: 'Year', sourceFieldId: 'date', transform: 'Y' }, { id: 'quarter', name: 'Quarter', sourceFieldId: 'date', transform: 'Q' }], measures: [{ id: 'rev', sourceFieldId: 'revenue', aggregation: 'sum' }], formulas: [], layout: { rows: ['year', 'quarter'], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: true } });
export const source = (): WidgetDataset => ({ columns: [{ id: 'date', label: 'Date', dtype: 'dateString' }, { id: 'revenue', label: 'Revenue', dtype: 'number' }], rows: [{ id: 'a', values: { date: '2025-01-01', revenue: 80 } }, { id: 'b', values: { date: '2025-04-01', revenue: 20 } }, { id: 'c', values: { date: '2026-01-01', revenue: 20 } }], resultRevision: 1, outputRevision: 1, provenance: { sourceWidgetId: 'test' }, freshness: { availability: 'available', stale: false }, completeness: { kind: 'complete', warnings: [] } });
it('compiles independent imported definitions using actual schema and retains invalid entries', () => {
    const raw = model();
    raw.formulas = [{ id: 'good', name: 'Good', scope: 'source', expression: 'Revenue', ast: { kind: 'reference', target: 'field', id: 'revenue' } }, { id: 'bad', name: 'Bad', scope: 'source', expression: '', ast: { kind: 'nonsense' } as never }];
    const compiled = compileAnalyticalModel(raw, { columns: source().columns });
    expect(compiled.graph.externalValidation).toBe('complete');
    const result = evaluateSourceFormulas(source().rows, compiled);
    expect(result.rows[0].values.good).toBe(80);
    expect(result.formulaCells.get('a')?.get('bad')).toMatchObject({ ok: false });
    expect(compileAnalyticalModel(raw).graph.externalValidation).toBe('not-performed');
});
it('binds measure source aliases, preserves stable absent member intent, and rejects sibling aliases', () => {
    const raw = model();
    raw.formulas = [{ id: 'compare', name: 'Compare', scope: 'aggregate', expression: '', ast: { kind: 'member', value: { kind: 'reference', target: 'measure', id: 'rev' }, selectors: [{ categoryId: 'year', memberKey: '["string","2024"]' }] } }];
    let compiled = compileAnalyticalModel(raw, { columns: source().columns });
    expect(compiled.graph.order).toContain('compare');
    expect(bindFormula({ kind: 'name', name: 'Revenue' }, compiled.symbols, 'aggregate').ast).toMatchObject({ target: 'measure', id: 'rev' });
    raw.measures.push({ id: 'rev2', sourceFieldId: 'revenue', aggregation: 'last' });
    compiled = compileAnalyticalModel(raw, { columns: source().columns });
    expect(bindFormula({ kind: 'name', name: 'Revenue' }, compiled.symbols, 'aggregate').diagnostics[0]?.code).toBe('ambiguous-reference');
});
it('qualifies once at Year and Quarter then recomputes underlying record totals', () => {
    const raw = model();
    raw.resultFilters = [{ id: 'annual', categoryId: 'year', target: { kind: 'measure', id: 'rev' }, predicate: 'gt', value: 90 }, { id: 'quarterly', categoryId: 'quarter', target: { kind: 'measure', id: 'rev' }, predicate: 'gt', value: 50 }];
    const result = calculateTable({ source: source(), model: raw, table: {}, search: '' });
    expect([...result.recordIds]).toEqual(['a']);
    expect(result.totals.measures.cells.get('rev')).toEqual({ ok: true, value: 80 });
    expect(result.complete).toBe(true);
});
it('recomputes counterpart totals from surviving disjoint contexts and keeps excluded members errors', () => {
    const raw = model();
    raw.categories = [{ id: 'scenario', name: 'Scenario', sourceFieldId: 'scenarioInput', transform: 'native' }, { id: 'company', name: 'Company', sourceFieldId: 'companyInput', transform: 'native' }];
    raw.layout = { rows: ['company'], columns: [], values: [], page: { categoryId: 'scenario', memberKeys: ['["string","Actual"]'] } };
    raw.formulas = [{ id: 'budget', name: 'Budget', scope: 'aggregate', expression: '', ast: { kind: 'member', value: { kind: 'reference', target: 'measure', id: 'rev' }, selectors: [{ categoryId: 'scenario', memberKey: '["string","Budget"]' }] } }];
    raw.resultFilters = [{ id: 'keep', categoryId: 'company', target: { kind: 'measure', id: 'rev' }, predicate: 'gt', value: 50 }];
    const data = source();
    data.columns.push({ id: 'scenarioInput', label: 'Scenario' }, { id: 'companyInput', label: 'Company' });
    data.rows = [['a', 'A', 'Actual', 100], ['b', 'A', 'Budget', 70], ['c', 'B', 'Actual', 10], ['d', 'B', 'Budget', 999]].map(([id, companyInput, scenarioInput, revenue]) => ({ id: String(id), values: { companyInput, scenarioInput, revenue } }));
    let result = calculateTable({ source: data, model: raw, table: {}, search: '' });
    expect(result.totals.formulas.cells.get('budget')).toEqual({ ok: true, value: 70 });
    raw.checklists = [{ categoryId: 'scenario', memberKeys: ['["string","Actual"]'] }];
    result = calculateTable({ source: data, model: raw, table: {}, search: '' });
    expect(result.totals.formulas.cells.get('budget')).toMatchObject({ ok: false, error: { code: 'excluded-member' } });
});
it('keeps unavailable result categories visible and empty qualification empty', () => {
    const raw = model();
    raw.resultFilters = [{ id: 'bad', categoryId: 'lost', target: { kind: 'measure', id: 'rev' }, predicate: 'gt', value: 0 }];
    let result = calculateTable({ source: source(), model: raw, table: {}, search: '' });
    expect(result.complete).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'missing-reference' }));
    raw.resultFilters[0].categoryId = 'year';
    raw.resultFilters[0].value = 1000;
    result = calculateTable({ source: source(), model: raw, table: {}, search: '' });
    expect(result.recordIds.size).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.totals.empty).toBe(true);
});
it('preserves disjoint company/period counterpart contexts even when company is not laid out', () => {
    const raw = model();
    raw.categories.push({ id: 'scenario', name: 'Scenario', sourceFieldId: 'scenarioInput', transform: 'native' });
    raw.layout.page = { categoryId: 'scenario', memberKeys: ['["string","Actual"]'] };
    raw.formulas = [{ id: 'budget', name: 'Budget', scope: 'aggregate', expression: '', ast: { kind: 'member', value: { kind: 'reference', target: 'measure', id: 'rev' }, selectors: [{ categoryId: 'scenario', memberKey: '["string","Budget"]' }] } }];
    const data = source();
    data.columns.push({ id: 'company', label: 'Company' }, { id: 'scenarioInput', label: 'Scenario' });
    data.rows = [['a', 'A', '2025-01-01', 'Actual', 10], ['b', 'B', '2025-04-01', 'Actual', 20], ['ab', 'A', '2025-01-01', 'Budget', 1], ['bb', 'B', '2025-04-01', 'Budget', 2], ['cross1', 'B', '2025-01-01', 'Budget', 100], ['cross2', 'A', '2025-04-01', 'Budget', 200]].map(([id, company, date, scenarioInput, revenue]) => ({ id: String(id), values: { company, date, scenarioInput, revenue } }));
    const result = calculateTable({ source: data, model: raw, table: {}, search: '', context: { temporalContext: { dateFieldId: 'date', companyFieldId: 'company' } } });
    expect(result.totals.formulas.cells.get('budget')).toEqual({ ok: true, value: 3 });
});
it('recomputed parent comparisons retain surviving child scope without rerunning qualification', () => {
    const raw = model();
    raw.categories.push({ id: 'scenario', name: 'Scenario', sourceFieldId: 'scenarioInput', transform: 'native' });
    raw.layout.page = { categoryId: 'scenario', memberKeys: ['["string","Actual"]'] };
    raw.formulas = [{ id: 'budget', name: 'Budget', scope: 'aggregate', expression: '', ast: { kind: 'member', value: { kind: 'reference', target: 'measure', id: 'rev' }, selectors: [{ categoryId: 'scenario', memberKey: '["string","Budget"]' }] } }];
    raw.resultFilters = [{ id: 'q', categoryId: 'quarter', target: { kind: 'measure', id: 'rev' }, predicate: 'gt', value: 50 }];
    const data = source();
    data.columns.push({ id: 'scenarioInput', label: 'Scenario' });
    data.rows = [['a', '2025-01-01', 'Actual', 80], ['b', '2025-04-01', 'Actual', 20], ['ab', '2025-01-01', 'Budget', 7], ['bb', '2025-04-01', 'Budget', 999]].map(([id, date, scenarioInput, revenue]) => ({ id: String(id), values: { date, scenarioInput, revenue } }));
    raw.layout.values = ['rev', 'budget'];
    const displayed = calculateTable({ source: data, model: raw, table: {}, search: '' });
    expect(displayed.groups[0].rows[0].values.budget).toBe(7);
});
it('uses validated explicit fiscal metadata and reports malformed context without guessing', () => {
    const raw = model();
    raw.categories = [{ id: 'year', name: 'Fiscal', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'company' } }];
    raw.layout = { rows: ['year'], columns: [], values: [] };
    const data = source();
    data.columns.push({ id: 'company', label: 'Company' });
    data.rows = data.rows.map(row => ({ ...row, values: { ...row.values, company: 'A' } }));
    data.provenance.metadata = { fiscalContext: { companies: { A: { yearEndMonth: 6, source: 'file' } } } };
    let result = calculateTable({ source: data, model: raw, table: {}, search: '' });
    expect(result.groups[0]?.rows[0].values['\x1egroup']).toBe('FY2025');
    data.provenance.metadata = { fiscalContext: { companies: { A: { yearEndMonth: 99, source: 'file' } } } };
    result = calculateTable({ source: data, model: raw, table: {}, search: '' });
    expect(result.complete).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'fiscal-context' }));
});
it('does not poison a known 2026 page with a failed 2024 source predicate', () => {
    const raw = model();
    raw.layout.page = { categoryId: 'year', memberKeys: ['["string","2026"]'] };
    raw.layout.rows = ['quarter'];
    raw.formulas = [{ id: 'positive', name: 'Positive', scope: 'source', expression: '', ast: { kind: 'binary', operator: '/', left: { kind: 'literal', value: 1 }, right: { kind: 'reference', target: 'field', id: 'revenue' } } }];
    const data = source();
    data.rows = [{ id: 'old', values: { date: '2024-01-01', revenue: 0 } }, { id: 'new', values: { date: '2026-01-01', revenue: 10 } }];
    const result = calculateTable({ source: data, model: raw, table: { columnFilters: [{ id: 'positive', value: { min: 0 } }] }, search: '' });
    expect(result.totals.measures.cells.get('rev')).toEqual({ ok: true, value: 10 });
    expect(result.complete).toBe(true);
});
it('keeps unknown required category conservative and does not use inherited errored values as members', () => {
    const data = source();
    data.rows[0].cellErrors = { date: { code: 'invalid-date', message: 'Producer date unavailable' } };
    const result = calculateTable({ source: data, model: model(), table: {}, search: '' });
    expect(result.pool.members.get('a')?.get('year')).toMatchObject({ ok: false });
    expect(result.complete).toBe(false);
});
it('retains missing measure bindings as visible error columns without treating outputs as raw fields', () => {
    const raw = model();
    raw.measures.push({ id: 'missing', sourceFieldId: 'lost', aggregation: 'sum' });
    const result = calculateTable({ source: source(), model: raw, table: {}, search: '' });
    expect(result.columns.some(c => c.id === 'missing')).toBe(true);
    expect(result.groups[0].rows[0].values.missing).toBe('#ERROR');
});
it('never promotes emitted columns into input symbols and refuses colliding measure source bindings', () => {
    const raw = model();
    raw.formulas = [{ id: 'revenue', name: 'Overwrite', scope: 'source', expression: '999', ast: { kind: 'literal', value: 999 } }];
    const result = calculateTable({ source: source(), model: raw, table: {}, search: '' });
    expect(result.pool.rows[0].values.revenue).toBe(80);
    expect(result.totals.measures.cells.get('rev')).toMatchObject({ ok: false, error: { code: 'ambiguous-reference' } });
});
it('keeps source qualification failures visible when every source row is excluded', () => {
    const warnings=vi.spyOn(console,'warn');
    const raw = model();
    raw.formulas = [{id:'inverse',name:'Inverse',scope:'source',expression:'1 / Revenue',ast:{kind:'binary',operator:'/',left:{kind:'literal',value:1},right:{kind:'reference',target:'field',id:'revenue'}}}];
    const data = source(); data.rows = data.rows.map(row => ({...row, values:{...row.values,revenue:0}}));
    const result = calculateTable({source:data,model:raw,table:{columnFilters:[{id:'inverse',value:{min:0}}]},search:''});
    expect(result.rows).toEqual([]);
    expect(result.totals.empty).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({code:'division-by-zero',recordIds:['a']})]));
    expect(warnings).not.toHaveBeenCalled();warnings.mockRestore();
});
it.each([false,true])('sorts flat analytical rows after qualification with stable ties and blanks last, desc=%s', desc => {
    const raw=model();raw.layout={rows:[],columns:[], values: []};
    const data=source();data.rows=[['a',10],['c',30],['b',10],['blank',null]].map(([id,revenue])=>({id:String(id),values:{revenue,date:'2026-01-01'}}));
    const result=calculateTable({source:data,model:raw,table:{sorting:[{id:'revenue',desc}]},search:''});
    expect(result.rows.map(row=>row.id)).toEqual(desc?['c','a','b','blank']:['a','b','c','blank']);
    expect(result.eligibleRows.map(row=>row.id)).toEqual(result.rows.map(row=>row.id));
    expect(result.totals.measures.cells.get('rev')).toEqual({ok:true,value:50});
});
it.each([false,true])('sorts grouped leaves through duplicate measure bindings, desc=%s', desc => {
    const raw=model();raw.layout={rows:['year'],columns:[], values: []};raw.measures.push({id:'copy',sourceFieldId:'revenue',aggregation:'median'});
    const data=source();data.rows=[['a',10],['c',30],['b',10],['blank',null]].map(([id,revenue])=>({id:String(id),values:{revenue,date:'2026-01-01'}}));
    const result=calculateTable({source:data,model:raw,table:{sorting:[{id:'copy',desc}]},search:''});
    expect(result.groups[0].rows.slice(1).map(row=>row.id)).toEqual(desc?['c','a','b','blank']:['a','b','c','blank']);
    expect(result.rows.slice(1).map(row=>row.id)).toEqual(result.groups[0].rows.slice(1).map(row=>row.id));
});
it.each([false,true])('sorts structural category values before a colliding measure and preserves equal-category leaves, desc=%s', desc => {
    const raw=model();raw.layout={rows:['year'],columns:[], values: []};raw.measures=[{id:'year',sourceFieldId:'revenue',aggregation:'sum'}];
    const data=source();data.rows=[{id:'a',values:{date:'2025-01-01',revenue:90}},{id:'b',values:{date:'2025-02-01',revenue:10}},{id:'c',values:{date:'2026-01-01',revenue:20}}];
    const result=calculateTable({source:data,model:raw,table:{sorting:[{id:'year',desc}]},search:''});
    expect(result.groups.map(group=>group.rows[0].values['\x1egroup'])).toEqual(desc?['2026','2025']:['2025','2026']);
    expect(result.groups.find(group=>group.rows[0].values['\x1egroup']==='2025')?.rows.slice(1).map(row=>row.id)).toEqual(['a','b']);
    expect(result.eligibleRows.map(row=>row.id)).toEqual(result.groups.map(group=>group.id));
});
it('ignores a deeper category sort at ancestor levels and sorts child groups only',()=>{
    const raw=model();raw.measures=[{id:'quarter',sourceFieldId:'revenue',aggregation:'sum'}];
    const result=calculateTable({source:source(),model:raw,table:{sorting:[{id:'quarter',desc:true}]},search:''});
    expect(result.groups.map(group=>group.rows[0].values['\x1egroup'])).toEqual(['2025','2026']);
    expect(result.groups[0].children.map(group=>group.rows[0].groupPath?.at(-1)?.value)).toEqual(['2025-Q2','2025-Q1']);
});

it('disabled report controls retain source identities despite invalid dates, Page and rejecting aggregate filters', () => {
    const raw = { ...model(), enabled: false, layout: { ...model().layout, values: ['rev'], page: { categoryId: 'quarter', memberKeys: ['["string","absent"]'] } } };
    raw.layout.rows = ['year'];
    raw.formulas = [{ id: 'doubled', name: 'Doubled', scope: 'source', expression: '', ast: { kind: 'binary', operator: '*', left: { kind: 'reference', target: 'field', id: 'revenue' }, right: { kind: 'literal', value: 2 } } }];
    raw.resultFilters = [{ id: 'reject', categoryId: 'year', target: { kind: 'measure', id: 'rev' }, predicate: 'gt', value: 999 }];
    const data = source(); data.rows[0].values.date = 'invalid date';
    const result = calculateTable({ source: data, model: raw, table: {}, search: '' });
    expect(result.rows.map(row => row.id)).toEqual(['a', 'b', 'c']);
    expect(result.rows[0].values.doubled).toBe(160);
    expect(result.groups).toEqual([]);
    expect(result.totalCells.size).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.compiled.model.layout).toEqual(raw.layout);
    const presented=calculateTable({source:data,model:raw,table:{sorting:[{id:'revenue',desc:false}],hidden:['revenue'],columnOrder:['doubled','date']},search:''});
    expect(presented.rows.map(row=>row.id)).toEqual(['b','c','a']);
    expect(presented.columns.map(column=>column.id)).toEqual(['doubled','date']);
    expect(presented.rows.find(row=>row.id==='a')?.values.doubled).toBe(160);
});

it('projects mixed values with stable duplicate labels and full hidden aggregate dependencies', () => {
 const raw=model();raw.layout.rows=['year'];raw.layout.values=['shown','rev2','rev'];raw.measures.push({id:'rev2',sourceFieldId:'revenue',aggregation:'sum'});
 raw.formulas=[{id:'hidden',name:'Hidden',scope:'aggregate',expression:'',ast:{kind:'reference',target:'measure',id:'rev'}},{id:'shown',name:'Shown',scope:'aggregate',expression:'',ast:{kind:'reference',target:'formula',id:'hidden'}}];
 const result=calculateTable({source:source(),model:raw,table:{},search:''});
 expect(result.columns.map(c=>c.id)).toEqual(['\x1egroup','shown','rev2','rev']);
 expect(result.columns.map(c=>c.label)).toEqual(['Year','Shown','Revenue — Total (2)','Revenue — Total']);
 expect(result.groups[0].rows[0].values.shown).toBe(100);
 expect(result.compiled.graph.order).toContain('hidden');
 const override=calculateTable({source:source(),model:raw,table:{columnOrder:['rev','shown','rev2'],hidden:['rev2']},search:''});
 expect(override.columns.map(c=>c.id)).toEqual(['rev','shown','\x1egroup']);
});
it('retains explicit controls in compilation and stable split IDs when mixed values reorder',()=>{
 const raw=model();raw.layout={rows:['year'],columns:['quarter'],values:['rev','shown']};raw.formulas=[{id:'shown',name:'Shown',scope:'aggregate',expression:'',ast:{kind:'reference',target:'measure',id:'rev'}}];
 expect(compileAnalyticalModel({...raw,enabled:false}).model).toMatchObject({enabled:false,layout:raw.layout});
 const first=calculateTable({source:source(),model:raw,table:{},search:''});
 const second=calculateTable({source:source(),model:{...raw,layout:{...raw.layout,values:['shown','rev']}},table:{},search:''});
 expect(first.columns.map(c=>c.id).sort()).toEqual(second.columns.map(c=>c.id).sort());
 expect(second.columns.filter(c=>c.splitPath).map(c=>c.metadata?.formulaId??c.measureId)).toEqual(['shown','rev','shown','rev','shown','rev']);
});

it('explains absent authored filter keys from observed universe without calling excluded members absent',()=>{
 const raw=model();raw.params.filters=[{id:'year-param',categoryId:'year',label:'Year',multiSelect:true}];
 raw.checklists=[{categoryId:'year',memberKeys:['["string","2024"]']}];
 const absent=calculateTable({source:source(),model:raw,table:{},search:''});
 expect(absent.rows).toHaveLength(0);
 expect(absent.paramDiagnostics).toContainEqual(expect.objectContaining({code:'PIVOT_PARAM_UNMATCHED',key:'pivot:filter:year',memberKeys:['["string","2024"]']}));
 raw.checklists=[{categoryId:'year',memberKeys:['["string","2025"]']}];
 const excluded=calculateTable({source:source(),model:raw,table:{columnFilters:[{id:'revenue',value:{min:1000}}]},search:''});
 expect(excluded.rows).toHaveLength(0);
 expect(excluded.paramDiagnostics.some(d=>d.code==='PIVOT_PARAM_UNMATCHED')).toBe(false);
 expect(excluded.paramDiagnostics).toContainEqual(expect.objectContaining({code:'PIVOT_PARAM_EXCLUDED'}));
 raw.enabled=false;raw.checklists=[{categoryId:'year',memberKeys:[]}];
 expect(calculateTable({source:source(),model:raw,table:{},search:''}).paramDiagnostics).toContainEqual(expect.objectContaining({code:'PIVOT_PARAM_EMPTY'}));
});
it('grouping many rows many ways scales with rows, not groups × rows', () => {
    // 20k rows in 2k groups took 42 s when every group scope rescanned every row.
    const N = 20_000, G = 2_000;
    const rows = Array.from({ length: N }, (_, i) => ({ id: `r${i}`, values: { sym: `s${i % G}`, v: i } }));
    const data: WidgetDataset = { ...source(), columns: [{ id: 'sym', label: 'Sym', dtype: 'text' }, { id: 'v', label: 'V', dtype: 'number' }], rows };
    const grouped: TableModelV1 = { ...model(), params: { promotePage: false, filters: [] }, categories: [{ id: 'cs', name: 'Sym', sourceFieldId: 'sym', transform: 'native' }], measures: [{ id: 'm', sourceFieldId: 'v', aggregation: 'sum' }], layout: { rows: ['cs'], columns: [], values: ['m'] } };
    const started = performance.now();
    const result = calculateTable({ source: data, model: grouped, table: {}, search: '' });
    const elapsed = performance.now() - started;
    expect(result.errors).toEqual([]);
    expect(result.rows.find(row => row.groupPath?.length === 1 && row.groupPath[0].value === 's0')?.values.m).toBe(Array.from({ length: N / G }, (_, k) => k * G).reduce((a, b) => a + b, 0));
    expect(elapsed).toBeLessThan(8_000);
}, 60_000);
