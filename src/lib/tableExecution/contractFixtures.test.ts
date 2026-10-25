// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { createPureExecutor, runExecutorContract } from './testContract';
import { createWorkerExecutor } from './workerClient';
import { createWorkerHandler } from './table.worker';
import type { ExecutionRequest } from './types';

it('preserves hand-checked ordinary and Statement contracts across shuffled block sizes', async () => {
  const results = await runExecutorContract(createPureExecutor);
  for (const result of results) {
    if (!result.deliveries) continue;
    expect(result.deliveries[1]).toEqual(result.deliveries[0]);
    expect(result.deliveries[2]).toEqual(result.deliveries[0]);
  }
  expect(results.find(result => result.name === 'operators')?.totals).toEqual({ mean: 40, median: 20, last: 90 });
  expect(results.find(result => result.name === 'scoped-result-filters')?.totals).toMatchObject({ revenueSum: 80, costSum: 20, margin: 0.75, budget: 70 });
  expect(results.find(result => result.name === 'excluded-budget')?.totals?.budget).toBe('#ERROR');
  expect(results.find(result => result.name === 'mixed-fiscal-calendars')?.modelWarnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'fiscal-alignment' })]));
  expect(results.find(result => result.name === 'source-filter-excludes-budget')?.totals?.budget).toBe('#ERROR');
  expect(results.find(result => result.name === 'empty-analytical')?.chart).toEqual([]);
  expect(results.find(result => result.name === 'selected')?.chart?.map(row => row.values.revenue)).toEqual([10, 90]);
  const off=results.find(result=>result.name==='pivot-off-source-safe')!;
  expect(off).toMatchObject({totals:{},completeness:{kind:'complete'}});
  expect(off.inspection).toContainEqual(expect.objectContaining({kind:'formula',id:'sourceComputed',scope:'source',sourceFilterKind:'number'}));
  expect(off.inspection).toContainEqual(expect.objectContaining({kind:'formula',id:'aggregate',resolvedOperators:['sum']}));
  expect(off.chart!.map(row=>row.id)).toEqual(['keep']);
  expect(off.columns!.map(column=>column.id)).not.toContain('secret');
  expect(results.find(result => result.name === 'empty')).toMatchObject({ chart: [], totals: {}, completeness: { kind: 'complete' } });
 const get=(name:string)=>results.find(r=>r.name===`statement-${name}`)!;
 const formatted=get('scoped-formats');const formattedColumn=formatted.columns!.find(c=>c.measureId)!.id;
 expect(formatted.chart!.filter(r=>r.groupPath?.length===2).map(r=>({value:r.values[formattedColumn],format:r.cellFormats?.[formattedColumn]}))).toEqual([{value:100,format:{formatterFn:'int'}},{value:60,format:{decimalPlaces:3}},{value:0.4,format:{formatterFn:'normalizedPercent'}}]);
 const values=(name:string)=>{const r=get(name);const money=r.columns!.filter(c=>c.measureId);return r.chart!.filter(row=>row.groupPath?.length===2).map(row=>({line:row.groupPath!.at(-1)!.memberKey,values:money.map(c=>row.values[c.id]),errors:row.cellErrors}));};
 expect(values('income-wide').map(row=>row.values)).toEqual([[100],[60],[40]]);
 expect(values('income-long')).toEqual(values('income-wide'));
 const schema=(name:string)=>get(name).columns!.map(({sourceBindingId: _sourceBindingId,...column})=>column);
 expect(schema('income-wide')).toEqual(schema('income-long'));
 expect(get('income-wide').totals).toEqual({});
 expect(values('duplicate-keyless').every(row=>row.values[0]==='#ERROR'&&row.errors)).toBe(true);
 expect(values('missing').at(-1)?.values).toEqual(['#ERROR']);
 expect(values('upstream-error')[0].errors).toEqual(expect.objectContaining({[get('upstream-error').columns!.find(c=>c.measureId)!.id]:expect.objectContaining({code:'blocked-dependency',message:'Source validation failed'})}));
 expect(get('hidden-field').error).toMatch(/revenue.*unavailable/);
 expect(get('annual-quarter-overlap').error).toMatch(/FY\/FQ overlap/);
 expect(get('invalid-number').error).toMatch(/finite number/);
 expect(get('fiscal-warning').modelWarnings).toContainEqual(expect.objectContaining({code:'fiscal-alignment'}));
 expect(values('hidden-dependency').map(row=>row.values)).toEqual([[60],[40]]);
 expect(values('explicit-prior-period').at(-1)?.values).toEqual([100,100]);
 expect(values('balance')[0].values).toEqual([100,60]);
 expect(values('cashflow')[0].values).toEqual([100,60]);

});

it('matches pure fixtures through structured-clone protocol handler transport (not a real worker)', async () => {
  class Boundary {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;
    onmessageerror = null;
    handler = createWorkerHandler(data => this.onmessage?.({ data: structuredClone(data) } as MessageEvent));
    postMessage(request: ExecutionRequest) { void this.handler(structuredClone(request)); }
    terminate() {}
  }
  expect(await runExecutorContract(() => createWorkerExecutor('source', () => new Boundary() as unknown as Worker))).toEqual(await runExecutorContract(createPureExecutor));
});
