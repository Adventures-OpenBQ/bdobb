// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under BUSL-1.1.
// SPDX-License-Identifier: BUSL-1.1
import { useEffect,useRef,useState } from 'react';
import { getHost } from '../host';
import type { BackendConfig } from '../lib/types';
import { AcceptedCandles,byteLength,normalizeView,parseFrame,viewKey,type CandleView } from '../lib/accepted/candles';
import type { Candle,TickStatus } from './useTickCache';

type Output={status:TickStatus;candles:Candle[];note:string|null};
/** Original accepted-data candle transport. Its only URL comes from the host resolver. */
export function useAcceptedCandles({backend,view,enabled,subscriptionId='arts-chart'}:{backend:BackendConfig;view:CandleView;enabled:boolean;subscriptionId?:string}): Output {
  const [output,setOutput]=useState<Output>({status:'idle',candles:[],note:null});
  const latest=useRef(backend);latest.current=backend;
  const identity=JSON.stringify([backend.id,backend.baseUrl,view,subscriptionId]);
  const visibleIdentity=useRef(identity);
  useEffect(()=>{
    if(!enabled) {setOutput({status:'idle',candles:[],note:null});return;}
    let stopped=false, cycle=0, drops=0, request=0;
    let socket:WebSocket|null=null, model:AcceptedCandles|null=null;
    let retryTimer:ReturnType<typeof setTimeout>|null=null,ackTimer:ReturnType<typeof setTimeout>|null=null;
    let liveness:ReturnType<typeof setInterval>|null=null;
    const clearAck=()=>{if(ackTimer!==null)clearTimeout(ackTimer);ackTimer=null;};
    if(visibleIdentity.current!==identity) {visibleIdentity.current=identity;setOutput({status:'connecting',candles:[],note:null});}
    else setOutput(current=>({...current,status:'connecting'}));
    const publish=(status:TickStatus)=>{
      if(stopped || !model)return;
      setOutput({status,candles:model.candles,note:model.truncated?'Accepted candle window is truncated; earlier composed history is retained':!model.complete?'Accepted trade coverage is incomplete':null});
    };
    const connect=async()=>{
      const own=++cycle;let retrying=false,opened=0,lastFrame=Date.now(),controls:number[]=[];
      const stale=()=>stopped || own!==cycle;
      const retry=(reset:boolean)=>{
        if(stale()||retrying)return;retrying=true;clearAck();
        if(liveness!==null)clearInterval(liveness);liveness=null;
        if(reset)model?.reset();else model?.admit();
        const closing=socket;socket=null;closing?.close();
        setOutput(current=>({...current,status:'error',note:reset?'Resynchronizing accepted candle data':current.note}));
        drops=opened && Date.now()-opened>=30000?0:drops+1;
        const wait=Math.min(15000,Math.max(500,500*2**Math.min(8,drops-1)*(.8+Math.random()*.4)));
        retryTimer=setTimeout(()=>{retryTimer=null;void connect();},wait);
      };
      try {
        if(!model) {const normalized=normalizeView(view);const hash=await viewKey(normalized);if(stale())return;model=new AcceptedCandles(normalized,hash,subscriptionId);}
        const resolve=getHost().chartStreamUrl;
        if(!resolve)throw Error('Host has no accepted-data URL resolver');
        const url=await resolve(latest.current);if(stale())return;
        const target=new URL(url);if(!['ws:','wss:'].includes(target.protocol)||target.username||target.password)throw Error('Invalid accepted-data URL');
        const ws=new globalThis.WebSocket(url);socket=ws;
        const send=(control:Record<string,unknown>)=>{
          const encoded=JSON.stringify({protocol_version:1,subscription_id:subscriptionId,request_id:`arts-${++request}`,...control});
          controls=controls.filter(at=>Date.now()-at<1000);
          if(byteLength(encoded)>64*1024 || controls.length>=10 || (ws.bufferedAmount??0)>8*1024*1024)throw Error('Accepted control budget exceeded');
          controls.push(Date.now());ws.send(encoded);
        };
        const acknowledge=()=>{
          if(ackTimer!==null)return;
          ackTimer=setTimeout(()=>{
            ackTimer=null;if(stale()||retrying||!model?.cursor||!model.generation)return;
            try{send({type:'ack',generation:model.generation,cursor:model.cursor});}catch{retry(true);}
          },250);
        };
        ws.onopen=()=>{
          if(stale()||retrying)return;opened=Date.now();lastFrame=opened;
          try{
            let checkpoint=model!.checkpoint();
            if(checkpoint && byteLength(JSON.stringify({type:'resume',view:model!.view,checkpoint}))+256>64*1024) {model!.reset();checkpoint=null;}
            send(checkpoint?{type:'resume',view:model!.view,checkpoint}:{type:'subscribe',view:model!.view});
            liveness=setInterval(()=>{if(Date.now()-lastFrame>15000)retry(false);},1000);
          }catch{retry(true);}
        };
        ws.onmessage=(event)=>{
          if(stale()||retrying)return;
          try {
            const frame=parseFrame(event.data);lastFrame=Date.now();
            const result=model!.receive(frame);
            if(result==='reset') {retry(true);return;}
            if(result==='heartbeat') {send({type:'pong',generation:model!.generation});return;}
            if(result==='data'||result==='status') {publish('live');acknowledge();}
          }catch{retry(true);}
        };
        ws.onclose=(event)=>retry(event?.code===4009);
        ws.onerror=()=>retry(false);
      }catch{retry(true);}
    };
    void connect();
    return()=>{
      stopped=true;cycle++;clearAck();if(retryTimer!==null)clearTimeout(retryTimer);if(liveness!==null)clearInterval(liveness);
      if(socket?.readyState===1 && model?.generation) {
        try{socket.send(JSON.stringify({protocol_version:1,type:'unsubscribe',subscription_id:subscriptionId,generation:model.generation,request_id:`arts-${++request}`}));}catch{/* socket already closed */}
      }
      socket?.close();socket=null;
    };
  // identity includes normalized source/view inputs; resolver reads latest credentials at admission.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[identity,enabled]);
  return output;
}
