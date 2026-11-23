// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useCallback,useEffect,useMemo,useState} from 'react';
import {buildWidgetWsUrl,ticketedWsUrl,wantsSocketTicket} from '../lib/dataClient';
import {isRecord} from '../lib/isRecord';
import type {BackendConfig,WidgetDef} from '../lib/types';
import {useReconnectingSocket} from './useReconnectingSocket';
export type DayQuote={price:number;change:number|null;change_percent:number|null;at:number};
const definition={id:'day_chart',type:'day_chart',wsEndpoint:'live_grid_ws'} as WidgetDef;
export function useDayQuotes(backend:BackendConfig,symbols:string[]) {
 const symbol=[...new Set(symbols)].join(',');
 const backendKey=JSON.stringify(backend);
 const connection=useMemo(()=>JSON.parse(backendKey) as BackendConfig,[backendKey]);
 const identity=backendKey;
 const [state,setState]=useState<{identity:string;quotes:Record<string,DayQuote>}>({identity,quotes:{}});
 useEffect(()=>{setState(old=>({identity,quotes:old.identity===identity?Object.fromEntries(Object.entries(old.quotes).filter(([s])=>symbol.split(',').includes(s))):{}}));},[identity,symbol]);
 const url=useMemo(()=>symbol?buildWidgetWsUrl(connection,definition):null,[connection,symbol]);
 const subscribe=useMemo(()=>({params:{symbol}}),[symbol]);
 const onMessage=useCallback((message:unknown)=>{
  const wanted=new Set(symbol.split(','));
  const rows=(Array.isArray(message)?message:[message]).filter(isRecord);
  setState(old=>{
   const quotes={...(old.identity===identity?old.quotes:{})};
   for(const row of rows){
    if(typeof row.symbol!=='string'||!wanted.has(row.symbol)||typeof row.price!=='number'||!Number.isFinite(row.price))continue;
    const at=typeof row.updated_ts==='string'?Date.parse(row.updated_ts):NaN;
    if(!Number.isFinite(at)||(quotes[row.symbol]?.at??0)>at)continue;
    const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
    quotes[row.symbol]={price:row.price,change:number(row.change),change_percent:number(row.change_percent)===null?null:Number(row.change_percent)*100,at};
   }
   return {identity,quotes};
  });
 },[identity,symbol]);
 const status=useReconnectingSocket(url,subscribe,onMessage,{resolveUrl:wantsSocketTicket(connection)?plain=>ticketedWsUrl(connection,plain):undefined,reconnectKey:backendKey,reconnectOnForeground:true});
 return {quotes:state.identity===identity?Object.fromEntries(Object.entries(state.quotes).filter(([s])=>symbol.split(',').includes(s))):{},status};
}
