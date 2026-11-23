// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useMemo,useState} from "react";
import {fetchDayLogo} from "../lib/dayLogo";
import type {BackendConfig} from "../lib/types";
/** At most four raster requests, only for the current nearby symbols. */
export function useDayLogos(backend:BackendConfig,symbols:string[]):Record<string,string>{
  const backendKey=JSON.stringify(backend);
  const connection=useMemo(()=>JSON.parse(backendKey) as BackendConfig,[backendKey]);
  const membership=JSON.stringify([...new Set(symbols)].sort());
  const identity=`${backendKey}:${membership}`;
  const [state,setState]=useState<{identity:string;urls:Record<string,string>}>({identity,urls:{}});
  useEffect(()=>{
    let disposed=false;
    const urls:Record<string,string>={};
    const controllers=new Set<AbortController>();
    const entries=JSON.parse(membership) as string[];
    void (async()=>{
      for(let at=0;at<entries.length&&!disposed;at+=4){
        await Promise.all(entries.slice(at,at+4).map(async symbol=>{
          const controller=new AbortController();controllers.add(controller);
          const timer=setTimeout(()=>controller.abort(),15000);
          try{
            const blob=await fetchDayLogo(connection,symbol,controller.signal);
            if(disposed||controller.signal.aborted)return;
            urls[symbol]=URL.createObjectURL(blob);
            setState({identity,urls:{...urls}});
          }catch{/* Initials remain available when a logo is absent. */}
          finally{clearTimeout(timer);controllers.delete(controller);}
        }));
      }
    })();
    return()=>{disposed=true;for(const controller of controllers)controller.abort();for(const url of Object.values(urls))URL.revokeObjectURL(url);};
  },[connection,identity,membership]);
  return state.identity===identity?state.urls:{};
}
