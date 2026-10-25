// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {EvaluatedRows} from './formulaEvaluation';
import type {TableModelV1} from './types';
export type GroupResolution={status:'resolved'|'refused';reason?:'ambiguous'|'partial'|'budget';keys:string[];unmatched:string[];inputCount:number;classificationComplete:boolean};
export const GROUP_RESOLUTION_WORK=100000;
/** Legacy transport has no quoting. Prove complete supported interpretations before choosing one. */
export function resolveGroupTransport(raw:string,domain:ReadonlyMap<string,readonly string[]>,complete:boolean,work=GROUP_RESOLUTION_WORK):GroupResolution{
 const parts=raw===''?[]:raw.split(',');const base={keys:[] as string[],unmatched:[] as string[],inputCount:parts.length,classificationComplete:complete};
 const refused=(reason:GroupResolution['reason']):GroupResolution=>({...base,status:'refused',reason});
 if(parts.length>1024)return refused('budget');if(parts.length>1&&!complete)return refused('partial');if(!parts.length)return {...base,status:'resolved'};
 if(parts.length===1)return {...base,status:'resolved',keys:[...(domain.get(raw)??[])],unmatched:complete&&!domain.has(raw)?[raw]:[]};
 let commaDomain=false;for(const label of domain.keys()){if(--work<0)return refused('budget');if(label.includes(',')){commaDomain=true;break;}}
 if(!commaDomain){if(work<parts.length)return refused('budget');return {...base,status:'resolved',keys:[...new Set(parts.flatMap(token=>domain.get(token)??[]))],unmatched:complete?parts.filter(token=>!domain.has(token)):[]};}
 type Interpretation={tokens:string[];keys:string[]};
 let exhausted=false;
 const spend=()=>{if(--work<0){exhausted=true;return false;}return true;};
 const parseMode=(allowAbsent:boolean)=>{
  const memo=new Map<number,Interpretation[]>();
  const parse=(start:number):Interpretation[]=>{
   if(start===parts.length)return [{tokens:[],keys:[]}];const cached=memo.get(start);if(cached)return cached;
   const answers:Interpretation[]=[];const signatures=new Set<string>();let text='';
   const add=(token:string,end:number)=>{for(const tail of parse(end)){if(!spend())break;const keys=[...new Set([...(domain.get(token)??[]),...tail.keys])];const signature=JSON.stringify([...keys].sort());if(signatures.has(signature))continue;signatures.add(signature);answers.push({tokens:[token,...tail.tokens],keys});
     // Keep at most two distinct matched resolutions plus the no-hit path.
     if(answers.filter(answer=>answer.keys.length).length===2)break;}};
   for(let end=start;end<parts.length;end++){if(!spend())break;text+=(end===start?'':',')+parts[end];if(domain.has(text))add(text,end+1);if(exhausted||answers.filter(answer=>answer.keys.length).length===2)break;}
   if(allowAbsent&&!domain.has(parts[start])&&!exhausted&&answers.filter(answer=>answer.keys.length).length<2)add(parts[start],start+1);
   memo.set(start,answers);return answers;
  };
  return parse(0);
 };
 let interpretations=parseMode(false);if(exhausted)return refused('budget');if(interpretations.length>1)return refused('ambiguous');
 if(!interpretations.length){interpretations=parseMode(true).filter(answer=>answer.keys.length);if(exhausted)return refused('budget');if(interpretations.length>1)return refused('ambiguous');}
 const tokens=interpretations[0]?.tokens??parts;
 const keys=[...new Set(tokens.flatMap(token=>domain.get(token)??[]))];const unmatched=complete?tokens.filter(token=>!domain.has(token)):[];
 return {...base,status:'resolved',keys,unmatched,inputCount:tokens.length};
}
export function observedGroupResolution(raw:string,model:TableModelV1,categoryId:string,input:EvaluatedRows):GroupResolution{
 const category=model.categories.find(c=>c.id===categoryId);const domain=new Map<string,string[]>();let complete=Boolean(category);
 for(const row of input.rows){const member=input.members.get(row.id)?.get(categoryId);if(!member?.ok){complete=false;continue;}const text=category?.transform==='native'&&!category.legacyBucket?String(member.value.value):member.value.label;const keys=domain.get(text)??[];if(!keys.includes(member.value.key))keys.push(member.value.key);domain.set(text,keys);}
 return resolveGroupTransport(raw,domain,complete);
}
