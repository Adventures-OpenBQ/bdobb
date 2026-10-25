// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { remapWidgetReferences, persistedCard } from './persistence';
import type { DashboardCard } from '../types';
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
