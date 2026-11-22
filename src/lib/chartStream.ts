// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
export type Cursor = { epoch: string; seq: string };
// Wire dictionaries are validated at the reducer boundary before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartItem = { [key: string]: any };
export type ChartStreamState = { items: ChartItem[]; cursor?: Cursor; resync: boolean; generation?: string; view?: ChartItem; view_key?: string; view_floor?: ChartItem; status_seq: string; staged?: ChartItem };
export const initialChartStream = (): ChartStreamState => ({ items: [], resync: false, status_seq: '0' });
const seq = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid sequence');
  const n = BigInt(value);
  if (n > 9223372036854775807n) throw new Error('Sequence overflow');
  return n;
};
const reset = (s: ChartStreamState): ChartStreamState => ({ ...s, cursor: undefined, staged: undefined, resync: true });
const candleKey = (k: ChartItem) => JSON.stringify([k.symbol,k.interval,k.bucket_start]);
const key = (i: ChartItem) => i.key ? candleKey(i.key) : `${i.tick_id.epoch}:${i.tick_id.seq}`;
const compare = (a: ChartItem, b: ChartItem) => {
  const at = a.key?.bucket_start ?? a.time;
  const bt = b.key?.bucket_start ?? b.time;
  return at < bt ? -1 : at > bt ? 1 : a.tick_id ? (seq(a.tick_id.seq) < seq(b.tick_id.seq) ? -1 : 1) : 0;
};
const utc = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{9}Z$/.test(value) && Number.isFinite(Date.parse(value));
const finiteOrNull = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value));
const orderedWhenPresent = (low: number | null, high: number | null): boolean => low === null || high === null || low <= high;
function validItem(item: ChartItem, view: ChartItem, cursor: Cursor): boolean {
  const revision = item.revision ?? item.tick_id;
  if (!revision || revision.epoch !== cursor.epoch || seq(revision.seq) > seq(cursor.seq)) return false;
  if (view.mode === 'candles') return item.key?.symbol === view.symbol && item.key?.interval === view.interval && utc(item.key.bucket_start)
    && ['open','high','low','close','volume','vwap'].every(k => finiteOrNull(item[k]))
    && (item.volume === null || item.volume >= 0)
    && orderedWhenPresent(item.low,item.open) && orderedWhenPresent(item.low,item.close)
    && orderedWhenPresent(item.open,item.high) && orderedWhenPresent(item.close,item.high) && orderedWhenPresent(item.low,item.high)
    && seq(item.tickCount) >= 0n && ['open','closed'].includes(item.status);
  return item.sym === view.symbol && utc(item.time) && finiteOrNull(item.price) && finiteOrNull(item.size) && (item.size === null || item.size >= 0);
}
function bounded(s: ChartStreamState, items: ChartItem[]): ChartStreamState {
  const floor = s.view_floor;
  items = items.filter(i => !floor || (i.key ? i.key.bucket_start >= floor.bucket_start : i.time > floor.time || (i.time === floor.time && (floor.seq === null || seq(i.tick_id.seq) >= seq(floor.seq))))).sort(compare);
  const cap = Math.min(s.view?.max_items ?? 2000, s.view?.mode === 'ticks' ? 10000 : 2000);
  if (items.length > cap) {
    items = items.slice(-cap);
    const first = items[0];
    s = { ...s, view_floor: first.key ? { kind: 'candle', bucket_start: first.key.bucket_start } : { kind: 'tick', time: first.time, seq: first.tick_id.seq } };
  }
  return { ...s, items };
}
export function reduceChartStream(state: ChartStreamState, message: unknown): ChartStreamState {
  try {
    const f = message as ChartItem;
    if (!f || f.protocol_version !== 1) return reset(state);
    if (f.type === 'snapshot_begin') {
      seq(f.cursor.seq); seq(f.item_count);
      if (typeof f.generation !== 'string' || typeof f.cursor.epoch !== 'string' || !['candles','ticks'].includes(f.view.mode) || typeof f.view.symbol !== 'string') return reset(state);
      if (!Number.isInteger(f.view.max_items) || f.view.max_items < 1 || seq(f.item_count) > BigInt(f.view.mode === 'ticks' ? 10000 : 2000)) return reset(state);
      return { ...state, staged: { ...f, items: [], chunks: 0, bytes: JSON.stringify(f).length }, resync: false };
    }
    const stage = state.staged;
    if (f.type === 'snapshot_chunk') {
      if (!stage || f.generation !== stage.generation || seq(f.chunk_index) !== BigInt(stage.chunks)) return reset(state);
      if (!Array.isArray(f.items) || !f.items.every(i => validItem(i,stage.view,stage.cursor))) return reset(state);
      const bytes = stage.bytes + new TextEncoder().encode(JSON.stringify(f)).length;
      if (bytes > 8 * 1024 * 1024 || stage.items.length + f.items.length > Number(stage.item_count)) return reset(state);
      return { ...state, staged: { ...stage, bytes, chunks: stage.chunks + 1, items: [...stage.items, ...f.items] } };
    }
    if (f.type === 'snapshot_end') {
      if (!stage || f.generation !== stage.generation || seq(f.chunk_count) !== BigInt(stage.chunks) || seq(f.item_count) !== BigInt(stage.items.length) || (f.cursor.epoch !== stage.cursor.epoch || seq(f.cursor.seq) !== seq(stage.cursor.seq))) return reset(state);
      if (new Set(stage.items.map(key)).size !== stage.items.length) return reset(state);
      return bounded({ ...initialChartStream(), generation: f.generation, cursor: f.cursor, view: stage.view, view_key: stage.view_key, view_floor: stage.view_floor }, stage.items);
    }
    if (f.type !== 'resumed' && f.generation !== state.generation) return state;
    if (f.type === 'resync_required') return reset(state);
    if (f.type === 'candle_status' || f.type === 'resumed') {
      if (f.type === 'resumed' && (!state.cursor || f.cursor.epoch !== state.cursor.epoch || seq(f.cursor.seq) !== seq(state.cursor.seq) || f.view_key !== state.view_key)) return reset(state);
      if (f.type === 'candle_status' && seq(f.status_seq) <= seq(state.status_seq)) return state;
      if (!Array.isArray(f.statuses) || f.statuses.some((x: ChartItem) => !['open','closed'].includes(x.status))) return reset(state);
      const statuses = new Map(f.statuses.map((x: ChartItem) => [candleKey(x.key), x.status]));
      if (f.type === 'resumed' && state.view?.mode === 'candles' && state.items.some(i => !statuses.has(key(i)))) return reset(state);
      seq(f.status_seq);
      return { ...state, generation: f.generation, status_seq: f.status_seq, items: state.items.map(i => statuses.has(key(i)) ? { ...i, status: statuses.get(key(i)) } : i) };
    }
    if (f.type !== 'ticks' && f.type !== 'candles') return state;
    if (!state.cursor || stage || f.from_cursor.epoch !== state.cursor.epoch || f.through_cursor.epoch !== state.cursor.epoch || seq(f.from_cursor.seq) > seq(state.cursor.seq) || seq(f.through_cursor.seq) < seq(f.from_cursor.seq)) return reset(state);
    const replayed = seq(f.through_cursor.seq) <= seq(state.cursor.seq);
    const items = new Map(state.items.map(i => [key(i), i]));
    const changes = f.type === 'candles' ? f.candles : f.batches.flatMap((b: ChartItem) => b.ticks);
    for (const item of changes) {
      if (!validItem(item,state.view!,f.through_cursor)) return reset(state);
      const revision = item.revision ?? item.tick_id;
      if (revision.epoch !== state.cursor.epoch || seq(revision.seq) > seq(f.through_cursor.seq)) return reset(state);
      const previous = items.get(key(item));
      if (item.key && previous && seq(revision.seq) === seq(previous.revision.seq) && ['open','high','low','close','volume','vwap','tickCount'].some(k => item[k] !== previous[k])) return reset(state);
      if (item.key ? !previous || seq(revision.seq) > seq(previous.revision.seq) : seq(revision.seq) > seq(state.cursor.seq)) items.set(key(item), item);
    }
    if (replayed) return state;
    return bounded({ ...state, cursor: f.through_cursor }, [...items.values()]);
  } catch { return reset(state); }
}
