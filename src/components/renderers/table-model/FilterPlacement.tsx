// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { TableModelV1 } from '../../../lib/tableModel/types';
import { demote, promote } from '../../../lib/tableModel/pivotParams';
import type { ModelEdit } from '../../../stores/tableCommitCoordinator';
export function FilterPlacement({model,categoryId,readonly,onEditModel}:{model:TableModelV1;categoryId:string;readonly:boolean;onEditModel:(edit:ModelEdit)=>Promise<boolean>}) {
 const param=model.params.filters.find(p=>p.categoryId===categoryId);const category=model.categories.find(c=>c.id===categoryId);
 const [label,setLabel]=useState<string>();const [error,setError]=useState('');
 const publish=async(edit:ModelEdit,clearLabel=false)=>{if(await onEditModel(edit)){setError('');if(clearLabel)setLabel(current=>current===label?undefined:current);}else setError('Could not save parameter placement. Your edits have been retained.');};
 const update=(patch:{multiSelect?:boolean;label?:string})=>void publish({replaceKey:`param-${patch.label!==undefined?'label':patch.multiSelect!==undefined?'mode':'placement'}:${categoryId}`,apply:current=>{
  const latest=current.params.filters.find(p=>p.categoryId===categoryId);
  return promote(current,categoryId,{id:latest?.id??crypto.randomUUID(),label:latest?.label??category?.name.slice(0,64)??categoryId.slice(0,64),multiSelect:latest?.multiSelect??true,...patch});
 }},patch.label!==undefined);
 return <fieldset className="pivot-filter-placement" disabled={readonly}><legend>Placement</legend><div className="pivot-filter-row"><span>Where this filter lives</span><span className="seg" role="group" aria-label="Where this filter lives"><button type="button" aria-pressed={!param} onClick={()=>void publish({apply:current=>demote(current,categoryId),replaceKey:`param-placement:${categoryId}`})}>In this panel</button><button type="button" aria-pressed={!!param} onClick={()=>update({})}>Parameters row</button></span></div>
 {param?<><div className="pivot-filter-row"><span>Selection</span><span className="seg" role="group" aria-label="Selection"><button type="button" aria-pressed={param.multiSelect} onClick={()=>update({multiSelect:true})}>Multi-select</button><button type="button" aria-pressed={!param.multiSelect} onClick={()=>update({multiSelect:false})}>Single-select</button></span></div><label>Parameter label<input value={label??param.label} onChange={e=>setLabel(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();update({label:label??param.label});}}}/></label><button type="button" disabled={label===undefined} onClick={()=>update({label:label??param.label})}>Save parameter label</button><p className="pivot-category-note">Single-select keeps saved values until you explicitly choose a member.</p></>:null}{error?<p role="alert">{error}</p>:null}</fieldset>;
}
