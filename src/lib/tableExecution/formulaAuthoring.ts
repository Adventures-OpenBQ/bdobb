// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {compileAnalyticalModel,type AnalyticalModel} from '../tableModel/calculate';
import {evaluateSourceFormulas} from '../tableModel/formulaEvaluation';
import {eligiblePool,type EligiblePool} from '../tableModel/facets';
import {validateFiscalContext} from '../tableModel/fiscalContext';
import {categoryAuthoringRecipe} from '../tableModel/categoryAuthoringRecipe';
import {bindFormula} from '../tableModel/formulaBinding';
import {parseFormula,validateFormulaAst,type FormulaDiagnostic} from '../tableModel/formulaSyntax';
import {rememberFormulaBindings,rememberMembers,applyBindings,chronological} from '../tableModel/formulaProvenance';
import {validateFormulaGraph} from '../tableModel/formulaGraph';
import type {FormulaAst} from '../tableModel/types';
import type {WidgetDataset} from '../widgetData/types';
import type {AggName} from '../types';
import type {FormulaBindRequest,FormulaBindResult,MemberDomainRequest,MemberDomainResult,ObservedMember,TableDefinition,AuthoringWarnings} from './types';
import {ExecutionProtocolError} from './validation';
import {byteLength} from './formulaAuthoringProtocol';
type Context={compiled:AnalyticalModel;pool:EligiblePool};
const contexts=new WeakMap<WidgetDataset,Map<string,Context>>();
/** Private acquired context cache. Authoring never renders, applies, or publishes a view. */
function context(input:WidgetDataset,definition:TableDefinition):Context{
 let cache=contexts.get(input);if(!cache){cache=new Map();contexts.set(input,cache);}const key=JSON.stringify(definition);const cached=cache.get(key);if(cached)return cached;
 const fiscal=validateFiscalContext(input.provenance.metadata?.fiscalContext),compiled=compileAnalyticalModel(definition.analytical,{columns:input.columns,fiscal:fiscal.context});
 const evaluated=evaluateSourceFormulas(input.rows,compiled),columns=[...evaluated.columns,...compiled.model.categories.filter(c=>compiled.model.enabled||definition.table.columnFilters?.some(f=>f.id===c.id)).map(c=>({id:c.id,label:c.name}))];
 const pool=eligiblePool(evaluated,{columns,table:definition.table,search:definition.search,checklists:compiled.model.checklists});const result={compiled,pool};if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,result);return result;
}
function categoryErrors(pool:EligiblePool,id:string):number{return pool.universe.rows.filter(row=>pool.universe.members.get(row.id)?.get(id)?.ok!==true).length;}
const scalar=(v:unknown):v is number|string|boolean|null=>v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
const preview=(v:string,max:number)=>{let output='',size=0;for(const char of v){const bytes=byteLength(char);if(size+bytes>max)break;output+=char;size+=bytes;}return output;};
function warningProjection(pool:EligiblePool):AuthoringWarnings{
 const source=pool.universe.warnings,rows:AuthoringWarnings['authoringWarnings']=[];let size=2;
 for(const w of source){const row={code:w.code,message:preview(w.message,1024),severity:'warning' as const};const bytes=byteLength(JSON.stringify(row))+1;if(rows.length>=100||size+bytes>16384)break;rows.push(row);size+=bytes;}
 return {authoringWarnings:rows,authoringWarningCount:source.length,authoringWarningsTruncated:rows.length<source.length};
}
function diagnosticsProjection(diagnostics:FormulaDiagnostic[]):Pick<FormulaBindResult,'bindingDiagnostics'|'diagnosticCount'|'truncated'>{
 const rows:FormulaDiagnostic[]=[];let size=2;
 for(const d of diagnostics){if(byteLength(d.message)>1024||d.definitionId&&byteLength(d.definitionId)>16384||['dependencyIds','candidateIds'].some(k=>{const ids=d[k as 'dependencyIds'|'candidateIds'];return ids&&(ids.length>100||ids.some(id=>byteLength(id)>16384));}))continue;const row:FormulaDiagnostic={code:d.code,message:preview(d.message,1024),...(d.position===undefined?{}:{position:d.position})};if(d.definitionId&&byteLength(d.definitionId)<=16384)row.definitionId=d.definitionId;
  for(const k of ['dependencyIds','candidateIds'] as const)if(d[k])row[k]=d[k]!.slice(0,100).filter(id=>byteLength(id)<=16384);
  const bytes=byteLength(JSON.stringify(row))+1;if(rows.length>=100||size+bytes>131072)break;rows.push(row);size+=bytes;
 }
 return {bindingDiagnostics:rows,diagnosticCount:diagnostics.length,truncated:rows.length<diagnostics.length};
}
function operators(ast:FormulaAst,compiled:AnalyticalModel):AggName[]{
 const result=new Set<AggName>(),nodes=[ast],seen=new Set<string>();while(nodes.length){const n=nodes.pop()!;switch(n.kind){case'reference':if(n.target==='measure'){const m=compiled.model.measures.find(m=>m.id===n.id);if(m?.aggregation)result.add(m.aggregation);}else if(n.target==='formula'&&!seen.has(n.id)){seen.add(n.id);const f=compiled.graph.entries.find(e=>e.value?.id===n.id)?.value;if(f)nodes.push(f.ast);}break;case'call':if(n.function!=='IF')result.add(n.function);nodes.push(...n.args);break;case'binary':nodes.push(n.left,n.right);break;case'unary':nodes.push(n.operand);break;case'member':nodes.push(n.value);break;}}
 return [...result];
}
export function bindObservedFormula(input:WidgetDataset,request:FormulaBindRequest):Omit<FormulaBindResult,'kind'|'requestId'|'revision'|'completeness'|'diagnostics'>{
 const {compiled,pool}=context(input,request.definition),{draft}=request;const originals=compiled.graph.entries.filter(e=>e.value?.id===draft.id);const original=originals.length===1?originals[0].value:undefined;
 const parsed=parseFormula(draft.expression);let diagnostics:FormulaDiagnostic[]=[...parsed.diagnostics],ast:FormulaAst|undefined;
 if(originals.length>1)diagnostics.push({code:'duplicate-id',message:'Formula ID is ambiguous.',definitionId:draft.id});
 const bindings=rememberFormulaBindings(original);for(const b of request.bindings)bindings.set(`${b.scope}\0${b.name}`,b.reference);
 const symbols={...compiled.symbols,formulas:[...compiled.symbols.formulas.filter(f=>f.id!==draft.id),draft],categories:compiled.symbols.categories.map(c=>({...c,members:[...(pool.observedMembers.get(c.id)?.values()??[])].flatMap(m=>scalar(m.value)?[{key:m.key,value:m.value}]:[])}))};
 if(parsed.ast&&!diagnostics.length){const syntax=original&&original.expression===draft.expression?original.ast:applyBindings(parsed.ast,bindings,rememberMembers(original),draft.scope);const bound=bindFormula(syntax,symbols,draft.scope,{boundMembers:'structural'});ast=bound.ast;diagnostics=bound.diagnostics.map(d=>d.code==='missing-member'&&d.dependencyIds?.[0]&&categoryErrors(pool,d.dependencyIds[0])>0?{code:'blocked-dependency',message:'Member identity is unknown because acquired category classification is incomplete.',dependencyIds:[d.dependencyIds[0]]}:d);
  if(ast){const definitions=[...compiled.graph.entries.filter(e=>e.value?.id!==draft.id).map(e=>e.raw),{...draft,ast}];const graph=validateFormulaGraph(definitions,symbols,{boundMembers:'structural'});diagnostics.push(...graph.diagnostics.filter(d=>d.definitionId===draft.id));
   const dates=new Set(compiled.model.categories.filter(c=>c.transform!=='native'||c.legacyBucket).map(c=>c.sourceFieldId)),companies=new Set(compiled.model.categories.flatMap(c=>c.fiscalBinding?[c.fiscalBinding.companyFieldId]:[]));if(chronological(ast)&&(dates.size!==1||companies.size>1))diagnostics.push({code:'scope',message:'First and Last require one declared temporal category and an unambiguous company mapping.'});
   if(byteLength(JSON.stringify(ast))>131072||!validateFormulaAst(ast).ast)diagnostics.push({code:'node-limit',message:'Bound formula exceeds the authoring AST budget.'});
  }
 }
 const projection=diagnosticsProjection(diagnostics);return {...warningProjection(pool),...projection,...(ast&&!diagnostics.length?{ast}:{}),resolvedOperators:ast&&!diagnostics.length?operators(ast,compiled):[]};
}
export function observedMemberPage(input:WidgetDataset,request:MemberDomainRequest):Omit<MemberDomainResult,'kind'|'requestId'|'revision'|'completeness'|'diagnostics'>{
 const {compiled,pool}=context(input,request.definition);const matches=compiled.model.categories.filter(c=>c.id===request.categoryId);
 if(matches.length!==1||categoryAuthoringRecipe(compiled.model,request.categoryId)!==request.categoryRecipe)throw new ExecutionProtocolError('INVALID_REQUEST','Member domain requires the exact saved category recipe');
 const source=[...(pool.observedMembers.get(request.categoryId)?.values()??[])].filter(m=>request.search===undefined||m.label.toLowerCase().includes(request.search.toLowerCase()));let omittedCount=0;
 const projected=source.map(m=>{if(!scalar(m.value)||byteLength(m.key)>16384||byteLength(JSON.stringify(m.value))>16384){omittedCount++;return undefined;}const label=preview(m.label,256);const row:ObservedMember={key:m.key,label,labelTruncated:label!==m.label,value:m.value,observedCount:m.count,eligibleCount:pool.eligibleMembers.get(request.categoryId)?.get(m.key)?.count??0};if(byteLength(JSON.stringify(row))>131072){omittedCount++;return undefined;}return row;});
 const rows:ObservedMember[]=[];let index=Math.min(request.offset,projected.length),scanned=0,size=2;
 while(index<projected.length&&scanned<request.limit){const row=projected[index],bytes=row?byteLength(JSON.stringify(row))+1:0;if(size+bytes>131072)break;index++;scanned++;if(row){rows.push(row);size+=bytes;}}
 const errors=categoryErrors(pool,request.categoryId),truncated=index<projected.length;return {...warningProjection(pool),categoryId:request.categoryId,categoryRecipe:request.categoryRecipe,offset:request.offset,limit:request.limit,...(request.search===undefined?{}:{search:request.search}),rows,total:projected.length,...(truncated?{nextOffset:index}:{}),truncated,scanned,omittedCount,classificationComplete:errors===0&&pool.classificationComplete,categoryErrorCount:errors};
}
