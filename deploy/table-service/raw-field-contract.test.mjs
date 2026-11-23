import test from 'node:test';
import assert from 'node:assert/strict';
import {fields,rows,tagged,plain,ordinaryTable,result,rejectedOpaqueIdentity} from './raw-field-contract.mjs';
test('exact synthetic JSON retains all eight own keys and all three rows across tagged wire values',()=>{
 const input=rows();assert.equal(input.length,3);
 for(const row of input){assert.deepEqual(Object.keys(row),fields);assert.ok(Object.hasOwn(row,'__proto__'));assert.ok(Object.hasOwn(row,'hasOwnProperty'));assert.ok(Object.hasOwn(row,''));}
 assert.deepEqual(input.map(row=>row['']),[101,21,301]);
 const output=plain(tagged(input));assert.deepEqual(output,input);
 assert.equal(Object.getPrototypeOf(output[0]),Object.prototype);
 assert.equal(Object.hasOwn(output[0],'__proto__'),true);
});
test('ordinary numeric filter is wire-typed and raw empty sort/order keys retained',()=>{
 const table=ordinaryTable();assert.deepEqual(table.sorting,[{id:'',desc:false}]);
 assert.deepEqual(plain(table.columnFilters[0].value),{min:30});
 assert.equal(table.columnFilters[0].id,'');assert.equal(table.columnOrder[0],'');
 const filtered=rows().filter(r=>r['']>=plain(table.columnFilters[0].value).min).sort((a,b)=>a['']-b['']);
 assert.deepEqual(filtered.map(r=>r['']),[101,301]);assert.deepEqual(filtered.map(r=>r.__proto__),[102,302]);
});
test('a failed wire reply cannot be classified as a subset or chart',()=>{
 assert.throws(()=>result({wire:JSON.stringify({response:{kind:'error',error:{code:'INVALID_REQUEST'}}})}));
 assert.equal(result({wire:JSON.stringify({response:{kind:'viewReady'}})}).kind,'viewReady');
});

test('strict opaque identity rejection requires sanitized gateway HTTP400, never server error or raw inner body',()=>{
 const refused={status:400,json:{error:{code:'upstream_refused',message:'Table request refused'}}};
 rejectedOpaqueIdentity(refused);
 for(const status of [200,401,404,409,422,500,502,503])assert.throws(()=>rejectedOpaqueIdentity({...refused,status}));
 for(const body of [{error:{code:'invalid_input'}},{error:{code:'upstream_refused',message:'other'}},{error:{code:'upstream_refused',message:'Table request refused',details:'inner details'}},{}]){
  assert.throws(()=>rejectedOpaqueIdentity({...refused,json:body}));
 }
});
