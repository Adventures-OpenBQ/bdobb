// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DatasetColumn } from '../../../lib/widgetData/types';
import type { DefinitionPreview, MemberDomainResult } from '../../../lib/tableExecution/types';
import type { StatementIntent, StatementTemplate } from '../../../lib/statementModel/types';
import { statementOwnedIds } from '../../../lib/statementModel/types';
import { statementTemplate } from '../../../lib/statementModel/catalog';
import { statementSnapshot } from '../../../lib/statementModel/persistence';
import { compileStatement } from '../../../lib/statementModel/compile';
import { resetStatementOverrides } from '../../../lib/statementModel/overrides';
import { previewStatementUpdate, type StatementUpdateChange } from '../../../lib/statementModel/updates';
import { TableRenderer } from '../TableRenderer';
import { DrawerFooterActions } from '../pivot-drawer/DrawerFooterTarget';

export type StatementPanelProps = {
 raw?: unknown; columns: readonly DatasetColumn[]; readonly: boolean; contextKey: string;
 onPreview: (candidate: StatementIntent, signal: AbortSignal) => Promise<DefinitionPreview>;
 onCommit: (candidate: StatementIntent) => Promise<boolean>;
 onCompanies?: (field: string, offset: number, signal: AbortSignal) => Promise<MemberDomainResult>;
};
function newStatement(id: 'income'|'balance'|'cashflow'): StatementIntent {
 return {schemaVersion:2,kind:'statement',template:statementTemplate(id,'1.0.0')!,bindings:{shape:'wide',companyFieldId:'',periodKindFieldId:'',fiscal:{companyFieldId:''},mappings:[]},overrides:{labels:{},lineOrder:{},hiddenIds:[],formulas:[]},periodKind:'FY',checklists:[],resultFilters:[]};
}
const message = (error:unknown) => error instanceof Error ? error.message : 'Statement could not be validated.';
/** Draft-only authoring. The caller owns current source authority and every durable save. */
export function StatementPanel(props: StatementPanelProps) {
 const owner=JSON.stringify(props.raw);
 return <StatementDraft key={owner} {...props}/>;
}
function StatementDraft({raw,columns,readonly,contextKey,onPreview,onCommit,onCompanies}:StatementPanelProps) {
 const initial=useMemo(()=>{try{return {value:raw===undefined?newStatement('income'):statementSnapshot(raw)};}catch(error){return {error:message(error)};}},[raw]);
 const [draft,setDraft]=useState(initial.value);
 const [error,setError]=useState('');
 const [preview,setPreview]=useState<{value:DefinitionPreview;context:string;draft:StatementIntent}>();
 const [pending,setPending]=useState(false),[saving,setSaving]=useState(false);
 const [snapshotText,setSnapshotText]=useState(''),[conflicts,setConflicts]=useState<{id:string;reason:string}[]>([]),[resolution,setResolution]=useState('');
 const [companyResult,setCompanyPage]=useState<{field:string;page:MemberDomainResult}>();
 const companyPage=companyResult?.field===draft?.bindings.companyFieldId?companyResult?.page:undefined;
 const [changes,setChanges]=useState<readonly StatementUpdateChange[]>([]);
 const [formulaTexts,setFormulaTexts]=useState<Record<string,string>>({});
 const request=useRef<AbortController|undefined>(undefined);const generation=useRef(0);
 const authority=JSON.stringify([contextKey,columns,readonly]);const latest=useRef(authority);latest.current=authority;
 useEffect(()=>{generation.current++;request.current?.abort();setPending(false);setPreview(undefined);setCompanyPage(undefined);},[authority]);
 useEffect(()=>()=>request.current?.abort(),[]);
 const cancel=()=>{generation.current++;request.current?.abort();setPending(false);setPreview(undefined);};
 const edit=(next:StatementIntent)=>{cancel();if(next.bindings.companyFieldId!==draft?.bindings.companyFieldId)setCompanyPage(undefined);setDraft(next);setError('');};
 if(!draft)return <div className="table-model-authoring"><p role="alert">Statement is inert: {initial.error} Open Inspect → Advanced repair to review and repair the complete saved definition.</p></div>;
 const change=(fn:(next:StatementIntent)=>void)=>{const next=structuredClone(draft);fn(next);edit(next);};
 const selectField=(label:string,value:string|undefined,set:(id:string)=>void,optional=false)=> <label>{label}<select aria-label={label} value={value??''} onChange={e=>set(e.target.value)}><option value="">{optional?'Not mapped':'Choose source field'}</option>{value&&!columns.some(c=>c.id===value)?<option value={value}>Missing: {value}</option>:null}{columns.map(c=><option key={c.id} value={c.id}>{c.label} · {c.id}</option>)}</select></label>;
 const fiscalFields=[['dateFieldId','Report date'],['fiscalYearFieldId','Fiscal year'],['fiscalQuarterFieldId','Fiscal quarter'],['periodStartFieldId','Period start'],['periodEndFieldId','Period end']] as const;
 const calculate=async()=>{
  if(readonly||pending||saving)return;
  cancel();setError('');const token=++generation.current,context=authority,controller=new AbortController();request.current=controller;
  try{
   if(conflicts.length)throw new Error('Resolve template update conflicts first.');
   const candidate=statementSnapshot(draft);compileStatement(candidate,columns);
   if(candidate.bindings.shape==='wide'&&!candidate.bindings.mappings.length)throw new Error('Map at least one source line field.');
   setPending(true);const result=await onPreview(candidate,controller.signal);
   if(!controller.signal.aborted&&token===generation.current&&latest.current===context)setPreview({value:result,context,draft:candidate});
  }catch(e){if(!controller.signal.aborted&&token===generation.current&&latest.current===context)setError(message(e));}
  finally{if(token===generation.current)setPending(false);}
 };
 const save=async()=>{
  if(readonly||saving||!preview||preview.context!==authority)return;
  const token=generation.current;setSaving(true);setError('');
  try{if(!await onCommit(preview.draft)&&token===generation.current)setError('Could not save Statement. Your draft and last valid result are retained.');}
  catch(e){if(token===generation.current)setError(`${message(e)} Your draft is retained.`);}
  finally{setSaving(false);}
 };
 const update=()=>{try{const result=previewStatementUpdate(statementSnapshot(draft),JSON.parse(snapshotText) as StatementTemplate);edit(result.next);setConflicts(result.conflicts);setChanges(result.changes);const clean={...result.next} as StatementIntent&{updateConflicts?:unknown};delete clean.updateConflicts;setResolution(JSON.stringify(clean,null,2));}catch(e){setError(message(e));}};
 const loadCompanies=async(offset=0)=>{if(!onCompanies||readonly)return;cancel();const controller=new AbortController();request.current=controller;const context=authority;setPending(true);try{const page=await onCompanies(draft.bindings.companyFieldId,offset,controller.signal);if(!controller.signal.aborted&&latest.current===context)setCompanyPage({field:draft.bindings.companyFieldId,page});}catch(e){if(!controller.signal.aborted)setError(message(e));}finally{if(!controller.signal.aborted)setPending(false);}};
 const sections=(draft.overrides.sectionOrder??draft.template.sections.map(s=>s.id)).map(id=>draft.template.sections.find(s=>s.id===id)).filter(s=>s!==undefined);
 return <div className="table-model-authoring statement-panel">
  <div className="pivot-panel-row"><strong>{draft.template.id} · {draft.template.version}</strong><span className="pivot-filter-tag">Pinned snapshot</span><span>{raw===undefined?'New Statement draft':'Saved Statement · local draft edits'}</span></div>
  <p className="pivot-panel-note">Missing facts are never zero. Map optional monetary lines explicitly; labels and order do not change formula bindings.</p>
  <fieldset disabled={readonly||saving||pending} className="statement-fields"><legend>Source bindings</legend>
   {raw===undefined?<label>Template<select aria-label="Template" value={draft.template.id} onChange={e=>edit(newStatement(e.target.value as 'income'|'balance'|'cashflow'))}><option value="income">Income statement</option><option value="balance">Balance sheet</option><option value="cashflow">Cash flow statement</option></select></label>:null}
   <label>Source shape<select aria-label="Source shape" value={draft.bindings.shape} onChange={e=>change(n=>{n.bindings.shape=e.target.value as 'wide'|'long';n.bindings.mappings=[];if(n.bindings.shape==='long')n.bindings.longFields={itemFieldId:'',valueFieldId:''};else delete n.bindings.longFields;})}><option value="wide">Wide · fields become line items</option><option value="long">Long · item and value fields</option></select></label>
   <label>Fiscal period<select aria-label="Fiscal period" value={draft.periodKind} onChange={e=>change(n=>{n.periodKind=e.target.value as 'FY'|'FQ';if([n.bindings.fiscal.periodKind,n.bindings.fiscal.fiscalYearFieldId,n.bindings.fiscal.fiscalQuarterFieldId,n.bindings.fiscal.periodStartFieldId,n.bindings.fiscal.periodEndFieldId].some(v=>v!==undefined))n.bindings.fiscal.periodKind=n.periodKind;})}><option>FY</option><option>FQ</option></select></label>
   {selectField('Company',draft.bindings.companyFieldId,id=>change(n=>{n.bindings.companyFieldId=id;n.bindings.fiscal.companyFieldId=id;delete n.page;}))}
   {selectField('Fact period kind',draft.bindings.periodKindFieldId,id=>change(n=>{n.bindings.periodKindFieldId=id;}))}
   {fiscalFields.map(([key,label])=><span key={key}>{selectField(label,draft.bindings.fiscal[key],id=>change(n=>{if(id)n.bindings.fiscal[key]=id;else delete n.bindings.fiscal[key];}),true)}</span>)}
   {selectField('Currency',draft.bindings.currencyFieldId,id=>change(n=>{if(id)n.bindings.currencyFieldId=id;else delete n.bindings.currencyFieldId;}),true)}
   {selectField('Unit',draft.bindings.unitFieldId,id=>change(n=>{if(id)n.bindings.unitFieldId=id;else delete n.bindings.unitFieldId;}),true)}
   <label>Fiscal metadata key<input aria-label="Fiscal metadata key" value={draft.bindings.fiscal.metadataKey??''} onChange={e=>change(n=>{if(e.target.value)n.bindings.fiscal.metadataKey=e.target.value;else delete n.bindings.fiscal.metadataKey;})}/></label>
   {draft.bindings.shape==='long'?<>{selectField('Line item identity',draft.bindings.longFields?.itemFieldId,id=>change(n=>{n.bindings.longFields={...n.bindings.longFields!,itemFieldId:id};}))}{selectField('Monetary value',draft.bindings.longFields?.valueFieldId,id=>change(n=>{n.bindings.longFields={...n.bindings.longFields!,valueFieldId:id};}))}<p>Item values must contain the stable template line IDs shown below.</p></>:null}
  </fieldset>
  <fieldset disabled={readonly||saving||pending}><legend>Company Page</legend><p>All keeps every company. Select a company when monetary contexts differ; mixed contexts produce errors.</p><div className="pivot-panel-row"><button type="button" disabled={!onCompanies||!draft.bindings.companyFieldId} onClick={()=>void loadCompanies()}>Load company members</button><button type="button" onClick={()=>change(n=>{delete n.page;})}>All companies</button><span>{draft.page?`${draft.page.memberKeys.length} selected`:'All companies'}</span></div>
   {draft.page?.memberKeys.map(key=><label key={key}><input type="checkbox" checked onChange={()=>change(n=>{n.page!.memberKeys=n.page!.memberKeys.filter(k=>k!==key);})}/>{key}</label>)}
   {companyPage?.rows.filter(row=>!draft.page?.memberKeys.includes(row.key)).map(row=><label key={row.key}><input type="checkbox" checked={false} onChange={()=>{if(companyResult?.field!==draft.bindings.companyFieldId)return;change(n=>{n.page={categoryId:statementOwnedIds(n.template).company,memberKeys:[...(n.page?.memberKeys??[]),row.key]};});}}/>{row.label}</label>)}
   {companyPage?.nextOffset!==undefined?<button type="button" onClick={()=>void loadCompanies(companyPage.nextOffset)}>More companies</button>:null}
  </fieldset>
  <fieldset disabled={readonly||saving||pending}><legend>Line items and local overrides</legend><button type="button" onClick={()=>{edit(resetStatementOverrides(draft));setFormulaTexts({});}}>Reset all overrides</button>
   {sections.map((section,sectionIndex)=><section className="statement-section" key={section.id} aria-label={section.label}>
    <div className="pivot-panel-row"><label>Section label<input aria-label={`Section label ${section.label}`} value={draft.overrides.labels[section.id]??section.label} onChange={e=>change(n=>{n.overrides.labels[section.id]=e.target.value;})}/></label><span className="pivot-filter-tag">{draft.overrides.labels[section.id]||draft.overrides.lineOrder[section.id]||draft.overrides.sectionOrder||draft.overrides.hiddenIds.includes(section.id)?'Local':'Template'}</span><label><input aria-label={`Visible section ${section.label}`} type="checkbox" checked={!draft.overrides.hiddenIds.includes(section.id)} onChange={e=>change(n=>{n.overrides.hiddenIds=n.overrides.hiddenIds.filter(id=>id!==section.id);if(!e.target.checked)n.overrides.hiddenIds.push(section.id);})}/>Visible</label><button type="button" disabled={sectionIndex===0} onClick={()=>change(n=>{const order=sections.map(s=>s.id);[order[sectionIndex-1],order[sectionIndex]]=[order[sectionIndex],order[sectionIndex-1]];n.overrides.sectionOrder=order;})}>Move section up</button><button type="button" onClick={()=>edit(resetStatementOverrides(draft,section.id))}>Reset section</button></div>
    {(draft.overrides.lineOrder[section.id]??section.lineIds).map((id,index,order)=>{const line=draft.template.lines.find(l=>l.id===id);if(!line)return null;const inheritedHidden=draft.overrides.hiddenIds.includes(section.id);const local=draft.overrides.labels[id]!==undefined||draft.overrides.hiddenIds.includes(id)||draft.overrides.formulas.some(f=>f.id===line.formula?.id);return <div key={id} className="statement-line">
     <label>Label<input aria-label={`Label ${line.label}`} value={draft.overrides.labels[id]??line.label} onChange={e=>change(n=>{n.overrides.labels[id]=e.target.value;})}/></label><span className="pivot-filter-tag">{inheritedHidden?'Hidden by section':local?'Local':'Template'}</span><span>{line.policy} · {line.required?'Required':'Optional'} · {line.unit}</span>
     {draft.bindings.shape==='wide'&&line.policy!=='formula'?selectField(`Source ${line.label}`,draft.bindings.mappings.find(m=>m.lineId===id)?.sourceFieldId,value=>change(n=>{n.bindings.mappings=n.bindings.mappings.filter(m=>m.lineId!==id);if(value)n.bindings.mappings.push({lineId:id,sourceFieldId:value});}),true):null}
     <label><input aria-label={`Visible ${line.label}`} type="checkbox" disabled={inheritedHidden} checked={!inheritedHidden&&!draft.overrides.hiddenIds.includes(id)} onChange={e=>change(n=>{n.overrides.hiddenIds=n.overrides.hiddenIds.filter(h=>h!==id);if(!e.target.checked)n.overrides.hiddenIds.push(id);})}/>Visible</label>
     <button type="button" aria-label={`Move ${line.label} down`} disabled={index===order.length-1} onClick={()=>change(n=>{const next=[...order];[next[index],next[index+1]]=[next[index+1],next[index]];n.overrides.lineOrder[section.id]=next;})}>↓</button><button type="button" onClick={()=>{edit(resetStatementOverrides(draft,id));setFormulaTexts(current=>{const next={...current};delete next[id];return next;});}}>Reset line</button>
     <details><summary>Stable identity{line.formula?' and formula':''}</summary><code>{id}</code>{line.formula?<><p>Edit the bound formula definition. Keep its ID; AST references use stable identities.</p><textarea aria-label={`Formula ${line.label}`} value={formulaTexts[id]??JSON.stringify(draft.overrides.formulas.find(f=>f.id===line.formula!.id)??line.formula,null,2)} onChange={e=>{cancel();setFormulaTexts({...formulaTexts,[id]:e.target.value});}}/><button type="button" onClick={()=>{try{const formula=JSON.parse(formulaTexts[id]??'null');if(formula?.id!==line.formula!.id)throw new Error('Keep the template formula identity.');const next=structuredClone(draft);next.overrides.formulas=[...next.overrides.formulas.filter(f=>f.id!==formula.id),formula];compileStatement(statementSnapshot(next),columns);edit(next);}catch(e){setError(message(e));}}}>Use formula override</button></>:null}</details>
    </div>;})}
   </section>)}
  </fieldset>
  <details className="pivot-inspector-repair"><summary>Explicit template update</summary><p>Bundled catalog: 1.0.0. No newer bundled release is available. Paste a supplied validated snapshot to preview an explicit update.</p><label>Supplied template snapshot<textarea aria-label="Supplied template snapshot" readOnly={readonly||saving} value={snapshotText} onChange={e=>setSnapshotText(e.target.value)}/></label><button type="button" disabled={readonly||saving||pending} onClick={update}>Preview template update</button>
   {changes.length?<section aria-label="Template changes" className="statement-update-changes"><p>Review the proposed snapshot. Apply Statement model saves it after a successful calculation.</p>{changes.map((change,index)=><div key={index}><strong>{change.label} · {change.field}</strong><div className="statement-update-comparison"><div><b>Before</b><pre>{JSON.stringify(change.before,null,2)??'Not set'}</pre></div><div><b>After</b><pre>{JSON.stringify(change.after,null,2)??'Not set'}</pre></div></div></div>)}</section>:null}
   {conflicts.length?<><p role="alert">Resolve every update conflict before calculation or adoption.</p><ul>{conflicts.map(c=><li key={c.id}>{c.id}: {c.reason}</li>)}</ul><label>Resolved update intent<textarea aria-label="Resolved update intent" readOnly={readonly} value={resolution} onChange={e=>setResolution(e.target.value)}/></label><button type="button" disabled={readonly||saving} onClick={()=>{try{const resolved=statementSnapshot(JSON.parse(resolution));if(JSON.stringify(resolved.template)!==JSON.stringify(draft.template))throw new Error('Keep the proposed template identity.');compileStatement(resolved,columns);edit(resolved);setConflicts([]);}catch(e){setError(message(e));}}}>Validate conflict resolution</button></>:null}
  </details>
  {error?<p role="alert">{error}</p>:null}{pending?<p role="status">Calculating current source…</p>:null}
  {preview&&preview.context===authority?<section aria-label="Calculated Statement preview"><p>Calculated preview · {preview.value.rows.length} of {preview.value.total} rows. Missing or invalid facts remain errors.</p>{preview.value.diagnostics.map((d,i)=><p key={i}>{d.message}</p>)}<TableRenderer data={preview.value.rows.map(r=>r.values)} execution={{columns:preview.value.columns.map(c=>({field:c.id,header:c.label,cellDataType:c.dtype,format:c.format,renderFn:[],colorRules:[],hiddenByDefault:false})),count:preview.value.rows.length,rowIds:preview.value.rows.map(r=>r.id),slot:index=>({rowId:preview.value.rows[index]?.id,groupPath:[],offset:index}),requestRange:()=>{},toggle:()=>{},totals:{},showTotals:false,rowFormats:new Map(preview.value.rows.flatMap(r=>r.cellFormats?[[r.id,r.cellFormats]]:[])),rowErrors:new Map(preview.value.rows.flatMap(r=>r.cellErrors?[[r.id,r.cellErrors]]:[]))}}/></section>:null}
  <DrawerFooterActions inline="pivot-category-actions"><button type="button" disabled={readonly||pending||saving||!!conflicts.length} onClick={()=>void calculate()}>Calculate preview</button><button type="button" disabled={saving} onClick={cancel}>Cancel preview</button><button type="button" disabled={readonly||pending||saving||!preview||preview.context!==authority||!!conflicts.length} onClick={()=>void save()}>{saving?'Saving Statement…':'Apply Statement model'}</button></DrawerFooterActions>
 </div>;
}
