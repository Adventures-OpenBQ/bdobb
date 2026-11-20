// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { revisionSlope } from '../../test/fixtures/estimateRevisions';
import { expect, it } from 'vitest';
import { remapWidgetReferences, persistedCard } from './persistence';
import type { DashboardCard } from '../types';
import { decodeLinkedChartRecipe } from './chartRecipes/settings';
import type { RecipeOptions } from './chartRecipes/types';
import { calendarOptions } from '../../test/fixtures/newsCalendar';
const source: DashboardCard = { id: 'source', widgetId: 'local_table', backendId: 'builtin', params: { file: 'import.csv' }, layout: { x: 0, y: 0, w: 2, h: 2 } };
const child: DashboardCard = { ...source, id: 'child', widgetId: 'linked_table', linkedSource: { kind: 'widget', sourceWidgetId: 'source' }, tableSelection: { kind: 'explicit', ids: ['r0'] }, linkedChart: { type: 'line', category: 'date', measures: ['close'], display: 'grouped' } };
it('remaps all dashboard owners and links without mutating settings or native file references', () => {
  const result = [source, child].map(c => remapWidgetReferences(c, new Map([['source', 'new-source'], ['child', 'new-child']])));
  expect(result[1]).toEqual({ ...child, id: 'new-child', linkedSource: { kind: 'widget', sourceWidgetId: 'new-source' } });
  expect(result[0].params.file).toBe('import.csv'); expect(child.linkedSource?.sourceWidgetId).toBe('source');
});
it('foreign source IDs on a single-card copy remain repairable', () => {
  expect([child].map(c => remapWidgetReferences(c, new Map([['child', 'copy']])))[0].linkedSource?.sourceWidgetId).toBe('source');
});
it('never serializes calculated datasets or worker revisions', () => {
  const runtime = { ...child, dataset: { rows: [{ id: 'secret' }] }, resultRevision: 42, executor: {} };
  expect(persistedCard(runtime)).toEqual(persistedCard(child));
  expect(JSON.stringify(persistedCard(runtime))).not.toContain('secret');
});
it('whole-widget copies keep owned analytical parameter IDs and authored values under the new widget owner',()=>{
 const model:import('../tableModel/types').TableModelV1={schemaVersion:1,params:{promotePage:false,filters:[{id:'param-sector',categoryId:'sector',label:'Sector',multiSelect:false}]},enabled:true,categories:[{id:'sector',name:'Sector',sourceFieldId:'Sector',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[],page:{categoryId:'sector',memberKeys: ['["string","Tech"]']}},checklists:[{categoryId:'sector',memberKeys:['["string","Tech"]','["string","Energy"]']}],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const card={...source,tableDefinition:{table:{},search:'',analytical:model}};const copy=[card].map(c => remapWidgetReferences(c, new Map([['source','copied-owner']])))[0];expect(copy.id).toBe('copied-owner');expect(copy.tableDefinition?.analytical).toEqual(model);expect(copy.tableDefinition?.analytical).not.toBe(model);expect(JSON.parse(JSON.stringify(persistedCard(copy))).tableDefinition.analytical).toEqual(model);
});
it('keeps server extensions, unknown keys included, as owned plain data through saving and dashboard copies', () => {
  const extensions = { workspace: { widget: { id: 'server-1', storage: { params: { a: null } } }, layout: { i: 'server-1' }, params: {} }, later: [1, { x: 'y' }] };
  const synced = { ...source, extensions: { ...structuredClone(extensions), hook: () => 'secret' } } as DashboardCard;
  expect(persistedCard(synced).extensions).toEqual(extensions);
  const copy = remapWidgetReferences(synced, new Map([['source', 'copy']]));
  expect(copy.extensions).toEqual(extensions);
  expect(copy.extensions?.workspace?.widget).not.toBe((synced.extensions as typeof extensions).workspace.widget);
});
it('persists the new linked chart values unchanged', () => {
  const linkedChart: DashboardCard['linkedChart'] = { type: 'pie', category: 'item', measures: ['fy2025'], display: 'percent', seriesFrom: 'rows' };
  expect(persistedCard({ ...child, linkedChart }).linkedChart).toEqual(linkedChart);
  const bullet: DashboardCard['linkedChart'] = { type: 'bullet', display: 'grouped', category: 'fiscal_period', measures: ['eps_actual'], period: 'FQ3 2026' };
  expect(persistedCard({ ...child, linkedChart: bullet }).linkedChart).toEqual(bullet);
});

it('copies and persists versioned recipe options along with the remapped source', () => {
  const linkedChart: NonNullable<DashboardCard['linkedChart']> = {
    type: 'monthly-returns', display: 'grouped', measures: [],
    recipe: { version: 1, kind: 'monthly-returns', fields: { date: 'date', price: 'adjusted_close' }, symbol: 'AMD' },
  };
  const copy = remapWidgetReferences({ ...child, linkedChart }, new Map([['child', 'chart-copy'], ['source', 'source-copy']]));
  expect(copy.linkedChart?.recipe).not.toBe(linkedChart.recipe);
  expect(JSON.parse(JSON.stringify(persistedCard(copy)))).toMatchObject({
    id: 'chart-copy', linkedSource: { kind: 'widget', sourceWidgetId: 'source-copy' }, linkedChart,
  });
});

it('reopens copied small multiples with the authored symbol order', () => {
  const recipe = {
    version: 1, kind: 'small-multiples', fields: { date: 'date', price: 'adjusted_close', symbol: 'ticker' }, symbols: ['NVDA', 'AMD'],
  } satisfies RecipeOptions;
  const linkedChart: NonNullable<DashboardCard['linkedChart']> = { type: recipe.kind, display: 'grouped', measures: [], recipe };
  const copy = remapWidgetReferences({ ...child, linkedChart }, new Map([['child', 'chart-copy'], ['source', 'source-copy']]));
  const reloaded = JSON.parse(JSON.stringify(persistedCard(copy)));
  expect(reloaded.linkedSource).toEqual({ kind: 'widget', sourceWidgetId: 'source-copy' });
  expect(reloaded.linkedChart).toEqual(linkedChart);
  expect(decodeLinkedChartRecipe(reloaded.linkedChart, reloaded.linkedChart.type)).toEqual({
    ok: true, options: linkedChart.recipe,
  });
});

it('persists a selected income period and refuses injected scale after reopening', () => {
  const recipe = { version: 1, kind: 'income-sankey', periodColumn: 'period-column' } satisfies RecipeOptions;
  const linkedChart: NonNullable<DashboardCard['linkedChart']> = { type: recipe.kind, display: 'grouped', measures: [], recipe };
  const reload = (options: unknown) => JSON.parse(JSON.stringify(persistedCard({
    ...child, linkedChart: { ...linkedChart, measures: [], recipe: options as RecipeOptions },
  }))).linkedChart;
  expect(decodeLinkedChartRecipe(reload(recipe), recipe.kind)).toEqual({ ok: true, options: recipe });
  const edited = reload({ ...recipe, scale: { status: 'verified', multiplier: 1000 } });
  expect(decodeLinkedChartRecipe(edited, recipe.kind)).toMatchObject({ ok: false });
  expect(JSON.stringify(edited)).not.toContain('multiplier');
  expect(persistedCard({ ...child, linkedChart: { ...linkedChart, chart_evidence: { coverage: 'full-record' } } as typeof linkedChart }).linkedChart)
    .toEqual(linkedChart);
});

it('keeps the news window declaration and strips attempted runtime evidence on saved cards', () => {
  const recipe = { ...calendarOptions, window: { mode: 'pinned', start: '2026-11-17', end: '2026-11-19' } } satisfies RecipeOptions;
  const linkedChart = { type: recipe.kind, display: 'grouped', measures: [], recipe } as const;
  const authored = { ...linkedChart, measures: [] };
  const injected = { ...authored, chart_sources: { receipts: ['forged'] }, daySummaries: [{}], viewportWidth: 300 };
  expect(persistedCard({ ...child, linkedChart: injected }).linkedChart).toEqual(authored);
  const unsupported = { ...recipe, version: 2 } as unknown as RecipeOptions;
  expect(persistedCard({ ...child, linkedChart: { ...authored, recipe: unsupported } }).linkedChart?.recipe).toBeUndefined();
});

it('persists the ownership question and strips runtime evidence, resolved coordinates and geometry', () => {
  const recipe = { version: 1, kind: 'ownership-snapshot', issuer: 'AAPL.US', view: 'bars',
    fields: { insiders: 'percent_insiders' } } satisfies RecipeOptions;
  const linkedChart = { type: recipe.kind, recipe, display: 'grouped', measures: [] } as const;
  const authored = { ...linkedChart, measures: [] };
  const injected = { ...authored, chart_sources: { receipts: ['injected'] }, ownershipSnapshot: { buckets: [] },
    resolvedAsOf: '2026-11-19', viewportWidth: 300 };
  expect(persistedCard({ ...child, linkedChart: injected }).linkedChart).toEqual(authored);
  const unsupported = { ...recipe, version: 2 } as unknown as RecipeOptions;
  expect(persistedCard({ ...child, linkedChart: { ...authored, recipe: unsupported } }).linkedChart?.recipe).toBeUndefined();
});

it('keeps the ETF authored snapshot selection and drops computed output from native persistence', () => {
  const recipe = { version: 1, kind: 'etf-sunburst', fund: 'VTI.US', snapshot: 'latest', depth: 2,
    fields: { holding: 'symbol', sector: 'sector', weight: 'weight' } } satisfies RecipeOptions;
  const authored = { type: recipe.kind, recipe, display: 'grouped', measures: [] } as const;
  const settings = { ...authored, measures: [] };
  const injected = { ...settings, chart_sources: { receipts: ['injected'] }, etfHierarchy: { holdings: [] },
    resolvedSnapshot: '2026-09-30', viewportHeight: 460 };
  expect(persistedCard({ ...child, linkedChart: injected }).linkedChart).toEqual(settings);
  const unsupported = { ...recipe, version: 2 } as unknown as RecipeOptions;
  expect(persistedCard({ ...child, linkedChart: { ...settings, recipe: unsupported } }).linkedChart?.recipe).toBeUndefined();
});

it('keeps only closed linked KPI settings on built-in metric cards', () => {
  const metric = { ...source, id: 'metric', widgetId: 'linked_metric', linkedSource: { kind: 'widget', sourceWidgetId: 'source' } } as const;
  const linkedMetric = { version: 1, metric: 'dividend_yield', valueField: 'acquired_yield', observation: { mode: 'latest' }, view: 'card' } as const;
  expect(persistedCard({ ...metric, linkedMetric }).linkedMetric).toEqual(linkedMetric);
  const forged = { ...linkedMetric, snapshot: { value: 0.003 }, range: undefined };
  expect(persistedCard({ ...metric, linkedMetric: forged })).not.toHaveProperty('linkedMetric');
  expect(persistedCard({ ...metric, widgetId: 'linked_chart', linkedMetric })).not.toHaveProperty('linkedMetric');
});

it('persists only the closed dual-axis overlay settings', () => {
  const recipe = { version: 1, kind: 'dual-axis-overlay', recipe: 'cpi-ten-year',
    fields: { series: 'series', date: 'date', value: 'value' } } satisfies RecipeOptions;
  const authored = { type: recipe.kind, recipe, display: 'grouped' as const, measures: [] };
  const injected = { ...authored, measures: ['unknown'], category: 'legacy_category', period: 'latest',
    chart_sources: { receipts: ['injected'] }, overlay: { points: [] }, viewportHeight: 460 };
  expect(persistedCard({ ...child, linkedChart: injected }).linkedChart).toEqual(authored);
  const invalid = { ...recipe, version: 2 } as unknown as RecipeOptions;
  expect(persistedCard({ ...child, linkedChart: { ...authored, recipe: invalid } }).linkedChart?.recipe).toBeUndefined();
});

it('keeps original revision pins in native settings and drops runtime state', () => {
  const settings = { type: revisionSlope.kind, measures: [], display: 'grouped' as const, recipe: revisionSlope };
  const injected = { ...settings, figure: { data: [] }, chart_sources: {}, estimateRevisionsSurface: { height: 352, width: 320 } };
  expect(persistedCard({ ...child, linkedChart: injected }).linkedChart).toEqual(settings);
  const invalid = { ...injected, recipe: { ...revisionSlope, issuer: 'ALFA.US' } };
  expect(persistedCard({ ...child, linkedChart: invalid }).linkedChart).toEqual({ ...settings, recipe: undefined });
});
