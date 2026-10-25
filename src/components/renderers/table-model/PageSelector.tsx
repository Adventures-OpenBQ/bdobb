// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useRef,useState} from 'react';
import {DrawerFooterActions} from '../pivot-drawer/DrawerFooterTarget';
import type {ModelEdit} from '../../../stores/tableCommitCoordinator';
import type {FacetResult} from '../../../lib/tableExecution/types';
import {categoryAuthoringRecipe as recipe} from '../../../lib/tableModel/categoryAuthoringRecipe';
import {memberLabel} from '../../../lib/tableModel/pivotParams';
import type {TableModelV1} from '../../../lib/tableModel/types';
type Draft={categoryId:string;keys:string[];promote:boolean;confirmed:boolean};
const fromModel=(model:TableModelV1):Draft=>({categoryId:model.layout.page?.categoryId??'',keys:[...(model.layout.page?.memberKeys??[])],promote:model.params.promotePage,confirmed:!!model.layout.page});
export function PageSelector({model,facet,readonly,pending,onRequestFacet,onCommitModel,onEditModel,error:metadataError,contextKey='',effectiveSummary}:{model:TableModelV1;facet?:FacetResult;readonly:boolean;pending?:boolean;error?:string;contextKey?:string;effectiveSummary?:string;onRequestFacet:(id:string)=>void;onEditModel?:(edit:ModelEdit)=>Promise<boolean>;onCommitModel:(next:TableModelV1)=>Promise<boolean>}) {
 const sourceAuthority=useRef(contextKey);sourceAuthority.current=contextKey;
 const [draft,setDraft]=useState<Draft>(()=>fromModel(model));const [dirty,setDirty]=useState(false);const [search,setSearch]=useState('');const [error,setError]=useState('');const [saving,setSaving]=useState(false);
 const version=useRef(0);const attempt=useRef(0);const authority=useRef(readonly);authority.current=readonly;
 const draftContext=useRef<string|undefined>(undefined);
 const context=JSON.stringify([contextKey,model.layout.page,recipe(model,model.layout.page?.categoryId??''),recipe(model,draft.categoryId)]);
 const latestContext=useRef(context);latestContext.current=context;
 const staleDraft=dirty&&draftContext.current!==context;
 const savedIdentity=JSON.stringify(model.layout.page);const savedRecipe=recipe(model,model.layout.page?.categoryId??'');
 useEffect(()=>{if(!dirty)setDraft(fromModel(model));},[savedIdentity,model.params.promotePage,dirty,model]);
 const categoryId=draft.categoryId;
 useEffect(()=>{if(categoryId)onRequestFacet(categoryId);},[categoryId,onRequestFacet]);
 const checklist=model.checklists.find(c=>c.categoryId===categoryId);
 const members=facet?.categoryId===categoryId&&!pending?facet.members?.filter(m=>m.count>0&&(!checklist||checklist.memberKeys.includes(m.key))):undefined;
 const eligibleKeys=new Set(members?.map(m=>m.key));const selectedKeys=new Set(draft.keys);
 const labelCounts=new Map<string,number>();for(const m of members??[]){const label=m.label||'(Blank)';labelCounts.set(label,(labelCounts.get(label)??0)+1);}
 const mutate=(next:Draft)=>{draftContext.current=JSON.stringify([contextKey,model.layout.page,recipe(model,model.layout.page?.categoryId??''),recipe(model,next.categoryId)]);version.current++;setDirty(true);setDraft(next);setError('');};
 const selectedLabels=draft.keys.map(key=>facet?.categoryId===categoryId?facet.members?.find(m=>m.key===key)?.label??memberLabel(key):memberLabel(key));
 const summary=selectedLabels.length?selectedLabels.map(label=>label||'(Blank)').join(', '):'No members';
 const index=draft.keys.length===1?members?.findIndex(m=>m.key===draft.keys[0])??-1:-1;
 const unavailable=draft.keys.filter(key=>members&&!eligibleKeys.has(key));
 const publish=async(remove=false)=>{
  if(readonly||pending||saving||staleDraft||(!remove&&(!categoryId||!draft.confirmed)))return;
  const captured={...draft,keys:[...draft.keys]};const categoryRecipe=recipe(model,categoryId);const generation=version.current;const submittedContext=context;const submission=++attempt.current;
  let refused=false;
  const apply=(current:TableModelV1)=>{
   if(authority.current||sourceAuthority.current!==contextKey||JSON.stringify(current.layout.page)!==savedIdentity||recipe(current,current.layout.page?.categoryId??'')!==savedRecipe||(!remove&&recipe(current,categoryId)!==categoryRecipe)){refused=true;return current;}
   const layout={...current.layout};if(remove)delete layout.page;else {layout.page={categoryId,memberKeys:captured.keys};layout.rows=layout.rows.filter(id=>id!==categoryId);layout.columns=layout.columns.filter(id=>id!==categoryId);}
   return {...current,layout,params:{...current.params,promotePage:captured.promote}};
  };
  const expected=apply(model);const expectedContext=JSON.stringify([contextKey,expected.layout.page,recipe(expected,expected.layout.page?.categoryId??''),recipe(expected,categoryId)]);
  setSaving(true);
  try{const saved=onEditModel?await onEditModel({apply,replaceKey:'page-value'}):await onCommitModel(apply(model));if(submission!==attempt.current||generation!==version.current||(submittedContext!==latestContext.current&&expectedContext!==latestContext.current))return;if(saved&&!refused){setDirty(false);setError('');}else setError('Could not save page. Your selection has been retained.');}
  catch{if(submission===attempt.current&&generation===version.current&&(submittedContext===latestContext.current||expectedContext===latestContext.current))setError('Could not save page. Your selection has been retained.');}
  finally{if(submission===attempt.current)setSaving(false);}
 };
 const actions=<><span className="pivot-drawer-editor-foot"><button type="button" className="pivot-page-save" disabled={readonly||pending||saving||staleDraft||!categoryId||!draft.confirmed} onClick={()=>void publish()}>Save page</button><button type="button" className="card-action" disabled={readonly||pending||saving||staleDraft||!model.layout.page} onClick={()=>void publish(true)}>Delete page</button></span></>;
 return <section className="pivot-page-panel" aria-label="Pages"><p className="pivot-page-note">{effectiveSummary?`Saved Page draft · current report: ${effectiveSummary}. Saving this draft does not change the linked group or viewer session.`:'Select one category and save its complete member set.'}</p><div className="pivot-page-grid"><fieldset><legend>Page</legend><label>Pages category<select value={categoryId} disabled={readonly||pending} onChange={e=>{mutate({...draft,categoryId:e.target.value,keys:[],confirmed:false});setSearch('');}}><option value="">Choose category</option>{model.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <details><summary aria-label="Selected Page members" title={summary}>{summary.length>160?`${summary.slice(0,160)}… (${draft.keys.length} members)`:summary}</summary><textarea aria-label="All selected Page members" readOnly value={summary}/></details>
 <label>Page member<select value={draft.keys.length===1?draft.keys[0]:''} disabled={readonly||pending||staleDraft||!members} onChange={e=>mutate({...draft,keys:[e.target.value],confirmed:true})}>{index<0?<option value={draft.keys.length===1?draft.keys[0]:''}>{draft.keys.length>1?`${draft.keys.length} selected members`:draft.keys.length?'Unavailable page':'No members selected'}</option>:null}{members?.map(m=><option key={m.key} value={m.key}>{m.label||'(Blank)'} ({m.count})</option>)}</select></label>
 <div className="pivot-page-navigation"><button type="button" className="card-action" disabled={readonly||pending||staleDraft||index<=0} onClick={()=>mutate({...draft,keys:[members![index-1].key],confirmed:true})}>Previous page</button><button type="button" className="card-action" disabled={readonly||pending||staleDraft||index<0||index>=(members?.length??0)-1} onClick={()=>mutate({...draft,keys:[members![index+1].key],confirmed:true})}>Next page</button></div>
 <label className="pivot-page-promotion"><input type="checkbox" checked={draft.promote} disabled={readonly||staleDraft||!categoryId} onChange={e=>mutate({...draft,promote:e.target.checked})}/>Show the page selector in the Parameters row (always first)</label>
 {unavailable.length?<p role="alert" className="pivot-page-note">Unavailable page members retained: {unavailable.map(memberLabel).join(', ')}. Remove them explicitly to change this intent.</p>:null}
 </fieldset><fieldset><legend>Members</legend><label>Search Page members<input value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="pivot-page-navigation"><button type="button" className="card-action" disabled={readonly||pending||staleDraft||!members} onClick={()=>mutate({...draft,keys:[...new Set([...draft.keys,...members!.map(m=>m.key)])],confirmed:true})}>Select all</button><button type="button" className="card-action" disabled={readonly||staleDraft||!categoryId} onClick={()=>mutate({...draft,keys:[],confirmed:true})}>None</button></div>
 <ul className="pivot-page-members">{[...(members??[]),...unavailable.map(key=>({key,label:memberLabel(key)+' (unavailable)',count:0}))].filter(m=>m.label.toLowerCase().includes(search.toLowerCase())).map(m=><li key={m.key} data-selected={selectedKeys.has(m.key)||undefined}><label title={m.key}><input type="checkbox" disabled={readonly||pending||staleDraft} checked={selectedKeys.has(m.key)} onChange={e=>mutate({...draft,keys:e.target.checked?[...draft.keys,m.key]:draft.keys.filter(key=>key!==m.key),confirmed:true})}/>{m.label||'(Blank)'}{(labelCounts.get(m.label||'(Blank)')??0)>1?` · ${'value' in m?m.value===null?'blank':typeof m.value:'unavailable'}`:''} ({m.count})</label></li>)}</ul>
 {!members?<p className="pivot-page-note">{pending?'Loading members…':'Choose a category to load eligible members.'}</p>:null}</fieldset></div>{staleDraft?<p role="alert">Page context changed. Your draft is retained; choose the category again to review it.</p>:null}{error||metadataError?<p role="alert">{error||metadataError}</p>:null}<DrawerFooterActions inline="pivot-page-actions">{actions}</DrawerFooterActions></section>;
}
