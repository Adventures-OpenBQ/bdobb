// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { statementContractCases } from './statementContractFixtures';
import { calculateView } from './engine';
import { createResultStore, type ResultStore } from './resultStore';
import { input, revision } from './fixtures';
import type { TableExecutor, TableDefinition, SelectionSpec } from './types';
import type { TableModelV1 } from '../tableModel/types';
import type { WidgetDataset } from '../widgetData/types';

/** Test-only adapter: evaluates once, then uses the same immutable delivery contract. */
export function createPureExecutor(): TableExecutor {
  let data: WidgetDataset;
  let store: ResultStore;
  const id = () => 'contract';
  return {
    async registerInput(value) { data = structuredClone(value); },
    async applyModel(definition, selection, rev, _signal, reconcile, previous, absent, runtimeParams) { store = createResultStore(calculateView(data, definition, selection, reconcile, previous, absent, runtimeParams), rev); return store.ready(id(), rev); },
    async selection(rev, action, visible) { return store.selection(id(), rev, action, visible); },
    async rows(rev, request) { return store.rows(id(), rev, request); },
    async facets(rev, category) { return store.facets(id(), rev, category); },
    async inspect(rev, request) { return store.inspect(id(), rev, request); },
    async totals(rev) { return store.totals(id(), rev); },
    async chartData(rev, fields) { return store.chartData(id(), rev, fields); },
    async *presented(rev) { yield* store.presented(id(), rev, 'contract-transfer'); },
    dispose() {},
  };
}

export const contractCases: { name: string; data: WidgetDataset; definition: TableDefinition; selection: SelectionSpec; expectFailure?: boolean }[] = [
  { name: 'raw', data: input, definition: { table: {}, search: '' }, selection: { kind: 'none' } },
  { name: 'operators', data: input, definition: { table: { pivot: { enabled: true, grouping: ['region', 'team'], split: [], measures: [
    { id: 'mean', sourceFieldId: 'revenue', aggregation: 'mean' },
    { id: 'median', sourceFieldId: 'revenue', aggregation: 'median' },
    { id: 'last', sourceFieldId: 'revenue', aggregation: 'last' },
  ] } }, search: '' }, selection: { kind: 'none' } },
  { name: 'selected', data: input, definition: { table: {}, search: '' }, selection: { kind: 'explicit', ids: ['r0', 'r2'] } },
  { name: 'empty', data: { ...input, rows: [] }, definition: { table: {}, search: '' }, selection: { kind: 'none' } },
];

/** Reusable semantic fixture runner. No vitest dependency, so Chromium can run a real worker. */
export async function runExecutorContract(create: () => TableExecutor) {
  const results = [];
  const signal = new AbortController().signal;
  for (const fixture of contractCases) {
    const executor = create();
    try {
      await executor.registerInput(fixture.data, 1, signal);
      let ready;
      try { ready = await executor.applyModel(fixture.definition, fixture.selection, revision, signal); }
      catch (error) { if(!fixture.expectFailure)throw error;results.push({name:fixture.name,error:error instanceof Error?error.message:String(error)}); continue; }
      if(fixture.expectFailure)throw new Error(`${fixture.name} unexpectedly accepted invalid input`);
      const deliveries = [];
      for (const size of [1, 2, 50]) {
        const collect = async (path: string[], count: number): Promise<unknown[]> => {
          const offsets = Array.from({ length: Math.ceil(count / size) }, (_, i) => i * size).reverse();
          const blocks = [];
          for (const offset of offsets) blocks.push(await executor.rows(revision, { groupPath: path, offset, limit: size }, signal));
          blocks.sort((a, b) => a.offset - b.offset);
          const children = [];
          for (const block of blocks) for (const group of block.groups) children.push({ path: group.path, rows: await collect(group.path, group.childCount) });
          return [{ rows: blocks.flatMap(block => block.rows), children }];
        };
        deliveries.push(await collect([], ready.topLevelCount));
      }
      const inspection = executor.inspect ? (await executor.inspect(revision, {collection:'definitions',offset:0,limit:100}, signal)).rows : [];
      const totals = await executor.totals(revision, signal);
      const chart = await executor.chartData(revision, ready.columns.map(column => column.id), signal);
      const facets = [];
      const readFacet = async (categoryId: string) => { const facet = await executor.facets(revision, categoryId, signal); return { categoryId, scope: facet.scope, values: facet.values, members: facet.members, empty: facet.empty }; };
      if (fixture.definition.table.pivot?.enabled) facets.push(await readFacet('region'));
      for (const category of (fixture.definition.analytical as TableModelV1 | undefined)?.categories ?? []) facets.push(await readFacet(category.id));
      const presented=[];for await(const batch of executor.presented(revision,signal))presented.push({columns:batch.columns,rows:batch.rows,final:batch.final});
      results.push({ name: fixture.name, presented, inspection, columns: ready.columns, diagnostics: ready.diagnostics, completeness: ready.completeness, modelWarnings: ready.modelWarnings, deliveries, totals: totals.values, totalScope: totals.scope, totalErrors: totals.cellErrors, chart: chart.rows, facets });
    } finally { executor.dispose(); }
  }
  return results;
}

const comparison: TableModelV1 = {
  schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true,
  categories: [{ id: 'scenarioCategory', name: 'Scenario', sourceFieldId: 'scenario', transform: 'native' }, { id: 'year', name: 'Year', sourceFieldId: 'date', transform: 'Y' }, { id: 'quarter', name: 'Quarter', sourceFieldId: 'date', transform: 'Q' }],
  measures: [{ id: 'revenueSum', sourceFieldId: 'revenue', aggregation: 'sum' }, { id: 'costSum', sourceFieldId: 'cost', aggregation: 'sum' }],
  formulas: [{ id: 'margin', name: 'Margin', scope: 'aggregate', expression: '', ast: { kind: 'binary', operator: '/', left: { kind: 'binary', operator: '-', left: { kind: 'reference', target: 'measure', id: 'revenueSum' }, right: { kind: 'reference', target: 'measure', id: 'costSum' } }, right: { kind: 'reference', target: 'measure', id: 'revenueSum' } } }, { id: 'budget', name: 'Budget', scope: 'aggregate', expression: '', ast: { kind: 'member', value: { kind: 'reference', target: 'measure', id: 'revenueSum' }, selectors: [{ categoryId: 'scenarioCategory', memberKey: '["string","Budget"]' }] } }],
  layout: { rows: ['year', 'quarter'], columns: [], values: ['margin', 'budget'], page: { categoryId: 'scenarioCategory', memberKeys: ['["string","Actual"]'] } },
  checklists: [], resultFilters: [{ id: 'annual', categoryId: 'year', target: { kind: 'measure', id: 'revenueSum' }, predicate: 'gt', value: 90 }, { id: 'quarterly', categoryId: 'quarter', target: { kind: 'measure', id: 'revenueSum' }, predicate: 'gt', value: 50 }], subtotals: { grandTotal: true, groups: true },
};
const comparisonData: WidgetDataset = { ...input, columns: [...input.columns, { id: 'scenario', label: 'Scenario', dtype: 'text' }, { id: 'cost', label: 'Cost', dtype: 'number' }], rows: [['a', '2025-01-01', 'Actual', 80, 20], ['b', '2025-04-01', 'Actual', 20, 10], ['c', '2026-01-01', 'Actual', 20, 10], ['ab', '2025-01-01', 'Budget', 70, 30], ['bb', '2025-04-01', 'Budget', 999, 30]].map(([id, date, scenario, revenue, cost]) => ({ id: String(id), values: { date, scenario, revenue, cost } })) };
contractCases.push({ name: 'scoped-result-filters', data: comparisonData, definition: { table: {}, search: '', analytical: comparison }, selection: { kind: 'none' } });
const excluded = structuredClone(comparison); excluded.checklists = [{ categoryId: 'scenarioCategory', memberKeys: ['["string","Actual"]'] }];
contractCases.push({ name: 'excluded-budget', data: comparisonData, definition: { table: {}, search: '', analytical: excluded }, selection: { kind: 'none' } });
const fiscal = structuredClone(comparison); fiscal.categories = [{ id: 'year', name: 'Fiscal year', sourceFieldId: 'date', transform: 'FY', fiscalBinding: { companyFieldId: 'scenario' } }]; fiscal.layout = { rows: ['year'], columns: [], values: [] }; fiscal.formulas = []; fiscal.resultFilters = [];
contractCases.push({ name: 'mixed-fiscal-calendars', data: { ...comparisonData, provenance: { ...input.provenance, metadata: { fiscalContext: { companies: { Actual: { yearEndMonth: 6, source: 'file' }, Budget: { yearEndMonth: 12, source: 'file' } } } } } }, definition: { table: {}, search: '', analytical: fiscal }, selection: { kind: 'none' } });

contractCases.push({ name: 'source-filter-excludes-budget', data: comparisonData, definition: { table: { columnFilters: [{ id: 'scenario', value: 'Actual' }] }, search: '', analytical: comparison }, selection: { kind: 'none' } });
contractCases.push({ name: 'empty-analytical', data: { ...comparisonData, rows: [] }, definition: { table: {}, search: '', analytical: comparison }, selection: { kind: 'none' } });
const fiscalQuarter = structuredClone(fiscal); fiscalQuarter.categories[0].transform = 'FQ';
contractCases.push({ name: 'company-fiscal-quarter', data: contractCases.find(fixture => fixture.name === 'mixed-fiscal-calendars')!.data, definition: { table: {}, search: '', analytical: fiscalQuarter }, selection: { kind: 'none' } });

/** Disabled report axes/Page/results remain authored while source constraints execute. */
export const pivotOffData: WidgetDataset = {
 ...input, columns:[...input.columns,{id:'secret',label:'Private input',dtype:'number'}],
 rows:[
  {id:'keep',values:{revenue:10,region:'A',team:'keep',date:'invalid date',secret:5}},
  {id:'search-excluded',values:{revenue:20,region:'A',team:'other',date:'invalid date',secret:5}},
  {id:'table-excluded',values:{revenue:90,region:'A',team:'keep',date:'invalid date',secret:5}},
  {id:'checklist-excluded',values:{revenue:10,region:'B',team:'keep',date:'invalid date',secret:5}},
 ],
};
export const pivotOffModel:TableModelV1={
 schemaVersion: 1, params: { promotePage: true, filters: [] },enabled:false,
 categories:[{id:'year',name:'Year',sourceFieldId:'date',transform:'Y'},{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native'},{id:'teamCategory',name:'Team',sourceFieldId:'team',transform:'native'}],
 measures:[{id:'total',sourceFieldId:'revenue',aggregation:'sum'}],
 formulas:[{id:'sourceComputed',name:'Source computed',scope:'source',expression:'',ast:{kind:'binary',operator:'+',left:{kind:'reference',target:'field',id:'revenue'},right:{kind:'reference',target:'field',id:'secret'}}},{id:'sourceError',name:'Source error',scope:'source',expression:'',ast:{kind:'call',function:'IF',args:[{kind:'binary',operator:'=',left:{kind:'reference',target:'field',id:'team'},right:{kind:'literal',value:'keep'}},{kind:'binary',operator:'/',left:{kind:'literal',value:1},right:{kind:'literal',value:0}},{kind:'literal',value:1}]}},{id:'aggregate',name:'Aggregate',scope:'aggregate',expression:'',ast:{kind:'reference',target:'measure',id:'total'}}],
 layout:{rows:['year'],columns:['regionCategory'],page:{categoryId:'teamCategory',memberKeys: ['["string","absent"]']},values:['aggregate','total']},
 checklists:[{categoryId:'regionCategory',memberKeys:['["string","A"]']}],
 resultFilters:[{id:'reject',categoryId:'year',target:{kind:'measure',id:'total'},predicate:'gt',value:1000}],subtotals:{grandTotal:true,groups:true},
};
export const pivotOffDefinition:TableDefinition={analytical:pivotOffModel,table:{hidden:['secret'],columnOrder:['sourceComputed','revenue'],columnFilters:[{id:'revenue',value:{max:50}}]},search:'keep'};
contractCases.push({name:'pivot-off-source-safe',data:pivotOffData,definition:pivotOffDefinition,selection:{kind:'explicit',ids:['keep']}});

contractCases.push(...statementContractCases);
