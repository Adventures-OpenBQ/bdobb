// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { input } from './fixtures';
import { createPureExecutor, pivotOffData, pivotOffDefinition } from './testContract';
import { createWasmTestExecutor } from './testing/wasmExecutor';
import { generateTrace, runTrace, parseTrace, serializeTrace, reduceTrace, traceMismatchClass, normalizeTrace, type TraceFixture, type TraceAction } from './testing/actionTrace';
import type { TableDefinition } from './types';
import reference from '../../test/fixtures/sec-statements/reference.json';
import expected from '../../test/fixtures/sec-statements/expected.json';
const pure = async () => createPureExecutor();
const fixture: TraceFixture = { dataset: input, definition: { table: {}, search: '' }, selection: { kind: 'none' } };
const extended = process.env.PIVOT_TRACE_EXTENDED === '1';
const userSeed = process.env.PIVOT_TRACE_SEED;
if (extended && userSeed === undefined) throw new Error('Extended parity requires PIVOT_TRACE_SEED');
const seeds = Array.from({ length: extended ? 200 : 20 }, (_, i) => i + 1);
if (extended) { const seed = Number(userSeed); if (!Number.isSafeInteger(seed)) throw new Error('PIVOT_TRACE_SEED must be an integer'); console.info(`Extended parity user seed: ${seed}`); seeds.push(seed); }
for (const seed of seeds) it(`TS/compiled-WASM action trace seed ${seed}`, async () => {
  const actions = generateTrace(seed, extended ? 200 : 50);
  expect(generateTrace(seed, actions.length)).toStrictEqual(actions);
  const replay = parseTrace(serializeTrace({ version: 1, seed, fixture, actions }));
  const ts = await runTrace(pure, fixture, actions), wasm = await runTrace(createWasmTestExecutor, replay.fixture, replay.actions);
  const failureClass = traceMismatchClass(ts, wasm);
  if (failureClass) {
    const minimized = await reduceTrace(actions, async candidate => {
      try { return traceMismatchClass(await runTrace(pure,fixture,candidate),await runTrace(createWasmTestExecutor,fixture,candidate)); }
      catch { return 'unexpected-execution-error'; }
    });
    const directory = new URL('../../test/fixtures/sec-statements/failing-traces/',import.meta.url);
    mkdirSync(directory,{recursive:true});
    for (const [suffix, trace] of [['full',actions],['minimized',minimized]] as const) writeFileSync(new URL(`seed-${seed}-${failureClass}-${suffix}.json`,directory),serializeTrace({version:1,seed,fixture,actions:trace}));
    throw new Error(`Seed ${seed}: ${failureClass}; frozen full/minimized traces in ${directory.pathname}`);
  }
  expect(wasm).toStrictEqual(ts);
});
it('register/apply revisions and proposed immutable selection use distinct newer snapshots', async () => {
  const actions: TraceAction[] = [{ kind: 'select', action: { kind: 'toggle', rowId: 'r2' }, visibleIds: ['r0'] }, { kind: 'replace', reverse: true }, { kind: 'presented' }];
  for (const create of [pure, createWasmTestExecutor]) {
    const result = await runTrace(create, fixture, actions);
    expect(result.map(o => o.revision)).toEqual([{widgetId:'trace',input:1,model:1,output:1},{widgetId:'trace',input:1,model:2,output:2},{widgetId:'trace',input:2,model:3,output:3},{widgetId:'trace',input:2,model:3,output:3}]);
    expect(result[1].value).toMatchObject({ proposed: { revision: {model:1,output:1}, selection: {kind:'explicit',ids:['r2']} }, applied: { revision: {model:2,output:2} } });
    expect(result[3].value).toMatchObject([{ rows: [{id:'r2',values:{revenue:90}}] }]);
  }
});
it('explicit empty, hidden selected identities, clear and signed zero retain independent outcomes', async () => {
  const data = structuredClone(input); data.rows[0].values.revenue = -0;
  expect(Object.is(parseTrace(serializeTrace({version:1,seed:0,fixture:{...fixture,dataset:data},actions:[]})).fixture.dataset.rows[0].values.revenue,-0)).toBe(true);
  const actions: TraceAction[] = [
    {kind:'presented'},
    {kind:'apply',definition:{table:{columnFilters:[{id:'region',value:'A'}]},search:''},selection:{kind:'explicit',ids:['r2']}},
    {kind:'presented'}, {kind:'select',action:{kind:'clear'},visibleIds:['r0']}, {kind:'presented'},
    {kind:'apply',definition:fixture.definition,selection:{kind:'explicit',ids:[]}}, {kind:'presented'},
  ];
  for (const create of [pure,createWasmTestExecutor]) {
    const out = await runTrace(create,{...fixture,dataset:data},actions);
    const rows = (index: number) => (out[index].value as {rows:typeof data.rows}[]).flatMap(b=>b.rows);
    expect(Object.is(rows(1)[0].values.revenue,-0)).toBe(true);
    expect(rows(3)).toEqual([]); expect(rows(5).map(r=>r.id)).toEqual(['r0','r1']); expect(rows(7)).toEqual([]);
  }
});
it('typed native members remain separate through grouped traces', async () => {
  const dataset = structuredClone(input); dataset.rows[0].values.region = 1; dataset.rows[1].values.region = '1'; dataset.rows[2].values.region = null;
  const actions: TraceAction[] = [{kind:'apply',definition:{table:{pivot:{enabled:true,grouping:['region'],split:[],aggregationFns:{revenue:'sum'}}},search:''}},{kind:'rows',request:{groupPath:[],offset:0,limit:50}},{kind:'presented'}];
  const ts = await runTrace(pure,{...fixture,dataset},actions);
  expect(ts[2].value).toMatchObject({siblingCount:3});
  expect(await runTrace(createWasmTestExecutor,{...fixture,dataset},actions)).toStrictEqual(ts);
});
for (const [symbol, company] of Object.entries(reference.companies)) it(`SEC independent Decimal cells and parity: ${symbol}`, async () => {
  const sec: TraceFixture = {dataset:{...company.dataset,provenance:{sourceWidgetId:`sec-${symbol}`}} as TraceFixture['dataset'],definition:company.definition as TableDefinition,selection:{kind:'none'}};
  const actions: TraceAction[] = [{kind:'presented'}];
  const ts = await runTrace(pure,sec,actions);
  expect(await runTrace(createWasmTestExecutor,sec,actions)).toStrictEqual(ts);
  for (const observations of [ts, await runTrace(createWasmTestExecutor,sec,actions)]) {
    const ready = observations[0].value as {columns:{id:string;measureId?:string;splitPath?:{value:unknown}[]}[]};
    const batches = observations[1].value as {rows:{groupPath?:{value:unknown}[];values:Record<string,unknown>}[]}[];
    const rows = batches.flatMap(b=>b.rows);
    for (const [year,lines] of Object.entries(expected[symbol as keyof typeof expected])) for (const [line,value] of Object.entries(lines)) {
      const row = rows.find(row=>row.groupPath?.some(p=>p.value === line));
      const column = ready.columns.find(c=>c.measureId?.endsWith('/value') && c.splitPath?.some(p=>p.value === `FY${year}`));
      expect(row, `${symbol}/${year}/${line}`).toBeDefined(); expect(column).toBeDefined();
      if (Number.isInteger(Number(value))) expect(Number.isSafeInteger(Number(value))).toBe(true);
      else expect(String(row!.values[column!.id])).toBe(value); // Source Decimal round-trip, no arithmetic tolerance.
      expect(row!.values[column!.id]).toBe(Number(value));
    }
  }
});
it('replays and deletion-minimizes a deliberate adapter divergence without changing failure class', async () => {
  const divergent = async () => {
    const executor = createPureExecutor(), originalChart = executor.chartData, originalPresented = executor.presented;
    executor.chartData = async (...args) => { const data = await originalChart(...args); return {...data,rows:[]}; };
    executor.presented = async function* (...args) {
      for await (const batch of originalPresented(...args)) yield {...batch,provenance:{sourceWidgetId:'deliberately-divergent'}};
    };
    return executor;
  };
  const classify = async (actions: TraceAction[]) => {
    try { const left = await runTrace(pure,fixture,actions), right = await runTrace(divergent,fixture,actions); return traceMismatchClass(left,right); } catch { return 'unexpected-error'; }
  };
  const actions: TraceAction[] = [{kind:'rows',request:{groupPath:[],offset:0,limit:1}},{kind:'chartData',fields:['revenue']},{kind:'presented'}];
  const reduced = await reduceTrace(actions,classify);
  expect(reduced).toEqual([{kind:'chartData',fields:['revenue']}]);
  expect(await classify(parseTrace(serializeTrace({version:1,seed:7,fixture,actions:reduced})).actions)).toBe('identities-order');
  expect(await classify([{kind:'presented'}])).toBe('provenance'); // This different failure cannot replace identities-order.
});

it('formula errors and selected subsets survive public exports and chart delivery', async () => {
  const errorFixture: TraceFixture = {dataset:pivotOffData,definition:pivotOffDefinition,selection:{kind:'explicit',ids:['keep']}};
  const actions: TraceAction[] = [{kind:'rows',request:{groupPath:[],offset:0,limit:1}},{kind:'presented'},{kind:'chartData'}];
  const ts = await runTrace(pure,errorFixture,actions);
  expect(await runTrace(createWasmTestExecutor,errorFixture,actions)).toStrictEqual(ts);
  expect(ts[1].value).toMatchObject({rows:[{id:'keep',values:{sourceComputed:15,sourceError:'#ERROR'},cellErrors:{sourceError:{code:'division-by-zero'}}}]});
});
it('unselecting the last off-page identity stays explicitly empty until clear', async () => {
  for (const create of [pure,createWasmTestExecutor]) {
    const actions: TraceAction[] = [{kind:'rows',request:{groupPath:[],offset:0,limit:1}},
      {kind:'select',action:{kind:'toggle',rowId:'r2'},visibleIds:['r0']},
      {kind:'select',action:{kind:'toggle',rowId:'r2'},visibleIds:['r0']},
      {kind:'presented'},{kind:'select',action:{kind:'clear'},visibleIds:['r0']},{kind:'presented'}];
    const out = await runTrace(create,fixture,actions);
    expect(out[3].value).toMatchObject({proposed:{selection:{kind:'explicit',ids:[]}}});
    expect(out[4].value).toMatchObject([{rows:[]}]);
    expect((out[6].value as {rows:{id:string}[]}[]).flatMap(b=>b.rows.map(r=>r.id))).toEqual(['r0','r1','r2']);
  }
});
it('disposes acquired executors on failed operations', async () => {
  let disposed = false;
  const create = async () => { const executor = createPureExecutor(); executor.dispose = () => { disposed = true; }; executor.rows = async () => { throw new Error('deliberate test failure'); }; return executor; };
  await expect(runTrace(create,fixture,[{kind:'rows',request:{groupPath:[],offset:0,limit:1}}])).rejects.toThrow('deliberate test failure');
  expect(disposed).toBe(true);
});

it('normalizes transport identifiers while preserving identically named source fields', () => {
  const source = {requestId:'source-request',transferId:'source-transfer',nested:{requestId:'nested-source'}};
  expect(normalizeTrace({kind:'subset',requestId:'transport-request',transferId:'transport-transfer',revision:{input:1},rows:[{id:'row',values:source}],provenance:source})).toEqual({kind:'subset',revision:{input:1},rows:[{id:'row',values:source}],provenance:source});
});
