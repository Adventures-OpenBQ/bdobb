// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useMemo,useRef,useState} from 'react';
import type {BackendConfig,ManagedSourceReference,WidgetDef} from '../../lib/types';
import {createSourceClient,type BackendSourceOption} from '../../lib/tableExecution/remote/sourceClient';
import {atomsOf,wireParams,type WireContext} from '../../lib/params';
import {useWidgetRegistryStore} from '../../stores/widgetRegistryStore';
import {useBackendsStore} from '../../stores/backendsStore';
import {useTradingCalendar,type TradingCalendars} from '../../hooks/useTradingCalendar';
import {useBundleCalendars,withOvernight} from '../../hooks/useBundleCalendars';
import type {CalendarTrace} from '../../lib/calendar';
import {CalendarError} from '../../lib/calendars/contracts';
/**
 * The binding's params as sent: wireParams on the source widget over the card's context plus the calendars the form
 * loaded (`trading`), refusing every failure at once. Beyond wireParams' own errors (RW9b, RW9c):
 * - a value stepped on plain weekdays is refused as "<MIC> calendar still loading" while its calendar is fetching,
 *   else "<MIC> calendar not loaded" (RF5, as formSubmitBody words it);
 * - a key with no declared param is untyped, which would send a `(MIC)` or `@` atom as typed, so one is refused.
 * Unqualified values and literals go through.
 */
function bindingParams(widget:WidgetDef|undefined,params:Record<string,string>,context:WireContext|undefined,trading:TradingCalendars):Record<string,string>{
 const trace:Record<string,CalendarTrace>={},failed:Record<string,string>={},errors:string[]=[];
 const out=wireParams(widget,params,{...context,calendars:{...context?.calendars,...trading.calendars},trace,errors:failed});
 for(const [key,value] of Object.entries(params)){
  const weekdays=trace[key]?.weekdays;
  if(failed[key])errors.push(`${key}: ${failed[key]}`);
  else if(weekdays)errors.push(`${key}: ${weekdays.year===undefined?weekdays.calendar:`${weekdays.calendar} ${weekdays.year}`} calendar ${trading.loading?.includes(weekdays.calendar)?'still loading':'not loaded'}`);
  else if(!widget?.params.some(p=>p.paramName===key)&&atomsOf(value).some(a=>a.calendar!==undefined||a.at!==undefined))errors.push(`${key}: Cannot resolve ${value}: unknown parameter type`);
 }
 if(errors.length)throw new CalendarError('CALENDAR_UNAVAILABLE',errors.join('; '));
 return out;
}
/**
 * Upload a table file or bind a server data source for a managed table. A binding's typed values resolve on the
 * source widget before registration, on the calendars they name loaded from the source's own backend (the card's
 * managed-native widget declares no params, so the card loads none): `(MIC)` and `@` never reach the server, and a
 * value that cannot resolve is refused here (RW9, RW9b, RW9c).
 */
export function ManagedSourceForm({backend,context,onSave}:{backend:BackendConfig;context?:WireContext;onSave:(source:ManagedSourceReference)=>Promise<void>}) {
 const client=useMemo(()=>createSourceClient(backend),[backend]);
 const [options,setOptions]=useState<BackendSourceOption[]>([]),[binding,setBinding]=useState(''),[params,setParams]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState<string>();
 const operation=useRef<AbortController|null>(null);
 useEffect(()=>{const c=new AbortController();void client.backends(c.signal).then(setOptions).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>{c.abort();operation.current?.abort();};},[client]);
 const choices=options.flatMap(b=>b.widgets.map(w=>({key:JSON.stringify([b.backendId,w.widgetId]),backendId:b.backendId,...w,label:`${b.label} · ${w.label}`})));
 const selected=choices.find(c=>c.key===binding);
 const sourceWidget=useWidgetRegistryStore(s=>selected?s.find(selected.backendId,selected.widgetId):undefined);
 const sourceBackend=useBackendsStore(s=>selected?s.backends.find(b=>b.id===(sourceWidget?.backendId??selected.backendId)):undefined);
 // The hooks the card uses (useCardRequest): a bound source resolves on bundles, any other on the per-year loader.
 const legacy=useTradingCalendar(sourceWidget,params,sourceBackend,undefined,context?.now,context?.exchange);
 const bundled=useBundleCalendars(sourceWidget,params,sourceBackend,context?.exchange,context?.now);
 const sourceBinding=sourceWidget?.calendarBinding;
 const trading=useMemo(()=>sourceBinding?bundled:withOvernight(legacy,bundled),[sourceBinding,legacy,bundled]);
 async function save(acquire:(signal:AbortSignal)=>Promise<ManagedSourceReference>){
  operation.current?.abort();const c=new AbortController();operation.current=c;setBusy(true);setError(undefined);
  let source:ManagedSourceReference|undefined;
  try{source=await acquire(c.signal);if(c.signal.aborted)throw new DOMException('Cancelled','AbortError');await onSave(source);}
  catch(e){if(source)await client.deleteSource(source.sourceId).catch(()=>{});if(!c.signal.aborted)setError(e instanceof Error?e.message:'Source could not be saved');}
  finally{if(operation.current===c){setBusy(false);operation.current=null;}}
 }
 return <fieldset className="table-model-authoring" disabled={busy}><legend>Server execution</legend>
  <p>Upload a private table file or bind an allowed server data source.</p>
  <label>Upload table file<input aria-label="Upload table file" type="file" accept=".csv,.tsv,.json,.xls,.xlsx" onChange={e=>{const file=e.target.files?.[0];if(file)void save(signal=>client.uploadFile(file,signal));}}/></label>
  <label>Backend source<select aria-label="Backend source" value={binding} onChange={e=>{setBinding(e.target.value);setParams({});}}><option value="">Choose source</option>{choices.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
  {selected?.parameters.map(name=><label key={name}>{name}<input value={params[name]??''} onChange={e=>setParams(p=>({...p,[name]:e.target.value}))}/></label>)}
  <button type="button" disabled={!selected} onClick={()=>{if(selected)void save(signal=>client.registerBackend({backendId:selected.backendId,widgetId:selected.widgetId,params:bindingParams(sourceWidget,params,context,trading)},signal));}}>Bind server source</button>
  {busy?<p role="status">Saving server source…</p>:null}{error?<p role="alert">{error}</p>:null}
 </fieldset>;
}
