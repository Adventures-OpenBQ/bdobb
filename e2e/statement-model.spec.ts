// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { isDiscoveryRequest, MOCK_URL, seedCards, seedApp, read } from './fixtures';

async function importStatement(page:Page, shape:'wide'|'long', extension:'csv'|'xls', fixtureName?:string, suppliedBytes?:number[]) {
  await seedCards(page,[]); await page.locator('.dashboard-grid').waitFor();
  const name=fixtureName??`income-${shape}.${extension}`;
  const bytes=suppliedBytes??[...readFileSync(`src/test/fixtures/statement/${name}`)];
  await page.evaluate(({name,bytes})=>{
    const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],name));
    const area=document.querySelector('main.dashboard-area')!;
    for(const type of ['dragover','drop']) area.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:transfer}));
  },{name,bytes});
  const source=page.locator('.widget-card').first();
  await expect(source.locator('tbody')).toContainText('ACME');
  await source.getByRole('button',{name:'Card menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Create linked table',exact:true}).click();
  const statement=page.locator('.widget-card').nth(1);
  await expect(statement.locator('tbody')).toContainText('ACME');
  return {source,statement,bytes};
}
async function applyStatement(card:Locator,shape:'wide'|'long',previewText='40') {
  await card.getByRole('button',{name:'Pivot',exact:true}).click();
  await card.getByRole('tab',{name:'Saved',exact:true}).click();await card.getByRole('button',{name:'Statement template',exact:true}).click();
  await card.getByLabel('Source shape',{exact:true}).selectOption(shape);
  for(const [label,value] of [['Company','symbol'],['Fact period kind','period'],['Report date','date'],['Fiscal year','year'],['Period start','start'],['Period end','end']]) await card.getByLabel(label,{exact:true}).selectOption(value);
  if(shape==='wide') {
    await card.getByLabel('Source revenue',{exact:true}).selectOption('revenue');
    await card.getByLabel('Source cost_of_revenue',{exact:true}).selectOption('cost_of_revenue');
  } else {
    await card.getByLabel('Line item identity',{exact:true}).selectOption('item');
    await card.getByLabel('Monetary value',{exact:true}).selectOption('amount');
  }
  await card.getByLabel('Label revenue',{exact:true}).fill('Sales');
  await card.getByRole('button',{name:'Calculate preview',exact:true}).click();
  await expect(card.getByRole('region',{name:'Calculated Statement preview'})).toContainText(previewText);
  await card.getByRole('tabpanel',{name:'Saved',exact:true}).getByRole('button',{name:'Apply Statement model',exact:true}).click();
  await expect(card.getByRole('button',{name:'Calculate preview',exact:true})).toBeEnabled();
  await card.getByRole('button',{name:'Close pivot drawer',exact:true}).click();
  await card.getByRole('button',{name:'Expand Income',exact:true}).click();
  await expect(card.locator('tbody')).toContainText('Sales');
}
async function savedDashboard(page:Page){return JSON.parse((await read(page,'dashboards/d1.json'))!);}
async function output(page:Page,id:string){
  return page.evaluate(async id=>{
    const path='/src/stores/tableExecutionStore.ts';
    const store=(await import(path)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;
    await store.settled('d1');const view=store.readView('d1',id);
    if(!view.active||!['ready','empty'].includes(view.status))return {status:view.status,error:view.error,active:view.active,stale:view.stale,requested:view.requested};
    const executor=store.readExecutor('d1',id);
    if(!executor)return {status:view.status,active:view.active,source:view.sourceRevision,stale:view.stale};
    const rows=[];for await(const batch of executor.presented(view.active,new AbortController().signal))rows.push(...batch.rows);
    return {status:view.status,rows,columns:view.ready!.columns,active:view.active,source:view.sourceRevision,selection:view.ready!.selection,totals:await executor.totals(view.active,new AbortController().signal)};
  },id);
}
async function hideSourceField(page:Page,id:string,hidden:boolean){
 return page.evaluate(async({id,hidden})=>{
  const runtimePath='/src/stores/tableExecutionStore.ts',coordinatorPath='/src/stores/tableCommitCoordinator.ts';
  const runtime=(await import(runtimePath)).tableExecutionStore as import('../src/stores/tableExecutionStore').TableExecutionStore;
  const coordinators=(await import(coordinatorPath)).tableCommitCoordinators as typeof import('../src/stores/tableCommitCoordinator').tableCommitCoordinators;
  await runtime.settled('d1');const coordinator=coordinators.get('d1',id),release=coordinator.retain();
  try{const definition=structuredClone(runtime.readView('d1',id).definition);definition.table.hidden=hidden?['revenue']:[];
   const outcome=await coordinator.replaceDefinition(coordinator.authoringBase(),definition);await runtime.settled('d1');return outcome;
  }finally{release();}
 },{id,hidden});
}
async function reorderStatement(page:Page,id:string){
 return await page.evaluate(async id=>{
   const rp='/src/stores/tableExecutionStore.ts',cp='/src/stores/tableCommitCoordinator.ts';
   const runtime=(await import(rp)).tableExecutionStore,coordinator=(await import(cp)).tableCommitCoordinators.get('d1',id),release=coordinator.retain();
   try{await runtime.settled('d1');const definition=structuredClone(runtime.readView('d1',id).definition);const intent=definition.analytical as import('../src/lib/statementModel/types').StatementIntent;intent.overrides.sectionOrder=intent.template.sections.map(s=>s.id).reverse();
    const outcome=await coordinator.replaceDefinition(coordinator.authoringBase(),definition);await runtime.settled('d1');return outcome;
   }finally{release();}
  },id);
}
for(const [shape,extension] of [['wide','xls'],['wide','csv'],['long','xls'],['long','csv']] as const){
 test(`normal ${shape} ${extension} Statement has selected Profit40 and durable binary reopen`,async({page,context},info)=>{
  test.setTimeout(90_000);
  const requests:string[]=[];page.on('request',r=>{if(r.url().startsWith(MOCK_URL)&&!isDiscoveryRequest(r.url()))requests.push(r.url());});
  const {statement,bytes}=await importStatement(page,shape,extension);await applyStatement(statement,shape);
  const saved=await savedDashboard(page),statementId=saved.tabs[0].cards[1].id;
  const result=await output(page,statementId);
  const money=result.columns!.find(c=>c.measureId==='statement/income/1.0.0/measure/value')!.id;
  const profit=result.rows!.find(r=>r.groupPath?.at(-1)?.memberKey===JSON.stringify(['string','statement/income/1.0.0/line/calculated_gross_profit']))!;
  expect(profit.values[money]).toBe(40);expect(result.totals!.values).toEqual({});
  await statement.getByRole('button',{name:'Expand Profit',exact:true}).click();
  await statement.locator(`tr[data-row-id=${JSON.stringify(profit.id)}]`).getByRole('checkbox').click();
  await expect(statement.locator(`tr[data-row-id=${JSON.stringify(profit.id)}]`).getByRole('checkbox')).toBeChecked();
  await statement.getByRole('button',{name:'Card menu',exact:true}).click();await page.getByRole('menuitem',{name:'Create linked table',exact:true}).click();
  const child=page.locator('.widget-card').nth(2);await expect(child.locator('tbody')).toContainText('40');
  await child.getByRole('button',{name:'Card menu',exact:true}).click();await page.getByRole('menuitem',{name:'Create linked chart',exact:true}).click();
  const chart=page.locator('.linked-chart-renderer');
  await chart.getByLabel('Category',{exact:true}).selectOption(result.columns![0].id);
  await chart.getByRole('checkbox',{name:/Value/}).click();
  await expect.poll(()=>chart.locator('.js-plotly-plot').evaluate(e=>(e as unknown as {data:{y:number[]}[]}).data[0].y)).toEqual([40]);
  await statement.getByRole('button',{name:'Collapse Profit',exact:true}).click();
  await expect.poll(()=>chart.locator('.js-plotly-plot').evaluate(e=>(e as unknown as {data:{y:number[]}[]}).data[0].y)).toEqual([40]);
  const reordered=await reorderStatement(page,statementId);
  expect(reordered).toEqual({status:'saved'});
  await expect.poll(()=>chart.locator('.js-plotly-plot').evaluate(e=>(e as unknown as {data:{y:number[]}[]}).data[0].y)).toEqual([40]);
  expect(requests).toEqual([]);
  const durable=await savedDashboard(page);const source=durable.tabs[0].cards[0];
  expect(durable.tabs[0].cards[1].tableDefinition.analytical.template.version).toBe('1.0.0');
  expect(durable.tabs[0].cards[1].tableDefinition.analytical.overrides.labels['statement/income/1.0.0/line/revenue']).toBe('Sales');
  const files:Record<string,string|number[]>=await page.evaluate(()=>Object.fromEntries(window.__bdobb!.list!().map(p=>[p,window.__bdobb!.read!(p)!])));
  files[`files/${source.params.file}`]=await page.evaluate(async path=>{const modulePath='/src/test/memfs.ts';const memory=await import(modulePath);return [...memory.__readBytes(path)];},`files/${source.params.file}`);
  expect(files[`files/${source.params.file}`]).toEqual(bytes);
  durable.tabs=[{id:'linked',name:'Linked',cards:durable.tabs[0].cards.slice(1)},{id:'source',name:'Source',cards:[source]}];
  files['dashboards/d1.json']=JSON.stringify(durable);
  if(shape==='wide'&&extension==='xls')for(const [path,content]of Object.entries(files)){const destination=join(info.outputPath('native-statement-handoff'),path);mkdirSync(join(destination,'..'),{recursive:true});writeFileSync(destination,Buffer.from(content));}
  const reopened=await context.newPage();await seedApp(reopened,files);
  await expect.poll(()=>reopened.locator('.js-plotly-plot').evaluate(e=>(e as unknown as {data:{y:number[]}[]}).data[0].y)).toEqual([40]);
  expect((await output(reopened,statementId)).selection).toEqual({kind:'explicit',ids:[profit.id]});
  if(shape==='wide'&&extension==='xls'){
   const sourceId=source.id,childId=durable.tabs[0].cards[1].id,chartId=durable.tabs[0].cards[2].id;
   const beforeHidden=await output(reopened,chartId);
   expect(await hideSourceField(reopened,sourceId,true)).toEqual({status:'saved'});
   await expect.poll(async()=>(await output(reopened,statementId)).status).toBe('failed');
   expect((await output(reopened,statementId)).error).toMatch(/revenue.*unavailable/);
   await expect(reopened.locator('.linked-chart-renderer').getByText('Updating chart — showing completed data (stale).',{exact:true})).toBeVisible();
   const blocked=await output(reopened,chartId);expect(blocked.status).toBe('blocked');expect(blocked.stale).toBe(true);expect(blocked.active).toEqual(beforeHidden.active);
   expect(await hideSourceField(reopened,sourceId,false)).toEqual({status:'saved'});
   const recovered=await output(reopened,chartId);expect(recovered.status).toBe('ready');expect(recovered.active).not.toEqual(beforeHidden.active);
   await expect.poll(()=>reopened.locator('.js-plotly-plot').evaluate(e=>(e as unknown as {data:{y:number[]}[]}).data[0].y)).toEqual([40]);
   const book=XLSX.read(Buffer.from(bytes),{type:'buffer'});const sheet=book.Sheets[book.SheetNames[0]];sheet.G2.v=120;
   const changed=[...XLSX.write(book,{type:'buffer',bookType:'biff8'})] as number[];
   await reopened.evaluate(async({file,bytes,id})=>{const fsPath='/src/browser-shim/fs.ts',runtimePath='/src/stores/tableExecutionStore.ts';const fs=await import(fsPath);await fs.writeFile(`files/${file}`,new Uint8Array(bytes));const runtime=(await import(runtimePath)).tableExecutionStore;runtime.refresh('d1',id);await runtime.settled('d1');},{file:source.params.file,bytes:changed,id:sourceId});
   await expect.poll(()=>reopened.locator('.js-plotly-plot').evaluate(e=>(e as unknown as {data:{y:number[]}[]}).data[0].y)).toEqual([60]);
   const root=await output(reopened,sourceId),report=await output(reopened,statementId),childOutput=await output(reopened,childId),chartOutput=await output(reopened,chartId);
   expect(report.source).toEqual(root.active);expect(childOutput.source).toEqual(report.active);expect(chartOutput.active).toEqual(childOutput.active);
   expect(report.selection).toEqual({kind:'explicit',ids:[profit.id]});
   expect(childOutput.rows).toHaveLength(1);expect(childOutput.rows![0].values[money]).toBe(60);
  }
  await reopened.close();
 });
}

test('actual module worker preserves Statement values errors warnings order totals and linked schema',async({page},info)=>{
 await seedCards(page,[]);
 const result=await page.evaluate(async()=>{
  const contractPath='/src/lib/tableExecution/testContract.ts',workerPath='/src/lib/tableExecution/workerClient.ts';
  const {runExecutorContract,createPureExecutor}=await import(contractPath);
  const {createWorkerExecutor}=await import(workerPath);
  return {actual:await runExecutorContract(()=>createWorkerExecutor('source')),expected:await runExecutorContract(createPureExecutor)};
 });
 await info.attach('statement-worker-contract',{body:JSON.stringify(result.actual,null,2),contentType:'application/json'});
 expect(result.actual).toEqual(result.expected);
});

test('supplemental real module worker shared-engine scope policies and Unpivot resource observations',async({page},info)=>{
 await seedCards(page,[]);
 const session=await page.context().browser()!.newBrowserCDPSession();
 const sample=async()=>{
  const targets=await session.send('Target.getTargets');const worker=targets.targetInfos.find(t=>t.type==='worker'&&t.url.includes('statementAcceptance.worker.ts'))!;
  const attached=await session.send('Target.attachToTarget',{targetId:worker.targetId,flatten:false});
  try{return await new Promise<{usedSize:number;totalSize:number}>((resolve,reject)=>{
   const timeout=setTimeout(()=>{session.off('Target.receivedMessageFromTarget',receive);reject(new Error('Worker heap sample timed out'));},5000);
   const receive=(event:{sessionId:string;message:string})=>{if(event.sessionId!==attached.sessionId)return;const reply=JSON.parse(event.message);if(reply.id!==1)return;clearTimeout(timeout);session.off('Target.receivedMessageFromTarget',receive);if(reply.error)reject(new Error(JSON.stringify(reply.error)));else resolve(reply.result);};
   session.on('Target.receivedMessageFromTarget',receive);void session.send('Target.sendMessageToTarget',{sessionId:attached.sessionId,message:JSON.stringify({id:1,method:'Runtime.getHeapUsage'})}).catch(reject);
  });}finally{await session.send('Target.detachFromTarget',{sessionId:attached.sessionId});}
 };
 await page.exposeFunction('statementHeap',sample);
 const evidence=await page.evaluate(async()=>{
  const worker=new Worker('/src/test/statementAcceptance.worker.ts',{type:'module'});
  const request=(value:unknown)=>new Promise<unknown>((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(new Error(e.message));worker.postMessage(value);});
  let maxTickGapMs=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxTickGapMs=Math.max(maxTickGapMs,now-last);last=now;},10);
  try{
   const policies=await request({kind:'scope'}),measurements=[];
   for(const count of [1000,10000]){const result=await request({kind:'expansion',count});const heap=await (window as unknown as {statementHeap:()=>Promise<unknown>}).statementHeap();measurements.push({result,heap});}
   return {policies,measurements,maxTickGapMs};
  }finally{clearInterval(timer);worker.terminate();}
 });
 const policies=evidence.policies as {kind:string;missing:number|null;result:{ok:boolean;value?:number}}[];
 expect(policies.find(p=>p.kind==='balance'&&p.missing===null)?.result).toEqual({ok:true,value:60});
 expect(policies.find(p=>p.kind==='cashflow'&&p.missing===null)?.result).toEqual({ok:true,value:180});
 for(const missing of [0,1])expect(policies.find(p=>p.kind==='balance'&&p.missing===missing)?.result).toEqual({ok:true,value:60});
 for(const policy of policies.filter(p=>p.kind==='cashflow'&&p.missing!==null||p.kind==='balance'&&p.missing===2))expect(policy.result.ok).toBe(false);
 for(const m of evidence.measurements){const result=m.result as {inputRows:number;expandedRows:number;identities:string[];reorderedIdentities:string[];duplicateSourceIds:string[]};expect(result.expandedRows).toBe(result.inputRows*2);expect(new Set(result.identities).size).toBe(4);expect(new Set(result.duplicateSourceIds).size).toBe(2);expect(result.reorderedIdentities.sort()).toEqual(result.identities.sort());expect((m.heap as {usedSize:number}).usedSize).toBeGreaterThan(0);}
 await info.attach('statement-scope-resource',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});writeFileSync(info.outputPath('statement-resources.json'),JSON.stringify(evidence,null,2));
 await session.detach();
});

for(const kind of ['balance','cashflow'] as const)test(`${kind} normal CSV guarded apply and reopen preserves period values and pinned snapshot`,async({page,context})=>{
 const {statement,bytes}=await importStatement(page,'wide','csv','policies-wide.csv');
 await statement.getByRole('button',{name:'Pivot',exact:true}).click();await statement.getByRole('tab',{name:'Saved',exact:true}).click();await statement.getByRole('button',{name:'Statement template',exact:true}).click();
 await statement.getByLabel('Template',{exact:true}).selectOption(kind);
 for(const [label,value]of [['Company','symbol'],['Fact period kind','period'],['Report date','date'],['Fiscal year','year'],['Period start','start'],['Period end','end']])await statement.getByLabel(label,{exact:true}).selectOption(value);
 const field=kind==='balance'?'total_assets':'operating_cash_flow';await statement.getByLabel(`Source ${field}`,{exact:true}).selectOption(field);
 await statement.getByRole('button',{name:'Calculate preview',exact:true}).click();
 await expect(statement.getByRole('region',{name:'Calculated Statement preview'})).toContainText('100');
 await statement.getByRole('tabpanel',{name:'Saved',exact:true}).getByRole('button',{name:'Apply Statement model',exact:true}).click();
 await expect(statement.getByRole('button',{name:'Calculate preview',exact:true})).toBeEnabled();
 const saved=await savedDashboard(page),id=saved.tabs[0].cards[1].id,result=await output(page,id);
 const columns=result.columns!.filter(c=>c.measureId);const row=result.rows!.find(r=>r.groupPath?.length===2)!;
 expect(columns.map(c=>row.values[c.id])).toEqual([100,60]);expect(result.totals!.values).toEqual({});
 const snapshot=saved.tabs[0].cards[1].tableDefinition.analytical.template;expect(snapshot).toMatchObject({id:kind,version:'1.0.0'});
 const files:Record<string,string|number[]>=await page.evaluate(()=>Object.fromEntries(window.__bdobb!.list!().map(p=>[p,window.__bdobb!.read!(p)!])));files[`files/${saved.tabs[0].cards[0].params.file}`]=bytes;
 const reopened=await context.newPage();await seedApp(reopened,files);await expect.poll(async()=>(await output(reopened,id)).status).toBe('ready');
 const restored=await savedDashboard(reopened);expect(restored.tabs[0].cards[1].tableDefinition.analytical.template).toEqual(snapshot);
 const value=await output(reopened,id),line=value.rows!.find(r=>r.groupPath?.length===2)!;expect(value.columns!.filter(c=>c.measureId).map(c=>line.values[c.id])).toEqual([100,60]);await reopened.close();
});

test('normal duplicate keyless CSV keeps distinct source identity and diagnosed Statement identity through folds and reorder',async({page})=>{
 const {statement}=await importStatement(page,'wide','csv','income-duplicates.csv');const saved=await savedDashboard(page);
 const source=await output(page,saved.tabs[0].cards[0].id);expect(source.rows).toHaveLength(2);expect(new Set(source.rows!.map(r=>r.id)).size).toBe(2);
 await applyStatement(statement,'wide','#ERROR');const id=saved.tabs[0].cards[1].id,before=await output(page,id);
 const leaves=before.rows!.filter(r=>r.groupPath?.length===2);expect(leaves).toHaveLength(3);expect(leaves.every(r=>Object.values(r.cellErrors??{}).some(e=>/duplicate/i.test(e.message)))).toBe(true);
 await statement.getByRole('button',{name:'Collapse Income',exact:true}).click();
 expect((await output(page,id)).rows!.map(r=>r.id)).toEqual(before.rows!.map(r=>r.id));
 expect(await reorderStatement(page,id)).toEqual({status:'saved'});
 const after=await output(page,id);expect(after.rows!.map(r=>r.id).sort()).toEqual(before.rows!.map(r=>r.id).sort());
 expect(after.rows!.filter(r=>r.groupPath?.length===2).every(r=>Object.values(r.cellErrors??{}).some(e=>/duplicate/i.test(e.message)))).toBe(true);
});

test('formatted XLS Statement keeps ratio numeric across actual worker linked table and chart',async({page})=>{
 test.setTimeout(90_000);
 const book=XLSX.read(readFileSync('src/test/fixtures/statement/income-wide.xls'),{type:'buffer'}),sheet=book.Sheets[book.SheetNames[0]];
 sheet.G2.z='0';sheet.H2.z='0.00%';
 const {statement}=await importStatement(page,'wide','xls',undefined,[...XLSX.write(book,{type:'buffer',bookType:'biff8'})]);
 await applyStatement(statement,'wide');const saved=await savedDashboard(page),id=saved.tabs[0].cards[1].id;
 const intent=saved.tabs[0].cards[1].tableDefinition.analytical as import('../src/lib/statementModel/types').StatementIntent;
 const formula=structuredClone(intent.template.lines.find(l=>l.formula)!.formula!);
 if(formula.ast.kind!=='binary')throw new Error('Expected gross-profit formula');
 formula.ast={kind:'binary',operator:'/',left:formula.ast,right:formula.ast.left};formula.format='percent';formula.expression='(Revenue - Cost) / Revenue';
 await statement.getByRole('button',{name:'Pivot',exact:true}).click();await statement.getByRole('tab',{name:'Saved',exact:true}).click();await statement.getByRole('button',{name:'Statement template',exact:true}).click();
 await statement.getByText('Stable identity and formula',{exact:true}).click();
 await statement.getByLabel('Formula Calculated gross profit',{exact:true}).fill(JSON.stringify(formula));await statement.getByRole('button',{name:'Use formula override',exact:true}).click();
 await statement.getByRole('button',{name:'Calculate preview',exact:true}).click();await expect(statement.getByRole('region',{name:'Calculated Statement preview'})).toContainText('40 %');
 await statement.getByRole('tabpanel',{name:'Saved',exact:true}).getByRole('button',{name:'Apply Statement model',exact:true}).click();await expect(statement.getByRole('button',{name:'Calculate preview',exact:true})).toBeEnabled();
 await statement.getByRole('button',{name:'Close pivot drawer',exact:true}).click();
 const result=await output(page,id),column=result.columns!.find(c=>c.measureId)!.id,leaves=result.rows!.filter(r=>r.groupPath?.length===2);
 expect(leaves.map(r=>r.cellFormats?.[column])).toEqual([{formatterFn:'int'},{formatterFn:'normalizedPercent',decimalPlaces:2},{formatterFn:'normalizedPercent'}]);
 expect(leaves.map(r=>r.values[column])).toEqual([100,60,0.4]);
 await statement.getByRole('button',{name:'Expand Profit',exact:true}).click();await expect(statement.locator('tbody')).toContainText('40 %');
 const profit=leaves[2];await statement.locator(`tr[data-row-id=${JSON.stringify(profit.id)}]`).getByRole('checkbox').click();await expect(statement.locator(`tr[data-row-id=${JSON.stringify(profit.id)}]`).getByRole('checkbox')).toBeChecked();
 await statement.getByRole('button',{name:'Card menu',exact:true}).click();await page.getByRole('menuitem',{name:'Create linked table',exact:true}).click();
 const child=page.locator('.widget-card').nth(2);await expect(child.locator('tbody')).toContainText('40 %');
 await child.getByRole('button',{name:'Card menu',exact:true}).click();await page.getByRole('menuitem',{name:'Create linked chart',exact:true}).click();const chart=page.locator('.linked-chart-renderer');
 await chart.getByLabel('Category',{exact:true}).selectOption(result.columns![0].id);await chart.getByRole('checkbox',{name:/Value/}).click();
 await expect.poll(()=>chart.locator('.js-plotly-plot').evaluate(e=>(e as unknown as {data:{y:number[]}[]}).data[0].y)).toEqual([0.4]);
});
