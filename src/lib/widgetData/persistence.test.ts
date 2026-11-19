// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { remapWidgetReferences, persistedCard } from './persistence';
import type { DashboardCard } from '../types';
import { decodeLinkedChartRecipe } from './chartRecipes/settings';
import type { RecipeOptions } from './chartRecipes/types';
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
