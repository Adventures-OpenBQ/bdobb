// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Test-only semantic oracle. Never imported by production or used for fallback. */
import { contractCases } from '../testContract';
import { calculateView } from '../engine';
import { createResultStore, type ResultStore } from '../resultStore';
import { bindObservedFormula, columnProfilePage, observedMemberPage } from '../formulaAuthoring';
import { identityWitness } from '../identityWitness';
import { validateLinkedBindings } from '../../tableModel/linkedBindings';
import { input } from '../fixtures';
import { categoryAuthoringRecipe } from '../../tableModel/categoryAuthoringRecipe';
import { categoryRecipe } from '../../tableModel/categories';
import { AGG_NAMES } from '../../types';
import type { TableModelV1 } from '../../tableModel/types';
import type { WidgetDataset } from '../../widgetData/types';
import type { TableDefinition, SelectionSpec, RuntimeParams, Revision, RowBlock, ViewReady, TotalResult, SelectionResult, FacetResult, InspectionResult, ChartResult, FormulaBindRequest, MemberDomainRequest, ColumnProfileRequest, InspectionRequest, SelectionAction, SubsetBatch } from '../types';

type WithoutRequest<T> = Omit<T, 'requestId'>;
export type OracleOperation =
  | { kind: 'selection'; action: SelectionAction; visibleIds?: string[] }
  | { kind: 'apply'; definition?: TableDefinition; runtimeParams?: RuntimeParams }
  | { kind: 'preview'; definition: TableDefinition }
  | ({ kind: 'bindFormula' } & FormulaBindRequest)
  | ({ kind: 'memberDomain' } & MemberDomainRequest)
  | ({ kind: 'columnProfile' } & ColumnProfileRequest)
  | { kind: 'inspect'; request: InspectionRequest }
  | { kind: 'linked'; definition: TableDefinition; selection?: SelectionSpec }
  | { kind: 'identityWitness'; path: TableDefinition[]; ids: string[] };
export type OracleCase = {name: string; dataset: WidgetDataset; definition: TableDefinition; selection: SelectionSpec; locale: string; runtimeParams?: RuntimeParams; operations: OracleOperation[]; expectFailure?: boolean};
export type OracleTree = {groupPath: string[]; siblingCount: number; rows: RowBlock['rows']; groups: RowBlock['groups']; selection?: RowBlock['selection']; children: OracleTree[]};
export type OracleSubset = {batches: WithoutRequest<SubsetBatch>[];columns: ViewReady['columns'];rows: WidgetDataset['rows'];provenance: WidgetDataset['provenance'];freshness: WidgetDataset['freshness'];completeness: WidgetDataset['completeness'];diagnostics: ViewReady['diagnostics'];revision: Revision};
export type OracleResult = {name: string; locale: string; ready?: WithoutRequest<ViewReady>; deliveries: {size:number;tree:OracleTree;blocks:WithoutRequest<RowBlock>[]}[]; totals?: WithoutRequest<TotalResult>; selection?: WithoutRequest<SelectionResult>; facets?: WithoutRequest<FacetResult>[]; inspection?: WithoutRequest<InspectionResult>[]; chart?: WithoutRequest<ChartResult>; linked?: OracleSubset; export?: OracleSubset; operations: {kind:OracleOperation['kind'];value:unknown}[]; error?: {name:string;code?:unknown;message:string;diagnostics?:unknown}};
export type Difference = {path:string;actual:unknown;expected:unknown;reason:string};
export const baselineLocale = new Intl.Collator(undefined, {sensitivity:'base',numeric:true}).resolvedOptions().locale;

const model = (): TableModelV1 => ({schemaVersion:1,enabled:true,params:{promotePage:true,filters:[]},categories:[],measures:[],formulas:[],layout:{rows:[],columns:[],values:[]},checklists:[],resultFilters:[],subtotals:{grandTotal:true,groups:true}});
const make = (name:string, dataset:WidgetDataset, definition:TableDefinition, selection:SelectionSpec={kind:'none'},operations:OracleOperation[]=[]):OracleCase => ({name,dataset,definition,selection,locale:baselineLocale,operations});
export const oracleCases: OracleCase[] = contractCases.map(c => ({...make(c.name,c.data,c.definition,c.selection),...(c.expectFailure?{expectFailure:true}:{})}));

const operatorsData:WidgetDataset = {...input,rows:[
  {id:'later',values:{region:'A',date:'2025-02-28',revenue:20}},
  {id:'tie-first',values:{region:'A',date:'2025-01-31',revenue:10}},
  {id:'null-latest',values:{region:'A',date:'2025-03-31',revenue:null}},
  {id:'tie-second',values:{region:'A',date:'2025-01-31',revenue:12}},
]};
const allMeasures=AGG_NAMES.map(aggregation=>({id:aggregation,sourceFieldId:'revenue',aggregation}));
oracleCases.push(make('legacy-all-operators',operatorsData,{table:{pivot:{enabled:true,grouping:['region'],split:[],measures:allMeasures}},search:''}));
const allModel=model();allModel.categories=[{id:'year',name:'Year',sourceFieldId:'date',transform:'Y'}];allModel.measures=allMeasures;allModel.layout={rows:['year'],columns:[],values:AGG_NAMES.slice()};
oracleCases.push(make('analytical-all-operators',operatorsData,{table:{},search:'',analytical:allModel}));
const ratio=model();ratio.categories=[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native'}];ratio.formulas=[{id:'ratio',name:'Ratio',scope:'aggregate',expression:'',ast:{kind:'binary',operator:'/',left:{kind:'call',function:'sum',args:[{kind:'reference',target:'field',id:'x'}]},right:{kind:'call',function:'sum',args:[{kind:'reference',target:'field',id:'y'}]}}}];ratio.layout={rows:['regionCategory'],columns:[],values:['ratio']};
oracleCases.push(make('ratio-source-scope',{...input,columns:[...input.columns,{id:'x',label:'X',dtype:'number'},{id:'y',label:'Y',dtype:'number'}],rows:[{id:'a',values:{region:'A',x:4,y:2}},{id:'b',values:{region:'B',x:2,y:4}}]},{table:{},search:'',analytical:ratio}));
const dimensions=[undefined,undefined,null,'',false,0,'0',9007199254740993n,NaN,Infinity,-Infinity,-0];
oracleCases.push(make('typed-blanks',{...input,columns:[{id:'dimension',label:'Dimension'},{id:'revenue',label:'Revenue',dtype:'number'}],rows:dimensions.map((value,i)=>({id:`typed-${i}`,values:i===0?{revenue:1}:{dimension:value,revenue:1}}))},{table:{pivot:{enabled:true,grouping:[],split:['dimension'],measures:[{id:'sum',sourceFieldId:'revenue',aggregation:'sum'}]}},search:''}));
oracleCases.push(make('duplicate-identity',{...input,rows:input.rows.map((row,i)=>({...row,id:i<2?'duplicate':'other'}))},{table:{},search:''},{kind:'explicit',ids:['duplicate']}));
const comparison=structuredClone(oracleCases.find(c=>c.name==='scoped-result-filters')!);
const missing=structuredClone(comparison.definition.analytical) as TableModelV1;missing.formulas.find(f=>f.id==='budget')!.ast={kind:'member',value:{kind:'reference',target:'measure',id:'revenueSum'},selectors:[{categoryId:'scenarioCategory',memberKey:'["string","Forecast"]'}]};
oracleCases.push(make('member-missing',comparison.dataset,{...comparison.definition,analytical:missing}));
const noCounterpart=structuredClone(comparison.definition.analytical) as TableModelV1;noCounterpart.resultFilters=[];
oracleCases.push(make('member-no-counterpart',{...comparison.dataset,rows:comparison.dataset.rows.filter(row=>row.id==='a'||row.id==='bb')},{...comparison.definition,analytical:noCounterpart}));
const missingInput=model();missingInput.measures=[{id:'last',sourceFieldId:'revenue',aggregation:'last'}];missingInput.layout.values=['last'];
oracleCases.push(make('missing-input',input,{table:{},search:'',analytical:missingInput}));
const unset=model();unset.categories=[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native'}];unset.measures=[{id:'unset',sourceFieldId:'revenue'}];unset.layout={rows:['regionCategory'],columns:[],values:['unset']};
oracleCases.push(make('unset-measure-blank',input,{table:{},search:'',analytical:unset}));
const runtime=model();runtime.enabled=false;runtime.params={promotePage:false,filters:[{id:'region-param',categoryId:'regionCategory',label:'Region',multiSelect:true}]};runtime.categories=[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native'}];runtime.formulas=[{id:'sourceDouble',name:'Source double',scope:'source',expression:'',ast:{kind:'binary',operator:'*',left:{kind:'reference',target:'field',id:'revenue'},right:{kind:'literal',value:2}}}];
const runtimeDefinition={table:{},search:'',analytical:runtime};
oracleCases.push(make('runtime-authoring-linked',input,runtimeDefinition,{kind:'none'},[
 {kind:'memberDomain',definition:runtimeDefinition,categoryId:'regionCategory',categoryRecipe:categoryAuthoringRecipe(runtime,'regionCategory'),offset:0,limit:50},
 {kind:'bindFormula',definition:runtimeDefinition,draft:{id:'draft',name:'Draft',scope:'aggregate',expression:'SUM(Revenue)'},bindings:[]},
 {kind:'apply',runtimeParams:{'pivot:filter:regionCategory':{source:'group',groupId:'region-group',transportValue:'A,missing'}}},
 {kind:'inspect',request:{collection:'groupDomain',paramKey:'pivot:filter:regionCategory',categoryId:'regionCategory',categoryRecipe:categoryRecipe(runtime.categories[0]),groupEvidence:{groupId:'region-group',transportValue:'A,missing'},offset:0,limit:50}},
 {kind:'preview',definition:{...runtimeDefinition,table:{columnFilters:[{id:'revenue',value:{max:20}}]}}},
 {kind:'selection',action:{kind:'all'},visibleIds:['r0','r1']},
 {kind:'selection',action:{kind:'toggle',rowId:'r1'},visibleIds:['r0','r1']},
 {kind:'linked',definition:{table:{},search:''}},
 {kind:'columnProfile',definition:runtimeDefinition,scope:'input',offset:0,limit:50},
 {kind:'columnProfile',definition:{table:{columnFilters:[{id:'revenue',value:{max:20}}]},search:''},scope:'filtered',offset:0,limit:1,fields:['date','region']},
]));
const pageRuntime=structuredClone(comparison.definition.analytical) as TableModelV1;pageRuntime.resultFilters=[];
oracleCases.push({...make('runtime-page-viewer',comparison.dataset,{table:{},search:'',analytical:pageRuntime}),runtimeParams:{'pivot:page':{source:'viewer',memberKeys:['["string","Budget"]']}}});
oracleCases.push(make('identity-witness',input,{table:{columnFilters:[{id:'revenue',value:{max:20}}]},search:''},{kind:'none'},[{kind:'identityWitness',path:[{table:{},search:''}],ids:['r0','r2','absent']} ]));
oracleCases.push(make('locale-numeric-order',{...input,rows:['item10','item2','Item1'].map((team,i)=>({id:`sort-${i}`,values:{team}}))},{table:{sorting:[{id:'team',desc:false}]},search:''}));

const sourceSplit=model();sourceSplit.categories=[{id:'regionCategory',name:'Region',sourceFieldId:'region',transform:'native'},{id:'teamCategory',name:'Team',sourceFieldId:'team',transform:'native'}];
sourceSplit.formulas=[
 {id:'plus',name:'Plus one',scope:'source',expression:'',ast:{kind:'binary',operator:'+',left:{kind:'reference',target:'formula',id:'double'},right:{kind:'literal',value:1}}},
 {id:'double',name:'Double',scope:'source',expression:'',ast:{kind:'binary',operator:'*',left:{kind:'reference',target:'field',id:'revenue'},right:{kind:'literal',value:2}}},
];sourceSplit.measures=[{id:'total',sourceFieldId:'plus',aggregation:'sum'}];sourceSplit.layout={rows:['regionCategory'],columns:['teamCategory'],values:['total']};
oracleCases.push(make('analytical-source-split',input,{table:{},search:'',analytical:sourceSplit}));
oracleCases.push(make('legacy-saved-bucket',input,{table:{pivot:{enabled:true,grouping:['date'],split:[],buckets:{date:'year'},aggregationFns:{revenue:'sum'}}},search:''}));
oracleCases.push(make('authoring-refusal',input,runtimeDefinition,{kind:'none'},[
 {kind:'bindFormula',definition:runtimeDefinition,draft:{id:'chronology',name:'Chronology',scope:'aggregate',expression:'FIRST(Revenue)'},bindings:[]},
 {kind:'bindFormula',definition:runtimeDefinition,draft:{id:'missingBinding',name:'Missing binding',scope:'aggregate',expression:'SUM(Revenue)'},bindings:[{scope:'source',name:'Revenue',reference:{kind:'reference',target:'field',id:'absent'}}]},
]));

/** Strip correlation only at the response envelope, never inside a user record. */
function clean<T extends {requestId:string}>(response:T):WithoutRequest<T> {
 const {requestId: _requestId, ...semantic}=response;
 return semantic;
}
function collectTree(store:ResultStore,revision:Revision,size:number,path:string[],count:number,trace:WithoutRequest<RowBlock>[]):OracleTree {
 const offsets=Array.from({length:Math.max(1,Math.ceil(count/size))},(_,i)=>i*size).reverse();
 const received=offsets.map(offset=>store.rows('oracle',revision,{groupPath:path,offset,limit:size}));
 trace.push(...received.map(clean));
 const blocks=received.sort((a,b)=>a.offset-b.offset);
 const groups=blocks.flatMap(b=>b.groups);
 const selection=blocks[0].selection;
 return {groupPath:path,siblingCount:blocks[0].siblingCount,rows:blocks.flatMap(b=>b.rows),groups,
  ...(selection?{selection:{...selection,rows:blocks.flatMap(b=>b.selection?.rows??[])}}:{}),
  children:groups.map(g=>collectTree(store,revision,size,g.path,g.childCount,trace))};
}
function subset(store:ResultStore,revision:Revision,ignoreSelection:boolean):OracleSubset {
 const batches=[...store.presented('oracle',revision,'oracle-transfer',2,ignoreSelection)];
 const first=batches[0];
 return {batches:batches.map(clean),columns:first.columns!,rows:batches.flatMap(b=>b.rows),provenance:first.provenance!,freshness:first.freshness!,completeness:first.completeness,diagnostics:first.diagnostics,revision:first.revision};
}
/** Evaluate once per application/selection change, then page the same result session. */
export function captureBaseline(c:OracleCase):OracleResult {
 if(c.locale!==baselineLocale)throw new Error(`Oracle locale ${c.locale} differs from evaluated baseline locale ${baselineLocale}`);
 const result:OracleResult={name:c.name,locale:c.locale,deliveries:[],operations:[]};
 const dataset=structuredClone(c.dataset);
 let definition=structuredClone(c.definition),selection=structuredClone(c.selection),runtime=c.runtimeParams;
 let revision:Revision={widgetId:'oracle',input:dataset.resultRevision,model:1,output:1};
 const calculate=()=>{
  const next=calculateView(dataset,definition,selection,false,undefined,[],runtime);
  next.diagnostics=[...(dataset.freshness.diagnostics??[]).map(message=>({code:'INPUT',message,severity:'warning' as const})),...next.diagnostics];
  return next;
 };
 try {
  let view=calculate(),store=createResultStore(view,revision);
  const refresh=()=>{revision={...revision,model:revision.model+1,output:revision.output+1};view=calculate();store=createResultStore(view,revision);};
  for(const op of c.operations) {
   let value:unknown;
   switch(op.kind) {
    case 'selection': {
     const response=store.selection('oracle',revision,op.action,op.visibleIds??view.logicalRows.map(row=>row.id));
     value=clean(response);selection=response.selection;
     // The UI applies the returned declarative selection to publish its next revision.
     refresh();break;
    }
    case 'apply':definition=op.definition??definition;runtime=op.runtimeParams??runtime;refresh();value=clean(store.ready('oracle',revision));break;
    case 'preview': {
     const candidate=calculateView(dataset,op.definition,{kind:'none'});
     value={kind:'previewDefinition',revision,completeness:candidate.completeness,diagnostics:candidate.diagnostics,columns:candidate.columns,rows:candidate.presentedRows.slice(0,100),total:candidate.presentedRows.length};break;
    }
    case 'bindFormula':value={kind:'bindFormula',revision,completeness:dataset.completeness,diagnostics:[],...bindObservedFormula(dataset,op)};break;
    case 'memberDomain':value={kind:'memberDomain',revision,completeness:dataset.completeness,diagnostics:[],...observedMemberPage(dataset,op)};break;
    case 'columnProfile':value={kind:'columnProfile',revision,completeness:dataset.completeness,diagnostics:[],...columnProfilePage(dataset,op)};break;
    case 'inspect':value=clean(store.inspect('oracle',revision,op.request));break;
    case 'identityWitness':value={kind:'identityWitness',revision,completeness:view.completeness,diagnostics:view.diagnostics,identities:identityWitness(dataset,op.path,op.ids,definition,view.columns)};break;
    case 'linked': {
     const presented=subset(store,revision,false);
     const child:WidgetDataset={...presented,resultRevision:revision.model,outputRevision:revision.output};
     validateLinkedBindings(op.definition,child.columns);
     const childView=calculateView(child,op.definition,op.selection??{kind:'none'});
     const childRevision={...revision,widgetId:'linked'};
     const childStore=createResultStore(childView,childRevision);
     value={ready:clean(childStore.ready('oracle',childRevision)),chart:clean(childStore.chartData('oracle',childRevision,childView.columns.map(col=>col.id))),totals:clean(childStore.totals('oracle',childRevision))};break;
    }
   }
   result.operations.push({kind:op.kind,value});
  }
  result.ready=clean(store.ready('oracle',revision));
  result.deliveries=[1,2,50].map(size=>{
   const blocks:WithoutRequest<RowBlock>[]=[];
   return {size,tree:collectTree(store,revision,size,[],result.ready!.topLevelCount,blocks),blocks};
  });
  result.totals=clean(store.totals('oracle',revision));
  result.selection=clean(store.selection('oracle',revision,{kind:'summary'},view.logicalRows.map(row=>row.id)));
  result.facets=Object.keys(view.facets).map(categoryId=>clean(store.facets('oracle',revision,categoryId)));
  result.inspection=[];
  for(const collection of ['definitions','warnings','periodBounds'] as const) {
   let offset:number|undefined=0;
   while(offset!==undefined) {
    const page=store.inspect('oracle',revision,{collection,offset,limit:100});
    result.inspection.push(clean(page));
    if(page.nextOffset===undefined)break;
    if(page.nextOffset<=offset)throw new Error('Non-progressing inspection cursor');
    offset=page.nextOffset;
   }
  }
  result.chart=clean(store.chartData('oracle',revision,view.columns.map(col=>col.id)));
  result.linked=subset(store,revision,false);
  result.export=subset(store,revision,true);
 }catch(error) {
  if(!c.expectFailure)throw error;
  const e=error as Error & {descriptor?:{code:string};diagnostics?:unknown};
  result.error={name:e.name,message:e.message,...(e.descriptor?{code:e.descriptor.code}:{}),...(e.diagnostics?{diagnostics:e.diagnostics}:{})};
 }
 if(c.expectFailure&&!result.error)throw new Error(`${c.name} unexpectedly accepted invalid input`);
 return result;
}
/** Exact comparison: null/missing, typed identities, order and diagnostics get no tolerance. */
export function compareOracle(actual:OracleResult,expected:OracleResult):Difference[] {
 const differences:Difference[]=[];
 const visit=(a:unknown,e:unknown,path:string):void=>{
  if(Object.is(a,e))return;
  const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object';
  if(object(a)&&object(e)&&Array.isArray(a)===Array.isArray(e)) {
   if(Array.isArray(a)&&Array.isArray(e)&&a.length!==e.length)differences.push({path:`${path}.length`,actual:a.length,expected:e.length,reason:'array length'});
   for(const key of new Set([...Object.keys(e),...Object.keys(a)])) {
    const child=Array.isArray(a)?`${path}[${key}]`:`${path}.${key}`;
    if(!Object.hasOwn(a,key)||!Object.hasOwn(e,key))differences.push({path:child,actual:a[key],expected:e[key],reason:Object.hasOwn(a,key)?'unexpected property':'missing property'});
    else visit(a[key],e[key],child);
   }
  }else differences.push({path,actual:a,expected:e,reason:'value or type'});
 };
 visit(actual,expected,'$');return differences;
}
/** Task 1 test-only portable wire shape; production validation/codec belongs to Task 2. */
export type OracleWireValue = {tag:'missing'|'null'} | {tag:'bool';value:boolean} | {tag:'string'|'bigint-string';value:string} | {tag:'f64';value:number|'NaN'|'Infinity'|'-Infinity'|'-0'} | {tag:'array';value:OracleWireValue[]} | {tag:'record';value:[string,OracleWireValue][]};
export function encodeOracleValue(value:unknown):OracleWireValue {
 if(value===undefined)return {tag:'missing'};
 if(value===null)return {tag:'null'};
 if(typeof value==='boolean')return {tag:'bool',value};
 if(typeof value==='string')return {tag:'string',value};
 if(typeof value==='bigint')return {tag:'bigint-string',value:String(value)};
 if(typeof value==='number')return {tag:'f64',value:Number.isNaN(value)?'NaN':value===Infinity?'Infinity':value===-Infinity?'-Infinity':Object.is(value,-0)?'-0':value};
 if(Array.isArray(value))return {tag:'array',value:value.map(encodeOracleValue)};
 if(typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null))return {tag:'record',value:Object.entries(value).map(([key,v])=>[key,encodeOracleValue(v)])};
 throw new Error(`Unsupported oracle wire value: ${typeof value}`);
}
export function decodeOracleValue(raw:unknown):unknown {
 const wire=raw as OracleWireValue;
 switch(wire.tag) {
  case 'missing':return undefined;
  case 'null':return null;
  case 'bool':case 'string':return wire.value;
  case 'bigint-string':return BigInt(wire.value);
  case 'f64':return typeof wire.value==='number'?wire.value:wire.value==='NaN'?NaN:wire.value==='Infinity'?Infinity:wire.value==='-Infinity'?-Infinity:-0;
  case 'array':return wire.value.map(decodeOracleValue);
  case 'record': {
   const record:Record<string,unknown>={};
   for(const [key,value] of wire.value)Object.defineProperty(record,key,{value:decodeOracleValue(value),enumerable:true,writable:true,configurable:true});
   return record;
  }
  default:throw new Error('Unknown oracle wire tag');
 }
}
