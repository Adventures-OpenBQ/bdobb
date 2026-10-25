// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from 'vitest';
import { fixture } from './compileFixtures';
import { calculateView } from '../tableExecution/engine';
import { createResultStore } from '../tableExecution/resultStore';
import { revision } from '../tableExecution/fixtures';
import { formatCell } from '../format';
import { validateExecutionResponse } from '../tableExecution/validation';

it('keeps numeric scoped line formats through presented, row and chart delivery and linked input', () => {
 const f=fixture();f.statement.template=structuredClone(f.statement.template);
 f.source.columns.find(c=>c.id==='revenue')!.format={formatterFn:'int'};
 f.source.columns.find(c=>c.id==='cost_of_revenue')!.format={formatterFn:'normalizedPercent',decimalPlaces:1};
 const profit=f.statement.template.lines.find(l=>l.formula)!;
 profit.formula={...profit.formula!,format:'percent',expression:'0.4',ast:{kind:'literal',value:0.4}};
 const view=calculateView(f.source,{table:{},search:'',analytical:f.statement},{kind:'none'});
 const col=view.columns.find(c=>c.measureId)!;
 const leaves=view.logicalRows.filter(r=>r.groupPath?.length===2);
 expect(leaves.map(r=>r.values[col.id])).toEqual([100,60,0.4]);
 expect(leaves.map(r=>r.cellFormats?.[col.id])).toEqual([{formatterFn:'int'},{formatterFn:'normalizedPercent',decimalPlaces:1},{formatterFn:'normalizedPercent'}]);
 expect(formatCell(leaves[2].values[col.id],col.id,2,undefined,leaves[2].cellFormats?.[col.id])).toBe('40 %');
 const store=createResultStore(view,revision);
 const batches=[...store.presented('p',revision,'transfer',1)];
 const rows=batches.flatMap(b=>b.rows);
 expect(rows.filter(r=>r.groupPath?.length===2)).toEqual(leaves);
 const chart=store.chartData('c',revision,[col.id]);
 expect(validateExecutionResponse(chart,revision,'c')).toEqual(chart);
 expect(chart.rows.filter(r=>r.groupPath?.length===2).map(r=>r.cellFormats)).toEqual(leaves.map(r=>r.cellFormats));
 const linked=calculateView({...f.source,columns:view.columns,rows},{table:{},search:''},{kind:'none'});
 expect(linked.presentedRows.map(r=>r.cellFormats)).toEqual(rows.map(r=>r.cellFormats));
 expect(store.chartData('hidden',revision,[]).rows.every(r=>Object.keys(r.cellFormats??{}).length===0)).toBe(true);
});
it('explicit template and overridden formula formats precede source hints',()=>{
 const f=fixture();f.statement.template=structuredClone(f.statement.template);f.source.columns.find(c=>c.id==='revenue')!.format={formatterFn:'int'};
 f.statement.template.lines.find(l=>l.id===f.ids.line('revenue'))!.format='percent';
 const formula=f.statement.template.lines.find(l=>l.formula)!.formula!;
 f.statement.overrides.formulas=[{...formula,format:'integer'}];
 const v=calculateView(f.source,{table:{},search:'',analytical:f.statement},{kind:'none'});
 const col=v.columns.find(c=>c.measureId)!;
 expect(v.logicalRows.filter(r=>r.groupPath?.length===2).map(r=>r.cellFormats?.[col.id])).toEqual([{formatterFn:'normalizedPercent'},undefined,{formatterFn:'int'}]);
});

it('preserves heterogeneous actual XLS numeric formats through import and Statement calculation',async()=>{
 const XLSX=await import('xlsx');const {datasetFromBytes}=await import('../localTableData');const f=fixture();
 const sheet=XLSX.utils.json_to_sheet(f.source.rows.map(r=>r.values));sheet.G2.z='0';sheet.H2.z='0.0%';
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Income');
 const bytes=XLSX.write(book,{type:'array',bookType:'biff8'});
 const input=await datasetFromBytes('income.xls',new Uint8Array(bytes),'source',1);
 expect(input.rows[0].values.revenue).toBe(100);expect(input.rows[0].values.cost_of_revenue).toBe(60);
 const v=calculateView(input,{table:{},search:'',analytical:f.statement},{kind:'none'}),col=v.columns.find(c=>c.measureId)!;
 expect(v.logicalRows.filter(r=>r.groupPath?.length===2).slice(0,2).map(r=>r.cellFormats?.[col.id])).toEqual([{formatterFn:'int'},{formatterFn:'normalizedPercent',decimalPlaces:1}]);
});
