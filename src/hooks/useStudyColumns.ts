// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useState} from 'react';
import {fetchWidgetPath,postWidgetPath} from '../lib/dataClient';
import {parseStudyCatalog,parseStudyResults,type StudyColumn,type StudyEntry,type StudyResult} from '../lib/studyColumns';
import type {BackendConfig} from '../lib/types';
export function useStudyCatalog(backend:BackendConfig,enabled:boolean){
 const [catalog,setCatalog]=useState<StudyEntry[]>([]),[error,setError]=useState<string|null>(null);
 useEffect(()=>{
  if(!enabled)return;let current=true;const controller=new AbortController();
  setCatalog([]);setError(null);
  if(backend.authLocation==='query'&&backend.headerValue){setError('Study requests require header or cookie authentication');return;}
  void fetchWidgetPath(backend,'study_catalog',{}, {signal:controller.signal,maxResponseBytes:2*1024*1024}).then(raw=>{if(current)setCatalog(parseStudyCatalog(raw));}).catch(()=>{if(current)setError('Study catalog unavailable. Check the connection and service configuration.');});
  return()=>{current=false;controller.abort();};
 },[backend,enabled]);
 return {catalog,error};
}
export function useStudyColumns(backend:BackendConfig,enabled:boolean,columns:readonly StudyColumn[],symbols:readonly string[]){
 const symbolsJson=JSON.stringify([...new Set(symbols.map(symbol=>symbol.toUpperCase()))].sort());
 const columnsJson=JSON.stringify(columns.map(({presentation:_,...column})=>column));
 const key=JSON.stringify([backend.id,backend.baseUrl,symbolsJson,columnsJson,enabled]);
 const [state,setState]=useState<{key:string;results:Map<string,StudyResult>;error:string|null;backend?:BackendConfig}>({key:'',results:new Map(),error:null});
 useEffect(()=>{
  if(!enabled||columns.length===0||symbols.length===0)return;
  let current=true,inFlight=false;let controller:AbortController|undefined;let deadline:ReturnType<typeof setTimeout>|undefined;
  const requestedSymbols=JSON.parse(symbolsJson) as string[];
  const requestedColumns=JSON.parse(columnsJson) as StudyColumn[];
  if(requestedSymbols.length>50){setState({backend,key,results:new Map(),error:'SYMBOL_LIMIT'});return;}
  const refresh=async()=>{
   if(!current||inFlight)return;inFlight=true;const requestController=new AbortController();controller=requestController;
   deadline=setTimeout(()=>requestController.abort(),10000);
   try{
    const raw=await postWidgetPath(backend,'study_results',{schema_version:1,symbols:requestedSymbols,columns:requestedColumns},{signal:requestController.signal});
    const results=parseStudyResults(raw,requestedColumns,requestedSymbols);
    if(results.size!==requestedColumns.length*requestedSymbols.length)throw new Error('Missing study results');
    if(current)setState({backend,key,results,error:null});
   }catch{if(current)setState({backend,key,results:new Map(),error:'STUDY_REQUEST_FAILED'});}finally{clearTimeout(deadline);inFlight=false;}
  };
  void refresh();const timer=setInterval(()=>void refresh(),1000);
  return()=>{current=false;clearInterval(timer);clearTimeout(deadline);controller?.abort();};
  // The normalized strings keep quote-price ticks from restarting calculation polling.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[backend,enabled,columnsJson,symbolsJson,key]);
 return !enabled?{results:new Map<string,StudyResult>(),error:'STUDY_SERVICE_UNAVAILABLE'}:state.key===key&&state.backend===backend?state:{results:new Map<string,StudyResult>(),error:null};
}
