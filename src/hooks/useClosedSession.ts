// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useMemo,useState} from 'react';
import {fetchEndpoint} from '../lib/dataClient';
import {isRecord} from '../lib/isRecord';
import type {BackendConfig} from '../lib/types';
import type {UdfBar} from '../lib/udf';
type Result={mode:'checking'|'stream'|'closed'|'error';symbol:string;bars:UdfBar[];date?:string;partial?:boolean;error?:string;stale?:boolean;source?:string;liveFrom?:number|null};
function parse(value:unknown,symbol:string,interval:string):Result {
 if(!isRecord(value)||value.schema_version!==1||value.symbol!==symbol||value.interval!==interval||!Array.isArray(value.bars)||value.bars.length>2000||JSON.stringify(value).length>512*1024)throw Error('Invalid session history');
 if(value.mode==='stream'&&value.bars.length===0)return {mode:'stream',symbol,bars:[]};
 const btc=value.mode==='stream'&&symbol==='BTC-USD'&&typeof value.source==='string'&&['eodhd','eodhd+kdb ticks','eodhd+coinbase','eodhd+kdb ticks+coinbase'].includes(value.source);
 if((!btc&&(value.mode!=='closed'||value.source!=='eodhd'))||!isRecord(value.session)||typeof value.session.date!=='string'||value.session.status!==(btc?'open':'closed'))throw Error('Invalid session history');
 const liveFrom=value.live_from==null?null:typeof value.live_from==='string'?Date.parse(value.live_from)/1000:NaN;
 if(liveFrom!==null&&!Number.isFinite(liveFrom))throw Error('Invalid history seam');
 const bars:UdfBar[]=[];let last=-Infinity;
 for(const raw of value.bars){
  if(!isRecord(raw)||typeof raw.date!=='string')throw Error('Invalid historical bar');
  const time=Date.parse(raw.date)/1000;
  if(!Number.isFinite(time)||time<=last||!['open','high','low','close','volume'].every(k=>typeof raw[k]==='number'&&Number.isFinite(raw[k])))throw Error('Invalid historical bar');
  const {open,high,low,close,volume}=raw as {open:number;high:number;low:number;close:number;volume:number};
  if(volume<0||low>Math.min(open,close)||high<Math.max(open,close))throw Error('Invalid historical candle');
  bars.push({time,open,high,low,close,volume});last=time;
 }
 return {mode:btc?'stream':'closed',symbol,bars,source:String(value.source),liveFrom,date:value.session.date,partial:value.partial===true,error:value.error_code==='subminute_history_unavailable'?'Closed-session history requires a 1-minute or longer interval.':undefined};
}
export function useClosedSession(backend:BackendConfig,symbol:string,interval:string,enabled:boolean,refreshKey:number) {
 const backendKey=JSON.stringify(backend);
 const connection=useMemo(()=>JSON.parse(backendKey) as BackendConfig,[backendKey]);
 const identity=JSON.stringify([backendKey,symbol,interval]);
 const [state,setState]=useState<{identity:string;result:Result}|null>(null);
 useEffect(()=>{
  if(!enabled||!symbol)return;
  let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;let deadline:ReturnType<typeof setTimeout>|undefined;let controller:AbortController;
  const poll=async()=>{
   controller=new AbortController();deadline=setTimeout(()=>controller.abort(),30000);
   try{
    const result=parse(await fetchEndpoint(connection,'closed_session',{symbol,interval},controller.signal),symbol,interval);
    if(!disposed)setState({identity,result});
   }catch{
    if(!disposed)setState(old=>old?.identity===identity && old.result.bars.length>0?{identity,result:{...old.result,stale:true,error:'Refresh failed; showing the last successful session snapshot.'}}:{identity,result:{mode:'error',symbol,bars:[],error:'Session history is unavailable.'}});
   }finally{clearTimeout(deadline);if(!disposed)timer=setTimeout(()=>{void poll();},15000);}
  };
  void poll();
  return()=>{disposed=true;controller?.abort();clearTimeout(deadline);clearTimeout(timer);};
 },[connection,identity,symbol,interval,enabled,refreshKey]);
 return !enabled?{mode:'stream' as const,symbol,bars:[]}:state?.identity===identity?state.result:{mode:'checking' as const,symbol,bars:[]};
}
