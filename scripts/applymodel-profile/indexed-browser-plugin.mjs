// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {insertOnce} from './instrument.mjs';
export function indexedBrowserPlugin(root){return {name:'audit-indexed-worker',setup(b){
 const helper=join(root,'scripts/applymodel-profile/indexed-sort-prototype.ts');
 b.onResolve({filter:/^node:assert\/strict$/},()=>({path:join(root,'scripts/applymodel-profile/browser-assert.ts')}));
 b.onResolve({filter:/^audit-reconcile$/},()=>({path:join(root,'src/lib/tableExecution/engine.ts')}));
 b.onResolve({filter:/^audit-store-owned$/},()=>({path:join(root,'src/lib/tableExecution/resultStore.ts')}));
 b.onLoad({filter:/\/sort-cache-prototype\.ts$/},async({path})=>{const s=await readFile(path,'utf8'),a=s.indexOf('export function reserveGraph('),z=s.indexOf('const canonicalDefinition=',a);if(a<0||z<a)throw Error('reservation extraction drift');return {contents:s.slice(a,z),loader:'ts'};});
 b.onLoad({filter:/\/tableExecution\/engine\.ts$/},async({path})=>{
  let s=await readFile(path,'utf8');const anchor='  return reconcileView(view,selection,reconcile,previousSelectionNamespace,provenAbsentIds);',at=s.lastIndexOf(anchor);if(at<0)throw Error('analytical reconciliation drift');
  s=s.slice(0,at)+"  if((globalThis as any).__captureOrder)attachGeneratedOrder(view,definition,runtimeParams);\n"+s.slice(at);
  s=insertOnce(s,'  input = structuredClone(input);',"  ((globalThis as any).__auditState??={}).calculations=(((globalThis as any).__auditState??={}).calculations??0)+1;\n  input = structuredClone(input);");
  return {contents:`import {attachGeneratedOrder} from ${JSON.stringify(helper)};\n`+s+'\nexport {reconcileView};\n',loader:'ts'};
 });
 b.onLoad({filter:/\/tableModel\/calculate\.ts$/},async({path})=>{
  let s=await readFile(path,'utf8');
  s=insertOnce(s,'    const groups: LogicalGroup[] = [];','    const auditPositions=(globalThis as any).__captureOrder?new Map<object,number>():undefined;\n    const groups: LogicalGroup[] = [];');
  s=insertOnce(s,'        sortForDisplay(rows, (row, id) => sourceSortValue(row, id, false));','        rows.forEach((row,i)=>auditPositions?.set(row,i));\n        sortForDisplay(rows, (row, id) => sourceSortValue(row, id, false));');
  s=insertOnce(s,'            rows.length = 0;','            if(auditPositions){const capture=(nodes:LogicalGroup[])=>nodes.forEach((node,i)=>{auditPositions.set(node,i);if(node.children.length)capture(node.children);else node.rows.slice(1).forEach((row,j)=>auditPositions.set(row,j));});capture(groups);}\n            rows.length = 0;');
  s=insertOnce(s,'    return { paramDiagnostics,','    return { ...(auditPositions?{__auditPositions:auditPositions}:{}),paramDiagnostics,');
  return {contents:s,loader:'ts'};
 });
 b.onLoad({filter:/\/tableExecution\/resultStore\.ts$/},async({path})=>{
  let s=await readFile(path,'utf8');
  s=insertOnce(s,'  view = structuredClone(view);\n  revision = structuredClone(revision);','  return buildAuditOwnedStore(structuredClone(view),structuredClone(revision));\n}\nexport function buildAuditOwnedStore(view:CalculatedView,revision:Revision):ResultStore {');
  s=insertOnce(s,'  return {\n    ready(',`  return {\n    __auditStats(){return indexedStats(view);},\n    __auditOrderCount(){return indexEntries(view);},\n    __auditCanResort(definition,runtime,next){return next.widgetId===revision.widgetId&&next.input===revision.input&&next.model>revision.model&&next.output>revision.output&&canIndexedResort(view,definition,runtime);},\n    __auditResort(definition,selection,next,runtime){const candidate=indexedReorder(view,definition,selection,runtime);return buildAuditOwnedStore(candidate,structuredClone(next));},\n    ready(`);
  return {contents:`import {indexedStats,indexedReorder,canIndexedResort,indexEntries} from ${JSON.stringify(helper)};\n`+s,loader:'ts'};
 });
 b.onLoad({filter:/\/tableExecution\/table\.worker\.ts$/},async({path})=>{
  let s=await readFile(path,'utf8'),at=s.indexOf("// Importing the handler in tests");if(at<0)throw Error('worker entry drift');s=s.slice(0,at);
  const anchor='          const view = calculateView(input, request.definition, request.selection, request.reconcileMissing, request.previousSelectionNamespace, request.provenAbsentIds, request.runtimeParams);';
  s=insertOnce(s,anchor,`          const budget=(globalThis as any).__indexedBudget??0,audit=(globalThis as any).__auditState??={};\n          const eligible=budget>0&&(request.definition.analytical as any)?.schemaVersion===1&&(request.definition.analytical as any)?.enabled===true&&(((request.definition.analytical as any)?.layout?.rows?.length??0)>0||!((request.definition.analytical as any)?.layout?.columns?.length))&&request.reconcileMissing!==false&&request.previousSelectionNamespace===undefined&&!(request.provenAbsentIds?.length);\n          const requestBytes=eligible?reserveGraph({definition:request.definition,selection:request.selection,runtime:request.runtimeParams},budget):Infinity;\n          if(eligible&&Number.isFinite(requestBytes)&&(store as any)?.__auditCanResort(request.definition,request.runtimeParams,request.revision)){\n            const needed=(store as any).__auditStats().wholeReservation*2+requestBytes*4;audit.admission=needed;\n            if(needed<=budget){const candidate=(store as any).__auditResort(request.definition,request.selection,request.revision,request.runtimeParams);store=candidate;audit.hit=true;audit.orderEntries=(store as any).__auditOrderCount();const ready=store.ready(request.requestId,request.revision);context={completeness:ready.completeness,diagnostics:ready.diagnostics};send(ready);break;}\n            audit.reason='warm-admission';\n          }\n          const depth=(request.definition.analytical as any)?.layout?.rows?.length??0;\n          const captureBound=4096+512*(input.rows.length*(depth+1)*4+101)+requestBytes*4+reserveGraph(input.freshness.diagnostics??[],budget)*2;\n          audit.capture=eligible&&captureBound<=budget;audit.captureBound=captureBound;\n          let view;try{(globalThis as any).__captureOrder=audit.capture;\n            view = calculateView(input, request.definition, request.selection, request.reconcileMissing, request.previousSelectionNamespace, request.provenAbsentIds, request.runtimeParams);\n          }finally{(globalThis as any).__captureOrder=false;}\n          audit.hit=false;`);
  s=insertOnce(s,"          view.diagnostics = [...(input.freshness.diagnostics ?? []).map(message => ({ code: 'INPUT', message, severity: 'warning' as const })), ...view.diagnostics];", "          const fresh=(input.freshness.diagnostics??[]).map(message=>({code:'INPUT',message,severity:'warning' as const}));\n          view.diagnostics=[...fresh,...view.diagnostics];if((view as any).__auditOrder)(view as any).__auditOrder.diagnostics=[...fresh,...(view as any).__auditOrder.diagnostics];");
  s=insertOnce(s,'          store = createResultStore(view, request.revision);','          store = createResultStore(view, request.revision);audit.orderEntries=(store as any).__auditOrderCount();');
  return {contents:`import {reserveGraph} from ${JSON.stringify(join(root,'scripts/applymodel-profile/sort-cache-prototype.ts'))};\n`+s,loader:'ts'};
 });
}};}
