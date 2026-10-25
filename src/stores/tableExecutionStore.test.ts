// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { backendTableSource, createTableExecutionStore } from './tableExecutionStore';
import { useWidgetRegistryStore } from './widgetRegistryStore';
import { WORKER_MAX_CELLS } from '../lib/tableExecution/eligibility';
import { createTableProvider } from '../lib/tableExecution/rust/providerFactory';
import { providerHandler } from '../test/tableProviderBoundary';
import { input } from '../lib/tableExecution/fixtures';
import type { ExecutionRequest } from '../lib/tableExecution/types';
import type { DashboardCard, Dashboard } from '../lib/types';
describe.each(['typescript','rust'] as const)('%s provider', engine => {
 const createWorkerExecutor=(id:string,factory:()=>Worker)=>createTableProvider(id,engine,{workerFactory:factory});
 const createWorkerHandler=(send:Parameters<typeof providerHandler>[1])=>providerHandler(engine,send);
 beforeEach(()=>{vi.stubEnv('DEV',true);vi.stubEnv('VITE_TABLE_ENGINE',engine);});
 afterEach(()=>vi.unstubAllEnvs());
class WorkerBoundary {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  handler = createWorkerHandler(data => this.onmessage?.({ data } as MessageEvent));
  postMessage(data: ExecutionRequest) {
    void this.handler(data);
  }
  terminate() {
  }
}
const card = (id: string, source?: string): DashboardCard => ({ id, widgetId: 'local_table', backendId: 'builtin', params: { file: id }, layout: { x: 0, y: 0, w: 1, h: 1 }, ...(source ? { linkedSource: { kind: 'widget', sourceWidgetId: source } } : {}) });
const dashboard = (cards: DashboardCard[]) => ({ id: 'd', tabs: [{ id: 'tab', name: 'Tab', cards }] } as Dashboard);
function setup(cards: DashboardCard[]) {
  let acquisitions = 0;
  const registered = new Map<string, typeof input>();
  const store = createTableExecutionStore({ executor: id => {
      const e = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      const register = e.registerInput.bind(e);
      e.registerInput = async (data, rev, signal) => {
        registered.set(id, structuredClone(data));
        await register(data, rev, signal);
      };
      return e;
    }, source: () => ({ acquire: async () => {
        acquisitions++;
        return { kind: 'dataset', dataset: structuredClone(input) };
      } }) });
  store.syncDashboard(dashboard(cards));
  return { store, registered, acquisitions: () => acquisitions };
}
it('sourceRunsOnceForTwoChildren', async () => {
  const { store, acquisitions } = setup([card('root'), card('a', 'root'), card('b', 'root')]);
  store.ensureTable('d', 'a');
  store.ensureTable('d', 'b');
  await store.settled('d');
  expect(acquisitions()).toBe(1);
  expect(store.readView('d', 'a').status).toBe('ready');
  store.refresh('d', 'a');
  await store.settled('d');
  expect(acquisitions()).toBe(2);
});
it('threeStageCascadeUsesOnlyPresentedSubset', async () => {
  const { store, registered, acquisitions } = setup([card('root'), card('middle', 'root'), card('leaf', 'middle')]);
  store.updateDefinition('d', 'root', { table: { columnFilters: [{ id: 'region', value: 'A' }] }, search: '' }, { kind: 'none' });
  await store.settled('d');
  expect(registered.get('middle')!.rows.map(r => r.id)).toEqual(['r0', 'r1']);
  store.updateDefinition('d', 'middle', { table: { hidden: ['team'] }, search: '' }, { kind: 'explicit', ids: ['r1'] });
  await store.settled('d');
  expect(registered.get('leaf')!.rows.map(r => r.id)).toEqual(['r1']);
  expect(registered.get('leaf')!.rows[0].values).not.toHaveProperty('team');
  expect(acquisitions()).toBe(1);
  store.updateDefinition('d', 'root', { table: {}, search: '' }, { kind: 'explicit', ids: ['r2'] });
  await store.settled('d');
  expect(registered.get('middle')!.rows.map(r => r.id)).toEqual(['r2']);
  expect(store.readView('d', 'leaf').status).toBe('empty');
  expect(acquisitions()).toBe(1);
});
it('missingFieldBlocksDescendants', async () => {
  const child = card('child', 'root');
  child.table = { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' } } };
  const { store } = setup([card('root'), child, card('leaf', 'child')]);
  store.ensureTable('d', 'leaf');
  await store.settled('d');
  const completed = store.readView('d', 'child');
  store.updateDefinition('d', 'root', { table: { hidden: ['region'] }, search: '' }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('blocked');
  expect(store.readView('d', 'child').error).toContain('region');
  expect(store.readView('d', 'leaf').status).toBe('blocked');
  expect(store.readView('d', 'child').active).toEqual(completed.active);
  expect(store.readView('d', 'child').ready).toBe(completed.ready);
  expect(store.readView('d', 'child').stale).toBe(true);
  expect(store.readView('d', 'child').definition.table).toEqual(child.table);
});
it('emptySubsetPublishesSuccessfully', async () => {
  const { store } = setup([card('root'), card('child', 'root')]);
  store.updateDefinition('d', 'root', { table: {}, search: 'no match' }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('empty');
});
it('deletedSourceRetainsDependentSettings', async () => {
  const child = card('child', 'root');
  child.table = { sorting: [{ id: 'revenue', desc: true }] };
  const { store } = setup([card('root'), child]);
  store.ensureTable('d', 'child');
  await store.settled('d');
  store.syncDashboard(dashboard([child]));
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('unavailable');
  expect(store.readView('d', 'child').definition.table).toEqual(child.table);
});
it('invalid persisted graph never starts workers', () => {
  let starts = 0;
  const store = createTableExecutionStore({ executor: () => {
      starts++;
      throw Error();
    }, source: () => undefined });
  store.syncDashboard(dashboard([card('a', 'b'), card('b', 'a')]));
  store.ensureTable('d', 'a');
  expect(starts).toBe(0);
  expect(store.readView('d', 'a').error).toContain('cycle');
});
it('sourceChangesDuringTransferNeverMixInputs', async () => {
  let release!: () => void, firstBatch!: () => void;
  const arrived = new Promise<void>(resolve => firstBatch = resolve);
  let pause = true;
  const registered: string[][] = [];
  const store = createTableExecutionStore({ executor: id => {
      const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      if (id === 'root') {
        const presented = executor.presented.bind(executor);
        executor.presented = async function* (rev, signal) {
          for await (const batch of presented(rev, signal)) {
            yield batch;
            if (pause) {
              pause = false;
              firstBatch();
              await new Promise<void>(resolve => release = resolve);
            }
          }
        };
      }
      if (id === 'child') {
        const register = executor.registerInput.bind(executor);
        executor.registerInput = async (data, rev, signal) => {
          registered.push(data.rows.map(r => r.id));
          await register(data, rev, signal);
        };
      }
      return executor;
    }, source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: { ...input, rows: [...input.rows, ...Array.from({ length: 600 }, (_, i) => ({ id: `extra${i}`, values: { revenue: i, region: 'B', team: 'extra', date: '2026-01-01' } }))] } }) }) });
  store.syncDashboard(dashboard([card('root'), card('child', 'root')]));
  store.ensureTable('d', 'child');
  await arrived;
  expect(store.readView('d', 'child').active).toBeUndefined();
  expect(registered).toEqual([]);
  store.updateDefinition('d', 'root', { table: {}, search: '' }, { kind: 'explicit', ids: ['r2'] });
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  await store.settled('d');
  expect(registered).toEqual([['r2']]);
  expect(store.readView('d', 'child').status).toBe('ready');
});
it('modelOnlyEditReusesLinkedInputWithoutAnotherTransfer', async () => {
  let transfers = 0;
  const store = createTableExecutionStore({ executor: id => {
      const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      const presented = executor.presented.bind(executor);
      executor.presented = (rev, signal) => {
        transfers++;
        return presented(rev, signal);
      };
      return executor;
    }, source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }) });
  store.syncDashboard(dashboard([card('root'), card('child', 'root')]));
  store.ensureTable('d', 'child');
  await store.settled('d');
  store.updateDefinition('d', 'child', { table: {}, search: 'A' }, { kind: 'none' });
  await store.settled('d');
  expect(transfers).toBe(1);
});
it('propagates inherited sample metadata diagnostics and lineage through three workers', async () => {
  const sampled = { ...input, completeness: { kind: 'sample' as const, warnings: ['sample'], acquiredRowCount: 3, totalRowCount: 300 }, provenance: { sourceWidgetId: 'root', sample: 'example', receipt: { fiscal: 'FY' }, metadata: { fiscalBasis: 'company' } }, diagnostics: [{ code: 'SAMPLE', message: 'sample warning', severity: 'warning' as const }] };
  const received = new Map<string, typeof input>();
  const store = createTableExecutionStore({ executor: id => {
      const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      const register = executor.registerInput.bind(executor);
      executor.registerInput = async (data, rev, signal) => {
        received.set(id, data);
        await register(data, rev, signal);
      };
      return executor;
    }, source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: sampled }) }) });
  store.syncDashboard(dashboard([card('root'), card('child', 'root'), card('leaf', 'child')]));
  store.ensureTable('d', 'leaf');
  await store.settled('d');
  const leaf = received.get('leaf')!;
  expect(leaf.completeness).toEqual(sampled.completeness);
  expect(leaf.provenance.receipt).toEqual({ fiscal: 'FY' });
  expect(leaf.provenance.metadata).toEqual({ fiscalBasis: 'company' });
  expect(leaf.provenance.lineage?.map(item => item.widgetId)).toEqual(['root', 'child']);
  expect(store.readView('d', 'leaf').ready?.diagnostics).toContainEqual(sampled.diagnostics[0]);
});
it('runtime missing snapshot identity is stable for React subscription', () => {
  const { store } = setup([]);
  expect(store.readView('d', 'missing')).toBe(store.readView('d', 'missing'));
});
it('new missing binding blocks a linked model even when its input is cached', async () => {
  const { store } = setup([card('root'), card('child', 'root')]);
  store.ensureTable('d', 'child');
  await store.settled('d');
  store.updateDefinition('d', 'child', { search: '', table: { pivot: { enabled: true, grouping: ['absent'], split: [], aggregationFns: {} } } }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('blocked');
  expect(store.readView('d', 'child').error).toContain('absent');
});
it('rejects a newly persisted cycle without recursive invalidation', async () => {
  const root = card('root'), child = card('child', 'root');
  const { store } = setup([root, child]);
  store.ensureTable('d', 'child');
  await store.settled('d');
  expect(() => store.syncDashboard(dashboard([{ ...root, linkedSource: { kind: 'widget', sourceWidgetId: 'child' } }, child]))).not.toThrow();
  expect(store.readView('d', 'root').status).toBe('blocked');
});
it('linked chart follows source status and revision without a calculation worker', async () => {
  let workers = 0;
  const chart = { ...card('chart', 'root'), widgetId: 'linked_chart', linkedChart: { type: 'line' as const, measures: ['revenue'], display: 'grouped' as const } };
  const store = createTableExecutionStore({ executor: id => {
      workers++;
      return createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
    }, source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }) });
  store.syncDashboard(dashboard([card('root'), chart]));
  store.ensureTable('d', 'chart');
  await store.settled('d');
  expect(workers).toBe(1);
  expect(store.readExecutor('d', 'chart')).toBeUndefined();
  expect(store.readView('d', 'chart').active).toEqual(store.readView('d', 'root').active);
});

it('linked split pivot sorts its generated measure column in the output namespace', async () => {
  const child = card('child', 'root');
  child.table = { pivot: { enabled: true, grouping: ['team'], split: ['region'], aggregationFns: { revenue: 'sum' } }, hidden: ['date'] };
  const { store } = setup([card('root'), child]);
  store.ensureTable('d', 'child');
  await store.settled('d');
  const generated = store.readView('d', 'child').ready!.columns.find(column => column.sourceFieldId === 'revenue')!.id;
  expect(generated).not.toBe('revenue');

  store.updateDefinition('d', 'child', { search: '', table: { ...child.table, sorting: [{ id: generated, desc: true }] } }, { kind: 'none' });
  await store.settled('d');

  expect(store.readView('d', 'child').status).toBe('ready');
  expect(store.readView('d', 'child').ready!.inspection.definition.table.sorting).toEqual([{ id: generated, desc: true }]);
  const rows = await store.readExecutor('d', 'child')!.rows(store.readView('d', 'child').active!, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
  expect(rows.rows.map(row => row.values[generated])).toEqual([20, 10, undefined]);
});

it('native file root schema removal blocks missing bindings and descendants with last success', async () => {
  let text = 'revenue,region\n10,A\n20,B';
  const store = createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker),
    source: () => ({ acquire: async () => ({ kind: 'file', name: 'source.csv', bytes: new TextEncoder().encode(text) }) }),
  });
  const root = card('root');
  root.table = { columnFilters: [{ id: 'region', value: 'A' }], sorting: [{ id: 'region', desc: true }] };
  store.syncDashboard(dashboard([root, card('child', 'root')]));
  store.ensureTable('d', 'child');
  await store.settled('d');
  const previous = store.readView('d', 'root').active;

  text = 'revenue\n10\n20';
  store.refresh('d', 'root');
  await store.settled('d');

  expect(store.readView('d', 'root').status).toBe('blocked');
  expect(store.readView('d', 'root').error).toContain('region');
  expect(store.readView('d', 'root').active).toEqual(previous);
  expect(store.readView('d', 'root').stale).toBe(true);
  expect(store.readView('d', 'child').status).toBe('blocked');
});

// User ruling 2026-10-15: a local statement table is relabelled at its source, from the card's chosen
// backend; a linked table fed by it reads the same labels. Unset, it stays as reported with the note.
it('relabels a local statement source from its year ends, and a linked child reads the same labels', async () => {
  const { STATEMENT_CSV, STATEMENT_YEAR_ENDS, STATEMENT_LABELS } = await import('../test/fixtures/statementRows');
  const asked: string[][] = [];
  const build = (withYearEnds: boolean) => createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker),
    source: () => ({ acquire: async () => ({ kind: 'file', name: 's.csv', bytes: new TextEncoder().encode(STATEMENT_CSV),
      ...(withYearEnds ? { yearEnds: async (symbols: string[]) => { asked.push(symbols); return STATEMENT_YEAR_ENDS; } } : {}) }) }),
  });
  const labels = async (store: ReturnType<typeof build>, id: string) => {
    const view = store.readView('d', id);
    const block = await store.readExecutor('d', id)!.rows(view.active!, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
    return block.rows.map(r => [r.values.fiscal_period, r.values.fiscal_year]);
  };
  const store = build(true);
  store.syncDashboard(dashboard([card('root'), card('child', 'root')]));
  store.ensureTable('d', 'child');
  await store.settled('d');
  expect(asked).toEqual([['WMT', 'JPM']]);
  expect(await labels(store, 'root')).toEqual(STATEMENT_LABELS);
  expect(await labels(store, 'child')).toEqual(STATEMENT_LABELS);
  expect(store.readView('d', 'root').ready?.diagnostics.some(d => d.code === 'FISCAL_AS_REPORTED')).toBe(false);
  const unset = build(false);
  unset.syncDashboard(dashboard([card('root')]));
  unset.ensureTable('d', 'root');
  await unset.settled('d');
  expect((await labels(unset, 'root')).map(([p]) => p)).toEqual(['Q2', 'FY', 'Q2']);
  expect(unset.readView('d', 'root').ready?.diagnostics.some(d => d.code === 'FISCAL_AS_REPORTED')).toBe(true);
});

it('local edits reuse one pending native acquisition and activate only the newest model', async () => {
  let resolve!: (value: { kind: 'file'; name: string; bytes: Uint8Array }) => void;
  let acquisitions = 0;
  const store = createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker),
    source: () => ({ acquire: () => { acquisitions++; return new Promise(done => resolve = done); } }),
  });
  store.syncDashboard(dashboard([card('root'), card('child', 'root')]));
  store.ensureTable('d', 'root');
  store.updateDefinition('d', 'root', { search: 'A', table: {} }, { kind: 'allMatching', excludedIds: [] });
  expect(acquisitions).toBe(1);

  resolve({ kind: 'file', name: 'source.csv', bytes: new TextEncoder().encode('revenue,region\n10,A\n20,B') });
  await store.settled('d');

  expect(acquisitions).toBe(1);
  expect(store.readView('d', 'root').ready!.inspection.definition.search).toBe('A');
  expect(store.readView('d', 'root').ready!.topLevelCount).toBe(1);
  expect(store.readView('d', 'root').selection).toEqual({ kind: 'allMatching', excludedIds: [] });
  expect(store.readView('d', 'child').ready!.topLevelCount).toBe(1);
});

it('retains generated member sort through filtered absence empty first load and restoration', async () => {
  const generated = '["string","A"]\x1frevenue';
  const child = card('child', 'root');
  child.table = { hidden: ['date'], sorting: [{ id: generated, desc: true }], pivot: { enabled: true, grouping: ['team'], split: ['region'], aggregationFns: { revenue: 'sum' } } };
  const { store } = setup([card('root'), child]);
  store.updateDefinition('d', 'root', { table: {}, search: 'no match' }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('empty');
  expect(store.readView('d', 'child').ready!.columns.some(column => column.id === generated)).toBe(false);

  store.updateDefinition('d', 'root', { table: {}, search: 'B' }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('ready');
  expect(store.readView('d', 'child').ready!.columns.some(column => column.id === generated)).toBe(false);

  store.updateDefinition('d', 'root', { table: {}, search: 'A' }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('ready');
  expect(store.readView('d', 'child').ready!.columns.some(column => column.id === generated)).toBe(true);
  expect(store.readView('d', 'child').definition.table.sorting).toEqual([{ id: generated, desc: true }]);
});

it('explicit refresh cancels the old acquisition while later model edits reuse its replacement', async () => {
  const requests: { signal: AbortSignal; resolve: (value: { kind: 'file'; name: string; bytes: Uint8Array }) => void }[] = [];
  const imports: string[] = [];
  const store = createTableExecutionStore({
    executor: id => {
      const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      const importFile = executor.importFile.bind(executor);
      executor.importFile = async (name, bytes, revision, signal, yearEnds) => { imports.push(new TextDecoder().decode(bytes)); return importFile(name, bytes, revision, signal, yearEnds); };
      return executor;
    },
    source: () => ({ acquire: signal => new Promise(resolve => requests.push({ signal, resolve })) }),
  });
  store.syncDashboard(dashboard([card('root')]));
  store.ensureTable('d', 'root');
  store.updateDefinition('d', 'root', { table: {}, search: 'A' }, { kind: 'none' });
  store.refresh('d', 'root');
  store.updateDefinition('d', 'root', { table: {}, search: 'B' }, { kind: 'none' });
  expect(requests).toHaveLength(2);
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(false);

  requests[0].resolve({ kind: 'file', name: 'source.csv', bytes: new TextEncoder().encode('revenue,region\n999,A') });
  requests[1].resolve({ kind: 'file', name: 'source.csv', bytes: new TextEncoder().encode('revenue,region\n20,B') });
  await store.settled('d');

  expect(imports).toEqual(['revenue,region\n20,B']);
  expect(store.readView('d', 'root').status).toBe('ready');
  expect(store.readView('d', 'root').ready!.inspection.definition.search).toBe('B');
  const view = store.readView('d', 'root');
  const rows = await store.readExecutor('d', 'root')!.rows(view.active!, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
  expect(rows.rows.map(row => row.values.revenue)).toEqual([20]);
});

it('deleting a source aborts pending acquisition immediately and ignores late native bytes', async () => {
  let resolve!: (value: { kind: 'file'; name: string; bytes: Uint8Array }) => void;
  let acquisitionSignal!: AbortSignal;
  let imports = 0;
  const store = createTableExecutionStore({
    executor: id => {
      const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      const importFile = executor.importFile.bind(executor);
      executor.importFile = async (...args) => { imports++; return importFile(...args); };
      return executor;
    },
    source: () => ({ acquire: signal => { acquisitionSignal = signal; return new Promise(done => resolve = done); } }),
  });
  store.syncDashboard(dashboard([card('root')]));
  store.ensureTable('d', 'root');
  store.syncDashboard(dashboard([]));
  await store.settled('d');
  expect(acquisitionSignal.aborted).toBe(true);

  resolve({ kind: 'file', name: 'source.csv', bytes: new TextEncoder().encode('revenue\n999') });
  await Promise.resolve();
  await Promise.resolve();
  expect(imports).toBe(0);
  expect(store.readView('d', 'root').status).toBe('unavailable');
});

it('registered roots block missing grouping or sorting on refresh instead of failing or dropping bindings', async () => {
  for (const table of [{ sorting: [{ id: 'region', desc: true }] }, { pivot: { enabled: true, grouping: ['region'], split: [], aggregationFns: { revenue: 'sum' as const } } }]) {
    let dataset = input;
    const store = createTableExecutionStore({
      executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker),
      source: () => ({ acquire: async () => ({ kind: 'dataset', dataset }) }),
    });
    const root = { ...card('root'), table };
    store.syncDashboard(dashboard([root, card('child', 'root')]));
    store.ensureTable('d', 'child');
    await store.settled('d');
    const previous = store.readView('d', 'root').active;

    dataset = { ...input, columns: input.columns.filter(column => column.id !== 'region') };
    store.refresh('d', 'root');
    await store.settled('d');

    expect(store.readView('d', 'root').status).toBe('blocked');
    expect(store.readView('d', 'root').active).toEqual(previous);
    expect(store.readView('d', 'root').stale).toBe(true);
    expect(store.readView('d', 'root').error).toContain('region');
    expect(store.readView('d', 'child').status).toBe('blocked');
  }
});

it('pending registered input uses the newest explicit selection in its descendant', async () => {
  let resolve!: (value: { kind: 'dataset'; dataset: typeof input }) => void;
  let acquisitions = 0;
  const store = createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker),
    source: () => ({ acquire: () => { acquisitions++; return new Promise(done => resolve = done); } }),
  });
  store.syncDashboard(dashboard([card('root'), card('child', 'root')]));
  store.ensureTable('d', 'child');
  store.updateDefinition('d', 'root', { table: {}, search: 'A' }, { kind: 'explicit', ids: ['r0'] });
  store.updateDefinition('d', 'root', { table: {}, search: 'B' }, { kind: 'explicit', ids: ['r2'] });
  resolve({ kind: 'dataset', dataset: input });
  await store.settled('d');

  expect(acquisitions).toBe(1);
  const rows = await store.readExecutor('d', 'child')!.rows(store.readView('d', 'child').active!, { groupPath: [], offset: 0, limit: 10 }, new AbortController().signal);
  expect(rows.rows.map(row => row.id)).toEqual(['r2']);
  expect(rows.rows.map(row => row.values.revenue)).toEqual([90]);
});

it('durable toolkit patches preserve ephemeral model and symbolic selection without a duplicate execution', async () => {
  const root = card('root'); const { store } = setup([root]);
  const selection = { kind: 'allMatching' as const, excludedIds: ['r1'] };
  store.updateDefinition('d', 'root', { table: {}, search: 'A' }, selection);
  await store.settled('d');
  const table = { sorting: [{ id: 'revenue', desc: true }], columnFilters: [{ id: 'revenue', value: { min: 5 } }] };
  store.updateDefinition('d', 'root', { table, search: 'A' }, selection);
  await store.settled('d');
  const active = store.readView('d', 'root').active;
  store.syncDashboard(dashboard([{ ...root, table }]));
  await store.settled('d');
  expect(store.readView('d', 'root').definition).toEqual({ table, search: 'A' });
  expect(store.readView('d', 'root').selection).toEqual(selection);
  expect(store.readView('d', 'root').active).toEqual(active);
  // Persisted edits arriving from import/reopen stay authoritative.
  const imported = { ...root, table, tableDefinition: { table, search: 'B' }, tableSelection: { kind: 'explicit' as const, ids: ['r2'] } };
  store.syncDashboard(dashboard([imported])); await store.settled('d');
  expect(store.readView('d', 'root').definition.search).toBe('B');
  expect(store.readView('d', 'root').selection).toEqual(imported.tableSelection);
  expect(store.readView('d', 'root').active).not.toEqual(active);
  const importedRevision = store.readView('d', 'root').active;
  store.syncDashboard(dashboard([{ ...imported, table: { columnFilters: table.columnFilters, sorting: table.sorting } }]));
  await store.settled('d');
  expect(store.readView('d', 'root').active).toEqual(importedRevision);
});

it('unchanged runtime definition updates reuse the current revision', async () => {
  const { store, acquisitions } = setup([card('root')]);
  store.updateDefinition('d', 'root', { table: {}, search: '' }, { kind: 'none' });
  await store.settled('d');
  const active = store.readView('d', 'root').active;
  store.updateDefinition('d', 'root', { search: '', table: {} }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'root').active).toEqual(active);
  expect(acquisitions()).toBe(1);
});

it('legacy transposed source allocates no worker and dependents wait for supported Table restoration', async () => {
  const root = { ...card('root'), view: 'transposed' as const };
  const child = card('child', 'root');
  const { store, acquisitions } = setup([root, child]);
  const release = store.acquireDashboard(dashboard([root, child]));
  await store.settled('d');
  expect(acquisitions()).toBe(0);
  expect(store.readExecutor('d', 'root')).toBeUndefined();
  expect(store.readExecutor('d', 'child')).toBeUndefined();
  expect(store.readView('d', 'child').status).toBe('unavailable');
  store.syncDashboard(dashboard([{ ...root, view: 'table' }, child]));
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('ready');
  expect(acquisitions()).toBe(1);
  const active = store.readView('d', 'child').active;
  store.syncDashboard(dashboard([root, child])); await store.settled('d');
  expect(store.readExecutor('d', 'root')).toBeUndefined();
  expect(store.readView('d', 'child')).toMatchObject({ status: 'unavailable', active, stale: true });
  expect(store.readView('d', 'child').definition).toEqual({ search: '', table: {} });
  store.syncDashboard(dashboard([{ ...root, view: 'table' }, child])); await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('ready');
  expect(acquisitions()).toBe(2);
  release();
});

it('reconciliation is durable before activation, does not loop, and refresh fences old callbacks', async () => {
  let release!: () => void, calls = 0, applied = 0;
  const root = { ...card('root'), tableSelection: { kind: 'explicit' as const, ids: ['vanished'] } };
  const store = createTableExecutionStore({ executor: id => {
    const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
    const apply = executor.applyModel.bind(executor);
    executor.applyModel = (...args) => { applied++; return apply(...args); }; return executor;
  }, source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }),
  reconcileSelection: async (_d, _id, _definition, _selection, guard) => {
    calls++; await new Promise<void>(resolve => { release = resolve; });
    if (!guard.isCurrent()) return false;
    guard.beforePublish(); return true;
  } });
  store.syncDashboard(dashboard([root])); store.ensureTable('d', 'root');
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  expect(store.readView('d', 'root').active).toBeUndefined();
  const oldRelease = release; release = undefined as never;
  store.refresh('d', 'root'); oldRelease();
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  release(); await store.settled('d');
  expect(store.readView('d', 'root').selection).toEqual({ kind: 'none' });
  expect(store.readView('d', 'root').status).toBe('ready');
  expect(calls).toBe(2); expect(applied).toBe(2);
  store.disposeDashboard('d');
});
it('linked selections hidden upstream survive refresh and reopening without reverting to all rows', async () => {
  const root = { ...card('root'), tableDefinition: { table: {}, search: 'B' } };
  const child = { ...card('child', 'root'), tableSelection: { kind: 'explicit' as const, ids: ['r0'] } };
  const { store } = setup([root, child, card('leaf', 'child')]);
  store.ensureTable('d', 'leaf'); await store.settled('d');
  expect(store.readView('d', 'child').selection).toEqual(child.tableSelection);
  expect(store.readView('d', 'leaf').status).toBe('empty');
  store.refresh('d', 'root'); await store.settled('d');
  expect(store.readView('d', 'child').selection).toEqual(child.tableSelection);
  expect(store.readView('d', 'leaf').status).toBe('empty');
  store.updateDefinition('d', 'root', { table: {}, search: '' }, { kind: 'none' }); await store.settled('d');
  expect(store.readView('d', 'leaf').ready?.topLevelCount).toBe(1);
  store.disposeDashboard('d');
});
it('deleting a node fences delayed reconciliation and failed saves do not activate a new output', async () => {
  let release!: () => void;
  const root = { ...card('root'), tableSelection: { kind: 'explicit' as const, ids: ['vanished'] } };
  const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }),
    reconcileSelection: async (_d, _id, _definition, _selection, guard) => {
      await new Promise<void>(resolve => { release = resolve; });
      expect(guard.isCurrent()).toBe(false); return false;
    } });
  store.syncDashboard(dashboard([root])); store.ensureTable('d', 'root');
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  store.syncDashboard(dashboard([])); release(); await store.settled('d');
  expect(store.readView('d', 'root').status).toBe('unavailable');
  const failed = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }), reconcileSelection: async () => { throw new Error('Save failed'); } });
  failed.syncDashboard(dashboard([root])); failed.ensureTable('d', 'root'); await failed.settled('d');
  expect(failed.readView('d', 'root')).toMatchObject({ status: 'failed', selection: root.tableSelection, error: 'Save failed' });
  expect(failed.readView('d', 'root').active).toBeUndefined();
  failed.disposeDashboard('d'); store.disposeDashboard('d');
});
it('linked hidden groups survive split addition and replacement, refresh, and reopen without fallback', async () => {
  const { calculateView } = await import('../lib/tableExecution/engine');
  const grouped = { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [] as string[] } } };
  const groupA = calculateView(input, grouped, { kind: 'none' }).groups[0].id;
  const selection = { kind: 'explicit' as const, ids: [groupA] };
  const root = card('root'), child = { ...card('child', 'root'), tableDefinition: grouped, tableSelection: selection }, leaf = card('leaf', 'child');
  const { store, acquisitions } = setup([root, child, leaf]);
  store.ensureTable('d', 'leaf'); await store.settled('d');
  store.updateDefinition('d', 'root', { table: {}, search: 'B' }, { kind: 'none' }); await store.settled('d');
  for (const split of [['team'], ['date']]) {
    store.updateDefinition('d', 'child', { ...grouped, table: { pivot: { ...grouped.table.pivot, split } } }, selection);
    await store.settled('d');
    expect(store.readView('d', 'child').selection).toEqual(selection);
    expect(store.readView('d', 'child').ready?.diagnostics.some(d => d.code === 'SELECTION_RECONCILED')).toBe(false);
    expect(store.readView('d', 'leaf').status).toBe('empty');
  }
  expect(acquisitions()).toBe(1);
  store.refresh('d', 'root'); await store.settled('d');
  expect(store.readView('d', 'child').selection).toEqual(selection);
  expect(store.readView('d', 'leaf').status).toBe('empty');
  const savedDefinition = store.readView('d', 'child').definition;
  store.disposeDashboard('d');
  const reopened = setup([{ ...root, tableDefinition: { table: {}, search: 'B' } }, { ...child, tableDefinition: savedDefinition }, leaf]).store;
  reopened.ensureTable('d', 'leaf'); await reopened.settled('d');
  expect(reopened.readView('d', 'child').selection).toEqual(selection);
  expect(reopened.readView('d', 'leaf').status).toBe('empty');
  reopened.updateDefinition('d', 'root', { table: {}, search: '' }, { kind: 'none' }); await reopened.settled('d');
  expect(reopened.readView('d', 'leaf').ready?.topLevelCount).toBe(1);
  reopened.disposeDashboard('d');
});
it('linked pivot off reconciles a proven local group namespace after worker input replacement', async () => {
  const { calculateView } = await import('../lib/tableExecution/engine');
  const grouped = { search: '', table: { pivot: { enabled: true, grouping: ['region'], split: [] } } };
  const selection = { kind: 'explicit' as const, ids: [calculateView(input, grouped, { kind: 'none' }).groups[0].id] };
  const { store } = setup([card('root'), { ...card('child', 'root'), tableDefinition: grouped, tableSelection: selection }]);
  store.ensureTable('d', 'child'); await store.settled('d');
  store.updateDefinition('d', 'root', { table: {}, search: 'B' }, { kind: 'none' }); await store.settled('d');
  store.updateDefinition('d', 'child', { table: {}, search: '' }, selection); await store.settled('d');
  expect(store.readView('d', 'child').selection).toEqual({ kind: 'none' });
  expect(store.readView('d', 'child').ready?.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTION_RECONCILED' }));
  store.disposeDashboard('d');
});

it('root identity witnesses reconcile true deletion through an ordinary chain but preserve upstream hidden identities', async () => {
  let data = structuredClone(input), acquisitions = 0;
  const saved: unknown[] = [];
  const store = createTableExecutionStore({
    executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker),
    source: () => ({ acquire: async () => { acquisitions++; return { kind: 'dataset', dataset: data }; } }),
    reconcileSelection: async (_d, _id, _definition, selection, guard) => { saved.push(selection); guard.beforePublish(); return true; },
  });
  const root = card('root'), middle = card('middle', 'root'), leaf = card('leaf', 'middle');
  root.tableDefinition = { table: {}, search: 'B' };
  middle.tableSelection = { kind: 'explicit', ids: ['r2'] };
  leaf.tableSelection = { kind: 'explicit', ids: ['r0'] };
  store.syncDashboard(dashboard([root, middle, leaf])); store.ensureTable('d', 'leaf'); await store.settled('d');
  const batches = [];
  for await (const batch of store.readExecutor('d', 'leaf')!.presented(store.readView('d', 'leaf').active!, new AbortController().signal)) batches.push(...batch.rows);
  expect(batches).toEqual([]);
  expect(store.readView('d', 'leaf').selection).toEqual({ kind: 'explicit', ids: ['r0'] });
  data = { ...data, rows: data.rows.slice(1) };
  store.refresh('d', 'leaf'); await store.settled('d');
  expect(store.readView('d', 'leaf').selection).toEqual({ kind: 'none' });
  expect(store.readView('d', 'leaf').status).toBe('ready');
  expect(store.readView('d', 'leaf').ready?.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTION_RECONCILED' }));
  expect(saved).toEqual([{ kind: 'none' }]);
  expect(acquisitions).toBe(2);
  store.disposeDashboard('d');
});

it('direct category and date bucket selections reconcile root deletion through ordinary ancestors', async () => {
  const category = '["group","[[\\"region\\",\\"native\\"]]","[\\"string\\",\\"A\\"]"]';
  const date = '["group","[[\\"date\\",\\"year\\"]]","[\\"string\\",\\"2026\\"]"]';
  for (const [field, id, buckets] of [['region', category, undefined], ['date', date, { date: 'year' as const }]] as const) {
    let data = structuredClone(input);
    const store = createTableExecutionStore({ executor: widget => createWorkerExecutor(widget, () => new WorkerBoundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
    const root = { ...card('root'), tableDefinition: { table: {}, search: 'no match' } };
    const child = { ...card('child', 'middle'), tableDefinition: { table: { pivot: { enabled: true, grouping: [field], split: [], buckets } }, search: '' }, tableSelection: { kind: 'explicit' as const, ids: [id] } };
    store.syncDashboard(dashboard([root, card('middle', 'root'), child])); store.ensureTable('d', 'child'); await store.settled('d');
    expect(store.readView('d', 'child').selection).toEqual(child.tableSelection);
    data = { ...data, rows: field === 'region' ? data.rows.slice(2) : [] };
    store.refresh('d', 'child'); await store.settled('d');
    expect(store.readView('d', 'child').selection).toEqual({ kind: 'none' });
    expect(store.readView('d', 'child').ready?.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTION_RECONCILED' }));
    store.disposeDashboard('d');
  }
});

it('aggregate ancestry leaves hidden linked identity deletion unknown after refresh', async () => {
  const selected = '["group","[[\\"region\\",\\"native\\"]]","[\\"string\\",\\"A\\"]"]';
  let data = structuredClone(input);
  const store = createTableExecutionStore({ executor: widget => createWorkerExecutor(widget, () => new WorkerBoundary() as unknown as Worker), source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: data }) }) });
  const root = { ...card('root'), tableDefinition: { table: { pivot: { enabled: true, grouping: ['region'], split: [] } }, search: 'B' } };
  const leaf = { ...card('leaf', 'middle'), tableSelection: { kind: 'explicit' as const, ids: [selected] } };
  store.syncDashboard(dashboard([root, card('middle', 'root'), leaf])); store.ensureTable('d', 'leaf'); await store.settled('d');
  data = { ...data, rows: data.rows.slice(2) };
  store.refresh('d', 'leaf'); await store.settled('d');
  expect(store.readView('d', 'leaf').selection).toEqual(leaf.tableSelection);
  expect(store.readView('d', 'leaf').ready?.diagnostics.some(d => d.code === 'SELECTION_RECONCILED')).toBe(false);
  store.disposeDashboard('d');
});

it('an old identity witness cannot commit after an ancestor edit supersedes its path', async () => {
  let release!: () => void, hold = true;
  let saved = 0, acquisitions = 0;
  const store = createTableExecutionStore({
    executor: id => {
      const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      const witness = executor.identityWitness.bind(executor);
      executor.identityWitness = async (...args) => {
        const result = await witness(...args);
        if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve; }); }
        return result;
      };
      return executor;
    },
    source: () => ({ acquire: async () => { acquisitions++; return { kind: 'dataset', dataset: input }; } }),
    reconcileSelection: async (_d, _id, _definition, _selection, guard) => { saved++; guard.beforePublish(); return true; },
  });
  const leaf = { ...card('leaf', 'middle'), tableSelection: { kind: 'explicit' as const, ids: ['missing'] } };
  store.syncDashboard(dashboard([card('root'), card('middle', 'root'), leaf])); store.ensureTable('d', 'leaf');
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  // The new ancestor produces aggregate IDs, so absence is now unknown.
  store.updateDefinition('d', 'middle', { table: { pivot: { enabled: true, grouping: ['region'], split: [] } }, search: '' }, { kind: 'none' });
  release(); await store.settled('d');
  expect(store.readView('d', 'leaf').selection).toEqual(leaf.tableSelection);
  expect(saved).toBe(0);
  expect(acquisitions).toBe(1);
  store.disposeDashboard('d');
});

it('batches complete explicit and excluded identity sets beyond the UI row bound', async () => {
  for (const kind of ['explicit', 'allMatching'] as const) {
    const ids = [...Array.from({ length: 1200 }, (_, i) => `missing-${i}`), 'r0', 'last-missing'];
    const selection = kind === 'explicit' ? { kind, ids } : { kind, excludedIds: ids };
    const queries: { ids: string[]; revision: unknown }[] = [];
    const store = createTableExecutionStore({
      executor: id => {
        const e = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
        const witness = e.identityWitness.bind(e);
        e.identityWitness = async (revision, path, ids, signal) => { queries.push({ ids, revision }); return witness(revision, path, ids, signal); };
        return e;
      }, source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }),
    });
    store.syncDashboard(dashboard([card('root'), { ...card('child', 'root'), tableSelection: selection }]));
    store.ensureTable('d', 'child'); await store.settled('d');
    expect(store.readView('d', 'child').selection).toEqual(kind === 'explicit' ? { kind, ids: ['r0'] } : { kind, excludedIds: ['r0'] });
    expect(queries.map(q => q.ids.length)).toEqual([1200, 2]);
    expect(queries[0].revision).toEqual(queries[1].revision);
    store.disposeDashboard('d');
  }
});

it('over-budget identity paths retain ambiguous selections with an explicit diagnostic', async () => {
  const cards = Array.from({ length: 65 }, (_, i) => card(`n${i}`, i ? `n${i - 1}` : undefined));
  cards[64].tableSelection = { kind: 'explicit', ids: ['missing'] };
  const { store } = setup(cards);
  store.ensureTable('d', 'n64'); await store.settled('d');
  expect(store.readView('d', 'n64').selection).toEqual(cards[64].tableSelection);
  expect(store.readView('d', 'n64').status).toBe('ready');
  expect(store.readView('d', 'n64').ready?.diagnostics).toContainEqual(expect.objectContaining({ code: 'IDENTITY_WITNESS_UNAVAILABLE' }));
  store.disposeDashboard('d');
});

it('ambiguous untyped root dates retain a hidden child year selection when a filter changes', async () => {
  const data = { ...input, columns: [{ id: 'date', label: 'Date' }, { id: 'tag', label: 'Tag', dtype: 'text' as const }], rows: [
    { id: 'object', values: { date: { x: 1 }, tag: 'object' } },
    { id: 'new', values: { date: '2026-01-01', tag: 'new' } },
    { id: 'old', values: { date: '2025-01-01', tag: 'old' } },
  ] };
  let acquisitions = 0;
  const store = createTableExecutionStore({ executor: id => createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker), source: () => ({ acquire: async () => { acquisitions++; return { kind: 'dataset', dataset: data }; } }) });
  const rootDefinition = { table: { columnFilters: [{ id: 'tag', value: 'new' }] }, search: '' };
  const childDefinition = { table: { pivot: { enabled: true, grouping: ['date'], split: [], buckets: { date: 'year' as const } } }, search: '' };
  const year = '["group","[[\\"date\\",\\"year\\"]]","[\\"string\\",\\"2026\\"]"]';
  const selection = { kind: 'explicit' as const, ids: [year] };
  store.syncDashboard(dashboard([{ ...card('root'), tableDefinition: rootDefinition }, { ...card('child', 'root'), tableDefinition: childDefinition, tableSelection: selection }, card('leaf', 'child')]));
  store.ensureTable('d', 'leaf'); await store.settled('d');
  expect(store.readView('d', 'leaf').ready?.topLevelCount).toBe(1);
  store.updateDefinition('d', 'root', { ...rootDefinition, table: { columnFilters: [{ id: 'tag', value: 'old' }] } }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child').selection).toEqual(selection);
  expect(store.readView('d', 'leaf').status).toBe('empty');
  expect(store.readView('d', 'child').ready?.diagnostics.some(d => d.code === 'SELECTION_RECONCILED')).toBe(false);
  expect(acquisitions).toBe(1);
  store.disposeDashboard('d');
});

it('analytical required fields block a three-table cascade and recover without reacquisition', async () => {
  const child = card('child', 'root');
  child.tableDefinition = { table: {}, search: '', analytical: {
    schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [], measures: [{ id: 'amount', sourceFieldId: 'revenue', aggregation: 'sum' }],
    formulas: [{ id: 'double', name: 'Double', scope: 'source', expression: '', ast: { kind: 'binary', operator: '*', left: { kind: 'reference', target: 'field', id: 'revenue' }, right: { kind: 'literal', value: 2 } } }],
    layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false },
  } };
  const { store, acquisitions, registered } = setup([card('root'), child, card('leaf', 'child')]);
  store.ensureTable('d', 'leaf'); await store.settled('d');
  const previous = store.readView('d', 'child'), leaf = store.readView('d', 'leaf');
  expect(previous.status).toBe('ready');
  store.updateDefinition('d', 'root', { table: { hidden: ['revenue'] }, search: '' }, { kind: 'none' });
  await store.settled('d');
  expect(store.readView('d', 'child')).toMatchObject({ status: 'blocked', stale: true, active: previous.active });
  expect(store.readView('d', 'child').ready).toBe(previous.ready);
  expect(store.readView('d', 'leaf')).toMatchObject({ status: 'blocked', stale: true, active: leaf.active });
  store.updateDefinition('d', 'root', { table: {}, search: '' }, { kind: 'explicit', ids: ['r1'] });
  await store.settled('d');
  expect(store.readView('d', 'child').status).toBe('ready');
  expect(store.readView('d', 'leaf').status).toBe('ready');
  expect(registered.get('leaf')!.rows.map(row => row.values.double)).toEqual([40]);
  expect(acquisitions()).toBe(1);
});
it('unsupported saved ASTs retain TypeScript diagnostics and Rust refuses recoverably without partial publication', async () => {
  const child = card('child', 'root');
  child.tableDefinition = { table: {}, search: '', analytical: {
    schemaVersion: 1, params: { promotePage: true, filters: [] }, enabled: true, categories: [{ id: 'regionCategory', name: 'Region', sourceFieldId: 'region', transform: 'native' }],
    measures: [{ id: 'dependent', sourceFieldId: 'f', aggregation: 'sum' }, { id: 'valid', sourceFieldId: 'revenue', aggregation: 'sum' }],
    formulas: [{ id: 'f', name: 'F', scope: 'source', expression: '', ast: { kind: 'not-supported' } }],
    layout: { rows: ['regionCategory'], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: true, groups: false },
  } };
  const { store, registered, acquisitions } = setup([card('root'), child, card('leaf', 'child')]);
  store.ensureTable('d', 'leaf'); await store.settled('d');
  if(engine==='rust') {
    expect(store.readView('d','child').status).toBe('failed');
    expect(store.readView('d','child').active).toBeUndefined();
    expect(store.readView('d','leaf').status).toBe('blocked');
    expect(store.readView('d','child').definition).toEqual(child.tableDefinition);
    expect(store.readView('d','child').error).toMatch(/AST/i);
    const repaired=structuredClone(child.tableDefinition!);
    const analytical=repaired.analytical as import('../lib/tableModel/types').TableModelV1;
    analytical.formulas=[];analytical.measures=analytical.measures.filter(m=>m.id==='valid');
    store.updateDefinition('d','child',repaired,{kind:'none'});await store.settled('d');
    expect(store.readView('d','child').status).toBe('ready');expect(store.readView('d','leaf').status).toBe('ready');
    const prior=store.readView('d','child').active;
    store.updateDefinition('d','child',child.tableDefinition!,{kind:'none'});await store.settled('d');
    expect(store.readView('d','child').status).toBe('failed');expect(store.readView('d','child').active).toEqual(prior);
    await expect(store.readExecutor('d','child')!.applyModel(child.tableDefinition!,{kind:'none'},{...prior!,model:99,output:99},new AbortController().signal)).rejects.toMatchObject({descriptor:{code:'INVALID_REQUEST'}});
    expect((await store.readExecutor('d','child')!.rows(prior!,{groupPath:[],offset:0,limit:10},new AbortController().signal)).rows.map(row=>row.values.valid)).toEqual([30,90]);
    store.updateDefinition('d','child',repaired,{kind:'none'});await store.settled('d');
    expect(acquisitions()).toBe(1);store.disposeDashboard('d');return;
  }
  expect(store.readView('d', 'child').status).toBe('ready');
  expect(store.readView('d', 'leaf').status).toBe('ready');
  expect(registered.get('leaf')!.rows.map(r => r.values.valid)).toEqual([30, 90]);
  expect(registered.get('leaf')!.rows.every(r => r.cellErrors?.dependent)).toBe(true);
  expect(acquisitions()).toBe(1);
});
it('authored promotion/value changes at a settled root reuse acquired input while ordinary source params reacquire',async()=>{
 const root=card('root');root.tableDefinition={table:{},search:'',analytical:{schemaVersion:1,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'region-cat',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[{id:'sum',sourceFieldId:'revenue',aggregation:'sum'}],formulas:[],layout:{rows:['region-cat'],columns:[],values:['sum']},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}}};
 const {store,acquisitions,registered}=setup([root]);store.ensureTable('d','root');await store.settled('d');expect(acquisitions()).toBe(1);const cached=registered.get('root');
 const definition=structuredClone(store.readView('d','root').definition);const model=definition.analytical as import('../lib/tableModel/types').TableModelV1;model.params.filters=[{id:'param-region',categoryId:'region-cat',label:'Region',multiSelect:true}];model.checklists=[{categoryId:'region-cat',memberKeys:['["string","A"]']}];store.updateDefinition('d','root',definition,{kind:'none'});await store.settled('d');expect(acquisitions()).toBe(1);expect(registered.get('root')).toBe(cached);expect(store.readView('d','root').ready?.inspection.definition).toEqual(definition);
 store.syncDashboard(dashboard([{...root,tableDefinition:definition,params:{file:'different'}}]));store.ensureTable('d','root');await store.settled('d');expect(acquisitions()).toBe(2);
});
it('accepted source witness refuses unsynchronized linked source and presentation edits without acquisition',async()=>{
 const cards=[card('root'),card('child','root')],{store,acquisitions}=setup(cards);store.ensureTable('d','child');await store.settled('d');
 expect(store.sourceMatches('d','child',cards)).toBe(true);const before=acquisitions();
 const retarget=structuredClone(cards);retarget[0].params={file:'other'};
 expect(store.sourceMatches('d','child',retarget)).toBe(false);expect(acquisitions()).toBe(before);
 const presentation=structuredClone(cards);presentation[0].table={hidden:['revenue']};expect(store.sourceMatches('d','child',presentation)).toBe(false);
 store.syncDashboard(dashboard(retarget));await store.settled('d');expect(store.sourceMatches('d','child',retarget)).toBe(true);
 const active=store.readView('d','root').active;store.refresh('d','root');
 expect(store.readView('d','root').active).toEqual(active);expect(store.sourceMatches('d','child',retarget)).toBe(false);
 expect(store.sourceMatches('d','root',retarget)).toBe(false);await store.settled('d');store.disposeDashboard('d');
});
it('names a backend table source as unsupported, not unknown (#21)', () => {
  const store = createTableExecutionStore({ executor: () => { throw Error(); }, source: () => undefined });
  const backend: DashboardCard = { id: 'bt', widgetId: 'income', backendId: 'b1', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 } };
  store.syncDashboard(dashboard([backend, card('child', 'bt')]));
  store.ensureTable('d', 'child');
  const error = store.readView('d', 'child').error;
  expect(error).not.toContain('Unknown source');
  expect(error).toBe('Card bt cannot feed a linked table; only a table can');
});
// A date expression in a filter is kept as text and resolved for the worker
// each time the model is applied, so a refresh a day later moves it.
it('resolves stored date expressions before the worker filters, on every refresh', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-01-07T17:00:00Z'));
    const sent: unknown[] = [];
    const filtered = { ...card('root'), tableDefinition: { table: { columnFilters: [{ id: 'day', value: { from: '2026-01-02', to: 'T-1bd' } }] }, search: '' } };
    const store = createTableExecutionStore({ executor: id => {
      const executor = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
      const apply = executor.applyModel.bind(executor);
      executor.applyModel = (definition, ...rest) => { sent.push(structuredClone(definition.table.columnFilters)); return apply(definition, ...rest); };
      return executor;
    }, source: () => ({ acquire: async () => ({ kind: 'dataset', dataset: input }) }) });
    store.syncDashboard(dashboard([filtered])); store.ensureTable('d', 'root'); await store.settled('d');
    expect(sent.at(-1)).toEqual([{ id: 'day', value: { from: '2026-01-02', to: '2026-01-06' } }]);
    vi.setSystemTime(new Date('2026-01-08T17:00:00Z'));
    store.refresh('d', 'root'); await store.settled('d');
    expect(sent.at(-1)).toEqual([{ id: 'day', value: { from: '2026-01-02', to: '2026-01-07' } }]);
    expect(store.readView('d', 'root').definition.table.columnFilters).toEqual([{ id: 'day', value: { from: '2026-01-02', to: 'T-1bd' } }]);
    store.disposeDashboard('d');
  } finally { vi.useRealTimers(); }
});

it.each([
 {name:'missing reference',expression:'Missing',ast:{kind:'reference',target:'formula',id:'missing'}},
 {name:'cycle',expression:'F',ast:{kind:'reference',target:'formula',id:'f'}},
 {name:'type error',expression:'-"text"',ast:{kind:'unary',operator:'-',operand:{kind:'literal',value:'text'}}},
])('known AST $name retains independent linked values and diagnostic cells',async({expression,ast})=>{
 const child=card('child','root');child.tableDefinition={table:{},search:'',analytical:{schemaVersion:1,params:{promotePage:true,filters:[]},enabled:true,categories:[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native'}],measures:[{id:'dependent',sourceFieldId:'f',aggregation:'sum'},{id:'valid',sourceFieldId:'revenue',aggregation:'sum'}],formulas:[{id:'f',name:'F',scope:'source',expression,ast}],layout:{rows:['regionCategory'],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:false}}};
 const {store,registered}=setup([card('root'),child,card('leaf','child')]);
 try{store.ensureTable('d','leaf');await store.settled('d');expect(store.readView('d','child').status).toBe('ready');expect(store.readView('d','leaf').status).toBe('ready');expect(registered.get('leaf')!.rows.map(row=>row.values.valid)).toEqual([30,90]);expect(registered.get('leaf')!.rows.every(row=>row.cellErrors?.dependent)).toBe(true);}finally{store.disposeDashboard('d');}
});

// A non-SSRM backend table: its WidgetCard hands over the rows it fetched and
// the worker owns the table, re-acquiring only when new rows arrive.
it('runs a backend table on the worker from the rows its card fetched', async () => {
  useWidgetRegistryStore.setState({ widgets: [{ id: 'quotes', backendId: 'b1', type: 'table', name: 'Quotes', endpoint: '', params: [], table: { columns: [{ field: 'px', headerName: 'Price' }, { field: 'note', hide: true }] } } as never] });
  const registered: import('../lib/widgetData/types').WidgetDataset[] = [];
  const store = createTableExecutionStore({ executor: id => {
    const e = createWorkerExecutor(id, () => new WorkerBoundary() as unknown as Worker);
    const register = e.registerInput.bind(e);
    e.registerInput = async (data, rev, signal) => { if (id === 'bt') registered.push(structuredClone(data)); await register(data, rev, signal); };
    return e;
  }, source: backendTableSource });
  const bt: DashboardCard = { id: 'bt', widgetId: 'quotes', backendId: 'b1', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 } };
  try {
    store.syncDashboard(dashboard([bt, card('child', 'bt')]));
    store.ensureTable('d', 'bt');
    store.setBackendRows('d', 'bt', [{ sym: 'A', px: 1 }, { sym: 'B' }]);
    await store.settled('d');
    expect(store.readView('d', 'bt').status).toBe('ready');
    expect(registered).toHaveLength(1);
    // widgets.json `hide: true` is hidden until the user saves their own list.
    expect(store.readView('d', 'bt').definition.table.hidden).toEqual(['note']);
    // Spec columns first with their headerName; an absent key is null.
    expect(registered[0].columns.map(c => [c.id, c.label])).toEqual([['px', 'Price'], ['sym', 'sym']]);
    expect(registered[0].rows[1].values).toEqual({ sym: 'B', px: null });
    // A backend table can now feed a linked table.
    store.ensureTable('d', 'child');
    await store.settled('d');
    expect(store.readView('d', 'child').status).toBe('ready');
    // New rows re-acquire once; the same payload again does nothing.
    const same = [{ sym: 'C', px: 3 }];
    store.setBackendRows('d', 'bt', same);
    await store.settled('d');
    expect(registered).toHaveLength(2);
    expect(registered[1].rows.map(r => r.values.sym)).toEqual(['C']);
    store.setBackendRows('d', 'bt', same);
    await store.settled('d');
    expect(registered).toHaveLength(2);
    store.setBackendRows('d', 'bt', Array.from({ length: WORKER_MAX_CELLS + 1 }, () => ({ x: 1 })));
    await store.settled('d');
    expect(store.readView('d', 'bt').error).toBe('This table is too large for the table engine');
    // A failed fetch replaces the rows rather than leaving the child on the previous ones.
    store.setBackendRows('d', 'bt', [{ sym: 'D', px: 4 }]);
    await store.settled('d');
    store.setBackendRows('d', 'bt', new Error('HTTP 404'));
    await store.settled('d');
    expect(store.readView('d', 'bt').error).toBe('HTTP 404');
    expect(store.readView('d', 'child').error).toBe('Source bt: HTTP 404');
  } finally {
    store.disposeDashboard('d');
    useWidgetRegistryStore.setState({ widgets: [] });
  }
});
});
it('disposing a dashboard releases the backend rows its tables were handed', async () => {
  const store = createTableExecutionStore({ source: backendTableSource });
  const bt: DashboardCard = { id: 'released-bt', widgetId: 'quotes', backendId: 'b1', params: {}, layout: { x: 0, y: 0, w: 1, h: 1 } };
  useWidgetRegistryStore.setState({ widgets: [{ id: 'quotes', backendId: 'b1', type: 'table', name: 'Quotes', endpoint: '', params: [] } as never] });
  try {
    store.syncDashboard({ id: 'd', tabs: [{ id: 'tab', name: 'Tab', cards: [bt] }] } as Dashboard);
    store.setBackendRows('d', bt.id, [{ px: 1 }]);
    store.disposeDashboard('d');
    // Released: a fresh acquisition waits for rows instead of reading the old ones.
    const outcome = await Promise.race([backendTableSource(bt).acquire(new AbortController().signal).then(() => 'old rows'), new Promise(r => setTimeout(() => r('waiting'), 20))]);
    expect(outcome).toBe('waiting');
  } finally {
    useWidgetRegistryStore.setState({ widgets: [] });
  }
});
