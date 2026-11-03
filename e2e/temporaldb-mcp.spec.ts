// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {MOCK_URL,read,seedCards} from './fixtures';
import {callMcpTool,discoverMcpTools} from '../src/lib/agent/mcp';

test('installed MCP saved definition appears in shared library and an older widget stays pinned', async({page,request})=>{
  test.setTimeout(90000);
  const api=process.env.TEMPORALDB_TEST_URL;
  const mcp=process.env.TEMPORALDB_MCP_URL;
  // Needs a live TemporalDB install; CI has none, so it skips there unless TEMPORALDB_MCP_REQUIRED=1 makes a missing prerequisite fail.
  test.skip(!process.env.TEMPORALDB_MCP_REQUIRED&&(!api||!mcp),'TEMPORALDB_TEST_URL and TEMPORALDB_MCP_URL not set');
  if(!api||!mcp)throw new Error('TEMPORALDB_MCP_REQUIRED=1 but TEMPORALDB_TEST_URL and TEMPORALDB_MCP_URL not set');
  const proof=JSON.parse(await readFile(process.env.TEMPORALDB_MCP_PROTOCOL!,'utf8'));
  const headers={Authorization:'Bearer '+process.env.TEMPORALDB_MCP_TOKEN,Host:'mcp.fixture.test'};
  const tools=await discoverMcpTools('temporaldb',mcp+'/mcp',fetch,headers);
  expect(tools.map(t=>t.name).sort()).toEqual(proof.tool_names.sort());
  const sent:Array<Record<string,unknown>>=[];
  // Transparent test transport bridge to the real installed API. No canned bodies.
  await page.route(`${MOCK_URL}/**`,async route=>{
    const incoming=route.request();const url=new URL(incoming.url());
    if(url.pathname==='/temporal/v1/executions' && incoming.method()==='POST')sent.push(incoming.postDataJSON());
    const upstream=await request.fetch(api+url.pathname+url.search,{method:incoming.method(),
      headers:{Authorization:'Bearer '+process.env.TEMPORALDB_TEST_TOKEN,'Content-Type':'application/json'},
      data:incoming.postDataBuffer()??undefined});
    await route.fulfill({status:upstream.status(),body:await upstream.body(),
      headers:{'content-type':'application/json','access-control-allow-origin':'*'}});
  });
  await seedCards(page,[{id:'q',widgetId:'temporaldb_query',backendId:'b1',params:{},layout:{x:0,y:0,w:40,h:14}}]);
  const card=page.locator('.widget-card').first();
  await card.getByRole('button',{name:'Open query library'}).click();
  const library=page.getByRole('dialog',{name:'Query library'});
  await expect(library.getByLabel(proof.saved.title,{exact:true}).getByText(proof.saved.description,{exact:true})).toBeVisible();
  await library.getByRole('button',{name:'Select '+proof.saved.title,exact:true}).click();
  await expect(library.getByLabel('Follow latest revision (explicit opt in)')).not.toBeChecked();
  await library.getByRole('button',{name:'Open as table widget',exact:true}).click();
  await expect(card.getByRole('cell',{name:'9007199254740993',exact:true}).first()).toBeVisible({timeout:60000});
  await expect(card).toContainText('Fixed revision 1');
  const binding=JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].queryBinding;
  expect(binding.queryId).toBe(proof.saved.query_id);
  expect(sent[0].revision).toBe(1);
  const revised=await callMcpTool(mcp+'/mcp','save_query',{key:'ui-new-revision',query_id:proof.saved.query_id,
    expected_revision:1,definition:{...proof.saved,title:'MCP later revision'}},fetch,headers) as {content:Array<{text:string}>};
  const revision=JSON.parse(revised.content[0].text);
  expect(revision.revision).toBe(2);
  await card.getByRole('button',{name:'Refresh query',exact:true}).click();
  await expect.poll(()=>sent.length).toBe(2);
  expect(sent[1].revision).toBe(1);
  await expect(card).toContainText('Fixed revision 1');
  expect(JSON.parse((await read(page,'dashboards/d1.json'))!).tabs[0].cards[0].queryBinding).toEqual(binding);
  await page.screenshot({path:'e2e-results/temporaldb-mcp-widget.png',fullPage:true});
  await writeFile(process.env.TEMPORALDB_MCP_UI_REPORT!,JSON.stringify({status:'PASS',query_id:proof.saved.query_id,
    discovered_tools:tools.map(t=>t.name),binding,started_revisions:sent.map(s=>s.revision),later_revision:revision.revision,
    integer_exact:true,transport:'existing browser fixtures with transparent real API bridge'}));
});
