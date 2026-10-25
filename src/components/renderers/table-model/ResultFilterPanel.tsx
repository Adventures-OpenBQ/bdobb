// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useRef,useState} from 'react';
import {DrawerFooterActions} from '../pivot-drawer/DrawerFooterTarget';
import type {TableModelV1,ResultFilter} from '../../../lib/tableModel/types';
import type {DatasetColumn} from '../../../lib/widgetData/types';
import {measureLabel} from '../../../lib/tableModel/measures';
const predicates={eq:['Equals','='],ne:['Does not equal','≠'],gt:['Greater than','>'],gte:['At least','≥'],lt:['Less than','<'],lte:['At most','≤']} as const;
export function ResultFilterPanel({model,columns,readonly,pending,onCommitModel}:{model:TableModelV1;columns:readonly DatasetColumn[];readonly:boolean;pending?:boolean;onCommitModel:(next:TableModelV1)=>Promise<boolean>}){
 const generation=useRef(0);
 const levels=[...new Set([...model.layout.rows,...model.layout.columns])];
 const targets=[...model.measures.map(m=>({kind:'measure' as const,id:m.id,label:measureLabel(m,columns.find(c=>c.id===m.sourceFieldId)?.label??m.sourceFieldId,model.measures),available:!!m.aggregation})),...model.formulas.filter(f=>f.scope==='aggregate').map(f=>({kind:'formula' as const,id:f.id,label:f.name,available:true}))];
 const key=(t:{kind:string;id:string})=>JSON.stringify([t.kind,t.id]);
 const [level,setLevel]=useState(levels[0]??''),[target,setTarget]=useState(()=>{const first=targets.find(t=>t.available);return first?key(first):'';}),[predicate,setPredicate]=useState<ResultFilter['predicate']>('gt'),[value,setValue]=useState(''),[valueType,setValueType]=useState('number'),[error,setError]=useState('');
 const change=(edit:()=>void)=>{generation.current++;setError('');edit();};
 const add=async()=>{
  if(readonly||pending)return;const chosen=targets.find(t=>key(t)===target&&t.available);let scalar:ResultFilter['value']=value;
  if(valueType==='number'){scalar=Number(value);if(!value.trim()||!Number.isFinite(scalar)){setError('Enter a finite number.');return;}}
  if(valueType==='boolean')scalar=value==='true';if(valueType==='blank')scalar=null;
  if(!levels.includes(level)||!chosen){setError('Choose a category level and named calculation.');return;}
  const filter:ResultFilter={id:crypto.randomUUID(),categoryId:level,target:{kind:chosen.kind,id:chosen.id},predicate,value:scalar},version=generation.current;setError('');
  try{if(!await onCommitModel({...model,resultFilters:[...model.resultFilters,filter]})&&generation.current===version)setError('Could not save result filter. Your draft has been retained.');}catch{if(generation.current===version)setError('Could not save result filter. Your draft has been retained.');}
 };
 const remove=async(id:string)=>{if(readonly||pending)return;const version=generation.current;try{if(!await onCommitModel({...model,resultFilters:model.resultFilters.filter(f=>f.id!==id)})&&generation.current===version)setError('Could not remove result filter. The saved filter is retained.');}catch{if(generation.current===version)setError('Could not remove result filter. The saved filter is retained.');}};
 const actions=<button type="button" className="pivot-panel-primary" disabled={readonly||pending||!levels.length||!targets.some(t=>t.available)} onClick={()=>void add()}>Add result filter</button>;
 return <section className="pivot-result-panel" aria-label="Result filters"><div className="pivot-panel-grid two"><fieldset disabled={readonly||pending}><legend>Result filter</legend>
 <label>Filter level<select value={level} onChange={e=>change(()=>setLevel(e.target.value))}>{!levels.includes(level)?<option value={level}>Choose category level</option>:null}{levels.map(id=><option value={id} key={id}>{model.categories.find(c=>c.id===id)?.name??id}</option>)}</select></label>
 <label>Calculation<select value={target} onChange={e=>change(()=>setTarget(e.target.value))}>{!targets.some(t=>key(t)===target&&t.available)?<option value={target}>Choose named calculation</option>:null}{targets.filter(t=>t.available).map(t=><option key={key(t)} value={key(t)}>{t.label}</option>)}</select></label>
 <div className="pivot-panel-grid"><label>Operator<select value={predicate} onChange={e=>change(()=>setPredicate(e.target.value as ResultFilter['predicate']))}>{(Object.keys(predicates) as ResultFilter['predicate'][]).map(p=><option key={p} value={p}>{predicates[p][0]}</option>)}</select></label>
 <label>Value type<select value={valueType} onChange={e=>change(()=>setValueType(e.target.value))}>{['number','text','boolean','blank'].map(t=><option key={t}>{t}</option>)}</select></label></div>
 <label>Comparison value{valueType==='boolean'?<select value={value} onChange={e=>change(()=>setValue(e.target.value))}><option>false</option><option>true</option></select>:<input value={value} disabled={valueType==='blank'} onChange={e=>change(()=>setValue(e.target.value))}/>}</label>
 {error?<p role="alert">{error}</p>:null}</fieldset>
 <fieldset><legend>Active result filters</legend><ul className="pivot-panel-list">{model.resultFilters.map(f=>{const text=`${model.categories.find(c=>c.id===f.categoryId)?.name??f.categoryId}: ${targets.find(t=>t.id===f.target.id&&t.kind===f.target.kind)?.label??f.target.id} ${predicates[f.predicate][1]} ${String(f.value)}`;return <li key={f.id}><span className="pivot-panel-grow" title={text}>{text}</span><button type="button" disabled={readonly||pending} onClick={()=>void remove(f.id)}>Remove result filter</button></li>;})}{!model.resultFilters.length?<li className="pivot-panel-note">None. All groups survive.</li>:null}</ul></fieldset></div>
 <p className="pivot-panel-note">Qualifying groups determine the surviving records and recomputed totals.</p><DrawerFooterActions>{actions}</DrawerFooterActions></section>;
}
