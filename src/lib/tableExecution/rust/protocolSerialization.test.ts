// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {encodeRequest} from './protocol';
import {input,revision} from '../fixtures';
it('escapes a repeated wire field name once per encoded request',()=>{
 const stringify=vi.spyOn(JSON,'stringify');
 let tags=0;
 try{
  const json=encodeRequest({kind:'registerInput',requestId:'q',revision,inputRevision:1,input},'en-US',1);
  expect(JSON.parse(json).request.input.rows).toHaveLength(input.rows.length);
  tags=stringify.mock.calls.filter(([value])=>value==='tag').length;
 }finally{stringify.mockRestore();}
 expect(tags).toBe(1);
});
it('preserves signed structural zero and escaped field names',()=>{
 const name='quoted"\\\nfield';
 const encoded=encodeRequest({kind:'applyModel',requestId:'q',revision,definition:{table:{widths:Object.fromEntries([[name,-0]])},search:''},selection:{kind:'none'}},'en-US',1);
 const parsed=JSON.parse(encoded);
 expect(Object.is(parsed.request.definition.definition.table.widths[name],-0)).toBe(true);
});
it('does not retain oversized field names in the per-request cache',()=>{
 const name='field'.repeat(20);
 const rows=input.rows.map(row=>({...row,values:{...row.values,[name]:1}}));
 const stringify=vi.spyOn(JSON,'stringify');let calls=0;
 try{
  const encoded=encodeRequest({kind:'registerInput',requestId:'q',revision,inputRevision:1,input:{...input,rows}},'en-US',1);
  expect(JSON.parse(encoded).request.input.rows[0].values[name]).toEqual({tag:'f64',value:1});
  calls=stringify.mock.calls.filter(([value])=>value===name).length;
 }finally{stringify.mockRestore();}
 expect(calls).toBe(rows.length);
});
