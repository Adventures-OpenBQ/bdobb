// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { buildLinkedFigure } from './chartFigure';
import {calculateView} from '../tableExecution/engine';
import {createResultStore} from '../tableExecution/resultStore';
import type { LinkedChartSettings, WidgetDataset } from './types';
const source: WidgetDataset = {columns:[{id:'item',label:'Item',dtype:'text'},{id:'a',label:'2024',dtype:'number'},{id:'b',label:'2025',dtype:'number'}],rows:[{id:'cash',values:{item:'Cash',a:10,b:30}},{id:'stock',values:{item:'Inventory',a:30,b:10}}],resultRevision:1,outputRevision:1,provenance:{sourceWidgetId:'source'},completeness:{kind:'complete',warnings:[]},freshness:{availability:'available',stale:false}};
const question = (extra: Record<string, unknown>) => ({category:'item',measures:['a'],display:'grouped',...extra}) as LinkedChartSettings;
it('renders a pie from one measure without merging duplicate item labels',()=>{
 const result=buildLinkedFigure({...source,rows:source.rows.map(r=>({...r,values:{...r.values,item:'Asset'}}))},question({type:'pie'}),'dark');
 expect(result).toMatchObject({ok:true,figure:{data:[{type:'pie',labels:['Asset','Asset (2)'],values:[10,30],sort:false}]}});
});
it('plots a percentage stack in percent units with share hover values',()=>{
 const result=buildLinkedFigure(source,question({type:'column',measures:['a','b'],seriesFrom:'rows',display:'percent'}),'dark');
 expect(result).toMatchObject({ok:true,figure:{layout:{barmode:'stack',barnorm:'percent',yaxis:{ticksuffix:'%'}}}});
 if(result.ok) expect((result.figure.data[0] as {text:string[]}).text[0]).toContain('25.0%');
});
it('uses each source row as a series when row series are selected',()=>{
 const result=buildLinkedFigure(source,question({type:'line',measures:['a','b'],seriesFrom:'rows'}),'dark');
 expect(result).toMatchObject({ok:true,figure:{data:[{type:'scatter',name:'Cash',x:['a','b'],y:[10,30]},{type:'scatter',name:'Inventory',x:['a','b'],y:[30,10]}]}});
});
it('refuses a pie over negative values instead of drawing a misleading share',()=>{
 const result=buildLinkedFigure({...source,rows:[{id:'negative',values:{item:'Debt',a:-10}}]},question({type:'pie'}),'dark');
 expect(result).toMatchObject({ok:false,refused:true});
});

it('retains a newer TemporalDB origin receipt through calculation and chart projection',()=>{
 const temporal={executionId:'execution-1',queryId:'query-1',queryRevision:3,resultHash:'result-1'};
 const input={...source,provenance:{...source.provenance,receipt:{temporal}}};
 const revision={widgetId:'source',input:1,model:1,output:1};
 const output=createResultStore(calculateView(input,{table:{},search:''},{kind:'none'}),revision).chartData('chart',revision,['item','a']);
 expect(output.provenance.receipt?.temporal).toEqual(temporal);
});
