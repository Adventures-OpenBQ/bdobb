// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {expect,test,type Locator,type Page} from '@playwright/test';
import {MOCK_URL,read,seedApp,seedCards,tickChartMeasures} from './fixtures';

// Exact synthetic native own-key payload, including an own __proto__ and blank field.
const rows = JSON.parse('[{"category":1,"hasOwnProperty":100,"__proto__":102,"":101,"day":"2026-11-20","hover":{"value":100,"description":"synthetic own cell"},"m1":100,"m2":200},{"category":2,"hasOwnProperty":20,"__proto__":22,"":21,"day":"2026-11-19","hover":{"value":20,"description":"synthetic own cell"},"m1":20,"m2":40},{"category":3,"hasOwnProperty":300,"__proto__":302,"":301,"day":"2026-11-21","hover":{"value":300,"description":"synthetic own cell"},"m1":300,"m2":600}]');
const columns = [
  {field:'category',headerName:'Category',cellDataType:'number'},
  {field:'hasOwnProperty',headerName:'Own numeric',cellDataType:'number'},
  {field:'__proto__',headerName:'Proto numeric',cellDataType:'number'},
  {field:'',headerName:'Empty-key numeric',cellDataType:'number'},
  {field:'day',headerName:'Day',cellDataType:'dateString'},
  {field:'hover',headerName:'Hover number',cellDataType:'object'},
  {field:'m1',headerName:'M1',cellDataType:'number'},
  {field:'m2',headerName:'M2',cellDataType:'number'},
];
type WorkerEvidence = {workers:string[];registered:{widgetId:string;fields:string[];rows:number}[]};
async function observeWorkers(page:Page) {
  await page.addInitScript(() => {
    const Original = window.Worker;
    const evidence:WorkerEvidence = {workers:[],registered:[]};
    Object.assign(window,{rawFieldWorkerEvidence:evidence});
    window.Worker = class extends Original {
      constructor(...args:ConstructorParameters<typeof Original>) {
        super(...args);
        evidence.workers.push(String(args[0]));
      }
      postMessage(message:unknown,options?:StructuredSerializeOptions|Transferable[]) {
        const request = message as {kind?:string;revision?:{widgetId:string};input?:{columns:{id:string}[];rows:unknown[]}};
        if (request.kind === 'registerInput' && request.input && evidence.registered.length < 32)
          evidence.registered.push({widgetId:request.revision!.widgetId,fields:request.input.columns.map(c=>c.id),rows:request.input.rows.length});
        if (Array.isArray(options)) super.postMessage(message,options);
        else super.postMessage(message,options);
      }
    };
  });
}
const blankCells = (card:Locator) => card.locator('tbody td[data-field=""]');
const protoCells = (card:Locator) => card.locator('tbody td[data-field="__proto__"]');
const traces = (chart:Locator) => chart.locator('.js-plotly-plot').evaluate(el =>
  (el as unknown as {data:{name:string;y:number[]}[]}).data.map(t=>({name:t.name,y:t.y})));

test('actual WidgetCard workers preserve empty and special source fields through UI edits, linked consumers and durable reopening', async ({page,context},info) => {
  await page.setViewportSize({width:1440,height:1000});
  const cors = {'access-control-allow-origin':'*'};
  await context.route(`${MOCK_URL}/widgets.json`,route=>route.fulfill({headers:cors,json:{native_own_table:{name:'Own-key table regression',description:'Synthetic regression fixture',type:'table',endpoint:'/own-key-table',params:[],gridData:{w:40,h:18},data:{table:{columnsDefs:columns}}}}}));
  let acquisitions = 0;
  await context.route(`${MOCK_URL}/own-key-table*`,route=>{
    acquisitions++;
    return route.fulfill({headers:cors,json:rows});
  });
  await observeWorkers(page);
  await seedCards(page,[{id:'own-source',widgetId:'native_own_table',backendId:'b1',params:{},layout:{x:0,y:0,w:40,h:18}}]);
  const source = page.locator('.widget-card').first();
  await expect(blankCells(source)).toHaveText(['101','21','301']);
  await expect(protoCells(source)).toHaveText(['102','22','302']);
  await expect(source.locator('tbody td[data-field="hasOwnProperty"]')).toHaveText(['100','20','300']);
  await expect(source.locator('thead tr').first().locator('th[data-field]')).toHaveCount(8);
  const acquisitionBaseline = acquisitions;
  expect(acquisitionBaseline).toBeGreaterThan(0);

  await source.locator('thead tr').first().locator('th[data-field=""]').click();
  await expect(blankCells(source)).toHaveText(['21','101','301']);
  await source.getByRole('button',{name:'Filter rows',exact:true}).click();
  await source.getByLabel('Minimum Empty-key numeric',{exact:true}).fill('30');
  await expect(blankCells(source)).toHaveText(['101','301']);
  const protoHeader = source.locator('thead tr').first().locator('th[data-field="__proto__"]');
  await protoHeader.click();
  await expect(protoHeader).toHaveAttribute('aria-sort','ascending');
  await protoHeader.click();
  await expect(protoHeader).toHaveAttribute('aria-sort','descending');
  await expect(blankCells(source)).toHaveText(['301','101']);
  await source.getByLabel('Minimum Proto numeric',{exact:true}).fill('150');
  await expect(blankCells(source)).toHaveText(['301']);
  await source.getByLabel('Minimum Proto numeric',{exact:true}).fill('');
  await expect(blankCells(source)).toHaveText(['301','101']);

  await source.getByRole('button',{name:'Card menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Create linked table',exact:true}).click();
  const linked = page.locator('.widget-card').filter({hasText:'Linked table'});
  await expect(blankCells(linked)).toHaveText(['301','101']);
  await expect(protoCells(linked)).toHaveText(['302','102']);
  await source.getByRole('button',{name:'Card menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Create linked chart',exact:true}).click();
  const chart = page.locator('.linked-chart-renderer');
  const chartCard = page.locator('.widget-card').filter({has:chart});
  await chartCard.getByRole('button',{name:'Show parameters',exact:true}).click();
  await chartCard.getByLabel('Category',{exact:true}).selectOption({label:'Category'});
  await tickChartMeasures(page,chartCard,'M1','M2');
  await expect.poll(()=>traces(chart)).toEqual([{name:'M1',y:[300,100]},{name:'M2',y:[600,200]}]);
  await expect(source.getByText('Expected nonempty ID',{exact:true})).toHaveCount(0);
  expect(acquisitions).toBe(acquisitionBaseline); // Edits/consumers add no acquisition beyond settled startup.
  await expect.poll(async()=>JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].tableDefinition.table).toMatchObject({sorting:[{id:'__proto__',desc:true}],columnFilters:[{id:'',value:{min:30}}]});
  const files = await page.evaluate(()=>Object.fromEntries(window.__bdobb!.list!().map(path=>[path,window.__bdobb!.read!(path)!])));
  const written = JSON.parse(files['dashboards/d1.json']);
  expect(written.tabs[0].cards.find((card:{linkedChart?:unknown})=>card.linkedChart).linkedChart).toMatchObject({category:'category',measures:['m1','m2']});

  const reopened = await context.newPage();
  await observeWorkers(reopened);
  await seedApp(reopened,files);
  const restoredSource = reopened.locator('.widget-card').first();
  const restoredLinked = reopened.locator('.widget-card').filter({hasText:'Linked table'});
  await expect(blankCells(restoredSource)).toHaveText(['301','101']);
  await expect(blankCells(restoredLinked)).toHaveText(['301','101']);
  await expect.poll(()=>traces(reopened.locator('.linked-chart-renderer'))).toEqual([{name:'M1',y:[300,100]},{name:'M2',y:[600,200]}]);
  const evidence = await reopened.evaluate(()=>(window as unknown as {rawFieldWorkerEvidence:WorkerEvidence}).rawFieldWorkerEvidence);
  expect(evidence.workers.some(url=>url.includes('/table.worker.ts'))).toBe(true);
  expect(evidence.workers.some(url=>url.includes('/rust.worker.ts'))).toBe(false);
  const registered = evidence.registered.find(input=>input.widgetId==='own-source')!;
  expect(registered.fields).toEqual(columns.map(column=>column.field));
  expect(registered.rows).toBe(3);
  const linkedId = written.tabs[0].cards.find((card:{linkedSource?:unknown;linkedChart?:unknown})=>card.linkedSource&&!card.linkedChart).id;
  const subsetInput = evidence.registered.find(input=>input.widgetId===linkedId)!;
  expect(subsetInput.fields).toEqual(columns.map(column=>column.field));
  expect(subsetInput.rows).toBe(2);
  await info.attach('actual-worker-raw-fields',{body:JSON.stringify({acquisitionBaseline,evidence}),contentType:'application/json'});
  await reopened.close();
});
