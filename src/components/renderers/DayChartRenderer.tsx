// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import { useDayLogos } from "../../hooks/useDayLogos";
import { useDayCharts } from "../../hooks/useDayCharts";
import { dayLine, daySymbols, type DayTile } from "../../lib/dayChart";
import type { BackendConfig } from "../../lib/types";
import "./dayChart.css";

const price = (value: number | null) => value === null ? "—" : value.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
const signed = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${price(value)}`;
function timeLabel(time: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit",timeZone:timezone}).format(new Date(time));
}
function Tile({symbol,tile,nearby,logo}:{symbol:string;tile?:DayTile;nearby:boolean;logo?:string}) {
  const [failedLogo,setFailedLogo]=useState<string|null>(null);
  const line = tile ? dayLine(tile.points, tile.previous_close) : null;
  const tone = tile?.change === null || tile?.change === undefined || tile.change === 0 ? "neutral" : tile.change > 0 ? "up" : "down";
  return <>
    <div className="day-chart-heading"><span className="day-chart-logo" aria-hidden="true">{logo && failedLogo !== logo ? <img alt="" src={logo} onError={()=>setFailedLogo(logo)}/> : symbol.slice(0,2)}</span><div><strong>{symbol}</strong><span className="day-chart-name">{tile?.name ?? symbol}</span></div></div>
    {!tile ? <p className="day-chart-empty">{nearby ? "Loading session…" : "Scroll to load"}</p> : <>
      <div className="day-chart-price">{price(tile.price)}</div>
      <div className={`day-chart-change day-chart-${tone}`}>{signed(tile.change)} ({signed(tile.change_percent)}%)</div>
      {line?.path && nearby ? <svg viewBox="0 0 310 132" className={`day-chart-line day-chart-${tone}`} role="img" aria-label={`${symbol} intraday prices`}>
        {line.referenceY !== null ? <line x1="8" x2="262" y1={line.referenceY} y2={line.referenceY} className="day-chart-reference"/> : null}
        <path d={line.path} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/>
        {line.lastPoint ? <circle cx={line.lastPoint.x} cy={line.lastPoint.y} r="2.5" fill="currentColor"/> : null}
        <text x="268" y="16">{price(line.high)}</text><text x="268" y="104">{price(line.low)}</text>
        <text x="8" y="126">{timeLabel(tile.points[0].time,tile.session.timezone)}</text>
        <text x="262" y="126" textAnchor="end">{timeLabel(tile.points.at(-1)!.time,tile.session.timezone)}</text>
      </svg> : <p className="day-chart-empty">{tile.status === "error" || tile.status === "empty" || !line?.path ? `No day data${tile.error_code ? ` · ${tile.error_code}` : ""}` : "Scroll to view"}</p>}
      <div className="day-chart-session">{tile.session.date ?? "No session"} · {tile.session.status}</div>
      <div className="day-chart-status" title={tile.as_of ? `As of ${tile.as_of}` : undefined}>{tile.session.label} · {tile.source} · {tile.status}</div>
    </>}
  </>;
}

export function DayChartRenderer({backend,params,refreshKey=0}:{backend:BackendConfig;params:Record<string,string>;refreshKey?:number}) {
  const input=params.symbol ?? "";
  const parsed=useMemo(() => {try {return {symbols:daySymbols(input),error:null};} catch(e) {return {symbols:[],error:(e as Error).message};}},[input]);
  const {symbols}=parsed;
  const membership=JSON.stringify(symbols);
  const [strip,setStrip]=useState<HTMLDivElement|null>(null);
  const [view,setView]=useState<{membership:string;indexes:number[]}>({membership,indexes:[0,1,2]});
  const indexes=view.membership===membership ? view.indexes : [0,1,2];
  const nearby=indexes.flatMap((i)=>symbols[i] ? [symbols[i]] : []);
  const {tiles}=useDayCharts(backend,symbols,nearby,refreshKey);
  const logos=useDayLogos(backend,nearby.filter(symbol=>tiles[symbol]?.logo_path === `/symbol_logo?symbol=${encodeURIComponent(symbol)}`));
  useEffect(() => {
    if(!strip) return;
    strip.scrollLeft=0;
    const active=new Set<number>();
    const publish=()=>setView({membership,indexes:[...active].sort((a,b)=>a-b)});
    const measure=()=>{
      // Fallback for older webviews and an initial viewport before IO reports.
      const width=strip.clientWidth || 620;
      const start=Math.max(0,Math.floor(strip.scrollLeft/322)-1);
      const end=Math.min(symbols.length,Math.ceil((strip.scrollLeft+width)/322)+1);
      if(typeof IntersectionObserver === "undefined") {active.clear();for(let i=start;i<end;i++)active.add(i);publish();}
    };
    const onWheel=(event:WheelEvent)=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)){strip.scrollLeft+=event.deltaY;event.preventDefault();measure();}};
    strip.addEventListener("wheel",onWheel,{passive:false});
    strip.addEventListener("scroll",measure,{passive:true});
    const observer=typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries)=>{
      for(const entry of entries){const index=Number((entry.target as HTMLElement).dataset.dayIndex);if(entry.isIntersecting)active.add(index);else active.delete(index);}
      publish();
    },{root:strip,rootMargin:"0px 322px",threshold:0});
    strip.querySelectorAll("[data-day-index]").forEach((node)=>observer?.observe(node));
    const resize=typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(strip);measure();
    return ()=>{observer?.disconnect();resize?.disconnect();strip.removeEventListener("wheel",onWheel);strip.removeEventListener("scroll",measure);};
  },[strip,membership,symbols.length]);
  if(parsed.error) return <p className="empty-state">{parsed.error}</p>;
  if(!symbols.length) return <p className="empty-state">Choose symbols to chart.</p>;
  function nav(where:"first"|"back"|"forward"|"last") {
    if(!strip)return;
    strip.scrollLeft=where==="first"?0:where==="last"?strip.scrollWidth:strip.scrollLeft+(where==="back"?-1:1)*Math.max(322,Math.floor(strip.clientWidth/322)*322);
    strip.dispatchEvent(new Event("scroll"));
  }
  return <div className="day-chart">
    <div className="day-chart-strip" ref={setStrip} role="list" aria-label="Day charts">
      {symbols.map((symbol,index)=><article role="listitem" className="day-chart-tile" data-day-index={index} key={`${index}:${symbol}`}><Tile symbol={symbol} tile={tiles[symbol]} nearby={indexes.includes(index)} logo={logos[symbol]}/></article>)}
    </div>
    <div className="day-chart-footer"><span>Session snapshots · 15s refresh</span><div className="news-nav" role="group" aria-label="Scroll day charts">{([["first","Beginning","|◂"],["back","Page back","◂◂"],["forward","Page forward","▸▸"],["last","End","▸|"]] as const).map(([where,label,glyph])=><button type="button" key={where} aria-label={label} title={label} onClick={()=>nav(where)}>{glyph}</button>)}</div></div>
  </div>;
}
