// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { buildWidgetWsUrl, ticketedWsUrl } from '../lib/dataClient';
import { initialChartStream, reduceChartStream, type ChartItem } from '../lib/chartStream';
import type { BackendConfig, WidgetDef } from '../lib/types';
import type { SocketStatus } from './useReconnectingSocket';

/** Owns one bounded view. No provider/q credentials enter the wire protocol. */
export function useChartStream(backend: BackendConfig, widget: WidgetDef, view: ChartItem, refreshKey: number) {
  const [state, setState] = useState(initialChartStream);
  const [status, setStatus] = useState<SocketStatus>('idle');
  const viewJson = JSON.stringify(view);
  useEffect(() => {
    const url = buildWidgetWsUrl(backend, widget);
    if (!url || !view.symbol) return;
    let model = initialChartStream();
    setState(model);
    let disposed = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingAck: ChartItem | undefined;
    let attempts = 0;
    let request = 0;
    const control = (type: string, data: ChartItem = {}) => {
      const payload = JSON.stringify({ protocol_version: 1, subscription_id: 'chart', request_id: `r${++request}`, type, ...data });
      if (socket?.readyState !== WebSocket.OPEN || new TextEncoder().encode(payload).length > 64 * 1024) return false;
      socket.send(payload);
      return true;
    };
    const subscribe = () => control('subscribe', { view: JSON.parse(viewJson) });
    const acknowledge = (data: ChartItem) => {
      pendingAck = data;
      if (ackTimer !== undefined) return;
      ackTimer = setTimeout(() => {
        ackTimer = undefined;
        if (pendingAck) control('ack', pendingAck);
        pendingAck = undefined;
      }, 250);
    };
    const connect = async () => {
      if (disposed) return;
      setStatus(attempts ? 'reconnecting' : 'connecting');
      const target = await ticketedWsUrl(backend, url);
      if (disposed) return;
      const ws = new WebSocket(target);
      socket = ws;
      let ended = false;
      let opened = 0;
      const retry = () => {
        if (disposed || ended || socket !== ws) return;
        ended = true;
        clearTimeout(watchdog); clearTimeout(ackTimer); ackTimer = undefined; pendingAck = undefined;
        ws.close();
        model = { ...model, staged: undefined };
        if (Date.now() - opened >= 30000 && opened) attempts = 0;
        const delay = Math.min(15000, 500 * 2 ** Math.min(attempts++, 5)) * (0.8 + Math.random() * 0.4);
        setStatus('reconnecting');
        timer = setTimeout(() => void connect(), delay);
      };
      const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(retry, 15000); };
      ws.onopen = () => {
        if (disposed || ended) return;
        opened = Date.now(); alive(); setStatus('live');
        if (model.cursor && model.view_key && !model.resync) {
          const resumed = control('resume', { view: JSON.parse(viewJson), checkpoint: {
          cursor: model.cursor, view_key: model.view_key, view_floor: model.view_floor,
          ...(model.view?.mode === 'candles' ? { retained_candle_keys: model.items.map(i => i.key) } : {}),
        } });
          // A large retained-key checkpoint must not exceed the gateway's control budget.
          if (!resumed) subscribe();
        } else subscribe();
      };
      ws.onmessage = event => {
        if (disposed || ended || socket !== ws) return;
        try {
          const raw = String(event.data);
          const bytes = new TextEncoder().encode(raw).length;
          // The logical-response budget covers change frames; snapshot chunks have a smaller cap.
          if (bytes > 8 * 1024 * 1024) { retry(); return; }
          const frame = JSON.parse(raw);
          if (frame.type === 'snapshot_chunk' && bytes > 512 * 1024) { retry(); return; }
          if (frame.subscription_id !== 'chart') return;
          alive();
          if (frame.protocol_version !== 1) { retry(); return; }
          if (frame.type === 'heartbeat') { if (frame.generation === model.generation) control('pong', { generation: frame.generation }); return; }
          if (frame.type === 'error') { retry(); return; }
          if (frame.type === 'snapshot_begin' && (frame.view?.symbol !== view.symbol || frame.view?.mode !== view.mode || frame.view?.interval !== view.interval)) { retry(); return; }
          const next = reduceChartStream(model, frame);
          model = next;
          setState(next);
          if (next.resync) { clearTimeout(ackTimer); ackTimer = undefined; pendingAck = undefined; model = initialChartStream(); subscribe(); return; }
          if (next.cursor && ['snapshot_end', 'ticks', 'candles', 'resumed'].includes(frame.type)) acknowledge({generation:next.generation,cursor:next.cursor});
        } catch { retry(); }
      };
      ws.onclose = retry;
      ws.onerror = retry;
    };
    void connect();
    return () => {
      if (model.generation) control('unsubscribe', { generation: model.generation });
      disposed = true;
      clearTimeout(timer); clearTimeout(watchdog); clearTimeout(ackTimer); socket?.close();
    };
    // The normalized view string bounds changes; ordinary render identities do not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, widget, viewJson, refreshKey]);
  return { state, status };
}
