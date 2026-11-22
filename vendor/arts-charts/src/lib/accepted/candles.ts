// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under BUSL-1.1.
// Original implementation of the Apache chart-stream v1 contract; no external reducer source.
import type { Candle } from '../../hooks/useTickCache';

export type Cursor = { epoch: string; seq: string };
export type CandleView = { symbol: string; mode: 'candles'; interval: string; start: string; end?: string; max_items: number };
type Key = { symbol: string; interval: string; bucket_start: string };
export type AcceptedCandle = { key: Key; revision: Cursor; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null; vwap: number | null; tickCount: string; status: 'open' | 'closed' };
type Floor = { kind: 'candle'; bucket_start: string };
type ObjectValue = Record<string, unknown>;
const LIMIT = 8 * 1024 * 1024;
export const INTERVALS: Record<string, number> = { '1s': 1, '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400 };
const encoder = new TextEncoder();
export const byteLength = (text: string) => encoder.encode(text).byteLength;
function demand(ok: unknown, reason = 'Invalid accepted chart protocol'): asserts ok { if (!ok) throw new Error(reason); }
function object(value: unknown): ObjectValue { demand(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as ObjectValue; }
function text(value: unknown, max = 64): string { demand(typeof value === 'string' && value.length > 0 && value.length <= max); return value; }
export function sequence(value: unknown): bigint { demand(typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)); const out = BigInt(value); demand(out <= 9223372036854775807n); return out; }
function cursor(value: unknown): Cursor { const v=object(value); text(v.epoch); sequence(v.seq); demand(Object.keys(v).length === 2); return v as Cursor; }
export function utc9(value: unknown): string {
  demand(typeof value === 'string');
  const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);
  demand(match); const millis=Date.parse(match[1]+'Z'); demand(Number.isFinite(millis) && new Date(millis).toISOString().slice(0,19) === match[1]);
  return `${match[1]}.${(match[2] ?? '').padEnd(9,'0')}Z`;
}
export function normalizeView(value: CandleView): CandleView {
  demand(/^[A-Z0-9][A-Z0-9._^=-]{0,63}$/.test(value.symbol)); demand(value.mode === 'candles' && value.interval in INTERVALS);
  demand(Number.isInteger(value.max_items) && value.max_items >= 1 && value.max_items <= 2000);
  const out: CandleView={symbol:value.symbol, mode:'candles', interval:value.interval, start:utc9(value.start), max_items:value.max_items};
  if (value.end !== undefined) { out.end=utc9(value.end); demand(out.end>out.start); }
  return out;
}
function canonical(value: CandleView) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)))); }
export async function viewKey(view: CandleView) { const hash=await crypto.subtle.digest('SHA-256',encoder.encode(canonical(view))); return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export function parseFrame(raw: unknown): ObjectValue {
  demand(typeof raw === 'string' && byteLength(raw) <= LIMIT);
  const frame=object(JSON.parse(raw)); demand(frame.protocol_version === 1); text(frame.type,32); text(frame.subscription_id);
  if (frame.type === 'snapshot_chunk') demand(byteLength(raw) <= 512*1024);
  return frame;
}
function key(value: unknown, view: CandleView): Key {
  const v=object(value); demand(v.symbol === view.symbol && v.interval === view.interval); const stamp=utc9(v.bucket_start);
  demand(stamp === v.bucket_start); demand(Object.keys(v).length === 3);
  const millis=Date.parse(stamp); demand(stamp.slice(20,29)==='000000000' && Math.floor(millis/1000) % INTERVALS[view.interval] === 0);
  demand(stamp < (view.end ?? '9999-12-31T23:59:59.999999999Z') && millis/1000+INTERVALS[view.interval]>Date.parse(view.start)/1000);
  return {symbol:view.symbol,interval:view.interval,bucket_start:stamp};
}
function candle(value: unknown, view: CandleView): AcceptedCandle {
  const v=object(value); key(v.key,view); cursor(v.revision); sequence(v.tickCount); demand(v.status === 'open' || v.status === 'closed');
  for (const name of ['open','high','low','close','volume','vwap']) demand(v[name] === null || (typeof v[name] === 'number' && Number.isFinite(v[name])));
  demand(Object.keys(v).length === 10); return v as AcceptedCandle;
}
function numbers(row: AcceptedCandle) { return JSON.stringify([row.key,row.revision,row.open,row.high,row.low,row.close,row.volume,row.vwap,row.tickCount]); }
function same(a: Cursor,b: Cursor) { return a.epoch===b.epoch && a.seq===b.seq; }
function floor(value: unknown): Floor { const v=object(value); demand(v.kind === 'candle' && Object.keys(v).length === 2); demand(utc9(v.bucket_start) === v.bucket_start); return v as Floor; }
function coverage(value: unknown): boolean { const v=object(value); demand(typeof v.complete === 'boolean'); for (const name of ['available_from','complete_from','available_to']) if (v[name] !== null) utc9(v[name]); return v.complete; }

type Stage = { generation: string; cursor: Cursor; floor: Floor; expected: bigint; chunks: bigint; bytes: number; rows: Map<string, AcceptedCandle>; complete: boolean; truncated: boolean };
/** A candle-only subscription. All public mutations commit after complete validation. */
export class AcceptedCandles {
  readonly view: CandleView;
  cursor: Cursor | null = null;
  generation: string | null = null;
  floor: Floor | null = null;
  complete = false;
  truncated = false;
  private rows = new Map<string,AcceptedCandle>();
  private stage: Stage | null = null;
  private statusSequence = -1n;
  private admitted = false;
  constructor(view: CandleView, readonly viewKey: string, readonly subscriptionId: string) { this.view=normalizeView(view); }
  get candles(): Candle[] {
    return [...this.rows.values()].filter(row => [row.open,row.high,row.low,row.close].every(x => x !== null)).map(row => ({time:Math.floor(Date.parse(row.key.bucket_start)/1000),open:row.open!,high:row.high!,low:row.low!,close:row.close!,volume:row.volume ?? 0}));
  }
  get retainedKeys() { return [...this.rows.values()].map(row => row.key); }
  get statuses() { return [...this.rows.values()].map(row => ({key:row.key,status:row.status})); }
  /** New transport admission keeps the last complete view, discards incomplete staging. */
  admit() { this.generation=null; this.stage=null; this.statusSequence=-1n; this.admitted=false; }
  reset() { this.admit(); this.cursor=null; this.floor=null; }
  checkpoint() { return this.cursor && this.floor ? {cursor:this.cursor,view_key:this.viewKey,view_floor:this.floor,retained_candle_keys:this.retainedKeys} : null; }
  private trim(rows: Map<string,AcceptedCandle>, lower: Floor): {rows:Map<string,AcceptedCandle>;floor:Floor} {
    const items=[...rows.values()].filter(row=>row.key.bucket_start>=lower.bucket_start).sort((a,b)=>a.key.bucket_start.localeCompare(b.key.bucket_start));
    const removed=items.length>this.view.max_items;
    const kept=items.slice(-this.view.max_items);
    return {rows:new Map(kept.map(row=>[row.key.bucket_start,row])),floor:removed ? {kind:'candle',bucket_start:kept[0].key.bucket_start} : lower};
  }
  private statusesAt(value: unknown, target: Map<string,AcceptedCandle>, baseline: boolean): Map<string,AcceptedCandle> {
    demand(Array.isArray(value) && value.length<=2000); const next=new Map(target); const seen=new Set<string>();
    for (const entry of value) { const item=object(entry), k=key(item.key,this.view); demand(item.status==='open'||item.status==='closed'); demand(!seen.has(k.bucket_start)); seen.add(k.bucket_start); const old=next.get(k.bucket_start); demand(old); next.set(k.bucket_start,{...old,status:item.status}); }
    if (baseline) demand(seen.size===target.size); return next;
  }
  receive(input: unknown): 'data' | 'status' | 'staged' | 'heartbeat' | 'reset' | 'ignored' {
    const f=object(input); demand(f.protocol_version===1 && f.subscription_id===this.subscriptionId);
    const kind=text(f.type,32);
    if (kind==='error' || kind==='resync_required') { if(this.generation && f.generation!==this.generation)return 'ignored'; this.reset(); return 'reset'; }
    const gen=text(f.generation);
    if (kind==='snapshot_begin') {
      demand(!this.admitted && this.stage===null); demand(f.view_key===this.viewKey && canonical(normalizeView(f.view as CandleView))===canonical(this.view));
      const h=cursor(f.cursor), lower=floor(f.view_floor), expected=sequence(f.item_count); demand(expected<=BigInt(this.view.max_items)); demand(typeof f.truncated==='boolean');
      this.stage={generation:gen,cursor:h,floor:lower,expected,chunks:0n,bytes:byteLength(JSON.stringify(f)),rows:new Map(),complete:coverage(f.coverage),truncated:f.truncated};
      this.generation=gen; return 'staged';
    }
    if (kind==='resumed') {
      demand(!this.admitted && this.stage===null && this.cursor && this.floor); demand(f.view_key===this.viewKey && same(cursor(f.cursor),this.cursor));
      demand(canonical(normalizeView(f.view as CandleView))===canonical(this.view) && JSON.stringify(floor(f.view_floor))===JSON.stringify(this.floor));
      const statuses=this.statusesAt(f.statuses,this.rows,true); this.statusSequence=sequence(f.status_seq); this.rows=statuses; this.generation=gen; this.admitted=true; return 'status';
    }
    if (gen!==this.generation) return 'ignored';
    if (kind==='snapshot_chunk') {
      const stage=this.stage; demand(stage && sequence(f.chunk_index)===stage.chunks && Array.isArray(f.items));
      const bytes=stage.bytes+byteLength(JSON.stringify(f)); demand(bytes<=LIMIT && stage.rows.size+f.items.length<=this.view.max_items);
      const rows=new Map(stage.rows);
      for (const item of f.items) { const row=candle(item,this.view); demand(row.revision.epoch===stage.cursor.epoch && sequence(row.revision.seq)===sequence(stage.cursor.seq)); demand(row.key.bucket_start>=stage.floor.bucket_start && !rows.has(row.key.bucket_start)); rows.set(row.key.bucket_start,row); }
      stage.rows=rows; stage.chunks++; stage.bytes=bytes; return 'staged';
    }
    if (kind==='snapshot_end') {
      const stage=this.stage; demand(stage && same(cursor(f.cursor),stage.cursor)); demand(sequence(f.chunk_count)===stage.chunks && sequence(f.item_count)===stage.expected && BigInt(stage.rows.size)===stage.expected);
      demand(stage.bytes+byteLength(JSON.stringify(f))<=LIMIT); const trimmed=this.trim(stage.rows,stage.floor);
      this.rows=trimmed.rows; this.floor=trimmed.floor; this.cursor=stage.cursor; this.complete=stage.complete; this.truncated=stage.truncated; this.stage=null; this.admitted=true; return 'data';
    }
    demand(this.admitted && this.cursor && this.floor);
    if (kind==='heartbeat') { const high=cursor(f.high_cursor); demand(high.epoch===this.cursor.epoch && sequence(high.seq)>=sequence(this.cursor.seq)); return 'heartbeat'; }
    if (kind==='candle_status') { const next=sequence(f.status_seq); if(next<=this.statusSequence) return 'ignored'; const rows=this.statusesAt(f.statuses,this.rows,false); this.rows=rows; this.statusSequence=next; return 'status'; }
    demand(kind==='candles'); const from=cursor(f.from_cursor),through=cursor(f.through_cursor), current=this.cursor;
    demand(from.epoch===current.epoch && through.epoch===current.epoch && sequence(from.seq)<=sequence(current.seq) && sequence(through.seq)>=sequence(from.seq));
    demand(Array.isArray(f.candles) && f.candles.length<=2000);
    const rows=new Map(this.rows);
    for (const item of f.candles) {
      const row=candle(item,this.view); demand(row.revision.epoch===through.epoch && sequence(row.revision.seq)===sequence(through.seq));
      if (row.key.bucket_start<this.floor.bucket_start) continue;
      const old=rows.get(row.key.bucket_start);
      if (old && sequence(row.revision.seq)===sequence(old.revision.seq)) demand(numbers(old)===numbers(row),'Conflicting accepted candle revision');
      if (!old || sequence(row.revision.seq)>sequence(old.revision.seq)) rows.set(row.key.bucket_start,row);
    }
    const trimmed=this.trim(rows,this.floor); this.rows=trimmed.rows; this.floor=trimmed.floor;
    if (sequence(through.seq)>sequence(current.seq)) this.cursor=through;
    return 'data';
  }
}
