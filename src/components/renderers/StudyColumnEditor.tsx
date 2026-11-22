// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useState} from 'react';
import {studyDefaults,validateStudyParams,type StudyColumn,type StudyEntry,type StudyValue} from '../../lib/studyColumns';
export function newStudyColumn(entry:StudyEntry,preset?:'rsi'|'slow'):StudyColumn{
 const params=studyDefaults(entry);
 const overrides=preset==='rsi'?{period:14}:preset==='slow'?{k:14,smooth_k:3,d:3}:{};
 for(const [key,value]of Object.entries(overrides))if(Object.hasOwn(entry.param_schema,key))params[key]=value;
 return {id:crypto.randomUUID(),study:entry.name,output:preset==='slow'&&entry.outputs.includes('stoch_k')?'stoch_k':entry.outputs[0],params,interval:'1m',session:'regular',basis:'adjusted',provider:'yfinance',points:60,presentation:preset==='slow'?'sparkline':'latest',definition_version:entry.definition_version};
}
export function StudyColumnEditor({catalog,column,editing=!!column,onSave,onCancel}:{catalog:StudyEntry[];column?:StudyColumn;editing?:boolean;onSave:(column:StudyColumn)=>void;onCancel:()=>void}){
 const [draft,setDraft]=useState<StudyColumn>(()=>column?{...column,params:{...column.params}}:newStudyColumn(catalog.find(entry=>!entry.unsupportedReason)??catalog[0]));
 const entry=catalog.find(item=>item.name===draft.study);
 const error=!entry?'This study is no longer registered.':entry.unsupportedReason??(!entry.outputs.includes(draft.output)?'This study output is no longer registered.':validateStudyParams(entry,draft.params));
 const validPoints=Number.isInteger(draft.points)&&draft.points>=1&&draft.points<=256;
 const update=(patch:Partial<StudyColumn>)=>setDraft(previous=>({...previous,...patch}));
 const param=(name:string,value:StudyValue)=>setDraft(previous=>({...previous,params:{...previous.params,[name]:value}}));
 return <section className="study-column-editor" role="dialog" aria-label={editing?'Edit study column':'Add study column'}>
  <form onSubmit={event=>{event.preventDefault();if(entry&&!error&&validPoints)onSave({...draft,params:{...draft.params},definition_version:entry.definition_version});}}>
   <h3>{editing?'Edit study column':'Add study column'}</h3>
   <label>Study<select className="bd-input" value={draft.study} onChange={event=>{const next=catalog.find(item=>item.name===event.target.value);if(next)update({study:next.name,output:next.outputs[0],params:studyDefaults(next),definition_version:next.definition_version});}}>{!entry?<option value={draft.study}>{draft.study} (unavailable)</option>:null}{catalog.map(item=><option key={item.name} value={item.name} disabled={!!item.unsupportedReason}>{item.label}{item.unsupportedReason?" (unavailable in grid)":""}</option>)}</select></label>
   <label>Output<select className="bd-input" value={draft.output} onChange={event=>update({output:event.target.value})}>{entry?.outputs.map(output=><option key={output} value={output}>{output}</option>)}</select></label>
   {entry?Object.entries(entry.param_schema).map(([name,descriptor])=><label key={name}>{descriptor.label??name}{descriptor.enum?<select className="bd-input" value={String(draft.params[name])} onChange={event=>param(name,descriptor.enum!.find(value=>String(value)===event.target.value)!)}>{descriptor.enum.map(value=><option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>:descriptor.type==='boolean'?<input className="bd-input" type="checkbox" checked={draft.params[name]===true} onChange={event=>param(name,event.target.checked)}/>:<input className="bd-input" type={descriptor.type==='string'?'text':'number'} value={String(draft.params[name]??'')} min={descriptor.minimum} max={descriptor.maximum} step={descriptor.step??(descriptor.type==='integer'?1:'any')} maxLength={1024} onChange={event=>param(name,event.target.value===''&&descriptor.nullable?null:descriptor.type==='string'||event.target.value===''?event.target.value:Number(event.target.value))}/>}</label>):null}
   <label>Interval<select className="bd-input" value={draft.interval} onChange={event=>update({interval:event.target.value})}>{['1s','1m','5m','15m','30m','1h','1d'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Session<select className="bd-input" value={draft.session} onChange={event=>update({session:event.target.value})}>{['regular','extended','24hr'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Price basis<select className="bd-input" value={draft.basis} onChange={event=>update({basis:event.target.value})}>{['adjusted','raw'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Provider<select className="bd-input" value={draft.provider} onChange={event=>update({provider:event.target.value})}><option value="">Server default</option>{['yfinance','eodhd','temporaldb'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Presentation<select className="bd-input" value={draft.presentation} onChange={event=>update({presentation:event.target.value as StudyColumn['presentation']})}><option value="latest">Latest value</option><option value="sparkline">Sparkline</option><option value="both">Both</option></select></label>
   <label>Sparkline points<input className="bd-input" type="number" min={1} max={256} step={1} value={draft.points} onChange={event=>update({points:Number(event.target.value)})}/></label>
   {error?<p role="alert">{error}</p>:null}{!validPoints?<p role="alert">Sparkline points must be between 1 and 256.</p>:null}
   {entry&&draft.definition_version&&draft.definition_version!==entry.definition_version?<p>Saving uses the current registered study definition.</p>:null}
   <div className="study-column-actions"><button className="bd-button bd-button--primary" type="submit" disabled={!!error||!validPoints}>Save study column</button><button className="bd-button" type="button" onClick={onCancel}>Cancel</button></div>
  </form>
 </section>;
}
