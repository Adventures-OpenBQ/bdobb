// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {FormulaAst,TableModelV1} from './types';
import {astChildren} from './formulaSyntax';
/** Fingerprint only source formulas reachable from the Page field; cosmetic edits compose. */
function sourceRecipe(model:TableModelV1,fieldId:string) {
 const formulas=new Map(model.formulas.filter(f=>f.scope==='source').map(f=>[f.id,f]));
 if(!formulas.has(fieldId))return undefined;
 const pending=[fieldId],seen=new Set<string>(),definitions:[string,FormulaAst|undefined][]=[];
 while(pending.length){
  const id=pending.pop()!;if(seen.has(id))continue;seen.add(id);
  const formula=formulas.get(id);definitions.push([id,formula?.ast]);
  const nodes:FormulaAst[]=formula?[formula.ast]:[];
  while(nodes.length){const node=nodes.pop()!;if(node.kind==='reference'&&node.target==='formula')pending.push(node.id);nodes.push(...astChildren(node));}
 }
 return definitions.sort((a,b)=>a[0].localeCompare(b[0]));
}
export const categoryAuthoringRecipe=(model:TableModelV1,id:string)=>{
 const c=model.categories.find(c=>c.id===id);
 return JSON.stringify(c&&[c.id,c.sourceFieldId,c.transform,c.legacyBucket,c.fiscalBinding,sourceRecipe(model,c.sourceFieldId)]);
};
