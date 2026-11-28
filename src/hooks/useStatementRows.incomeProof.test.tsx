// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { incomeEvidence, incomeRow } from '../test/fixtures/financialEvidence';
import { backend, card, widget } from '../test/fixtures';
import { ProviderBoundary } from '../test/tableProviderBoundary';
import { backendTableSource, createTableExecutionStore } from '../stores/tableExecutionStore';
import { useWidgetRegistryStore } from '../stores/widgetRegistryStore';
import { createWorkerExecutor } from '../lib/tableExecution/workerClient';
import { createRustExecutor } from '../lib/tableExecution/rust/runtime';
import { backendFinancialResponse, financialRowsAgree } from '../lib/widgetData/chartRecipes/financialEvidence';
import { buildIncomeSankey } from '../lib/widgetData/chartRecipes/incomeSankey';
import { intent } from '../lib/statementModel/testFixtures';
import { statementOwnedIds } from '../lib/statementModel/types';
import { correctStatementRows } from '../lib/statementFiscal';
import { useStatementRows } from './useStatementRows';
import { __resetStatementYearEndsForTests, correctStatementData } from './useStatementYearEnds';

const fetchFiscalYearEnd=vi.fn();
vi.mock('../lib/dataClient',async original=>({...(await original<typeof import('../lib/dataClient')>()),fetchFiscalYearEnd:(...args:unknown[])=>fetchFiscalYearEnd(...args)}));
afterEach(()=>{fetchFiscalYearEnd.mockReset();__resetStatementYearEndsForTests();useWidgetRegistryStore.setState({widgets:[]});});
const connection=backend();
const definition=widget({id:'verified-income',type:'table',params:[{paramName:'period',label:'Period',type:'text',value:'annual',options:[{label:'Annual',value:'annual'},{label:'Quarter',value:'quarter'}]}]});
const query={symbol:'HSBA.LSE',period:'annual'};
const fields=['revenue','cost_of_revenue','gross_profit','operating_income','income_before_tax','net_income','income_tax_expense'] as const;
const ids=statementOwnedIds({id:'income',version:'1.0.0'});
let serial=0;
function acquired(month=6,frequency='annual'){
 const quarter=frequency==='quarter',fiscal_period=quarter?(month===6?'Q4':'Q2'):'FY';
 const rows=[{...incomeRow,fiscal_period,symbol:'HSBA.LSE',start:quarter?'2026-04-01':month===6?'2025-07-01':'2026-01-01',end:quarter||month===6?'2026-06-30':'2026-12-31'}];
 const evidence={...incomeEvidence,period_kind:quarter?'FQ':'FY',periods:[{...incomeEvidence.periods[0],period_kind:quarter?'FQ':'FY',fiscal_period}]};
 const url=new URL(`https://example.org/api/v1/eodhd/equity/fundamental/income?symbol=HSBA&exchange=LSE&period=${frequency}&limit=1&chart_source=true`);
 const captured=backendFinancialResponse({results:rows,extra:{results_metadata:{chart_evidence:evidence}}},url);
 expect(captured?.rows).toBe(rows);
 return {rows,acquisition:{endpoint:url.pathname,parameters:{symbol:'HSBA',exchange:'LSE',period:frequency,limit:'1'},retrievedAt:Date.now(),financialEvidence:captured!.evidence}};
}
async function adapt(data:unknown,acquisition:ReturnType<typeof acquired>['acquisition']){
 const source=card({id:`fiscal-proof-${++serial}`,widgetId:definition.id});
 useWidgetRegistryStore.setState({widgets:[definition]});
 const store=createTableExecutionStore({source:backendTableSource});
 store.setBackendRows('fiscal-proof-dashboard',source.id,data,acquisition);
 const payload=await backendTableSource(source).acquire(new AbortController().signal);
 if(payload.kind!=='dataset')throw Error('Expected dataset');
 return {...payload.dataset,resultRevision:1,outputRevision:1};
}
const engines=[
 ['TypeScript',(id:string)=>createWorkerExecutor(id,()=>new ProviderBoundary('table.worker') as unknown as Worker)],
 ['compiled Rust',(id:string)=>createRustExecutor(id,()=>new ProviderBoundary('rust.worker') as unknown as Worker)],
] as const;
for(const [engine,make] of engines)for(const path of ['mounted','headless'] as const)for(const envelope of [false,true])for(const month of [6,12])for(const frequency of ['annual','quarter']){
 it(`${engine} retains verified ${frequency} income through ${path} fiscal display, envelope=${envelope}, year end=${month}`,async()=>{
  fetchFiscalYearEnd.mockResolvedValue({fiscalYearEnd:month===6?'June':'December'});
  const {rows,acquisition}=acquired(month,frequency),snapshot={rows,completeness:'bounded',receipt:{symbol:'HSBA.LSE'}},params={...query,period:frequency};
  const original=structuredClone(snapshot),raw=envelope?snapshot:rows;
  let corrected:unknown;
  if(path==='mounted'){
   const hook=renderHook(()=>useStatementRows(definition,connection,params,raw));
   await waitFor(()=>expect(hook.result.current.data).not.toBe(raw));
   expect(hook.result.current.asReported).toBe(false);corrected=hook.result.current.data;
  }else corrected=await correctStatementData(connection,definition,params,raw);
  const display=envelope?(corrected as typeof snapshot).rows:corrected as typeof rows;
  expect(display[0].fiscal_year).toBe(month===6?'FY2026':'2026');
  expect(display[0].fiscal_period).toBe(frequency==='annual'?'FY':month===6?'FQ4':'Q2');
  expect(snapshot).toEqual(original);
  // Display text is not an acquired numeric fiscal fact. The raw validator stays strict.
  expect(financialRowsAgree(acquisition.financialEvidence,display)).toBe(false);
  const dataset=await adapt(corrected,acquisition);
  expect(dataset.provenance.metadata?.financialEvidence).toEqual(acquisition.financialEvidence);
  const model=intent();model.bindings.periodKindFieldId='period_kind';
  model.periodKind=frequency==='annual'?'FY':'FQ';
  model.bindings.fiscal={companyFieldId:'symbol',dateFieldId:'period_ending',fiscalYearFieldId:'fiscal_year',...(frequency==='quarter'?{fiscalQuarterFieldId:'fiscal_period'}:{}),periodStartFieldId:'start',periodEndFieldId:'end',periodKind:model.periodKind};
  model.bindings.mappings=fields.map(sourceFieldId=>({sourceFieldId,lineId:ids.line(sourceFieldId)}));
  const executor=make('income'),revision={widgetId:'income',input:1,model:1,output:1},signal=new AbortController().signal;
  try{
   await executor.registerInput(dataset,1,signal);
   const ready=await executor.applyModel({table:{},search:'',analytical:model},{kind:'none'},revision,signal);
   const periodColumn=ready.columns.find(column=>column.measureId===ids.value)!.id;
   const chart=await executor.chartData(revision,[periodColumn],signal);
   expect(chart.provenance.metadata?.incomeChartProof).toBeDefined();
   expect(buildIncomeSankey(chart,{version:1,kind:'income-sankey',periodColumn},{theme:'light',maxDecimals:2,today:'2026-11-19'}))
    .toMatchObject({ok:true});
  }finally{executor.dispose();}
 });
}

it.each(['raw year','raw period','display year','display period','serialized display','forged display metadata','changed report date','wrong receipt year','extra row'] as const)('refuses income proof after %s',async fault=>{
 const source=acquired();
 if(fault==='raw year')source.rows[0].fiscal_year=1981;
 if(fault==='raw period')source.rows[0].fiscal_period='Q2';
 let rows=correctStatementRows(source.rows,'annual',{'HSBA.LSE':6},['HSBA.LSE']).rows;
 if(fault==='display year')rows[0].fiscal_year='FY1981';
 if(fault==='display period')rows[0].fiscal_period='FQ2';
 if(fault==='changed report date')rows[0].period_ending='2026-06-29';
 if(fault==='wrong receipt year')source.acquisition.financialEvidence={...source.acquisition.financialEvidence,...{periods:[{...incomeEvidence.periods[0],fiscal_year:1981}]}} as typeof source.acquisition.financialEvidence;
 if(fault==='serialized display'||fault==='forged display metadata')rows=JSON.parse(JSON.stringify(rows));
 if(fault==='forged display metadata')rows[0].fiscalDisplay={fiscal_year:2026,fiscal_period:'FY'};
 if(fault==='extra row')rows.push({...rows[0]});
 const dataset=await adapt({rows,completeness:'bounded'},source.acquisition);
 expect(dataset.provenance.metadata?.financialEvidence).toBeUndefined();
});
