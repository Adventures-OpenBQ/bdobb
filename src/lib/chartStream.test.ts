// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { initialChartStream, reduceChartStream } from './chartStream';
import examples from './chart-stream-v1.examples.json';
describe('chart stream model', () => {
  it('atomically installs the frozen candle snapshot and replaces historical volume', () => {
    const frames = examples[1].frames;
    let state = initialChartStream();
    state = reduceChartStream(state, frames[0]);
    state = reduceChartStream(state, frames[1]);
    expect(state.items).toEqual([]);
    state = reduceChartStream(state, frames[2]);
    expect(state.items).toHaveLength(1);
    state = reduceChartStream(state, frames[3]);
    expect(state.items[0]).toMatchObject({open:99,volume:5});
    expect(state.cursor?.seq).toBe('9007199254740994');
    expect(reduceChartStream(state, frames[3]).items).toEqual(state.items);
  });
  it('retains equal-time distinct trades and invalidates on explicit resync', () => {
    let state = initialChartStream();
    for (const frame of examples[0].frames.slice(1,4)) state = reduceChartStream(state, frame);
    state = reduceChartStream(state, examples[0].frames[5]);
    expect(state.items).toHaveLength(2);
    state = reduceChartStream(state, examples[2].frames[0]);
    expect(state.resync).toBe(true);
    expect(state.cursor).toBeUndefined();
  });
});

it('rejects a forward hole, wrong epoch and invalid int64 without advancing ack progress', () => {
  let s = initialChartStream();
  const frames = examples[1].frames;
  for (const f of frames.slice(0,3)) s = reduceChartStream(s,f);
  const change = frames[3];
  expect(reduceChartStream(s,{...change,from_cursor:{epoch:'epoch-a',seq:'9007199254740994'}}).resync).toBe(true);
  expect(reduceChartStream(s,{...change,through_cursor:{epoch:'wrong',seq:'9007199254740994'}}).resync).toBe(true);
  expect(reduceChartStream(s,{...change,through_cursor:{epoch:'epoch-a',seq:'9223372036854775808'}}).resync).toBe(true);
});
it('binds a fresh resume generation and applies its authoritative status baseline', () => {
  let s = initialChartStream();
  const frames = examples[1].frames;
  for (const f of frames.slice(0,5)) s = reduceChartStream(s,f);
  s = reduceChartStream(s,{...frames[6],generation:'new-generation',statuses:[{key:s.items[0].key,status:'open'}]});
  expect(s.generation).toBe('new-generation');
  expect(s.items[0].status).toBe('open');
  expect(s.status_seq).toBe('0');
});
it('retains the snapshot floor after spare-capacity truncation and bounds newest retained candles', () => {
  let s = initialChartStream();
  for (const f of examples[1].frames.slice(0,3)) s = reduceChartStream(s,f);
  const candle = s.items[0];
  const older = {...candle,key:{...candle.key,bucket_start:'2026-11-20T14:29:00.000000000Z'},revision:{epoch:'epoch-a',seq:'9007199254740994'}};
  s=reduceChartStream(s,{...examples[1].frames[3],candles:[older]});
  expect(s.items).toHaveLength(1);
  expect(s.view_floor?.bucket_start).toBe('2026-11-20T14:30:00.000000000Z');
});
it('refuses nonfinite candle data and mismatched snapshot items before installation', () => {
  let s=initialChartStream();
  const frames=examples[1].frames;
  s=reduceChartStream(s,frames[0]);
  const chunk=frames[1] as unknown as {items:Record<string,unknown>[]};
  s=reduceChartStream(s,{...frames[1],items:[{...chunk.items[0],volume:-1}]});
  expect(s.resync).toBe(true);
});
it('applies partial overlap only once and advances on empty data frames', () => {
  let s=initialChartStream();
  for (const f of examples[0].frames.slice(1,4)) s=reduceChartStream(s,f);
  const frame=examples[0].frames[5];
  s=reduceChartStream(s,frame);
  s=reduceChartStream(s,{...frame,through_cursor:{epoch:'epoch-a',seq:'9007199254740995'}});
  expect(s.items).toHaveLength(2);
  expect(s.cursor?.seq).toBe('9007199254740995');
  s=reduceChartStream(s,{...frame,from_cursor:s.cursor,through_cursor:{epoch:'epoch-a',seq:'9007199254740996'},batches:[]});
  expect(s.cursor?.seq).toBe('9007199254740996');
  expect(s.items).toHaveLength(2);
});
it('rejects conflicting candle data at the same revision', () => {
  let s=initialChartStream();
  for (const f of examples[1].frames.slice(0,3)) s=reduceChartStream(s,f);
  const candle={...s.items[0],volume:999};
  s=reduceChartStream(s,{...examples[1].frames[3],candles:[candle]});
  expect(s.resync).toBe(true);
});
it('identifies candle keys independently of JSON object property order', () => {
  let s=initialChartStream();
  for (const f of examples[1].frames.slice(0,3)) s=reduceChartStream(s,f);
  const replacement=(examples[1].frames[3] as unknown as {candles:{key:{bucket_start:string}}[]}).candles[0];
  s=reduceChartStream(s,{...examples[1].frames[3],candles:[{...replacement,key:{bucket_start:replacement.key.bucket_start,interval:'1m',symbol:'AAPL'}}]});
  expect(s.items).toHaveLength(1);
  expect(s.items[0].volume).toBe(5);
});
it('requires every retained candle status on a quiet resume', () => {
  let s=initialChartStream();
  for (const f of examples[1].frames.slice(0,4)) s=reduceChartStream(s,f);
  s=reduceChartStream(s,{...examples[1].frames[6],generation:'new',statuses:[]});
  expect(s.resync).toBe(true);
});
it('keeps the installed snapshot during an interrupted replacement and refuses missing chunks', () => {
  let s=initialChartStream();
  const frames=examples[1].frames;
  for (const f of frames.slice(0,3)) s=reduceChartStream(s,f);
  s=reduceChartStream(s,{...frames[0],generation:'replacement'});
  expect(s.items).toHaveLength(1);
  expect(s.cursor?.seq).toBe('9007199254740993');
  s=reduceChartStream(s,{...frames[2],generation:'replacement'});
  expect(s.resync).toBe(true);
  expect(s.cursor).toBeUndefined();
});
it('ignores old generations and stale status sequences without changing the data cursor', () => {
  let s=initialChartStream();
  for (const f of examples[1].frames.slice(0,5)) s=reduceChartStream(s,f);
  const cursor=s.cursor;
  const status=examples[1].frames[4];
  const stale=reduceChartStream(s,{...status,status_seq:'0',statuses:[]});
  expect(stale).toBe(s);
  expect(reduceChartStream(s,{...examples[1].frames[3],generation:'old'})).toBe(s);
  expect(s.cursor).toBe(cursor);
});
it('rejects same-revision conflicts even in a replayed interval', () => {
  let s=initialChartStream();
  for(const f of examples[1].frames.slice(0,4)) s=reduceChartStream(s,f);
  s=reduceChartStream(s,{...examples[1].frames[3],candles:[{...s.items[0],volume:99}]});
  expect(s.resync).toBe(true);
});
it('refuses duplicate snapshot candle keys rather than installing duplicate chart times', () => {
  let s=initialChartStream();
  const frames=examples[1].frames;
  s=reduceChartStream(s,{...frames[0],item_count:'2'});
  const candle=(frames[1] as unknown as {items:Record<string,unknown>[]}).items[0];
  s=reduceChartStream(s,{...frames[1],items:[candle,candle]});
  s=reduceChartStream(s,{...frames[2],item_count:'2'});
  expect(s.resync).toBe(true);
});
it('preserves null VWAP on zero-volume candle snapshots and replacements', () => {
  const [begin,chunk,end,change]=examples[1].frames;
  const initial=(chunk as unknown as {items:Record<string,unknown>[]}).items[0];
  const replacement=(change as unknown as {candles:Record<string,unknown>[]}).candles[0];
  let state=initialChartStream();
  state=reduceChartStream(state,begin);
  state=reduceChartStream(state,{...chunk,items:[{...initial,volume:0,vwap:null}]});
  state=reduceChartStream(state,end);
  expect(state.resync).toBe(false);
  expect(state.items[0]).toMatchObject({volume:0,vwap:null,tickCount:'1'});
  state=reduceChartStream(state,{...change,candles:[{...replacement,volume:0,vwap:null}]});
  expect(state.resync).toBe(false);
  expect(state.items[0]).toMatchObject({open:99,volume:0,vwap:null,tickCount:'2'});
  expect(state.cursor?.seq).toBe('9007199254740994');
});
it.each(['open','high','low','close','volume','vwap'])('preserves nullable candle %s while advancing snapshot and replacement cursors', field => {
  const [begin,chunk,end,change]=examples[1].frames;
  const initial=(chunk as unknown as {items:Record<string,unknown>[]}).items[0];
  const replacement=(change as unknown as {candles:Record<string,unknown>[]}).candles[0];
  let state=initialChartStream();
  state=reduceChartStream(state,begin);
  state=reduceChartStream(state,{...chunk,items:[{...initial,[field]:null}]});
  state=reduceChartStream(state,end);
  expect(state.resync).toBe(false);
  expect(state.items[0][field]).toBeNull();
  state=reduceChartStream(state,{...change,candles:[{...replacement,[field]:null}]});
  expect(state.resync).toBe(false);
  expect(state.items[0][field]).toBeNull();
  expect(state.cursor?.seq).toBe('9007199254740994');
  expect(reduceChartStream(state,{...change,candles:[{...replacement,[field]:null}]}).items).toEqual(state.items);
});
it('retains raw tick identities with null price and size through overlapping changes', () => {
  const [begin,chunk,end]=examples[0].frames.slice(1,4);
  const initial=(chunk as unknown as {items:Record<string,unknown>[]}).items[0];
  const change=examples[0].frames[5];
  const batch=(change as unknown as {batches:{ticks:Record<string,unknown>[]}[]}).batches[0];
  const frame={...change,batches:[{...batch,ticks:[{...batch.ticks[0],price:null,size:null}]}]};
  let state=initialChartStream();
  state=reduceChartStream(state,begin);
  state=reduceChartStream(state,{...chunk,items:[{...initial,price:null,size:null}]});
  state=reduceChartStream(state,end);
  state=reduceChartStream(state,frame);
  expect(state.resync).toBe(false);
  expect(state.cursor?.seq).toBe('9007199254740994');
  expect(state.items).toHaveLength(2);
  expect(state.items.every(item=>item.price===null&&item.size===null)).toBe(true);
  expect(reduceChartStream(state,frame).items).toEqual(state.items);
});
it.each([NaN,Infinity,'100',undefined])('rejects invalid non-null candle metric %s', value => {
  let state=reduceChartStream(initialChartStream(),examples[1].frames[0]);
  const chunk=examples[1].frames[1];
  const candle=(chunk as unknown as {items:Record<string,unknown>[]}).items[0];
  state=reduceChartStream(state,{...chunk,items:[{...candle,open:value}]});
  expect(state.resync).toBe(true);
});
it.each([
  ['price',NaN],['price',Infinity],['price','100'],['price',undefined],
  ['size',NaN],['size',Infinity],['size','2'],['size',undefined],
])('rejects invalid non-null raw tick %s=%s', (field,value) => {
  const chunk=examples[0].frames[2];
  const tick=(chunk as unknown as {items:Record<string,unknown>[]}).items[0];
  const state=reduceChartStream(initialChartStream(),examples[0].frames[1]);
  expect(reduceChartStream(state,{...chunk,items:[{...tick,[field]:value}]}).resync).toBe(true);
});
