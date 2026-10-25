// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fixture as statementFixture } from '../lib/statementModel/compileFixtures';
import { beforeEach, expect, it } from 'vitest';
import { __reset, __failPath, __read } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { widget } from '../test/fixtures';
import { useDashboardStore } from './dashboardStore';
import { loadDashboards, saveDashboard } from '../lib/dashboardsFile';
import { migratePivot } from '../lib/tableModel/migration';
import { calculateView } from '../lib/tableExecution/engine';
import { input } from '../lib/tableExecution/fixtures';

beforeEach(() => { __reset(); __resetJsonStoreForTests(); useDashboardStore.setState({ dashboards: [], activeId: null, activeTabId: null, viewer: false, pendingCardRemoval: null }); });
async function setup() {
  await useDashboardStore.getState().load();
  const id = (await useDashboardStore.getState().addCard(widget({ id: 'local_table', backendId: 'builtin' }), { file: 'data.csv' }))!;
  const dashboard = useDashboardStore.getState().activeDashboard()!;
  return { id, dashboard };
}
it('reopens committed migrated analytical definitions, stable names and selection without cached results', async () => {
  const { id, dashboard } = await setup();
  const analytical = migratePivot({ enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } }, { columns: input.columns });
  analytical.formulas = [{ id: 'stable', name: 'Renamed display', scope: 'aggregate', expression: 'old display name', ast: { kind: 'reference', target: 'measure', id: 'revenue' } }];
  analytical.layout.values.push('stable');
  const definition = { table: {}, search: '', analytical };
  await useDashboardStore.getState().commitTableDefinition(dashboard.id, id, definition, { kind: 'allMatching', excludedIds: [] });
  const reopened = (await loadDashboards())[0].tabs[0].cards[0];
  expect(reopened.tableDefinition).toEqual(definition);
  expect(reopened.tableSelection).toEqual({ kind: 'allMatching', excludedIds: [] });
  expect(calculateView(input, reopened.tableDefinition!, reopened.tableSelection!).totals.values.stable).toBe(120);
  expect(__read(`dashboards/${dashboard.id}.json`)).not.toContain('recordIds');
});
it('keeps unsupported and malformed independent imports unchanged across save and copy', async () => {
  const { dashboard } = await setup();
  const base = dashboard.tabs[0].cards[0];
  const cyclic = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [], formulas: [{ id: 'cycle', name: 'Cycle', scope: 'source', expression: '', ast: { kind: 'reference', target: 'formula', id: 'cycle' } }, { id: 'bad', ast: { kind: 'not-supported' } }], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } };
  const future = { schemaVersion: 44, opaque: ['preserve', { independent: true }] };
  const imported = { ...dashboard, tabs: [{ ...dashboard.tabs[0], cards: [{ ...base, tableDefinition: { table: {}, search: '', analytical: cyclic } }, { ...base, id: 'future', tableDefinition: { table: {}, search: '', analytical: future } }] }] };
  await saveDashboard(imported);
  const reopened = (await loadDashboards())[0];
  expect(reopened.tabs[0].cards.map(c => c.tableDefinition?.analytical)).toEqual([cyclic, future]);
  useDashboardStore.setState({ dashboards: [reopened] });
  const copyId = await useDashboardStore.getState().duplicateDashboard(reopened.id);
  const copy = (await loadDashboards()).find(d => d.id === copyId)!;
  expect(copy.tabs[0].cards.map(c => c.tableDefinition?.analytical)).toEqual([cyclic, future]);
});
it('copies widget ownership while preserving producer output IDs and linked chart mappings', async () => {
  const { id, dashboard } = await setup();
  const store = () => useDashboardStore.getState();
  const analytical = migratePivot({ enabled: true, grouping: ['region'], split: [], measures: [{ id: 'revenue', sourceFieldId: 'revenue', aggregation: 'sum' }] });
  await store().commitTableDefinition(dashboard.id, id, { table: {}, search: '', analytical }, { kind: 'none' });
  const chartId = (await store().addLinkedCard({ dashboardId: dashboard.id, tabId: dashboard.tabs[0].id, sourceWidgetId: id, presentation: 'chart' }))!;
  await store().commitLinkedChartSettings(dashboard.id, chartId, { type: 'bar', category: 'region', measures: ['revenue'], display: 'grouped' });
  const copiedId = await store().duplicateDashboard(dashboard.id);
  const [producer, chart] = store().dashboards.find(d => d.id === copiedId)!.tabs[0].cards;
  expect(producer.id).not.toBe(id);
  expect(producer.tableDefinition?.analytical).toEqual(analytical);
  expect(chart.linkedSource?.sourceWidgetId).toBe(producer.id);
  expect(chart.linkedChart?.measures).toEqual(['revenue']);
});
it('failed analytical saves keep the prior committed definition and disk content', async () => {
  const { id, dashboard } = await setup();
  const before = __read(`dashboards/${dashboard.id}.json`);
  __failPath(`dashboards/${dashboard.id}.json`);
  await expect(useDashboardStore.getState().commitTableDefinition(dashboard.id, id, { table: {}, search: '', analytical: migratePivot({ enabled: true, grouping: [], split: [] }) }, { kind: 'none' })).rejects.toThrow();
  expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].tableDefinition).toBeUndefined();
  expect(__read(`dashboards/${dashboard.id}.json`)).toBe(before);
});

it('snapshotReopensWithoutCatalog preserves authored Statement snapshots through native durable save and copy', async()=>{
 const {id,dashboard}=await setup(); const {statement,source,ids}=statementFixture();
 statement.overrides.labels[ids.line('revenue')]='Sales';
 const definition={table:{},search:'',analytical:statement};
 await useDashboardStore.getState().commitTableDefinition(dashboard.id,id,definition,{kind:'none'});
 const reopened=(await loadDashboards())[0];
 expect(reopened.tabs[0].cards[0].tableDefinition).toEqual(definition);
 expect(calculateView(source,reopened.tabs[0].cards[0].tableDefinition!,{kind:'none'}).definition.analytical).toEqual(statement);
 useDashboardStore.setState({dashboards:[reopened]});
 const copied=await useDashboardStore.getState().duplicateDashboard(dashboard.id);
 expect((await loadDashboards()).find(d=>d.id===copied)!.tabs[0].cards[0].tableDefinition).toEqual(definition);
});
it('failedUpdateWriteKeepsOldIntent and never runs runtime publication',async()=>{
 const {id,dashboard}=await setup(); const {statement,ids}=statementFixture();
 const definition={table:{},search:'',analytical:statement};
 await useDashboardStore.getState().commitTableDefinition(dashboard.id,id,definition,{kind:'none'});
 const before=__read(`dashboards/${dashboard.id}.json`); const expected=useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0];
 const next=structuredClone(statement); next.overrides.labels[ids.line('revenue')]='Sales'; let published=false;
 __failPath(`dashboards/${dashboard.id}.json`);
 await expect(useDashboardStore.getState().commitTableDefinition(dashboard.id,id,{...definition,analytical:next},{kind:'none'},{expected,isCurrent:()=>true,beforePublish:()=>{published=true;}})).rejects.toThrow();
 expect(useDashboardStore.getState().activeDashboard()!.tabs[0].cards[0].tableDefinition).toEqual(definition);
 expect(__read(`dashboards/${dashboard.id}.json`)).toBe(before); expect(published).toBe(false);
});
it('unresolved explicit Statement update cannot pass the durable commit boundary',async()=>{
 const {id,dashboard}=await setup(); const {statement}=statementFixture();
 const definition={table:{},search:'',analytical:statement};
 await useDashboardStore.getState().commitTableDefinition(dashboard.id,id,definition,{kind:'none'});
 const before=__read(`dashboards/${dashboard.id}.json`);
 const unresolved={...statement,updateConflicts:[{id:'removed',reason:'Resolve before adopting'}]};
 await expect(useDashboardStore.getState().commitTableDefinition(dashboard.id,id,{...definition,analytical:unresolved},{kind:'none'})).rejects.toThrow();
 expect(__read(`dashboards/${dashboard.id}.json`)).toBe(before);
});
