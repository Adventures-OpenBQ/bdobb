// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {startDragEdgeScroll} from "../../lib/dragEdgeScroll";
import {useDayQuotes, type DayQuote} from "../../hooks/useDayQuotes";
import { useDayLogos } from "../../hooks/useDayLogos";
import { useDayCharts } from "../../hooks/useDayCharts";
import { dayLine, daySymbols, dayLayout, dayScale, type DayTile } from "../../lib/dayChart";
import type { BackendConfig } from "../../lib/types";
import "./dayChart.css";

const price = (value: number | null) => value === null ? "—" : value.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
const signed = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${price(value)}`;
function timeLabel(time: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit",timeZone:timezone}).format(new Date(time));
}
function Tile({symbol,tile,nearby,logo,scale,quote}:{symbol:string;tile?:DayTile;nearby:boolean;logo?:string;scale:string;quote?:DayQuote}) {
  const [hoverTime,setHoverTime]=useState<string|null>(null);
  const [failedLogo,setFailedLogo]=useState<string|null>(null);
  const scaled = useMemo(()=>tile ? dayScale(tile.points,tile.chart_previous_close===undefined?tile.previous_close:tile.chart_previous_close,scale) : null,[tile,scale]);
  const baseline=tile?.chart_previous_close===undefined?tile?.previous_close:tile.chart_previous_close;
  const plotSessions=useMemo(()=>tile?.sessions?.map(s=>({...s,previous_close:scale==="percent"?typeof s.previous_close==="number" && baseline ? (s.previous_close-baseline)/baseline*100:null:s.previous_close})),[tile,scale,baseline]);
  const line = useMemo(()=>scaled ? dayLine(scaled.points, scaled.reference,plotSessions) : null,[scaled,plotSessions]);
  const hovered=line?.samples.find(sample=>tile?.points[sample.index]?.time===hoverTime);
  const hoverPoint=hovered?tile?.points[hovered.index]:undefined;
  const hoverPercent=hoverPoint?.value!==null && hoverPoint?.value!==undefined && baseline ? (hoverPoint.value-baseline)/baseline*100:null;
  const pick=(x:number)=>{
    const nearest=line?.samples.reduce((best,p)=>Math.abs(p.x-x)<Math.abs(best.x-x)?p:best,line.samples[0]);
    if(nearest)setHoverTime(tile?.points[nearest.index].time??null);
  };
  const axisLabel=(v:number|null)=>`${price(v)}${scale==="percent" ? "%" : ""}`;
  const current=quote && (!tile?.as_of || quote.at >= Date.parse(tile.as_of)) ? quote : tile;
  const tone = current?.change === null || current?.change === undefined || current.change === 0 ? "neutral" : current.change > 0 ? "up" : "down";
  return <>
    <div className="day-chart-top"><div className="day-chart-heading"><span className="day-chart-logo" aria-hidden="true">{logo && failedLogo !== logo ? <img alt="" src={logo} onError={()=>setFailedLogo(logo)}/> : symbol.slice(0,2)}</span><div><strong>{symbol}</strong><span className="day-chart-name">{tile?.name ?? symbol}</span></div></div>{tile ? <div className="day-chart-quote"><div className="day-chart-price">{price(current?.price??null)}</div><div className={`day-chart-change day-chart-${tone}`}>{signed(current?.change??null)} ({signed(current?.change_percent??null)}%)</div></div> : null}</div>
    {!tile ? <p className="day-chart-empty">{nearby ? "Loading session…" : "Scroll to load"}</p> : <>
      {line?.path && nearby ? <div className="day-chart-plot"><svg preserveAspectRatio="none" viewBox="0 0 274 112" className={`day-chart-line day-chart-${tone}`} role="img" aria-label={`${symbol} intraday prices`} tabIndex={0}
        onPointerMove={event=>{const bounds=event.currentTarget.getBoundingClientRect();if(bounds.width)pick((event.clientX-bounds.left)/bounds.width*274);}}
        onPointerLeave={()=>setHoverTime(null)} onBlur={()=>setHoverTime(null)}
        onFocus={()=>{if(!hoverTime)pick(4);}}
        onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End","Escape"].includes(event.key))return;event.preventDefault();if(event.key==="Escape"){setHoverTime(null);return;}const samples=line.samples;const index=samples.findIndex(p=>p.index===hovered?.index);const next=event.key==="Home"?0:event.key==="End"?samples.length-1:Math.max(0,Math.min(samples.length-1,index+(event.key==="ArrowRight"?1:-1)));setHoverTime(tile.points[samples[next].index].time);}}>
        {line.references.map((r,i)=><line key={i} x1={r.x1} x2={r.x2} y1={r.y} y2={r.y} className="day-chart-reference"/>)}
        {line.dividers.map(x=><line key={x} x1={x} x2={x} y1="4" y2="108" className="day-chart-divider"/>)}
        {hovered ? <><line x1={hovered.x} x2={hovered.x} y1="0" y2="112" className="day-chart-crosshair"/><line x1="0" x2="274" y1={hovered.y} y2={hovered.y} className="day-chart-crosshair"/></>:null}
        <path d={line.path} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke"/>
        {line.lastPoint ? <circle cx={line.lastPoint.x} cy={line.lastPoint.y} r="0.01" fill="currentColor" stroke="currentColor" strokeWidth="5" vectorEffect="non-scaling-stroke"/> : null}
      </svg>{hovered && hoverPoint ? <div role="tooltip" className="day-chart-tooltip"><strong>{symbol}</strong><div>{new Intl.DateTimeFormat(undefined,{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:tile.session.timezone,timeZoneName:"short"}).format(new Date(hoverPoint.time))}</div><div>Price {price(hoverPoint.value)} · Change {hoverPercent===null?"—":`${signed(hoverPercent)}%`}</div></div>:null}<span className="day-chart-axis-high">{axisLabel(line.high)}</span><span className="day-chart-axis-low">{axisLabel(line.low)}</span>
      <span className="day-chart-time-first">{(tile.sessions?.length??0)>1 ? tile.sessions?.[0].date : timeLabel(tile.points[0].time,tile.session.timezone)}</span>
      <span className="day-chart-time-last">{(tile.sessions?.length??0)>1 ? tile.session.date : timeLabel(tile.points.at(-1)!.time,tile.session.timezone)}</span></div> : <p className="day-chart-empty">{scaled?.available===false ? "Previous close unavailable for % scale" : tile.status === "error" || tile.status === "empty" || !line?.path ? `No day data${tile.error_code ? ` · ${tile.error_code}` : ""}` : "Scroll to view"}</p>}

    </>}
  </>;
}

export function DayChartRenderer({backend,params,refreshKey=0,onSnapshot,onSelectSymbol,onReorder,selectionError,footerControls}:{backend:BackendConfig;params:Record<string,string>;refreshKey?:number;onSnapshot?:(at:number|null)=>void;onSelectSymbol?:(symbol:string)=>void;onReorder?:(symbols:string)=>void;selectionError?:string;footerControls?:ReactNode}) {
  const input=params.symbol ?? "";
  const parsed=useMemo(() => {try {return {symbols:daySymbols(input),error:null};} catch(e) {return {symbols:[],error:(e as Error).message};}},[input]);
  const {symbols}=parsed;
  const drag=useRef<{index:number;input:string;pointerId:number;x:number;y:number;currentX:number;currentY:number;active:boolean}|null>(null);
  const suppressClick=useRef(false);
  const edgeScroll=useRef<(()=>void)|null>(null);
  const stopEdgeScroll=()=>{edgeScroll.current?.();edgeScroll.current=null;};
  const pendingFocus=useRef<{membership:string;index:number}|null>(null);
  const previousMembers=useRef<string|null>(null);
  const [dropTarget,setDropTarget]=useState<number|null>(null);
  const move=(from:number,to:number,keyboard=false)=>{
    if(!onReorder||from===to||from<0||to<0||from>=symbols.length||to>=symbols.length)return;
    const next=[...symbols];next.splice(to,0,next.splice(from,1)[0]);if(keyboard)pendingFocus.current={membership:JSON.stringify(next),index:to};onReorder(next.join(","));
  };
  const layout=useMemo(()=>{try{return {...dayLayout(params.rows??"1",params.columns??"",symbols.length),error:null};}catch(e){return {rows:1,columns:null,axis:"horizontal" as const,error:(e as Error).message};}},[params.rows,params.columns,symbols.length]);
  const scale=params.scale==="percent"?"percent":"price";
  const [size,setSize]=useState({width:620,height:260});
  const membership=JSON.stringify(symbols);
  const [strip,setStrip]=useState<HTMLDivElement|null>(null);
  useEffect(()=>{setDropTarget(null);return ()=>{edgeScroll.current?.();edgeScroll.current=null;drag.current=null;};},[strip,input,layout.axis,layout.rows,layout.columns]);
  const [view,setView]=useState<{membership:string;indexes:number[]}>({membership,indexes:[0,1,2]});
  const indexes=view.membership===membership ? view.indexes : [0,1,2];
  const nearby=indexes.flatMap((i)=>symbols[i] ? [symbols[i]] : []);
  const {tiles,fetchedAt}=useDayCharts(backend,symbols,nearby,refreshKey,params.days??"1");
  useEffect(()=>{onSnapshot?.(fetchedAt);},[fetchedAt,onSnapshot]);
  const {quotes,status:quoteStatus}=useDayQuotes(backend,nearby.filter(symbol=>tiles[symbol]?.status!=="error" && !!tiles[symbol]));
  const loaded=Object.values(tiles);
  const latestQuote=Math.max(0,...Object.values(quotes).map(q=>q.at));
  const sessionDates=[...new Set(loaded.flatMap(t=>t.sessions?.length?t.sessions.map(s=>s.date).filter(Boolean):[t.session.date]).filter(Boolean))].sort();
  const sessionStatuses=[...new Set(loaded.filter(t=>t.status!=="error").map(t=>`${t.session.label}: ${t.session.status}`))].join(" · ");
  const dateRange=sessionDates.length>1?`${sessionDates[0]} – ${sessionDates.at(-1)}`:sessionDates[0]??"";
  const sourceLabel=["EODHD",...(loaded.some(t=>t.source.includes("kdb ticks"))?["recorded ticks"]:[]),...(loaded.some(t=>t.source.includes("coinbase"))?["Coinbase backfill"]:[])].join(" + ");
  const statusText=loaded.length?`${dateRange} · ${sessionStatuses} · ${sourceLabel} · ${loaded.filter(t=>t.status==="error"||t.status==="partial").length} partial/error`:"Loading sessions…";
  const logos=useDayLogos(backend,nearby.filter(symbol=>tiles[symbol]?.logo_path === `/symbol_logo?symbol=${encodeURIComponent(symbol)}`));
  useEffect(() => {
    if(!strip) return;
    const members=JSON.stringify([...symbols].sort());
    if(previousMembers.current!==members){strip.scrollLeft=0;strip.scrollTop=0;}
    previousMembers.current=members;
    if(pendingFocus.current?.membership===membership){strip.querySelector<HTMLElement>(`[data-day-index="${pendingFocus.current.index}"]`)?.focus({preventScroll:true});pendingFocus.current=null;}
    const active=new Set<number>();
    const publish=()=>setView({membership,indexes:[...active].sort((a,b)=>a-b)});
    const measure=()=>{
      // Fallback for older webviews and an initial viewport before IO reports.
      setSize({width:strip.clientWidth||620,height:strip.clientHeight||260});
      if(typeof IntersectionObserver === "undefined") {
        active.clear();
        strip.querySelectorAll<HTMLElement>("[data-day-index]").forEach(node=>{
          if(node.offsetLeft+node.offsetWidth>=strip.scrollLeft-322 && node.offsetLeft<=strip.scrollLeft+strip.clientWidth+322 && node.offsetTop+node.offsetHeight>=strip.scrollTop-260 && node.offsetTop<=strip.scrollTop+strip.clientHeight+260)active.add(Number(node.dataset.dayIndex));
        });publish();
      }
    };
    const onWheel=(event:WheelEvent)=>{if(layout.axis==="horizontal" && Math.abs(event.deltaY)>Math.abs(event.deltaX)){strip.scrollLeft+=event.deltaY;event.preventDefault();measure();}};
    strip.addEventListener("wheel",onWheel,{passive:false});
    strip.addEventListener("scroll",measure,{passive:true});
    const observer=typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries)=>{
      for(const entry of entries){const index=Number((entry.target as HTMLElement).dataset.dayIndex);if(entry.isIntersecting)active.add(index);else active.delete(index);}
      publish();
    },{root:strip,rootMargin:"260px 322px",threshold:0});
    strip.querySelectorAll("[data-day-index]").forEach((node)=>observer?.observe(node));
    const resize=typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(strip);measure();
    return ()=>{observer?.disconnect();resize?.disconnect();strip.removeEventListener("wheel",onWheel);strip.removeEventListener("scroll",measure);};
  },[strip,membership,symbols,layout.axis,layout.rows,layout.columns]);
  const notice=layout.error??parsed.error??(!symbols.length?"Choose symbols to chart.":null);
  function nav(where:"first"|"back"|"forward"|"last") {
    if(!strip)return;
    const horizontal=layout.axis==="horizontal";
    const position=horizontal?strip.scrollLeft:strip.scrollTop;
    const extent=horizontal?strip.scrollWidth:strip.scrollHeight;
    const page=horizontal?strip.clientWidth:strip.clientHeight;
    const next=where==="first"?0:where==="last"?extent:position+(where==="back"?-1:1)*page;
    if(horizontal)strip.scrollLeft=next;else strip.scrollTop=next;
    strip.dispatchEvent(new Event("scroll"));
  }
  return <div className="day-chart">
    {notice?<p className="empty-state">{notice}</p>:<div className={`day-chart-strip day-chart-${layout.axis}`} style={{gridAutoFlow:layout.axis==="horizontal"?"column":"row",gridTemplateColumns:layout.columns?`repeat(${layout.columns}, minmax(180px, 1fr))`:undefined,gridTemplateRows:layout.axis==="horizontal"?`repeat(${layout.rows}, ${Math.max(180,(size.height-20-12*((layout.rows??1)-1))/(layout.rows??1))}px)`:undefined,gridAutoColumns:layout.axis==="horizontal"?"310px":undefined,gridAutoRows:layout.axis==="vertical"?`${layout.rows?Math.max(180,(size.height-20-12*(layout.rows-1))/layout.rows):220}px`:undefined}} ref={setStrip} role="listbox" aria-label="Day charts">
      {symbols.map((symbol,index)=><div role="option" className={`day-chart-tile${onReorder?" day-chart-reorderable":""}${dropTarget===index?" day-chart-drop-target":""}${params.selected_symbol===symbol?" day-chart-selected":""}`} aria-selected={params.selected_symbol===symbol} tabIndex={onSelectSymbol||onReorder?0:undefined} draggable={false}
        onPointerDown={event=>{if(!onReorder||drag.current||event.isPrimary===false||event.button!==0||(event.pointerType==="touch" && !(event.target as HTMLElement).closest(".day-chart-top")))return;event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});drag.current={index,input,pointerId:event.pointerId,x:event.clientX,y:event.clientY,currentX:event.clientX,currentY:event.clientY,active:false};suppressClick.current=false;event.currentTarget.setPointerCapture?.(event.pointerId);}}
        onPointerMove={event=>{const d=drag.current;if(!d||d.pointerId!==event.pointerId||d.input!==input)return;if(Math.hypot(event.clientX-d.x,event.clientY-d.y)<8&&!d.active)return;d.active=true;d.currentX=event.clientX;d.currentY=event.clientY;suppressClick.current=true;event.preventDefault();if(strip&&!edgeScroll.current)edgeScroll.current=startDragEdgeScroll(strip,layout.axis,()=>{const active=drag.current;return active?.active&&active.input===input?{x:active.currentX,y:active.currentY}:null;},()=>{const active=drag.current;if(!active)return;const hit=document.elementFromPoint(active.currentX,active.currentY)?.closest<HTMLElement>("[data-day-index]");setDropTarget(hit&&strip.contains(hit)?Number(hit.dataset.dayIndex):null);});const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>("[data-day-index]");setDropTarget(target&&strip?.contains(target)?Number(target.dataset.dayIndex):null);}}
        onPointerUp={event=>{const d=drag.current;if(!d||d.pointerId!==event.pointerId)return;stopEdgeScroll();drag.current=null;setDropTarget(null);if(d?.active&&d.input===input){event.preventDefault();event.stopPropagation();const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>("[data-day-index]");if(target&&strip?.contains(target))move(d.index,Number(target.dataset.dayIndex));}setTimeout(()=>{suppressClick.current=false;},0);}}
        onPointerCancel={event=>{if(drag.current?.pointerId!==event.pointerId)return;stopEdgeScroll();drag.current=null;setDropTarget(null);suppressClick.current=false;}}
        onLostPointerCapture={event=>{if(drag.current?.pointerId!==event.pointerId)return;stopEdgeScroll();drag.current=null;setDropTarget(null);}}
        onDragStart={event=>event.preventDefault()}
        onClick={()=>{if(!suppressClick.current)onSelectSymbol?.(symbol);}} onKeyDown={event=>{if(event.target===event.currentTarget && event.altKey && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();event.stopPropagation();move(index,index+(["ArrowLeft","ArrowUp"].includes(event.key)?-1:1),true);return;}if(event.target===event.currentTarget && (event.key==="Enter"||event.key===" ")){event.preventDefault();onSelectSymbol?.(symbol);}}} title={onSelectSymbol?`Select ${symbol} for detailed chart`:undefined} data-day-index={index} key={`${index}:${symbol}`}><Tile symbol={symbol} tile={tiles[symbol]} nearby={indexes.includes(index)} logo={logos[symbol]} scale={scale} quote={quotes[symbol]}/></div>)}
    </div>}
    <div className="day-chart-footer"><span role="status">{selectionError?`${selectionError} · `:""}{statusText} · Quotes: {quoteStatus==="live"?"connected":quoteStatus} · 250ms flush{latestQuote ? ` · Last price ${new Date(latestQuote).toLocaleTimeString()}`:" · awaiting trade"} · History: 15s{scale==="percent"?" · % from close before first session":""}</span>{footerControls?<div className="card-chips day-chart-footer-controls">{footerControls}</div>:null}<div className="news-nav" role="group" aria-label="Scroll day charts">{([["first","Beginning","|◂"],["back","Page back","◂◂"],["forward","Page forward","▸▸"],["last","End","▸|"]] as const).map(([where,label,glyph])=><button type="button" key={where} aria-label={label} title={label} onClick={()=>nav(where)}>{glyph}</button>)}</div></div>
  </div>;
}
