import {groupDomainPage} from './groupDomain';
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { AggName } from '../types';
import type { FormulaAst } from '../tableModel/types';
import type { CalculatedView, DefinitionInspection, InspectionCounts, InspectionPage, InspectionRequest, PeriodInspection, WarningInspection } from './types';
import { filterKindFor } from '../tableFiltering';
import { ExecutionProtocolError } from './validation';
const warnings = (view: CalculatedView) => view.analytical?.warnings ?? [];
export function inspectionCounts(view: CalculatedView): InspectionCounts {
  const model = view.analytical?.compiled.model;
  return { definitions: model ? model.categories.length + model.measures.length + model.formulas.length : 0,
    warnings: warnings(view).length, periodBounds: warnings(view).reduce((n,w) => n + (w.periods?.length ?? 0),0) };
}
/** Project metadata only. Record identities, scope maps and evaluator inputs stay private. */
export function inspectionPage(view: CalculatedView, request: InspectionRequest): InspectionPage {
  if(request.collection==='groupDomain')return groupDomainPage(view,request);
  if (!['definitions','warnings','periodBounds'].includes(request.collection) || !Number.isSafeInteger(request.offset) || request.offset < 0 || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 100)
    throw new ExecutionProtocolError('INVALID_REQUEST','Inspection page must have a nonnegative offset and limit 1–100');
  const model = view.analytical?.compiled.model;
  if(request.definitionId!==undefined&&(request.collection!=='definitions'||typeof request.definitionId!=='string'||!request.definitionId||new TextEncoder().encode(request.definitionId).length>16384))throw new ExecutionProtocolError('INVALID_REQUEST','Invalid definition selector');
  const matches=request.definitionId===undefined?undefined:[...model?.categories??[],...model?.measures??[],...model?.formulas??[]].filter(d=>d.id===request.definitionId);
  if(matches&&matches.length>1)throw new ExecutionProtocolError('INVALID_REQUEST','Definition selector is ambiguous');
  const total = matches?.length??inspectionCounts(view)[request.collection as Exclude<InspectionRequest['collection'],'groupDomain'>];
  const formulasById=new Map(model?.formulas.map(formula=>[formula.id,formula])??[]);
  const measuresById=new Map(model?.measures.map(measure=>[measure.id,measure])??[]);
  const rows: InspectionPage['rows'] = [];
  let index = 0;
  const add = (row: () => InspectionPage['rows'][number]) => { if (index >= request.offset && rows.length < request.limit) rows.push(row()); index++; };
  const bound = (id: string, name: string, kind: DefinitionInspection['kind'], ast?: FormulaAst, source?: string, operator?: AggName): DefinitionInspection => {
    const references = new Set<string>(source ? [source] : []), operators = new Set<AggName>(operator ? [operator] : []);
    const visited = new Set<string>();
    const pending: {node:FormulaAst;direct:boolean}[]=ast?[{node:ast,direct:true}]:[];
    while(pending.length) {
      const {node,direct}=pending.pop()!;
      switch(node.kind) {
        case 'reference': {
          if(direct) references.add(node.id);
          if(node.target==='measure') {const measure=measuresById.get(node.id);if(measure?.aggregation) operators.add(measure.aggregation);}
          if(node.target==='formula' && !visited.has(node.id)) {visited.add(node.id);const formula=formulasById.get(node.id);if(formula) pending.push({node:formula.ast,direct:false});}
          break;
        }
        case 'unary': pending.push({node:node.operand,direct});break;
        case 'binary': pending.push({node:node.right,direct},{node:node.left,direct});break;
        case 'call': if(node.function!=='IF') operators.add(node.function);for(const arg of [...node.args].reverse())pending.push({node:arg,direct});break;
        case 'member': if(direct)node.selectors.forEach(selector=>references.add(selector.categoryId));pending.push({node:node.value,direct});break;
      }
    }
    return {kind,id,name,referenceIds:[...references].slice(0,100),referenceCount:references.size,truncatedReferences:references.size>100,resolvedOperators:[...operators]};
  };
  if (request.collection === 'definitions' && model) {
    for(const category of model.categories.filter(d=>request.definitionId===undefined||d.id===request.definitionId)) add(()=>bound(category.id,category.name,'category',undefined,category.sourceFieldId));
    for(const measure of model.measures.filter(d=>request.definitionId===undefined||d.id===request.definitionId)) add(()=>bound(measure.id,measure.customLabel??measure.sourceFieldId,'measure',undefined,measure.sourceFieldId,measure.aggregation));
    for(const formula of model.formulas.filter(d=>request.definitionId===undefined||d.id===request.definitionId)) add(()=>{
      const projected=bound(formula.id,formula.name,'formula',formula.ast);
      if(formula.scope==='source'){
        const column=view.analytical?.pool.universe.columns.find(c=>c.id===formula.id);
        projected.scope='source';
        projected.sourceFilterKind=filterKindFor({field:formula.id,header:formula.name,cellDataType:column?.dtype,renderFn:[],colorRules:[],hiddenByDefault:false},view.analytical?.pool.universe.rows.map(r=>r.values)??[]);
      }
      return projected;
    });
  } else for(const [i,warning] of warnings(view).entries()) {
    const id=`warning:${i}`;
    if(request.collection==='warnings') add((): WarningInspection=>({kind:'warning',id,code:warning.code,message:warning.message,...(warning.categoryId?{categoryId:warning.categoryId}:{}),periodCount:warning.periods?.length??0}));
    else for(const period of warning.periods??[]) add((): PeriodInspection=>({kind:'periodBounds',warningId:id,...(warning.categoryId?{categoryId:warning.categoryId}:{}),companyKey:period.companyKey,start:period.start,end:period.end,source:period.source,period:model?.categories.find(c=>c.id===warning.categoryId)?.transform??'native',context:warning.message}));
  }
  const nextOffset=request.offset+rows.length;
  return {collection:request.collection,offset:request.offset,limit:request.limit,...(request.definitionId===undefined?{}:{definitionId:request.definitionId}),rows,total,truncated:nextOffset<total,...(nextOffset<total?{nextOffset}:{})};
}
