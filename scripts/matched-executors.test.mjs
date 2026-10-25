// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { equivalent, summarize, engineOrder } from './matched-executors-utils.mjs';
test('parity rejects changed identities, order, errors, formats and totals', () => {
 for (const key of ['id','values','cellErrors','cellFormats']) assert.throws(()=>equivalent({[key]:'a'},{[key]:'b'}));
 assert.throws(()=>equivalent([1,2],[2,1]));
 assert.throws(()=>equivalent({sum:1},{sum:1+1e-13}));
 assert.throws(()=>equivalent({ratio:1},{ratio:1+1e-13}));
 equivalent({rows:[{values:{computed:1}}]},{rows:[{values:{computed:1+1e-13}}]},'',new Set(['computed']),'baseline');
 for(const key of ['cellErrors','cellFormats','metadata'])assert.throws(()=>equivalent({rows:[{[key]:{computed:1}}]},{rows:[{[key]:{computed:1+1e-13}}]},'',new Set(['computed']),'baseline'));
 assert.throws(()=>equivalent({rows:[{values:{avgrevenue:1}}]},{rows:[{values:{avgrevenue:1+1e-13}}]}));
 assert.throws(()=>equivalent(0,-0));
 assert.throws(()=>equivalent({ratio:1},{ratio:1.01}));
});
test('statistics preserve observations and use nearest rank p95',()=>{
 const values=Array.from({length:20},(_,i)=>i+1);
 assert.deepEqual(summarize(values),{median:10.5,p95:19,observations:values});
 assert.deepEqual(engineOrder(0),['typescript','rust']);
 assert.deepEqual(engineOrder(1),['rust','typescript']);
});
test('tolerance requires published mean or an aggregate division formula',async()=>{
 const {toleratedComputedColumns}=await import('./matched-executors-utils.mjs');
 const definition={analytical:{formulas:[{id:'division',scope:'aggregate',ast:{kind:'binary',operator:'/'}},{id:'ratioSum',scope:'aggregate',ast:{kind:'binary',operator:'+'}},{id:'sourceRatio',scope:'source',ast:{kind:'binary',operator:'/'}}]}};
 const columns=[{id:'actualMean',aggregation:'mean'},{id:'actualRatio',metadata:{formulaId:'division'},analytical:{scope:'aggregate'}},{id:'ratio',aggregation:'sum'},{id:'averageSource'},{id:'sumFormula',metadata:{formulaId:'ratioSum'},analytical:{scope:'aggregate'}},{id:'sourceDivision',metadata:{formulaId:'sourceRatio'},analytical:{scope:'source'}}];
 assert.deepEqual([...toleratedComputedColumns(definition,columns)],['actualMean','actualRatio']);
 const allowed=toleratedComputedColumns(definition,columns);
 for(const id of ['ratio','averageSource','sumFormula','sourceDivision'])assert.throws(()=>equivalent({rows:[{values:{[id]:1}}]},{rows:[{values:{[id]:1+1e-13}}]},'',allowed));
});
test('raw published mean metadata cannot grant aggregate tolerance',async()=>{
 const {toleratedComputedColumns}=await import('./matched-executors-utils.mjs');
 assert.deepEqual([...toleratedComputedColumns({table:{}},[{id:'avgrevenue',aggregation:'mean'}])],[]);
});
test('tolerance anchors to real schema roots, preserving nested metadata and raw objects',()=>{
 const allow=new Set(['computed']);
 const metadata=n=>({ready:{columns:[{metadata:{rows:[{values:{computed:n}}]}}]}});
 assert.throws(()=>equivalent(metadata(1),metadata(1+1e-13),'baseline',allow,'baseline'));
 const raw=n=>({rows:[{values:{raw:{totals:{values:{computed:n}}}}}]});
 assert.throws(()=>equivalent(raw(1),raw(1+1e-13),'baseline',allow,'baseline'));
 equivalent({rows:[{values:{computed:1}}]},{rows:[{values:{computed:1+1e-13}}]},'baseline',allow,'baseline');
 const snapshot=n=>[{exported:{rows:[{values:{computed:n}}]},block:{rows:{rows:[{values:{computed:n}}]},totals:{values:{computed:n}}}}];
 equivalent(snapshot(1),snapshot(1+1e-13),'cross',new Map([[0,allow]]),'snapshots');
 const nested=n=>[{ready:{columns:[{metadata:{rows:[{values:{computed:n}}]}}]}}];
 assert.throws(()=>equivalent(nested(1),nested(1+1e-13),'cross',new Map([[0,allow]]),'snapshots'));
 assert.throws(()=>equivalent(snapshot(1),snapshot(1+1e-13),'cross',new Map([[1,allow]]),'snapshots'));
});
