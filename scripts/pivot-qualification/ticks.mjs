// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
/** Raw mixed venues; never prefilter Q or use substring membership. */
export function tickDataset(csv,expectedRows){
 const lines=csv.trimEnd().split(/\r?\n/);assert.equal(lines.shift(),'ts,seq,mkt,price,shares');assert.equal(lines.length,expectedRows);
 const parsed=lines.map((line,index)=>{const fields=line.split(',');assert.equal(fields.length,5);const [t,s,exchange,p,v]=fields;const ts=Number(t),seq=Number(s),price=Number(p),shares=Number(v);assert.ok(Number.isSafeInteger(ts)&&Number.isSafeInteger(seq)&&Number.isSafeInteger(shares)&&shares>=0&&Number.isFinite(price)&&exchange.length);return {ts,seq,index,exchange,price,shares};});
 parsed.sort((a,b)=>a.ts-b.ts||a.seq-b.seq||a.index-b.index);
 return {rows:parsed.map(r=>({id:`tick-${r.index}`,values:{date:new Date(r.ts).toISOString(),second:Math.floor(r.ts/1000),minute:Math.floor(r.ts/60000)*60,sequence:r.seq,originalIndex:r.index,exchange:r.exchange,price:r.price,shares:r.shares}})),columns:[['date','date'],['second','number'],['minute','number'],['sequence','number'],['originalIndex','number'],['exchange','text'],['price','number'],['shares','number']].map(([id,dtype])=>({id,label:id,dtype})),resultRevision:1,outputRevision:1,provenance:{sourceWidgetId:'raw-mixed-ticks'},completeness:{kind:'complete',warnings:[]},freshness:{availability:'available',stale:false}};
}
export function tickModel({granularity,venue,countOnly=false}){
 assert.ok(['1s','1m'].includes(granularity));assert.ok(['Q','24EQ'].includes(venue));assert.equal(typeof countOnly,'boolean');
 const measures=(countOnly?[['ticks','price','count']]:[['open','price','first'],['high','price','max'],['low','price','min'],['close','price','last'],['volume','shares','sum'],['ticks','price','count']]).map(([id,sourceFieldId,aggregation])=>({id,sourceFieldId,aggregation,customLabel:id}));
 const analytical={schemaVersion:1,enabled:true,categories:[{id:'cat_time',name:'UTC bucket',sourceFieldId:granularity==='1m'?'minute':'second',transform:'native'},{id:'cat_exchange',name:'Execution venue',sourceFieldId:'exchange',transform:'native'},{id:'chronology',name:'Trade timestamp chronology',sourceFieldId:'date',transform:'Y'}],measures,formulas:[],layout:{rows:['cat_time'],columns:[],values:measures.map(m=>m.id)},params:{promotePage:false,filters:[{id:'venue',categoryId:'cat_exchange',label:'Execution venue',multiSelect:true}]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}};
 return {definition:{analytical,table:{sorting:[{id:'cat_time',desc:false}]},search:''},runtimeParams:{'pivot:filter:cat_exchange':{source:'viewer',memberKeys:[JSON.stringify(['string',venue])]}}};
}
/** OHLC prices are source selections/min/max, not arithmetic: exact binary64 equality.
 * Shares/count are safe integers and exact sums. No blanket financial tolerance. */
export function checkTickBars(rows,reference,{granularity,venue,countOnly=false}){
 const expected=reference.filter(r=>r.venue===venue&&r.bucketMilliseconds===(granularity==='1s'?1000:60000)).sort((a,b)=>a.bucket-b.bucket);
 const actual=rows.filter(r=>r.groupPath?.length===1).map(r=>({bucket:Number(r.groupPath[0].value),...r.values})).sort((a,b)=>a.bucket-b.bucket);
 assert.equal(actual.length,expected.length,'Independent bar count');
 for(let i=0;i<expected.length;i++){assert.equal(actual[i].bucket,expected[i].bucket);for(const key of countOnly?['ticks']:['open','high','low','close','volume','ticks']){assert.equal(actual[i][key],expected[i][key],`bar ${i} ${key}`);if(['volume','ticks'].includes(key))assert.ok(Number.isSafeInteger(actual[i][key]));}}
 return expected.length;
}
