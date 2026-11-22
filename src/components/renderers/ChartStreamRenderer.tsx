// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react';
import {useClosedSession} from '../../hooks/useClosedSession';
import { useChartStream } from '../../hooks/useChartStream';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import type { SocketStatus } from '../../hooks/useReconnectingSocket';
import type { BackendConfig, WidgetDef } from '../../lib/types';
import { mountCandleChart, type CandleChartHandle, TRADINGVIEW_CREDIT_LABEL, TRADINGVIEW_CREDIT_URL } from '../../lib/lwChart';
import { intervalSeconds } from '../../lib/liveChart';
import { openCredit } from './TradingViewRenderer';
import { ErrorState } from './ErrorState';

export function ChartStreamRenderer({widget,backend,params,refreshKey=0,onLive,onStatus}: {widget:WidgetDef;backend:BackendConfig;params:Record<string,string>;refreshKey?:number;onLive?:(at:number)=>void;onStatus?:(status:SocketStatus)=>void}) {
  const theme = useResolvedTheme();
  const symbol = (params.symbol ?? '').split(',')[0].trim().toUpperCase();
  const interval = params.interval || '1m';
  // An omitted start is a stable bounded lookback for this mounted view, never a changing subscription per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const start = useMemo(() => params.start || new Date(Date.now()-86400000).toISOString(), [params.start,symbol,interval]);
  const view = {symbol,mode:'candles',interval,start,max_items:2000,...(params.end ? {end:params.end}: {})};
  const closed=useClosedSession(backend,symbol,interval,widget.closedSessionHistory===true && !params.start && !params.end,refreshKey);
  const streaming=closed.mode==='stream'||closed.mode==='error';
  const {state,status} = useChartStream(backend,widget,{...view,symbol:streaming?symbol:''},refreshKey);
  const [element,setElement] = useState<HTMLDivElement|null>(null);
  const [chart,setChart] = useState<CandleChartHandle|null>(null);
  const [error,setError] = useState<string|null>(null);
  // Keep nullable accepted candles in the canonical model, and draw only complete numeric bars.
  const acceptedBars = useMemo(() => state.items.filter(i => i.key?.symbol===symbol && i.key?.interval===interval && ['open','high','low','close','volume'].every(k => typeof i[k] === 'number' && Number.isFinite(i[k])))
    .map(i=>({time:Date.parse(i.key.bucket_start)/1000,open:i.open,high:i.high,low:i.low,close:i.close,volume:i.volume})), [state.items,symbol,interval]);
  const bars=useMemo(()=>closed.mode==='closed'?closed.bars:closed.mode==='checking'?[]:acceptedBars,[closed.mode,closed.bars,acceptedBars]);
  const omitted = state.items.length - acceptedBars.length;
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current=theme; chart?.applyTheme(theme); },[theme,chart]);
  useEffect(() => {
    if (!element) return;
    let disposed=false;
    let handle:CandleChartHandle|undefined;
    void mountCandleChart(element,{theme:themeRef.current,colors:{},showVolume:true,wickWidth:2,barSeconds:intervalSeconds(interval)}).then(h=>{
      if (disposed) {h.dispose();return;} handle=h;setChart(h);
    }).catch(()=>setError('chart library failed to load'));
    return ()=>{disposed=true;handle?.dispose();setChart(null);};
  },[element,interval]);
  useEffect(()=>{
    if (!chart) return;
    // setData is the supported historical redraw: replacements may revise ANY retained bucket.
    chart.setBars(bars);
    if (streaming && state.cursor) onLive?.(Date.now());
  },[chart,bars,state.cursor,onLive,streaming]);
  useEffect(()=>{onStatus?.(streaming?status:'idle');},[status,onStatus,streaming]);
  useEffect(()=>()=>onStatus?.('idle'),[onStatus]);
  if (!symbol) return <p className="empty-state">Choose a symbol to chart.</p>;
  if (error) return <ErrorState message={error} onRetry={()=>setError(null)} />;
  return <div className="tv-chart" data-status={status}>
    {closed.mode==='closed'||closed.mode==='checking'?null:!state.cursor ? <p className="live-chart-note">Loading…</p> : state.items.length===0 ? <p className="live-chart-note">No bars for {symbol} yet.</p> : bars.length===0 ? <p className="live-chart-note">No plottable bars for {symbol} yet.</p> : omitted > 0 ? <p className="live-chart-note">{omitted} {omitted===1 ? "candle has" : "candles have"} missing prices or volume and {omitted===1 ? "is" : "are"} not plotted.</p> : null}
    <div className="tv-chart-plot" ref={setElement} data-testid="live-chart-plot" />
    {closed.mode==='checking'?<p className="live-chart-note" role="status">Loading latest trading session…</p>:closed.mode==='closed'?<p className="live-chart-note" role="status">{symbol} · {closed.date} · {closed.stale?'Last confirmed closed session':'Market closed'} · EODHD historical session · {bars.length} candles{closed.partial?' · partial history':''}{closed.error?` · ${closed.error}`:''}</p>:closed.mode==='error'?<p className="live-chart-note" role="status">{closed.error}</p>:null}
    <a className="tv-credit" href={TRADINGVIEW_CREDIT_URL} onClick={openCredit}>{TRADINGVIEW_CREDIT_LABEL}</a>
  </div>;
}
