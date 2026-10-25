// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { saveDashboard } from '../lib/dashboardsFile';
import { fixture as statementFixture } from '../lib/statementModel/compileFixtures';
import { PivotParamControl } from '../components/PivotParamRow';
import { paramRow } from '../lib/tableModel/pivotParams';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render, fireEvent, screen, renderHook, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { useTableCommit } from '../hooks/useTableCommit';
import * as fs from '@tauri-apps/plugin-fs';
import { tableCommitCoordinators } from './tableCommitCoordinator';
import { tableExecutionStore as runtime } from './tableExecutionStore';
import { useDashboardStore as dashboards } from './dashboardStore';
import { migratePivot } from '../lib/tableModel/migration';
import { input } from '../lib/tableExecution/fixtures';
import { Boundary } from '../test/tableWorkerBoundary';
import { __reset, __read, __failPath } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import type { Dashboard } from '../lib/types';
import type { TableModelV1 } from '../lib/tableModel/types';
vi.mock('../lib/localFiles', () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode('region,revenue\nA,10\nB,20\n')) }));
let releases: (() => void)[] = [];
beforeEach(() => { __reset(); __resetJsonStoreForTests(); vi.stubGlobal('Worker', Boundary); });
afterEach(async () => { releases.forEach(release => release()); releases = []; await Promise.resolve(); runtime.disposeDashboard('d'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup() {
  const model = migratePivot({ enabled: true, grouping: ['region'], split: [], measures: [{ id: 'm', sourceFieldId: 'revenue', aggregation: 'sum' }] }, { columns: input.columns });
  const dashboard = { id: 'd', name: 'D', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'a.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 }, tableDefinition: { table: {}, search: '', analytical: model } }] }] } as Dashboard;
  dashboards.setState({ dashboards: [dashboard], viewer: false }); runtime.syncDashboard(dashboard); runtime.ensureTable('d', 'w'); await runtime.settled('d');
  const coordinator = tableCommitCoordinators.get('d', 'w'); releases.push(coordinator.retain());
  return { coordinator, base: coordinator.authoringBase(), model };
}
function delayDisk() {
  const original = fs.writeTextFile; let unblock!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  const write = vi.spyOn(fs, 'writeTextFile').mockImplementationOnce(async (...args) => { await gate; return original(...args); });
  return { unblock, write };
}
const persisted = () => JSON.parse(__read('dashboards/d.json')!).tabs[0].cards[0].tableDefinition.analytical as TableModelV1;
it('shares the key lane, rejects strict overlap and never publishes before disk success', async () => {
  const { coordinator, base, model } = await setup(); const gate = delayDisk();
  expect(tableCommitCoordinators.get('d', 'w')).toBe(coordinator);
  expect(tableCommitCoordinators.get('other', 'w')).not.toBe(coordinator);
  expect(tableCommitCoordinators.get('d', 'other')).not.toBe(coordinator);
  const save = coordinator.replaceModel(base, { ...model, subtotals: { ...model.subtotals, grandTotal: false } });
  await waitFor(() => expect(gate.write).toHaveBeenCalled());
  expect(runtime.readView('d', 'w').definition.analytical).toEqual(model);
  expect(await coordinator.replaceModel(base, model)).toMatchObject({ status: 'refused', reason: 'busy' });
  expect(await coordinator.chooseSelection(base, { kind: 'all' })).toMatchObject({ status: 'refused', reason: 'busy' });
  gate.unblock(); expect(await save).toEqual({ status: 'saved' }); expect(persisted().subtotals.grandTotal).toBe(false);
});
it('composes immutable intent from the original render after matching own activations', async () => {
  const { coordinator, base } = await setup(); const gate = delayDisk();
  const label = coordinator.editModel(base, { apply: current => ({ ...current, measures: current.measures.map(m => ({ ...m, customLabel: 'Sales' })) }) });
  const aggregate = coordinator.editModel(base, { apply: current => ({ ...current, measures: current.measures.map(m => ({ ...m, aggregation: 'mean' })) }) });
  const total = coordinator.editModel(base, { apply: current => ({ ...current, subtotals: { ...current.subtotals, grandTotal: false } }) });
  gate.unblock(); expect(await Promise.all([label, aggregate, total])).toEqual([{ status: 'saved' }, { status: 'saved' }, { status: 'saved' }]);
  expect(persisted().measures[0]).toMatchObject({ customLabel: 'Sales', aggregation: 'mean' }); expect(persisted().subtotals.grandTotal).toBe(false);
});
it('supersedes only adjacent unsent setters and preserves an in-flight save', async () => {
  const { coordinator, base } = await setup(); const gate = delayDisk();
  const setter = (label: string) => ({ replaceKey: 'label', apply: (m: Readonly<TableModelV1>) => ({ ...m, measures: m.measures.map(measure => ({ ...measure, customLabel: label })) }) });
  const x = coordinator.editModel(base, setter('X')); const a = coordinator.editModel(base, setter('A')); const b = coordinator.editModel(base, setter('B'));
  expect(await a).toEqual({ status: 'superseded' }); gate.unblock(); expect(await x).toEqual({ status: 'saved' }); expect(await b).toEqual({ status: 'saved' }); expect(persisted().measures[0].customLabel).toBe('B');
});
it('refresh invalidates exact-view save and queued commands, restoring disk intent', async () => {
  const { coordinator, base, model } = await setup(); const gate = delayDisk();
  const a = coordinator.editModel(base, { apply: m => ({ ...m, subtotals: { ...m.subtotals, grandTotal: false } }) });
  const b = coordinator.editModel(base, { apply: m => ({ ...m, measures: [], layout: {...m.layout, values: m.layout.values.filter(id=>id!=='m')} }) });
  await waitFor(() => expect(gate.write).toHaveBeenCalled()); runtime.refresh('d', 'w'); gate.unblock();
  expect((await a).status).toBe('refused'); expect((await b).status).toBe('refused');
  await waitFor(() => expect(coordinator.getSnapshot().pending).toBe(false)); expect(persisted()).toEqual(model);
  expect(await coordinator.editModel(base, { apply: m => ({ ...m }) })).toMatchObject({ status: 'refused', reason: 'stale' });
});
it('failure ends dependent work and retains the durable definition', async () => {
  const { coordinator, base, model } = await setup(); __failPath('dashboards/d.json');
  const a = coordinator.editModel(base, { apply: m => ({ ...m, subtotals: { ...m.subtotals, grandTotal: false } }) });
  const b = coordinator.editModel(base, { apply: m => ({ ...m, measures: [], layout: {...m.layout, values: m.layout.values.filter(id=>id!=='m')} }) });
  expect((await a).status).toBe('failed'); expect((await b).status).toBe('failed'); expect(coordinator.getSnapshot().error).toBeTruthy(); expect(runtime.readView('d', 'w').definition.analytical).toEqual(model);
});
it('one released consumer preserves accepted work; final release invalidates old render tokens', async () => {
  const { coordinator, base, model } = await setup(); const release = coordinator.retain(); const gate = delayDisk();
  const save = coordinator.replaceModel(base, model); release(); gate.unblock(); expect(await save).toEqual({ status: 'saved' });
  releases.pop()!(); const again = coordinator.retain(); releases.push(again);
  expect(await coordinator.replaceModel(base, model)).toMatchObject({ status: 'refused', reason: 'stale' });
});
it('source identity changes before runtime synchronization abort a durable save', async () => {
  const { coordinator, base, model } = await setup(); const gate = delayDisk();
  const save = coordinator.replaceModel(base, { ...model, subtotals: { ...model.subtotals, grandTotal: false } });
  await waitFor(() => expect(gate.write).toHaveBeenCalled());
  dashboards.setState(state => ({ dashboards: state.dashboards.map(d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, cards: t.cards.map(c => ({ ...c, params: { file: 'different.csv' } })) })) })) }));
  gate.unblock(); expect(await save).toMatchObject({ status: 'refused' });
  await waitFor(() => expect(coordinator.getSnapshot().pending).toBe(false)); expect(persisted()).toEqual(model);
});
it('delayed worker selection excludes definition saves and preserves the definition', async () => {
  const { coordinator, base, model } = await setup(); const executor = runtime.readExecutor('d', 'w')!;
  let unblock!: () => void; const gate = new Promise<void>(resolve => { unblock = resolve; }); const selection = executor.selection.bind(executor);
  vi.spyOn(executor, 'selection').mockImplementationOnce(async (...args) => { await gate; return selection(...args); });
  const chosen = coordinator.chooseSelection(base, { kind: 'all' });
  expect(coordinator.getSnapshot().selectionPending).toBe(true);
  expect(await coordinator.replaceModel(base, model)).toMatchObject({ status: 'refused', reason: 'busy' });
  expect(await coordinator.editModel(base, { apply: m => ({ ...m }) })).toMatchObject({ status: 'refused', reason: 'busy' });
  expect(__read('dashboards/d.json')).toBeUndefined(); unblock(); expect(await chosen).toEqual({ status: 'saved' });
  expect(persisted()).toEqual(model); expect(dashboards.getState().dashboards[0].tabs[0].cards[0].tableSelection).toEqual({ kind: 'allMatching', excludedIds: [] });
  await runtime.settled('d'); const next = coordinator.authoringBase();
  expect(await coordinator.replaceModel(next, { ...model, subtotals: { ...model.subtotals, grandTotal: false } })).toEqual({ status: 'saved' });
  expect(dashboards.getState().dashboards[0].tabs[0].cards[0].tableSelection).toEqual({ kind: 'allMatching', excludedIds: [] });
});
it('repair schema witness is exclusive and invalidated by source refresh', async () => {
  const { coordinator, model } = await setup();
  runtime.updateDefinition('d', 'w', { table: {}, search: '', analytical: { schemaVersion: 900 } }, { kind: 'none' }); await runtime.settled('d');
  const view = runtime.readView('d', 'w'); const base = coordinator.authoringBase();
  expect(await coordinator.replaceModel(base, model)).toMatchObject({ status: 'refused', reason: 'unavailable' });
  const columns = await runtime.repairColumns('d', 'w', new AbortController().signal);
  expect(coordinator.getSnapshot().canEnqueue).toBe(false);
  expect(await coordinator.replaceModel(base, model, { view, columns })).toEqual({ status: 'saved' });
  await runtime.settled('d'); runtime.refresh('d', 'w'); await runtime.settled('d');
  expect(await coordinator.replaceModel(coordinator.authoringBase(), model, { view, columns })).toMatchObject({ status: 'refused' });
});
it('invalid queued command ends dependent work and cannot resurrect a missing target', async () => {
  const { coordinator, base } = await setup(); const gate = delayDisk();
  const removed = coordinator.editModel(base, { apply: m => ({ ...m, measures: [], layout: {...m.layout, values: m.layout.values.filter(id=>id!=='m')} }) });
  const edit = coordinator.editModel(base, { apply: m => { if (!m.measures.some(measure => measure.id === 'm')) throw new Error('Measure was removed.'); return { ...m }; } });
  const dependent = coordinator.editModel(base, { apply: m => ({ ...m, subtotals: { ...m.subtotals, grandTotal: false } }) });
  gate.unblock(); expect(await removed).toEqual({ status: 'saved' }); expect(await edit).toMatchObject({ status: 'refused', reason: 'invalid' }); expect(await dependent).toMatchObject({ status: 'refused', reason: 'invalid' }); expect(persisted().measures).toEqual([]); expect(persisted().subtotals.grandTotal).toBe(true);
});
it('does not coalesce setters across non-idempotent commands', async () => {
  const { coordinator, base } = await setup(); const gate = delayDisk();
  const seen: string[] = [];
  const x = coordinator.editModel(base, { apply: m => ({ ...m, subtotals: { ...m.subtotals, groups: true } }) });
  const setter = (label: string) => ({ replaceKey: 'label', apply: (m: Readonly<TableModelV1>) => ({ ...m, measures: m.measures.map(measure => ({ ...measure, customLabel: label })) }) });
  const a = coordinator.editModel(base, setter('A'));
  const add = coordinator.editModel(base, { apply: m => { seen.push(m.measures[0].customLabel!); return { ...m, measures: [...m.measures, { id: 'second', sourceFieldId: 'revenue', aggregation: 'sum' }] }; } });
  const b = coordinator.editModel(base, setter('B')); gate.unblock();
  expect((await Promise.all([x, a, add, b])).every(result => result.status === 'saved')).toBe(true); expect(seen).toEqual(['A']); expect(persisted().measures).toHaveLength(2);
});
it('equal-looking external durable intent breaks the original command lineage', async () => {
  const { coordinator, base } = await setup();
  expect(await coordinator.editModel(base, { apply: m => ({ ...m, subtotals: { ...m.subtotals, grandTotal: false } }) })).toEqual({ status: 'saved' });
  await runtime.settled('d');
  dashboards.setState(state => ({ dashboards: state.dashboards.map(d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, cards: t.cards.map(c => ({ ...c, tableDefinition: structuredClone(c.tableDefinition) })) })) })) }));
  expect(await coordinator.editModel(base, { apply: m => ({ ...m, measures: [], layout: {...m.layout, values: m.layout.values.filter(id=>id!=='m')} }) })).toMatchObject({ status: 'refused', reason: 'stale' });
  expect(persisted().measures).toHaveLength(1);
});

it('shared hook snapshots remain stable and unmounting a drawer preserves the owner save', async () => {
  const { coordinator, model } = await setup();
  const owner = renderHook(() => useTableCommit('d', 'w', true));
  const drawer = renderHook(() => useTableCommit('d', 'w'));
  expect(drawer.result.current.coordinator).toBe(owner.result.current.coordinator);
  const snapshot = coordinator.getSnapshot(); owner.rerender(); expect(coordinator.getSnapshot()).toBe(snapshot);
  const gate = delayDisk(); let save!: Promise<boolean>;
  act(() => { save = drawer.result.current.commitModel({ ...model, subtotals: { ...model.subtotals, grandTotal: false } }); });
  expect(owner.result.current.pending).toBe(true); expect(drawer.result.current.pending).toBe(true);
  drawer.unmount(); await act(async () => { gate.unblock(); expect(await save).toBe(true); await runtime.settled('d'); });
  expect(owner.result.current.pending).toBe(false); expect(persisted().subtotals.grandTotal).toBe(false); owner.unmount();
});
it('final owner release settles all accepted promises even while persistence is delayed', async () => {
  const { coordinator, base } = await setup(); const gate = delayDisk();
  const a = coordinator.editModel(base, { apply: m => ({ ...m, subtotals: { ...m.subtotals, grandTotal: false } }) });
  const b = coordinator.editModel(base, { apply: m => ({ ...m, measures: [], layout: {...m.layout, values: m.layout.values.filter(id=>id!=='m')} }) });
  await waitFor(() => expect(gate.write).toHaveBeenCalled()); releases.pop()!();
  expect((await a).status).toBe('refused'); expect((await b).status).toBe('refused'); gate.unblock();
  await waitFor(() => expect(coordinator.getSnapshot().pending).toBe(false));
});
it('viewer transition and card removal invalidate an accepted save before publication', async () => {
  const { coordinator, base, model } = await setup(); const gate = delayDisk();
  const save = coordinator.replaceModel(base, { ...model, subtotals: { ...model.subtotals, grandTotal: false } });
  await waitFor(() => expect(gate.write).toHaveBeenCalled()); dashboards.setState({ viewer: true });
  expect((await save).status).toBe('refused'); gate.unblock(); await waitFor(() => expect(coordinator.getSnapshot().pending).toBe(false)); expect(persisted()).toEqual(model);
  expect(await coordinator.replaceModel(base, model)).toMatchObject({ status: 'refused', reason: 'viewer' });
  dashboards.setState({ viewer: false, dashboards: [] }); expect(await coordinator.replaceModel(base, model)).toMatchObject({ status: 'refused', reason: 'unavailable' });
});
it('unexpected refresh during activation refuses queued work without cancelling the completed save', async () => {
  const { coordinator, base } = await setup(); const executor = runtime.readExecutor('d', 'w')!;
  const apply = executor.applyModel.bind(executor); let unblock!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  vi.spyOn(executor, 'applyModel').mockImplementationOnce(async (...args) => { await gate; return apply(...args); });
  const a = coordinator.editModel(base, { apply: m => ({ ...m, subtotals: { ...m.subtotals, grandTotal: false } }) });
  const b = coordinator.editModel(base, { apply: m => ({ ...m, measures: [], layout: {...m.layout, values: m.layout.values.filter(id=>id!=='m')} }) });
  expect(await a).toEqual({ status: 'saved' }); expect(coordinator.getSnapshot().pending).toBe(true);
  runtime.refresh('d', 'w'); expect(await b).toMatchObject({ status: 'refused', reason: 'stale' }); unblock(); await runtime.settled('d'); expect(persisted().measures).toHaveLength(1);
});
it('a fresh consumer cannot enqueue functional edits during an exclusive strict save', async () => {
  const { coordinator, base, model } = await setup(); const gate = delayDisk();
  const strict = coordinator.replaceModel(base, { ...model, subtotals: { ...model.subtotals, grandTotal: false } });
  const fresh = coordinator.authoringBase();
  let outcome: unknown;
  void coordinator.editModel(fresh, { apply: m => ({ ...m, measures: [], layout: {...m.layout, values: m.layout.values.filter(id=>id!=='m')} }) }).then(result => { outcome = result; });
  await Promise.resolve(); gate.unblock();
  expect(outcome).toMatchObject({ status: 'refused', reason: 'busy' });
  expect(await strict).toEqual({ status: 'saved' }); expect(persisted().measures).toHaveLength(1);
});
it('strict save remains saved when its own activation finishes before the durable call returns', async () => {
  const { coordinator, base, model } = await setup(); const executor = runtime.readExecutor('d', 'w')!;
  const previous = runtime.readView('d', 'w').ready!;
  vi.spyOn(executor, 'applyModel').mockImplementationOnce(async (definition, _selection, revision) => ({ ...previous, revision, inspection: { ...previous.inspection, definition } }));
  expect(await coordinator.replaceModel(base, { ...model, subtotals: { ...model.subtotals, grandTotal: false } })).toEqual({ status: 'saved' });
  expect(persisted().subtotals.grandTotal).toBe(false);
});
it('refreshes a subscribed hook base after equal-looking external intent before its first save', async () => {
  const { coordinator, model } = await setup();
  const drawer = renderHook(() => useTableCommit('d', 'w'));
  const retainedCallback = drawer.result.current.commitModel;
  const snapshot = coordinator.getSnapshot();
  act(() => { dashboards.setState({ activeTabId: 'unrelated-tab' }); });
  expect(coordinator.getSnapshot()).toBe(snapshot);
  act(() => {
    dashboards.setState(state => ({ dashboards: state.dashboards.map(d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, cards: t.cards.map(c => ({ ...c, tableDefinition: structuredClone(c.tableDefinition) })) })) })) }));
  });
  // No failed interaction or parent rerender may be needed to refresh this callback.
  const currentCallback = drawer.result.current.commitModel;
  await act(async () => { expect(await currentCallback(model)).toBe(true); });
  expect(persisted()).toEqual(model);
  await act(async () => { expect(await retainedCallback(model)).toBe(false); });
  drawer.unmount();
});

it('idle StrictMode owner replay has no save error and preserves generation guards', async () => {
  const { model } = await setup();
  releases.pop()!(); await Promise.resolve();
  const captured: ((model: TableModelV1) => Promise<boolean>)[] = [];
  const owner = renderHook(() => {
    const commits = useTableCommit('d', 'w', true);
    useEffect(() => { captured.push(commits.commitModel); }, [commits.commitModel]);
    return commits;
  }, { reactStrictMode: true });
  expect(owner.result.current.error).toBeUndefined();
  expect(owner.result.current.canReplace).toBe(true);
  await act(async () => { expect(await owner.result.current.commitModel(model)).toBe(true); });
  expect(persisted()).toEqual(model);
  await act(async () => { expect(await captured[0](model)).toBe(false); });
  expect(owner.result.current.error).toBeTruthy();
  owner.unmount();
});
it('final release keeps accepted-save cancellation visible after an immediate owner replay', async () => {
  const { coordinator, base, model } = await setup(); const gate = delayDisk();
  const save = coordinator.replaceModel(base, { ...model, subtotals: { ...model.subtotals, grandTotal: false } });
  await waitFor(() => expect(gate.write).toHaveBeenCalled()); releases.pop()!();
  releases.push(coordinator.retain());
  expect(await save).toMatchObject({ status: 'refused', reason: 'stale' });
  expect(coordinator.getSnapshot().error).toBeTruthy();
  gate.unblock(); await waitFor(() => expect(coordinator.getSnapshot().pending).toBe(false));
  expect(persisted()).toEqual(model);
});
it('queued value reorder, pivot toggle and category edit compose against current draft',async()=>{
 const {coordinator,base}=await setup();const gate=delayDisk();
 const add=coordinator.editModel(base,{apply:m=>({...m,measures:[...m.measures,{id:'second',sourceFieldId:'revenue',aggregation:'mean'}]})});
 const move=coordinator.editModel(base,{apply:m=>({...m,layout:{...m.layout,values:['second','m']}})});
 const toggle=coordinator.editModel(base,{replaceKey:'pivot-enabled',apply:m=>({...m,enabled:false})});
 const category=coordinator.editModel(base,{apply:m=>({...m,categories:m.categories.map(c=>({...c,name:'Latest category'}))})});
 gate.unblock();expect((await Promise.all([add,move,toggle,category])).every(result=>result.status==='saved')).toBe(true);
 expect(persisted()).toMatchObject({enabled:false,layout:{values:['second','m']},categories:[{name:'Latest category'}]});
});

it('a header choice queued behind Page category replacement cannot write an old-category member',async()=>{
 const {coordinator,base,model}=await setup();const categoryId=model.categories[0].id;const a='["string","A"]';const b='["string","B"]';
 const pageModel={...model,layout:{...model.layout,rows:[],page:{categoryId,memberKeys: [a]}}};expect(await coordinator.editModel(base,{apply:()=>pageModel})).toEqual({status:'saved'});
 const capturedBase=coordinator.authoringBase();const gate=delayDisk();const replacement=coordinator.editModel(capturedBase,{apply:current=>({...current,categories:[...current.categories,{...current.categories[0],id:'replacement-category'}],layout:{...current.layout,page:{categoryId:'replacement-category',memberKeys: [a]}}})});await waitFor(()=>expect(gate.write).toHaveBeenCalled());
 let choice!:Promise<boolean>;render(createElement(PivotParamControl,{param:paramRow(pageModel)[0],members:[{key:a,label:'A',value:'A',count:1},{key:b,label:'B',value:'B',count:1}],readonly:false,onEditModel:edit=>{choice=coordinator.editModel(capturedBase,edit).then(outcome=>outcome.status==='saved');return choice;}}));fireEvent.click(screen.getByRole('button',{name:'region: A'}));fireEvent.click(screen.getByLabelText('A'));fireEvent.click(screen.getByLabelText('B'));fireEvent.click(screen.getByRole('button',{name:'Apply'}));
 await act(async()=>{gate.unblock();expect(await replacement).toEqual({status:'saved'});expect(await choice).toBe(true);await runtime.settled('d');});expect(persisted().layout.page).toEqual({categoryId:'replacement-category',memberKeys:[a]});expect(runtime.readView('d','w').ready?.inspection.definition.analytical).toEqual(persisted());
});

it('Statement definition adoption refuses unavailable bindings before durable or runtime publication', async () => {
  const { coordinator, base, model } = await setup();
  const { statement } = statementFixture();
  expect(await coordinator.replaceDefinition(base,{table:{},search:'',analytical:statement})).toMatchObject({status:'refused',reason:'invalid'});
  expect(runtime.readView('d','w').definition.analytical).toEqual(model);
  expect(__read('dashboards/d.json')).toBeUndefined();
});

async function setupStatement() {
 const {statement,source}=statementFixture();
 const values=source.rows[0].values; const fields=Object.keys(values);
 const {readLocalFile}=await import('../lib/localFiles');
 vi.mocked(readLocalFile).mockResolvedValueOnce(new TextEncoder().encode(`${fields.join(',')}\n${fields.map(id=>values[id]).join(',')}\n`));
 const dashboard:Dashboard={id:'d',name:'Statement',tabs:[{id:'t',name:'Main',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'a.csv'},layout:{x:0,y:0,w:1,h:1},tableDefinition:{table:{},search:'',analytical:statement}}]}]};
 await saveDashboard(dashboard);
 dashboards.setState({dashboards:[dashboard],viewer:false}); runtime.syncDashboard(dashboard); runtime.ensureTable('d','w'); await runtime.settled('d');
 expect(runtime.readView('d','w').ready!.inspection.inputColumns.map(c=>c.id)).toContain('revenue');
 const coordinator=tableCommitCoordinators.get('d','w'); releases.push(coordinator.retain());
 return {coordinator,base:coordinator.authoringBase(),statement};
}
it.each(['failed','refresh','cancel'] as const)('Statement %s update keeps old canonical and runtime definition',async mode=>{
 const {coordinator,base,statement}=await setupStatement();
 const next=structuredClone(statement);next.overrides.labels[next.template.lines[0].id]='Local updated label';
 if(mode==='failed') __failPath('dashboards/d.json');
 const gate=mode==='failed'?undefined:delayDisk();
 const saving=coordinator.replaceDefinition(base,{table:{},search:'',analytical:next});
 if(gate){
  await waitFor(()=>expect(gate.write).toHaveBeenCalled());
  if(mode==='refresh') runtime.refresh('d','w'); else releases.pop()!();
  gate.unblock();
 }
 const outcome=await saving; expect(outcome.status,JSON.stringify(outcome)).toBe(mode==='failed'?'failed':'refused');
 await runtime.settled('d');
 expect(runtime.readView('d','w').definition.analytical).toEqual(statement);
 expect(dashboards.getState().dashboards[0].tabs[0].cards[0].tableDefinition?.analytical).toEqual(statement);
 await waitFor(()=>expect(JSON.parse(__read('dashboards/d.json')!).tabs[0].cards[0].tableDefinition.analytical).toEqual(statement));
});
it('Statement cold error repairs require the exact current schema witness',async()=>{
 const {coordinator,statement}=await setupStatement();
 runtime.updateDefinition('d','w',{table:{},search:'',analytical:{kind:'statement',schemaVersion:99}},{kind:'none'});await runtime.settled('d');
 const view=runtime.readView('d','w'),base=coordinator.authoringBase(),definition={table:{},search:'',analytical:statement};
 expect(await coordinator.replaceDefinition(base,definition)).toMatchObject({status:'refused'});
 const {readLocalFile}=await import('../lib/localFiles');const {source}=statementFixture();const values=source.rows[0].values;
 vi.mocked(readLocalFile).mockResolvedValueOnce(new TextEncoder().encode(`${Object.keys(values).join(',')}\n${Object.values(values).join(',')}\n`));
 const columns=await runtime.repairColumns('d','w',new AbortController().signal);
 expect(await coordinator.replaceDefinition(base,definition,{view,columns})).toEqual({status:'saved'});
 await runtime.settled('d');runtime.refresh('d','w');await runtime.settled('d');
 expect(await coordinator.replaceDefinition(coordinator.authoringBase(),definition,{view,columns})).toMatchObject({status:'refused'});
});
it('Statement repair begun after retarget refuses a new base with the old runtime schema',async()=>{
 const {coordinator,statement}=await setupStatement();const view=runtime.readView('d','w');const columns=view.ready!.inspection.inputColumns;
 dashboards.setState(state=>({dashboards:state.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:t.cards.map(c=>({...c,params:{file:'retargeted.csv'}}))}))}))}));
 const result=await coordinator.replaceDefinition(coordinator.authoringBase(),{table:{},search:'',analytical:statement},{view,columns});
 expect(result).toMatchObject({status:'refused',reason:'stale'});
});
it('queues a V1 edit submitted after its own durable save while worker activation is held',async()=>{
 const {coordinator,base}=await setup();const executor=runtime.readExecutor('d','w')!;const apply=executor.applyModel.bind(executor);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(executor,'applyModel').mockImplementationOnce(async(...args)=>{await gate;return apply(...args);});
 try {
  expect(await coordinator.editModel(base,{apply:model=>({...model,subtotals:{...model.subtotals,grandTotal:false}})})).toEqual({status:'saved'});
  expect(runtime.readView('d','w').status).toBe('updating');expect(coordinator.getSnapshot().canEnqueue).toBe(true);
  let outcome:unknown;const second=coordinator.editModel(base,{apply:model=>({...model,measures:model.measures.map(m=>({...m,customLabel:'Queued sales'}))})}).then(result=>{outcome=result;return result;});
  await Promise.resolve();expect(outcome).toBeUndefined();release();expect(await second).toEqual({status:'saved'});await runtime.settled('d');
  expect(persisted().subtotals.grandTotal).toBe(false);expect(persisted().measures[0].customLabel).toBe('Queued sales');
 }finally {release();await runtime.settled('d');}
});
it.each(['refresh','retarget'] as const)('held own activation cannot authorize a new functional edit after external %s',async mode=>{
 const {coordinator,base}=await setup();const executor=runtime.readExecutor('d','w')!;const apply=executor.applyModel.bind(executor);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(executor,'applyModel').mockImplementationOnce(async(...args)=>{await gate;return apply(...args);});
 try {
  expect(await coordinator.editModel(base,{apply:model=>({...model,subtotals:{...model.subtotals,grandTotal:false}})})).toEqual({status:'saved'});
  if(mode==='refresh')runtime.refresh('d','w');else dashboards.setState(state=>({dashboards:state.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:t.cards.map(c=>({...c,params:{file:'retargeted.csv'}}))}))}))}));
  expect(await coordinator.editModel(coordinator.authoringBase(),{apply:model=>({...model,measures:model.measures.map(m=>({...m,customLabel:'Refused sales'}))})})).toMatchObject({status:'refused'});
  expect(persisted().measures[0].customLabel).not.toBe('Refused sales');
 }finally {release();await runtime.settled('d');}
});
it('a table-state patch during a recalculation waits for it, and one left at the final release is still written',async()=>{
 const {coordinator}=await setup();const executor=runtime.readExecutor('d','w')!;const apply=executor.applyModel.bind(executor);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(executor,'applyModel').mockImplementationOnce(async(...args)=>{await gate;return apply(...args);});
 const table=()=>JSON.parse(__read('dashboards/d.json')!).tabs[0].cards[0].table;
 try {
  coordinator.patchTable({sorting:[{id:'region',desc:true}]});
  await waitFor(()=>expect(runtime.readView('d','w').status).toBe('updating'));
  // The sort's recalculation is still running: a width dragged now used to be refused as stale.
  coordinator.patchTable({widths:{region:120}});
  release();await runtime.settled('d');
  await waitFor(()=>expect(table()).toEqual({sorting:[{id:'region',desc:true}],widths:{region:120}}));
  // A tab switch releases the owner before the table's own unmount flush runs.
  releases.splice(0).forEach(fn=>fn());
  coordinator.patchTable({widths:{region:200}});
  await waitFor(()=>expect(table().widths).toEqual({region:200}));
 }finally {release();await runtime.settled('d');}
});
