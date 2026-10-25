// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { pivotValueKey } from '../../lib/pivotKeys';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, afterEach, expect, it, vi } from 'vitest';
import { LocalTableRenderer as RuntimeRenderer } from './LocalTableRenderer';
import { PivotToggle } from './pivot-drawer/PivotToggle';
import { clearDrawerDashboard, dispatchDrawer } from '../../stores/pivotDrawerStore';
function LocalTableRenderer(props:Parameters<typeof RuntimeRenderer>[0]) {return <><PivotToggle dashboardId="execution" widgetId="w"/><RuntimeRenderer {...props}/></>;}
const inspect = () => act(()=>dispatchDrawer('execution','w',{kind:'select',section:'inspect'}));
import { useDashboardStore } from '../../stores/dashboardStore';
import { tableExecutionStore } from '../../stores/tableExecutionStore';
import { ProviderBoundary as Boundary } from '../../test/tableProviderBoundary';
import type { Dashboard } from '../../lib/types';
import type { TableModelV1 } from '../../lib/tableModel/types';
import type { ExecutionRequest } from '../../lib/tableExecution/types';
vi.mock('../../lib/localFiles', () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode('region,revenue,date\nA,10,2026-01-01\nA,20,2026-01-02\nB,90,2026-01-03\n')) }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: (index + 1) * 28 })), getTotalSize: () => count * 28, measureElement: () => {}, scrollToIndex: () => {} }) }));
describe.each(['typescript','rust'] as const)('%s provider',engine=>{
beforeEach(()=>{vi.stubEnv('DEV',true);vi.stubEnv('VITE_TABLE_ENGINE',engine);});
afterEach(()=>vi.unstubAllEnvs());
afterEach(() => { cleanup(); clearDrawerDashboard('execution'); tableExecutionStore.disposeDashboard('execution'); vi.unstubAllGlobals(); });
it('file pivot edits keep source schema and bounded expanded children use stable paths', async () => {
  vi.stubGlobal('Worker', Boundary);
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const, date: 'last' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  tableExecutionStore.syncDashboard(dashboard);
  const saved = vi.fn();
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} state={table} onStateChange={saved} filterRow />);
  await screen.findByRole('button', { name: 'Expand A' });
  expect(container.querySelector('tfoot')?.textContent).toContain('40');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Expand A' }));
  await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('10'));
  expect(container.querySelector('tbody')?.textContent).toContain('20');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse A' }));
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  fireEvent.click(container.querySelector('th[data-field="revenue"]')!);
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table?.sorting).toEqual([{ id: 'revenue', desc: false }]));
  // Saved intent precedes the worker's joined rows and totals publication.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pivot' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Pivot' }));
  expect(screen.getByText('Row Groups')).toBeInTheDocument();
  expect(container.querySelector('[data-list="rows"]')).toHaveTextContent('region');
  expect(container.querySelector('[data-list="available"]')).toHaveTextContent('date');
  fireEvent.change(screen.getByLabelText('Minimum revenue'), { target: { value: '50' } });
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('90'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Expand A' })).not.toBeInTheDocument());
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table?.columnFilters).toEqual(expect.any(Array));
  expect(container.querySelector('tfoot')?.textContent).toContain('90');
  // Numeric filtering is chosen from the complete worker schema, not loaded aggregate values.
  expect(screen.getByRole('button', { name: 'Pivot' })).toHaveAttribute('aria-expanded', 'true');
  await act(async () => { await tableExecutionStore.settled('execution'); });
});

it('zero matching file rows retain filter controls and Clear restores the worker result', async () => {
  vi.stubGlobal('Worker', Boundary);
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const, date: 'last' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} state={table} filterRow />);
  await screen.findByRole('button', { name: 'Expand A' });
  fireEvent.change(screen.getByLabelText('Minimum revenue'), { target: { value: '100' } });
  await screen.findByText('No rows.');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  expect(screen.getByLabelText('Minimum revenue')).toHaveValue(100);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await screen.findByRole('button', { name: 'Expand A' });
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  expect(screen.queryByText('No rows.')).not.toBeInTheDocument();
  expect(container.querySelector('tfoot')?.textContent).toContain('40');
  expect(screen.getByLabelText('Minimum revenue')).toHaveValue(null);
});
it('selection saves durable symbolic intent before runtime publishes and does not reread the file', async () => {
  vi.stubGlobal('Worker', Boundary);
  const { useDashboardStore } = await import('../../stores/dashboardStore');
  const { readLocalFile } = await import('../../lib/localFiles');
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  tableExecutionStore.syncDashboard(dashboard);
  const reads = vi.mocked(readLocalFile); reads.mockClear();
  render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all rows' }));
  await screen.findByText('3 selected');
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableSelection).toEqual({ kind: 'allMatching', excludedIds: [] });
  expect(reads).toHaveBeenCalledTimes(1);
});
it('selection does not change group folds', async () => {
  vi.stubGlobal('Worker', Boundary);
  const { useDashboardStore } = await import('../../stores/dashboardStore');
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Expand A' }));
  await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
  fireEvent.click(container.querySelector('tbody input[type="checkbox"]')!);
  await screen.findByText('1 selected');
  expect(screen.getByRole('button', { name: 'Collapse A' })).toBeInTheDocument();
  expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
});
it('root refresh durably removes vanished selections and shows the reconciliation notice', async () => {
  vi.stubGlobal('Worker', Boundary);
  const { useDashboardStore } = await import('../../stores/dashboardStore');
  const { readLocalFile } = await import('../../lib/localFiles');
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  await screen.findByRole('checkbox', { name: 'Select all rows' });
  fireEvent.click(container.querySelector('tbody input[type="checkbox"]')!);
  await screen.findByText('1 selected');
  vi.mocked(readLocalFile).mockResolvedValueOnce(new TextEncoder().encode('region,revenue,date\nB,90,2026-01-03\n'));
  await act(async () => { tableExecutionStore.refresh('execution', 'w'); await tableExecutionStore.settled('execution'); });
  await screen.findByText(/1 selection identities removed/);
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableSelection).toEqual({ kind: 'none' });
  expect(screen.getByText('0 selected')).toBeInTheDocument();
  expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
});

it('linked file selection is durably reconciled from the root witness even while the source hides it', async () => {
  vi.stubGlobal('Worker', Boundary);
  const { useDashboardStore } = await import('../../stores/dashboardStore');
  const { readLocalFile } = await import('../../lib/localFiles');
  const root = { id: 'root', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 } };
  const child = { ...root, id: 'child', linkedSource: { kind: 'widget' as const, sourceWidgetId: 'root' } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [root, child] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const reads = vi.mocked(readLocalFile); reads.mockClear();
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'child' }} file="data.csv" label="Child" refreshKey={0} />);
  await screen.findByRole('checkbox', { name: 'Select all rows' });
  fireEvent.click(container.querySelector('tbody input[type="checkbox"]')!);
  await screen.findByText('1 selected');
  const selection = useDashboardStore.getState().dashboards[0].tabs[0].cards[1].tableSelection;
  await act(async () => {
    tableExecutionStore.updateDefinition('execution', 'root', { table: {}, search: 'B' }, { kind: 'none' });
    await tableExecutionStore.settled('execution');
  });
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].tableSelection).toEqual(selection);
  reads.mockResolvedValueOnce(new TextEncoder().encode('region,revenue,date\nB,90,2026-01-03\n'));
  await act(async () => { tableExecutionStore.refresh('execution', 'child'); await tableExecutionStore.settled('execution'); });
  await screen.findByText(/1 selection identities removed/);
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].tableSelection).toEqual({ kind: 'none' });
  expect(reads).toHaveBeenCalledTimes(2);
  expect(container.querySelector('tbody')?.textContent).toContain('90');
});

it('duplicate edits save one durable definition before worker publication and preserve source acquisition', async () => {
  vi.stubGlobal('Worker', Boundary);
  const { useDashboardStore } = await import('../../stores/dashboardStore');
  const { readLocalFile } = await import('../../lib/localFiles');
  const user = (await import('@testing-library/user-event')).default.setup();
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  tableExecutionStore.syncDashboard(dashboard);
  vi.mocked(readLocalFile).mockClear();
  const saved = vi.fn();
  const commit = vi.spyOn(useDashboardStore.getState(), 'commitTableDefinition');
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} onStateChange={saved} />);
  await screen.findByRole('button', { name: 'Expand A' });
  await user.click(screen.getByRole('button', { name: 'Pivot' }));
  await user.click(screen.getByRole('button', { name: 'revenue — Average' }));
  await user.click(screen.getByRole('menuitem', { name: 'Duplicate revenue — Average' }));
  await screen.findByRole('button', { name: 'revenue — Average (2)' });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(saved).not.toHaveBeenCalled();
  const measures = (useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition!.analytical as TableModelV1).measures;
  expect(measures.filter(m => m.sourceFieldId === 'revenue')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'revenue — Average (2)' }));
  await user.click(screen.getByRole('menuitem', { name: 'Aggregation' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Total' }));
  await waitFor(() => expect(container.querySelector('tfoot')?.textContent).toContain('120'));
  expect(container.querySelector('thead')?.textContent).toContain('revenue — Average');
  expect(container.querySelector('thead')?.textContent).toContain('revenue — Total');
  expect(commit).toHaveBeenCalledTimes(2);
  expect(vi.mocked(readLocalFile)).toHaveBeenCalledTimes(1);
  commit.mockRestore();
});

it('failed durable Duplicate keeps the last valid definition and result', async () => {
  vi.stubGlobal('Worker', Boundary);
  const { __failPath, __reset } = await import('../../test/memfs');
  const user = (await import('@testing-library/user-event')).default.setup();
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  await screen.findByRole('button', { name: 'Expand A' });
  const definition = tableExecutionStore.readView('execution', 'w').definition;
  __failPath('dashboards/execution.json');
  try {
    await user.click(screen.getByRole('button', { name: 'Pivot' }));
    await user.click(screen.getByRole('button', { name: 'revenue — Average' }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate revenue — Average' }));
    await screen.findByText('Could not save table; try again.');
    expect(tableExecutionStore.readView('execution', 'w').definition).toBe(definition);
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table).toEqual(table);
    expect(screen.queryByRole('button', { name: 'revenue — Average (2)' })).not.toBeInTheDocument();
    expect(container.querySelector('tfoot')?.textContent).toContain('40');
  } finally { __reset(); }
});

it('does not publish a Duplicate whose durable save completes after the renderer unmounts', async () => {
  vi.stubGlobal('Worker', Boundary);
  const files = await import('../../lib/dashboardsFile');
  const { __read } = await import('../../test/memfs');
  const realSave = files.saveDashboard;
  let finish!: () => void;
  const save = vi.spyOn(files, 'saveDashboard').mockImplementationOnce(async dashboard => { await new Promise<void>(resolve => { finish = resolve; }); await realSave(dashboard); });
  const user = (await import('@testing-library/user-event')).default.setup();
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const { unmount } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  await screen.findByRole('button', { name: 'Expand A' });
  const definition = tableExecutionStore.readView('execution', 'w').definition;
  await user.click(screen.getByRole('button', { name: 'Pivot' }));
  await user.click(screen.getByRole('button', { name: 'revenue — Average' }));
  await user.click(screen.getByRole('menuitem', { name: 'Duplicate revenue — Average' }));
  await screen.findByText('Saving table…');
  expect(tableExecutionStore.readView('execution', 'w').definition).toBe(definition);
  expect(screen.getByRole('button', { name: 'Pivot' })).toBeEnabled();
  unmount();
  await act(async () => { finish(); });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(JSON.parse(__read('dashboards/execution.json')!).tabs[0].cards[0].table).toEqual(table));
  expect(tableExecutionStore.readView('execution', 'w').definition).toBe(definition);
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table).toEqual(table);
  save.mockRestore();
});

it.each(['Move to Available', 'Move to Column Groups'])('acknowledges durable %s before fast-worker invalid-group selection reconciliation', async action => {
  vi.stubGlobal('Worker', Boundary);
  const { __read } = await import('../../test/memfs');
  const user = (await import('@testing-library/user-event')).default.setup();
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  // Sync only the initial definition. No TableExecutionRuntime/passive
  // dashboard synchronization can rescue a stale runtime durable snapshot.
  tableExecutionStore.syncDashboard(dashboard);
  const commit = vi.spyOn(useDashboardStore.getState(), 'commitTableDefinition');
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  try {
    await screen.findByRole('button', { name: 'Expand A' });
    await user.click(container.querySelector('tbody input[type="checkbox"]')!);
    await screen.findByText('1 selected');
    expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableSelection).toMatchObject({ kind: 'explicit' });
    await user.click(screen.getByRole('button', { name: 'Pivot' }));
    await user.click(container.querySelector('[data-list="rows"] button')!);
    await user.click(screen.getByRole('menuitem', { name: action }));
    await act(async () => { await tableExecutionStore.settled('execution'); });
    await waitFor(() => expect(tableExecutionStore.readView('execution', 'w').status).toBe(action === 'Move to Column Groups' ? 'empty' : 'ready'));
    expect(tableExecutionStore.readView('execution', 'w').selection).toEqual({ kind: 'none' });
    expect(tableExecutionStore.readView('execution', 'w').error).toBeUndefined();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const card = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
    expect(card.tableSelection).toEqual({ kind: 'none' });
    expect((card.tableDefinition?.analytical as TableModelV1).layout.rows).toEqual([]);
    expect(card.table?.pivot?.grouping).toEqual(['region']);
    expect(JSON.parse(__read('dashboards/execution.json')!).tabs[0].cards[0]).toMatchObject({ table: card.table, tableDefinition: card.tableDefinition, tableSelection: { kind: 'none' } });
    expect(commit).toHaveBeenCalledTimes(3); // selection, definition, reconciliation
    const reconciliationGuard = commit.mock.calls[2][4]!;
    expect(reconciliationGuard.expected.table).toEqual(card.table);
    expect(reconciliationGuard.expected.tableDefinition).toEqual(card.tableDefinition);
  } finally { commit.mockRestore(); }
});

it('read-only analytical inspection requests bound operators and footer errors without authoring', async () => {
 vi.stubGlobal('Worker',Boundary);
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native' as const}],measures:[{id:'sum',sourceFieldId:'revenue',aggregation:'sum' as const}],formulas:[{id:'broken',name:'Broken',scope:'aggregate' as const,expression:'1 / 0',ast:{kind:'binary' as const,operator:'/' as const,left:{kind:'literal' as const,value:1},right:{kind:'literal' as const,value:0}}}],layout:{rows:['regionCategory'],columns:[], values: ['broken']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:true});tableExecutionStore.syncDashboard(dashboard);
 const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0} />);
 const toggle=await screen.findByRole('button',{name:'Pivot'});
 inspect();
 await screen.findByText(/Resolved operators: sum/);
 expect(container.querySelector('tfoot [aria-label="Error: Cannot divide by zero."]')).toHaveTextContent('⚠ #ERROR');
 expect(screen.getByRole('button',{name:'Pivot'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Close pivot drawer'}));
 expect(toggle).toHaveFocus();
 inspect();
 await screen.findByText(/Resolved operators: sum/);
 fireEvent.keyDown(screen.getByRole('button',{name:'Close pivot drawer'}),{key:'Escape'});
 fireEvent.keyDown(screen.getByRole('button',{name:'Close pivot drawer'}),{key:'Escape'});
 expect(toggle).toHaveFocus();
 expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition?.analytical).toEqual(analytical);
 await act(async()=>{await tableExecutionStore.settled('execution');});
});

it('simultaneous page facets and inspection settlement enable inspector pagination',async()=>{
 const held:(()=>Promise<void>)[]=[];
 class HeldMetadataBoundary extends Boundary {
  postMessage(request:ExecutionRequest){if(request.kind==='facets'||request.kind==='inspect')held.push(()=>this.handler(request));else super.postMessage(request);}
 }
 vi.stubGlobal('Worker',HeldMetadataBoundary);
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native' as const}],measures:[{id:'sum',sourceFieldId:'revenue',aggregation:'sum' as const}],
  formulas:Array.from({length:25},(_,i)=>({id:`f${i}`,name:`Formula ${i}`,scope:'aggregate' as const,expression:String(i),ast:{kind:'literal' as const,value:i}})),
  layout:{rows:[],columns:[], values: [],page:{categoryId:'regionCategory',memberKeys: [pivotValueKey('A')]}},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:true});tableExecutionStore.syncDashboard(dashboard);
 render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0} />);
 inspect();
 await waitFor(()=>expect(held).toHaveLength(2));
 await act(async()=>{await Promise.all(held.splice(0).map(deliver=>deliver()));});
 await screen.findByText('Showing 1–20 of 27');
 expect(screen.queryByText('Loading inspection…')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Next inspection page'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Next inspection page'}));
 await waitFor(()=>expect(held).toHaveLength(1));
 await act(async()=>{await held.shift()!();});
 await screen.findByText('Showing 21–27 of 27');
 expect(screen.getByRole('button',{name:'Previous inspection page'})).toBeEnabled();
 expect(screen.getByRole('button',{name:'Next inspection page'})).toBeDisabled();
 await act(async()=>{await tableExecutionStore.settled('execution');});
});

it('activates only on explicit request and migrates existing measure instances and temporal recipes into canonical authority',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const table={columnOrder:['revenue','date','region'],pivot:{enabled:true,grouping:['region','date'],split:[],buckets:{date:'week' as const},measures:[{id:'average',sourceFieldId:'revenue',aggregation:'mean' as const},{id:'total',sourceFieldId:'revenue',aggregation:'sum' as const}]}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},table,layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pivot'}));const enable=await screen.findByRole('button',{name:'Enable report model'});expect(tableExecutionStore.readView('execution','w').definition.analytical).toBeUndefined();
 fireEvent.click(enable);await waitFor(()=>expect(tableExecutionStore.readView('execution','w').definition.analytical).toEqual(expect.objectContaining({measures:table.pivot.measures,categories:expect.arrayContaining([expect.objectContaining({sourceFieldId:'date',legacyBucket:'week'})])})));
 fireEvent.click(screen.getByRole('tab',{name:'Categories'}));expect(screen.getByRole('region',{name:'Categories'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('tab',{name:'Measures'}));fireEvent.click(screen.getByRole('button',{name:'Duplicate revenue — Average'}));await waitFor(()=>expect((tableExecutionStore.readView('execution','w').definition.analytical as {measures:unknown[]}).measures).toHaveLength(3));
 expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table?.pivot?.measures).toHaveLength(2);
 await act(async()=>{await tableExecutionStore.settled('execution');});
});
it('failed report activation keeps canonical definition and old rows/totals',async()=>{
 vi.stubGlobal('Worker',Boundary);const {__failPath,__reset}=await import('../../test/memfs');
 const table={pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{revenue:'mean' as const}}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},table,layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pivot'}));const button=await screen.findByRole('button',{name:'Enable report model'});const old=tableExecutionStore.readView('execution','w').definition;
 __failPath('dashboards/execution.json');try{fireEvent.click(button);await screen.findByText('Could not save table; try again.');expect(tableExecutionStore.readView('execution','w').definition).toBe(old);expect(container.querySelector('tfoot')).toHaveTextContent('40');}finally{__reset();}
});
it('activation completing after unmount cannot publish ephemeral analytical authority',async()=>{
 vi.stubGlobal('Worker',Boundary);const files=await import('../../lib/dashboardsFile');const realSave=files.saveDashboard;let release!:()=>void;
 const save=vi.spyOn(files,'saveDashboard').mockImplementationOnce(async dashboard=>{await new Promise<void>(resolve=>{release=resolve;});await realSave(dashboard);});
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 const {unmount}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pivot'}));fireEvent.click(await screen.findByRole('button',{name:'Enable report model'}));await screen.findByText('Saving table…');const old=tableExecutionStore.readView('execution','w').definition;unmount();await act(async()=>{release();});await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(tableExecutionStore.readView('execution','w').definition).toBe(old);expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition?.analytical).toBeUndefined();save.mockRestore();
});
it('calculated header Show formula opens the bound definition and restores panel focus on Escape',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCat',name:'Region',sourceFieldId:'region',transform:'native' as const}],measures:[],formulas:[{id:'ratio',name:'Ratio',scope:'aggregate' as const,expression:'sum(revenue)',ast:{kind:'call' as const,function:'sum' as const,args:[{kind:'reference' as const,target:'field' as const,id:'revenue'}]}}],layout:{rows:['regionCat'],columns:[], values: ['ratio']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 await screen.findByText('Ratio');fireEvent.contextMenu(container.querySelector('th[data-field="ratio"]')!);
 fireEvent.click(await screen.findByRole('menuitem',{name:'Show formula'}));expect(screen.getByLabelText('Formula name')).toHaveValue('Ratio');
 fireEvent.keyDown(screen.getByRole('button',{name:'Close pivot drawer'}),{key:'Escape'});expect(screen.getByLabelText('Expression')).not.toBeVisible();await act(async()=>{await tableExecutionStore.settled('execution');});
});
it('analytical source filters bind incoming fields rather than independent measure output IDs',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCat',name:'Region',sourceFieldId:'region',transform:'native' as const}],measures:[{id:'average',sourceFieldId:'revenue',aggregation:'mean' as const}],formulas:[],layout:{rows:['regionCat'],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0} filterRow/>);
 fireEvent.change(await screen.findByLabelText('Minimum revenue'),{target:{value:'50'}});await waitFor(()=>expect(container.querySelector('tfoot')).toHaveTextContent('90'));expect(tableExecutionStore.readView('execution','w').definition.table.columnFilters).toEqual([{id:'revenue',value:{min:50}}]);await act(async()=>{await tableExecutionStore.settled('execution');});
});
it('migration preserves configured Last and warns about required report date binding',async()=>{
 vi.stubGlobal('Worker',Boundary);const table={pivot:{enabled:true,grouping:['region'],split:[],measures:[{id:'last-date',sourceFieldId:'date',aggregation:'last' as const}]}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},table,layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pivot'}));fireEvent.click(await screen.findByRole('button',{name:'Enable report model'}));await screen.findByText('First/Last needs a date category in report mode.');expect((tableExecutionStore.readView('execution','w').definition.analytical as {measures:unknown[]}).measures).toEqual(table.pivot.measures);await act(async()=>{await tableExecutionStore.settled('execution');});
 await waitFor(()=>expect(screen.getByRole('switch',{name:'Pivot on'})).toBeEnabled());
 fireEvent.click(screen.getByRole('switch',{name:'Pivot on'}));
 await waitFor(()=>expect((tableExecutionStore.readView('execution','w').definition.analytical as TableModelV1).enabled).toBe(false));
 expect(screen.queryByText('First/Last needs a date category in report mode.')).not.toBeInTheDocument();
 await act(async()=>{await tableExecutionStore.settled('execution');});
});
it('Clear groups turns the pivot off and empties row and column groups, keeping data columns',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCat',name:'Region',sourceFieldId:'region',transform:'native' as const}],measures:[{id:'average',sourceFieldId:'revenue',aggregation:'mean' as const}],formulas:[],layout:{rows:['regionCat'],columns:[],values:['average']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pivot'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Clear groups'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Clear groups'}));
 await waitFor(()=>expect((tableExecutionStore.readView('execution','w').definition.analytical as TableModelV1).enabled).toBe(false));
 const saved=tableExecutionStore.readView('execution','w').definition.analytical as TableModelV1;
 expect(saved.layout.rows).toEqual([]);expect(saved.layout.columns).toEqual([]);
 expect(saved.measures).toEqual(analytical.measures);expect(saved.categories).toEqual(analytical.categories);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Clear groups'})).toBeDisabled());
 await act(async()=>{await tableExecutionStore.settled('execution');});
});
it('source formula filters use bounded stable-ID metadata and preserve prior result on failed durable change',async()=>{
 const requests:ExecutionRequest[]=[];class SourceMetadataBoundary extends Boundary {postMessage(request:ExecutionRequest){requests.push(request);super.postMessage(request);}}
 vi.stubGlobal('Worker',SourceMetadataBoundary);const {__failPath,__reset}=await import('../../test/memfs');
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCat',name:'Region',sourceFieldId:'region',transform:'native' as const}],measures:[{id:'average',sourceFieldId:'revenue',aggregation:'mean' as const}],formulas:[{id:'inverse',name:'Inverse revenue',scope:'source' as const,expression:'1 / revenue',ast:{kind:'binary' as const,operator:'/' as const,left:{kind:'literal' as const,value:1},right:{kind:'reference' as const,target:'field' as const,id:'revenue'}}}],layout:{rows:['regionCat'],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0} filterRow/>);
 fireEvent.change(await screen.findByLabelText('Source formula filter'),{target:{value:'inverse'}});fireEvent.change(await screen.findByLabelText('Minimum Inverse revenue'),{target:{value:'0.04'}});await waitFor(()=>expect(container.querySelector('tfoot')).toHaveTextContent('15'));
 expect(requests.some(r=>r.kind==='inspect'&&r.definitionId==='inverse'&&r.limit===1)).toBe(true);expect(tableExecutionStore.readView('execution','w').ready?.inspection.inputColumns.some(c=>c.id==='inverse')).toBe(false);
 const old=tableExecutionStore.readView('execution','w').definition;__failPath('dashboards/execution.json');try{fireEvent.change(await screen.findByLabelText('Minimum Inverse revenue'),{target:{value:'0.08'}});await screen.findByText('Could not save table; try again.');expect(tableExecutionStore.readView('execution','w').definition).toBe(old);expect(container.querySelector('tfoot')).toHaveTextContent('15');}finally{__reset();}
 act(()=>dispatchDrawer('execution','w',{kind:'select',section:'formulas'}));fireEvent.change(screen.getByLabelText('Expression'),{target:{value:'1 / revenue + 1'}});fireEvent.click(screen.getByRole('button',{name:'Save formula'}));await waitFor(()=>expect((tableExecutionStore.readView('execution','w').definition.analytical as {formulas:{expression:string}[]}).formulas[0].expression).toBe('1 / revenue + 1'));
 await act(async()=>{await tableExecutionStore.settled('execution');});
});
it('all-error source formulas require an explicit filter type and retain incomplete empty results',async()=>{
 const warnings=vi.spyOn(console,'warn');
 vi.stubGlobal('Worker',Boundary);
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCat',name:'Region',sourceFieldId:'region',transform:'native' as const}],measures:[{id:'average',sourceFieldId:'revenue',aggregation:'mean' as const}],formulas:[{id:'broken',name:'Broken source',scope:'source' as const,expression:'1 / 0',ast:{kind:'binary' as const,operator:'/' as const,left:{kind:'literal' as const,value:1},right:{kind:'literal' as const,value:0}}}],layout:{rows:['regionCat'],columns:[], values: []},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0} filterRow/>);
 fireEvent.change(await screen.findByLabelText('Source formula filter'),{target:{value:'broken'}});fireEvent.change(await screen.findByLabelText('Formula filter type'),{target:{value:'number'}});fireEvent.change(screen.getByLabelText('Minimum Broken source'),{target:{value:'1'}});await screen.findByText('Calculation is incomplete because required constraints could not be evaluated.');await waitFor(()=>expect(container.querySelector('tfoot')).toHaveTextContent('No eligible data'));expect(tableExecutionStore.readView('execution','w').ready?.completeness.kind).toBe('partial');await act(async()=>{await tableExecutionStore.settled('execution');});expect(warnings).not.toHaveBeenCalled();warnings.mockRestore();
});

it.each([{ schemaVersion: 99 }, { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [], formulas: [], layout: null, checklists: {}, resultFilters: [], subtotals: { grandTotal: true, groups: false } }])('cold malformed model stays inert while runtime inspection supports durable validated repair: %j', async raw => {
  vi.stubGlobal('Worker', Boundary);
  const { migratePivot } = await import('../../lib/tableModel/migration');
  const { readLocalFile } = await import('../../lib/localFiles');
  const { __failPath, __reset, __read } = await import('../../test/memfs');
  const original = { search: '', table: {}, analytical: raw };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, tableDefinition: original, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  vi.mocked(readLocalFile).mockClear();
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  await waitFor(() => expect(tableExecutionStore.readView('execution', 'w').status).toBe('blocked'));
  expect(readLocalFile).not.toHaveBeenCalled();
  inspect();
  const draft = await screen.findByLabelText('Model repair draft');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save repaired model' })).not.toBeDisabled());
  expect(tableExecutionStore.readView('execution', 'w').active).toBeUndefined();
  expect(container.querySelector('tbody')).toBeNull();
  expect(JSON.parse((draft as HTMLTextAreaElement).value)).toEqual(raw);
  fireEvent.change(draft, { target: { value: '{' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save repaired model' }));
  await screen.findByText(/Enter a valid JSON model/);
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition).toEqual(original);
  const repaired = migratePivot({ enabled: false, grouping: [], split: [] }, { columns: [{ id: 'revenue', label: 'revenue', dtype: 'number' }] });
  repaired.formulas = [{ id: 'twice', name: 'Twice', scope: 'source', expression: '[revenue]*2', ast: { kind: 'binary', operator: '*', left: { kind: 'reference', target: 'field', id: 'revenue' }, right: { kind: 'literal', value: 2 } } }];
  fireEvent.change(draft, { target: { value: JSON.stringify(repaired) } });
  fireEvent.click(screen.getByRole('button', { name: 'Close pivot drawer' }));
  inspect();
  expect(screen.getByLabelText('Model repair draft')).toHaveValue(JSON.stringify(repaired));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save repaired model' })).not.toBeDisabled());
  __failPath('dashboards/execution.json');
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Save repaired model' }));
    await screen.findByText('Could not save repaired model. Your draft has been retained.');
    expect(tableExecutionStore.readView('execution', 'w').active).toBeUndefined();
    expect(screen.getByLabelText('Model repair draft')).toHaveValue(JSON.stringify(repaired));
  } finally { __reset(); }
  fireEvent.click(screen.getByRole('button', { name: 'Save repaired model' }));
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('180'));
  expect(JSON.parse(__read('dashboards/execution.json')!).tabs[0].cards[0].tableDefinition.analytical).toEqual(repaired);
  expect(tableExecutionStore.readView('execution', 'w').definition.analytical).toEqual(repaired);
});

it('report activation preserves hidden/order and a second header Hide keeps earlier hidden inputs private', async () => {
  vi.stubGlobal('Worker', Boundary);
  const table = { hidden: ['date'], columnOrder: ['revenue', 'region'] };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  fireEvent.click(await screen.findByRole('button',{name:'Pivot'}));fireEvent.click(await screen.findByRole('button', { name: 'Enable report model' }));
  await waitFor(() => expect(tableExecutionStore.readView('execution', 'w').definition.analytical).toBeDefined());
  await waitFor(() => expect(container.querySelectorAll('th[data-field]')[0]).toHaveAttribute('data-field', 'revenue'));
  fireEvent.contextMenu(container.querySelector('th[data-field="revenue"]')!);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
  await waitFor(() => expect(container.querySelector('th[data-field="revenue"]')).toBeNull());
  expect(container.querySelector('th[data-field="date"]')).toBeNull();
  expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].table?.hidden).toEqual(['date', 'revenue']);
});

it('a linked missing field remains repairable against current parent schema even with a stale ready result', async () => {
  vi.stubGlobal('Worker', Boundary);
  const analytical = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [], formulas: [{ id: 'twice', name: 'Twice', scope: 'source', expression: '', ast: { kind: 'binary', operator: '*', left: { kind: 'reference', target: 'field', id: 'revenue' }, right: { kind: 'literal', value: 2 } } }], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } };
  const root = { id: 'root', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 } };
  const child = { ...root, id: 'w', linkedSource: { kind: 'widget', sourceWidgetId: 'root' }, tableDefinition: { search: '', table: {}, analytical } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [root, child] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Child" refreshKey={0} />);
  await waitFor(() => expect(container.querySelector('tbody')?.textContent).toContain('180'));
  await act(async () => { tableExecutionStore.updateDefinition('execution', 'root', { table: { hidden: ['revenue'] }, search: '' }, { kind: 'none' }); await tableExecutionStore.settled('execution'); });
  await screen.findByText(/Missing linked source field/);
  inspect();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save repaired model' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save repaired model' }));
  expect(tableExecutionStore.readView('execution', 'w').error).toMatch(/Missing linked/);
  const repaired = { ...analytical, formulas: [] };
  fireEvent.change(screen.getByLabelText('Model repair draft'), { target: { value: JSON.stringify(repaired) } });
  fireEvent.click(screen.getByRole('button', { name: 'Save repaired model' }));
  await waitFor(() => expect(tableExecutionStore.readView('execution', 'w').status).toBe('ready'));
  await waitFor(() => expect(container.querySelector('th[data-field="twice"]')).toBeNull());
  expect(container.querySelector('th[data-field="revenue"]')).toBeNull();
});

it('inspection switches to newly retained malformed intent instead of offering an older draft over stale rows', async () => {
  vi.stubGlobal('Worker', Boundary);
  const root = { id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [root] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false }); tableExecutionStore.syncDashboard(dashboard);
  render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} />);
  inspect();
  const raw = { schemaVersion: 99, retained: 'new intent' };
  const changed = { ...dashboard, tabs: [{ ...dashboard.tabs[0], cards: [{ ...root, tableDefinition: { table: {}, search: '', analytical: raw } }] }] } as Dashboard;
  await act(async () => { useDashboardStore.setState({ dashboards: [changed] }); tableExecutionStore.syncDashboard(changed); await tableExecutionStore.settled('execution'); });
  await waitFor(() => expect(tableExecutionStore.readView('execution', 'w').status).toBe('blocked'));
  expect(JSON.parse((screen.getByLabelText('Model repair draft') as HTMLTextAreaElement).value)).toEqual(raw);
});

it('reactively toggles the actual dismiss checkbox twice and applies table dismissal without panel rerenders',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const user=(await import('@testing-library/user-event')).default.setup();
 const table={pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{revenue:'sum' as const}}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},table,layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const height=this.classList.contains('table-with-pivot')?700:this.classList.contains('pivot-footer-strip')?26:this.tagName==='THEAD'?32:this.tagName==='TR'?28:this.classList.contains('table-total-footer')?40:0;return {height,width:900,x:0,y:0,top:0,left:0,bottom:height,right:900,toJSON:()=>({})};});
 try {
  const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
  await screen.findByRole('button',{name:'Expand A'});await act(async()=>{await tableExecutionStore.settled('execution');});
  await user.click(screen.getByRole('button',{name:'Pivot'}));
  const checkbox=screen.getByRole('checkbox',{name:'Dismiss on table click'});expect(checkbox).toBeChecked();
  await user.click(checkbox);expect(checkbox).not.toBeChecked();
  await user.click(container.querySelector('tbody td:last-child')!);expect(screen.getByRole('button',{name:'Pivot'})).toHaveAttribute('aria-expanded','true');
  await user.click(checkbox);expect(checkbox).toBeChecked();
  await user.click(container.querySelector('tbody td:last-child')!);expect(screen.getByRole('button',{name:'Pivot'})).toHaveAttribute('aria-expanded','false');
 } finally {rect.mockRestore();}
});

it('keyboard Show formula transfers focus to visible Formulas and Escape returns to Arrange',async()=>{
 vi.stubGlobal('Worker',Boundary);const user=(await import('@testing-library/user-event')).default.setup();
 const analytical={schemaVersion:1 as const,params:{promotePage:true,filters:[]},enabled:true,categories:[],measures:[],formulas:[{id:'formula',name:'Keyboard formula',scope:'aggregate' as const,expression:'1',ast:{kind:'literal' as const,value:1}}],layout:{rows:[],columns:[], values: ['formula']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 inspect();const show=await screen.findByRole('button',{name:'Show formula Keyboard formula'});show.focus();await user.keyboard('{Enter}');
 expect(screen.getByRole('tab',{name:'Formulas'})).toHaveFocus();expect(document.activeElement?.closest('[hidden]')).toBeNull();
 expect(screen.getByLabelText('Formula name')).toHaveValue('Keyboard formula');await user.keyboard('{Escape}');
 expect(screen.getByRole('tab',{name:'Arrange'})).toHaveFocus();expect(screen.getByRole('tab',{name:'Arrange'})).toHaveAttribute('aria-selected','true');
 await act(async()=>{await tableExecutionStore.settled('execution');});
});

it('functional Arrange reorder and Pivot on toggle compose in the live renderer and persist source mode',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const {migratePivot}=await import('../../lib/tableModel/migration');
 const analytical=migratePivot({enabled:true,grouping:['region'],split:[],measures:[{id:'one',sourceFieldId:'revenue',aggregation:'sum'},{id:'two',sourceFieldId:'revenue',aggregation:'mean'}]});
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);tableExecutionStore.ensureTable('execution','w');await tableExecutionStore.settled('execution');
 render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0} state={{}} filterRow={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Pivot'}));
 await act(async()=>{await tableExecutionStore.settled('execution');});
 const {tableCommitCoordinators}=await import('../../stores/tableCommitCoordinator');const coordinator=tableCommitCoordinators.get('execution','w');
 await waitFor(()=>expect(coordinator.getSnapshot().canEnqueue).toBe(true));
 const edits=vi.spyOn(coordinator,'editModel');
 const later=screen.getByRole('button',{name:/revenue — Average/i});
 act(()=>{fireEvent.keyDown(later,{key:'ArrowUp',altKey:true});});
 expect(coordinator.getSnapshot().canEnqueue).toBe(true);
 expect(screen.getByRole('switch',{name:'Pivot on'})).toBeEnabled();
 fireEvent.click(screen.getByRole('switch',{name:'Pivot on'}));
 expect(edits).toHaveBeenCalledTimes(2);
 await waitFor(()=>expect((tableExecutionStore.readView('execution','w').definition.analytical as TableModelV1).enabled).toBe(false));
 const saved=tableExecutionStore.readView('execution','w').definition.analytical as TableModelV1;
 expect(saved.layout.values).toEqual(['two','one']);expect(saved.layout.rows).toEqual(analytical.layout.rows);
 await waitFor(()=>expect(screen.getByRole('switch',{name:'Pivot on'})).toBeEnabled());
 expect(screen.queryByRole('button',{name:/^Expand /})).toBeNull();expect(screen.queryByText('Grand total · Surviving groups')).toBeNull();
 const {__failPath,__reset}=await import('../../test/memfs');__failPath('dashboards/execution.json');
 try{fireEvent.click(screen.getByRole('switch',{name:'Pivot on'}));await screen.findByText('Could not save table; try again.');expect(tableExecutionStore.readView('execution','w').definition.analytical).toBe(saved);expect(screen.getByRole('switch',{name:'Pivot on'})).not.toBeChecked();}finally{__reset();}
 await act(async()=>{await tableExecutionStore.settled('execution');useDashboardStore.setState({viewer:true});});expect(screen.getByRole('switch',{name:'Pivot on'})).toBeDisabled();
});

it('Arrange footer explains a displayed missing aggregation only while Pivot is enabled',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const analytical:TableModelV1={schemaVersion: 1, params: { promotePage: true, filters: [] },enabled:true,categories:[{id:'regionCat',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[{id:'pending',sourceFieldId:'revenue'}],formulas:[],layout:{rows:['regionCat'],columns:[],values:['pending']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Pivot'}));
 const warning=await screen.findByText('1 data column needs an aggregation');
 expect(warning.closest('.pivot-drawer-foot')).not.toBeNull();
 expect(warning).toHaveClass('pivot-drawer-foot-warn');
 await waitFor(()=>expect(screen.getByRole('switch',{name:'Pivot on'})).toBeEnabled());
 fireEvent.click(screen.getByRole('switch',{name:'Pivot on'}));
 await waitFor(()=>expect((tableExecutionStore.readView('execution','w').definition.analytical as TableModelV1).enabled).toBe(false));
 expect(screen.queryByText('1 data column needs an aggregation')).not.toBeInTheDocument();
 expect((tableExecutionStore.readView('execution','w').definition.analytical as TableModelV1).measures).toEqual(analytical.measures);
 await act(async()=>{await tableExecutionStore.settled('execution');});
});
it('retains old singular Page raw intent in reachable Inspect repair without inserting memberKeys',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const raw={schemaVersion:1,enabled:true,params:{promotePage:true,filters:[]},categories:[{id:'scenarioCategory',name:'Scenario',sourceFieldId:'region',transform:'native'}],measures:[],formulas:[],layout:{rows:[],columns:[],values:[],page:{categoryId:'scenarioCategory',memberKey:pivotValueKey('A')}},checklists:[],resultFilters:[],subtotals:{grandTotal:false,groups:false}};
 const dashboard={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},layout:{x:0,y:0,w:1,h:1},tableDefinition:{table:{},search:'',analytical:raw}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);inspect();const draft=await screen.findByLabelText('Model repair draft');expect(JSON.parse((draft as HTMLTextAreaElement).value)).toEqual(raw);expect((draft as HTMLTextAreaElement).value).not.toContain('memberKeys');expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition?.analytical).toEqual(raw);await act(async()=>{await tableExecutionStore.settled('execution');});
});
it.each(['source','refresh','viewer','cancel'] as const)('Statement held preview is inert after %s changes and retains draft',async mode=>{
 const {fixture}=await import('../../lib/statementModel/compileFixtures');const {statement,source}=fixture();
 const {readLocalFile}=await import('../../lib/localFiles');const values=source.rows[0].values;
 vi.mocked(readLocalFile).mockResolvedValueOnce(new TextEncoder().encode(`${Object.keys(values).join(',')}\n${Object.values(values).join(',')}\n`));
 let held:ExecutionRequest|undefined,deliver:((request:ExecutionRequest)=>Promise<void>)|undefined;
 class HeldBoundary extends Boundary {postMessage(request:ExecutionRequest){if(request.kind==='previewDefinition'){held=request;deliver=this.handler;}else super.postMessage(request);}}
 vi.stubGlobal('Worker',HeldBoundary);
 const dashboard={id:'execution',name:'Statement',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical:statement},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 await act(async()=>{await tableExecutionStore.settled('execution');});
 act(()=>dispatchDrawer('execution','w',{kind:'select',section:'statement'}));
 fireEvent.change(screen.getByLabelText('Label revenue'),{target:{value:'Draft sales'}});
 fireEvent.click(screen.getByRole('button',{name:'Calculate preview'}));await waitFor(()=>expect(held).toBeDefined());
 if(mode==='source')act(()=>useDashboardStore.setState({dashboards:[{...dashboard,tabs:dashboard.tabs.map(t=>({...t,cards:t.cards.map(c=>({...c,params:{file:'retargeted.csv'}}))}))}]}));
 if(mode==='refresh')await act(async()=>{tableExecutionStore.refresh('execution','w');await tableExecutionStore.settled('execution');});
 if(mode==='viewer')act(()=>useDashboardStore.setState({viewer:true}));
 if(mode==='cancel')fireEvent.click(screen.getByRole('button',{name:'Cancel preview'}));
 await act(async()=>{await deliver!(held!);});
 expect(screen.queryByRole('region',{name:'Calculated Statement preview'})).toBeNull();
 expect(screen.getByRole('button',{name:'Apply Statement model'})).toBeDisabled();
 expect(screen.getByLabelText('Label revenue')).toHaveValue('Draft sales');
 expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition?.analytical).toEqual(statement);
});
it.each([{operation:'preview',linked:false},{operation:'members',linked:false},{operation:'preview',linked:true},{operation:'members',linked:true}])('Statement refuses new $operation after retarget before runtime synchronization (linked:$linked)',async({operation,linked})=>{
 const {fixture}=await import('../../lib/statementModel/compileFixtures');const {statement,source}=fixture();const {readLocalFile}=await import('../../lib/localFiles');const values=source.rows[0].values;
 vi.mocked(readLocalFile).mockResolvedValueOnce(new TextEncoder().encode(`${Object.keys(values).join(',')}\n${Object.values(values).join(',')}\n`));vi.stubGlobal('Worker',Boundary);
 const dashboard={id:'execution',name:'Statement',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},tableDefinition:{table:{},search:'',analytical:statement},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 if(linked){const child=dashboard.tabs[0].cards[0];dashboard.tabs[0].cards.unshift({...child,id:'parent',tableDefinition:{table:{},search:''}});child.linkedSource={kind:'widget',sourceWidgetId:'parent'};}
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);await act(async()=>{await tableExecutionStore.settled('execution');});
 act(()=>useDashboardStore.setState({dashboards:[{...dashboard,tabs:dashboard.tabs.map(t=>({...t,cards:t.cards.map(c=>c.id===(linked?'parent':'w')?{...c,params:{file:'retargeted.csv'}}:c)}))}]}));
 act(()=>dispatchDrawer('execution','w',{kind:'select',section:'statement'}));
 fireEvent.click(screen.getByRole('button',{name:operation==='preview'?'Calculate preview':'Load company members'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent(/source|synchron/i));
 expect(screen.queryByRole('region',{name:'Calculated Statement preview'})).toBeNull();expect(screen.queryByLabelText('ACME')).toBeNull();
});
// #17: an object category with no declared key and no scalar `value` is
// refused; the card names why, not only the generic incomplete notice.
it('an empty result names the refused object category instead of only "No rows." (#17)', async () => {
  vi.stubGlobal('Worker', Boundary);
  const { readLocalFile } = await import('../../lib/localFiles');
  vi.mocked(readLocalFile).mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify([{ name: { label: 'x' }, tvl: 1 }, { name: { label: 'y' }, tvl: 2 }])));
  const analytical: TableModelV1 = { schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [{ id: 'nameCategory', name: 'Name', sourceFieldId: 'name', transform: 'native' }], measures: [{ id: 'total', sourceFieldId: 'tvl', aggregation: 'sum' }], formulas: [], layout: { rows: ['nameCategory'], columns: [], values: ['total'] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.json' }, tableDefinition: { table: {}, search: '', analytical }, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  tableExecutionStore.syncDashboard(dashboard);
  render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.json" label="Data" refreshKey={0} state={{}} />);
  expect(await screen.findByText(/name holds objects and declares no display field/)).toBeInTheDocument();
});
// First-open path: a table with no report model opens on the chooser with
// empty Data Columns. Grouping a field saves no measure the user did not choose.
it('the first-open auto layout adds no measures the user did not choose', async () => {
  vi.stubGlobal('Worker', Boundary);
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} state={{}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pivot' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Pivot' }));
  const region = await waitFor(() => { const pill = container.querySelector('[data-list="available"] [aria-label="region"]') as HTMLElement | null; expect(pill).not.toBeNull(); return pill!; });
  fireEvent.click(region);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Row Groups' }));
  await waitFor(() => expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition?.analytical).toBeDefined());
  const measures = (useDashboardStore.getState().dashboards[0].tabs[0].cards[0].tableDefinition!.analytical as TableModelV1).measures;
  expect(measures).toEqual([]);
  await act(async () => { await tableExecutionStore.settled('execution'); });
});
it('a stored pivot opens with only its chosen aggregations in Data Columns', async () => {
  vi.stubGlobal('Worker', Boundary);
  const table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'mean' as const } } };
  const dashboard = { id: 'execution', name: 'Execution', tabs: [{ id: 't', name: 'T', cards: [{ id: 'w', widgetId: 'local_table', backendId: 'builtin', params: { file: 'data.csv' }, table, layout: { x: 0, y: 0, w: 1, h: 1 } }] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [dashboard], viewer: false });
  tableExecutionStore.syncDashboard(dashboard);
  const { container } = render(<LocalTableRenderer executionIdentity={{ dashboardId: 'execution', widgetId: 'w' }} file="data.csv" label="Data" refreshKey={0} state={table} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pivot' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Pivot' }));
  const values = await waitFor(() => { const list = container.querySelector('[data-list="values"]'); expect(list).toHaveTextContent('revenue'); return list!; });
  expect([...values.querySelectorAll('.pivot-pill-name')].map(pill => pill.textContent)).toEqual(['revenue — Average']);
  await act(async () => { await tableExecutionStore.settled('execution'); });
});

it('engine initialization failure shows a recoverable alert before any table publication',async()=>{
 let fail=true;
 class FailingBoundary extends Boundary {
  constructor(url:URL|string){super(url);if(fail){this.handler=async()=>{};queueMicrotask(()=>engine==='rust'?this.onmessage?.({data:{kind:'rustFailed',message:'Engine unavailable'}} as MessageEvent):this.onerror?.(new Event('error')));}}
 }
 vi.stubGlobal('Worker',FailingBoundary);
 const dashboard={id:'execution',name:'Failure',tabs:[{id:'t',name:'T',cards:[{id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},layout:{x:0,y:0,w:1,h:1}}]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[dashboard],viewer:false});tableExecutionStore.syncDashboard(dashboard);
 const {container}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 await screen.findByRole('alert');expect(tableExecutionStore.readView('execution','w').active).toBeUndefined();expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
 fail=false;await act(async()=>{tableExecutionStore.refresh('execution','w');await tableExecutionStore.settled('execution');});
 await screen.findByRole('checkbox',{name:'Select all rows'});expect(screen.queryByRole('alert')).toBeNull();expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
});

});
it('footer says the report model is off, not Pivot, while ordinary grouping is on',async()=>{
 vi.stubGlobal('Worker',Boundary);
 const card=(table?:object)=>({id:'w',widgetId:'local_table',backendId:'builtin',params:{file:'data.csv'},...(table?{table}:{}),layout:{x:0,y:0,w:1,h:1}});
 const grouped={id:'execution',name:'Execution',tabs:[{id:'t',name:'T',cards:[card({pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{revenue:'sum' as const}}})]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[grouped],viewer:false});tableExecutionStore.syncDashboard(grouped);
 const {container,unmount}=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 await waitFor(()=>expect(container.querySelector('.pivot-footer-summary')).toHaveTextContent('Report model off'));
 unmount();await act(async()=>{await tableExecutionStore.settled('execution');});
 const plain={...grouped,tabs:[{id:'t',name:'T',cards:[card()]}]} as Dashboard;
 useDashboardStore.setState({dashboards:[plain],viewer:false});tableExecutionStore.syncDashboard(plain);
 const second=render(<LocalTableRenderer executionIdentity={{dashboardId:'execution',widgetId:'w'}} file="data.csv" label="Data" refreshKey={0}/>);
 await waitFor(()=>expect(second.container.querySelector('.pivot-footer-summary')).toHaveTextContent('Pivot off'));
 await act(async()=>{await tableExecutionStore.settled('execution');});
});
