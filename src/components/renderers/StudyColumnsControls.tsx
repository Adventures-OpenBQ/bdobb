// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useState} from 'react';
import type {StudyColumn,StudyEntry} from '../../lib/studyColumns';
import {StudyColumnEditor,newStudyColumn} from './StudyColumnEditor';
export function studyColumnLabel(column:StudyColumn,catalog:StudyEntry[]):string{return `${catalog.find(entry=>entry.name===column.study)?.label??column.study} · ${Object.entries(column.params).map(([key,value])=>`${key}=${value??'default'}`).join(', ')} · ${column.output}`;}
export function StudyColumnsControls({enabled,catalog,error,columns,onChange}:{enabled:boolean;catalog:StudyEntry[];error:string|null;columns:StudyColumn[];onChange:(columns:StudyColumn[])=>void}){
 const [edit,setEdit]=useState<{column?:StudyColumn;isNew:boolean}|null>(null);
 const available=enabled&&catalog.some(entry=>!entry.unsupportedReason)&&columns.length<16;
 const preset=(name:string,kind:'rsi'|'slow')=>{const entry=catalog.find(item=>item.name===name&&!item.unsupportedReason);if(entry)setEdit({column:newStudyColumn(entry,kind),isNew:true});};
 const move=(index:number,direction:number)=>{const next=[...columns];[next[index],next[index+direction]]=[next[index+direction],next[index]];onChange(next);};
 return <div className="study-column-controls">
  <div className="study-column-actions"><button className="bd-button" type="button" disabled={!available} onClick={()=>setEdit({isNew:true})}>Add study column</button>{catalog.some(entry=>entry.name==='rsi')?<button className="bd-button" type="button" disabled={!available} onClick={()=>preset('rsi','rsi')}>Add RSI 14</button>:null}{catalog.some(entry=>entry.name==='stoch')?<button className="bd-button" type="button" disabled={!available} onClick={()=>preset('stoch','slow')}>Add slow %K</button>:null}</div>
  {error?<p role="status">{error}</p>:null}{!enabled&&columns.length>0?<p role="status">Study service is unavailable for this backend.</p>:null}
  {columns.length>0?<details className="study-column-management"><summary>Study columns ({columns.length})</summary>{columns.map((column,index)=><div className="study-column-actions" key={column.id}><span>{studyColumnLabel(column,catalog)}</span><button className="bd-button" type="button" disabled={!enabled||catalog.length===0} aria-label={`Edit ${studyColumnLabel(column,catalog)}`} onClick={()=>setEdit({column,isNew:false})}>Edit</button><button className="bd-button" type="button" aria-label={`Remove ${studyColumnLabel(column,catalog)}`} onClick={()=>onChange(columns.filter(item=>item.id!==column.id))}>Remove</button><button className="bd-button" type="button" aria-label={`Move ${column.study} earlier`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button className="bd-button" type="button" aria-label={`Move ${column.study} later`} disabled={index===columns.length-1} onClick={()=>move(index,1)}>↓</button></div>)}</details>:null}
  {edit&&catalog.length>0?<StudyColumnEditor key={edit.column?.id??'new'} catalog={catalog} column={edit.column} editing={!edit.isNew} onCancel={()=>setEdit(null)} onSave={column=>{onChange(edit.isNew?[...columns,column]:columns.map(item=>item.id===column.id?column:item));setEdit(null);}}/>:null}
 </div>;
}
