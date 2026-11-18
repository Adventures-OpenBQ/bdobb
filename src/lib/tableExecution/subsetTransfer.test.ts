// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { beginSubset, appendSubset, commitSubset } from './subsetTransfer';
import { calculateView } from './engine';
import { createResultStore } from './resultStore';
import { createWorkerExecutor } from './workerClient';
import { Boundary } from '../../test/tableWorkerBoundary';
import { input, revision } from './fixtures';
it('commits complete metadata and rejects partial, reordered and foreign revision input', () => {
  const batches = [...createResultStore(calculateView(input, { table: {}, search: '' }, { kind: 'none' }), revision).presented('req', revision, 'transfer', 2)];
  const pending = beginSubset('transfer', revision);
  expect(() => commitSubset(pending)).toThrow();
  expect(() => appendSubset(pending, batches[1])).toThrow();
  expect(() => appendSubset(pending, { ...batches[0], revision: { ...revision, output: 2 } })).toThrow();
  appendSubset(pending, batches[0]);
  expect(() => commitSubset(pending)).toThrow();
  appendSubset(pending, batches[1]);
  const result = commitSubset(pending);
  expect(result.rows.map(r => r.id)).toEqual(['r0', 'r1', 'r2']);
  expect(result.provenance.lineage).toEqual([{ widgetId: 'source', resultRevision: 1, outputRevision: 1 }]);
  expect(result.completeness).toEqual(input.completeness);
  expect(result.freshness).toEqual(input.freshness);
});
it('rejects mismatched request identity within one transfer', () => {
 const batches=[...createResultStore(calculateView(input,{table:{},search:''},{kind:'none'}),revision).presented('request',revision,'transfer',2)];
 const pending=beginSubset('transfer',revision);appendSubset(pending,batches[0]);
 expect(()=>appendSubset(pending,{...batches[1],requestId:'different'})).toThrow();
});

it('partial_subset_never_commits when a real stream is interrupted', async () => {
 const executor=createWorkerExecutor('source',()=>new Boundary() as unknown as Worker), signal=new AbortController().signal;
 try {
  await executor.registerInput({...input,rows:Array.from({length:1001},(_,i)=>({id:`r${i}`,values:{revenue:i}}))},1,signal);
  await executor.applyModel({table:{},search:''},{kind:'none'},revision,signal);
  const stream=executor.presented(revision,signal)[Symbol.asyncIterator](), first=await stream.next();
  expect(first.value.final).toBe(false);
  const pending=beginSubset(first.value.transferId,revision);appendSubset(pending,first.value);
  await stream.return!();
  expect(()=>commitSubset(pending)).toThrow('Incomplete or already committed subset');
  // A fresh complete transfer remains usable after the interruption.
  let complete:ReturnType<typeof beginSubset>|undefined;
  for await(const batch of executor.presented(revision,signal)){complete??=beginSubset(batch.transferId,revision);appendSubset(complete,batch);}
  expect(commitSubset(complete!).rows).toHaveLength(1001);
 } finally {executor.dispose();}
});
it('new_input_invalidates_open_transfer without admitting partial old rows', async () => {
 const executor=createWorkerExecutor('source',()=>new Boundary() as unknown as Worker),signal=new AbortController().signal;
 try {
  await executor.registerInput({...input,rows:Array.from({length:1001},(_,i)=>({id:`old${i}`,values:{revenue:i}}))},1,signal);
  await executor.applyModel({table:{},search:''},{kind:'none'},revision,signal);
  const stream=executor.presented(revision,signal)[Symbol.asyncIterator](),first=await stream.next();
  expect(first.value.final).toBe(false);
  const pending=beginSubset(first.value.transferId,revision);appendSubset(pending,first.value);
  await executor.registerInput({...input,resultRevision:2},2,signal);
  const current={...revision,input:2,model:2,output:2};
  await executor.applyModel({table:{},search:''},{kind:'none'},current,signal);
  await expect(stream.next()).rejects.toMatchObject({name:'AbortError'});
  expect(()=>commitSubset(pending)).toThrow('Incomplete or already committed subset');
  const rows=await executor.rows(current,{groupPath:[],offset:0,limit:10},signal);
  expect(rows.revision).toEqual(current);expect(rows.rows.map(row=>row.id)).toEqual(['r0','r1','r2']);
 } finally {executor.dispose();}
});
