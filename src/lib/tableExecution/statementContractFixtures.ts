// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { fixture } from '../statementModel/compileFixtures';
import { statementTemplate } from '../statementModel/catalog';
import { statementOwnedIds, type StatementIntent } from '../statementModel/types';
import type { WidgetDataset } from '../widgetData/types';
import type { TableDefinition, SelectionSpec } from './types';
export type StatementContractCase={name:string;data:WidgetDataset;definition:TableDefinition;selection:SelectionSpec;expectFailure?:boolean};
function base(name:string,edit:(intent:StatementIntent,data:WidgetDataset)=>void=()=>{},expectFailure=false):StatementContractCase{
  const f=fixture();edit(f.statement,f.source);
  return {name:`statement-${name}`,expectFailure,data:f.source,definition:{table:{},search:'',analytical:f.statement},selection:{kind:'none'}};
}
const wide=base('income-wide');
const long=base('income-long',(intent,data)=>{
  const values=data.rows[0].values;const ids=statementOwnedIds(intent.template);
  intent.bindings.shape='long';intent.bindings.mappings=[];intent.bindings.longFields={itemFieldId:'item',valueFieldId:'amount'};
  data.rows=['revenue','cost_of_revenue'].map(field=>({id:field,values:{...values,item:ids.line(field),amount:values[field]}}));
  data.columns.push({id:'item',label:'item'},{id:'amount',label:'amount',dtype:'number'});
});
export const statementContractCases:StatementContractCase[]=[wide,long,
 base('duplicate-keyless',(_intent,data)=>{data.rows.push({...structuredClone(data.rows[0]),id:'duplicate'});}),
 base('missing',(_intent,data)=>{data.rows[0].values.cost_of_revenue=null;}),
 base('invalid-number',(_intent,data)=>{data.rows[0].values.revenue='100';},true),
 base('upstream-error',(_intent,data)=>{data.rows[0].cellErrors={revenue:{code:'blocked-dependency',message:'Source validation failed'}};}),
 base('hidden-field',(_intent,data)=>{data.columns=data.columns.filter(c=>c.id!=='revenue');},true),
 base('annual-quarter-overlap',(_intent,data)=>{data.rows.push({id:'quarter',values:{...data.rows[0].values,period:'FQ'}});},true),
 base('mixed-units',(intent,data)=>{intent.bindings.unitFieldId='unit';data.columns.push({id:'unit',label:'unit'});data.rows[0].values.unit='USD';data.rows.push({id:'other-unit',values:{...data.rows[0].values,unit:'EUR'}});}),
 base('fiscal-warning',(_intent,data)=>{data.rows.push({id:'other-company',values:{...data.rows[0].values,symbol:'OTHER',start:'2024-07-01',end:'2025-06-30',date:'2025-06-30'}});}),
 base('hidden-dependency',(intent)=>{intent.overrides.hiddenIds=[statementOwnedIds(intent.template).line('revenue')];}),
 base('explicit-prior-period',(intent,data)=>{
  const ids=statementOwnedIds(intent.template);const formula=intent.template.lines.find(l=>l.formula)!.formula!;
  intent.overrides.formulas=[{...formula,ast:{kind:'member',value:{kind:'reference',target:'measure',id:ids.value},selectors:[{categoryId:ids.item,memberKey:ids.line('revenue')},{categoryId:ids.period,memberKey:JSON.stringify(['string','FY2025'])}]}}];
  data.rows.push({id:'next',values:{...data.rows[0].values,year:2026,date:'2026-12-31',start:'2026-01-01',end:'2026-12-31',revenue:200,cost_of_revenue:100}});
 }),
 ...(['balance','cashflow'] as const).map(kind=>base(kind,(intent,data)=>{
  intent.template=statementTemplate(kind,'1.0.0')!;const ids=statementOwnedIds(intent.template);
  const field=kind==='balance'?'total_assets':'operating_cash_flow';
  intent.bindings.mappings=[{sourceFieldId:field,lineId:ids.line(field)}];
  data.columns.push({id:field,label:field,dtype:'number'});data.rows[0].values[field]=100;
  data.rows.push({id:'next',values:{...data.rows[0].values,year:2026,date:'2026-12-31',start:'2026-01-01',end:'2026-12-31',[field]:60}});
 }))];
statementContractCases.push(base('scoped-formats',(intent,data)=>{
 const formula=intent.template.lines.find(l=>l.formula)!.formula!;
 intent.overrides.formulas=[{...formula,format:'percent',expression:'0.4',ast:{kind:'literal',value:0.4}}];
 data.columns.find(c=>c.id==='revenue')!.format={formatterFn:'int'};
 data.columns.find(c=>c.id==='cost_of_revenue')!.format={decimalPlaces:3};
}));
