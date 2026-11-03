// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Real browser transport qualification; P tests/test_gateway_browser.py owns fixture runtime.
import {test,expect} from '@playwright/test';
import type {TemporalClient} from '../src/lib/temporal/client';
import type {DiscoveryResult} from '../src/lib/discovery';
import type {QueryDefinition} from '../src/lib/temporal/contracts';
declare global { interface Window {temporalClient:TemporalClient;discover:()=>Promise<DiscoveryResult>} }
import {mkdtemp,mkdir,writeFile,rm,cp,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {createServer as httpsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {encode} from '@auth/core/jwt';
import {createPreviewServer} from '../web/server.mjs';
import {readConfig,SESSION_COOKIE} from '../web/config.mjs';

test('full Query Data app shares revisions and preserves linked chart/export receipts through real gateway',async({browser})=>{
 test.skip(!process.env.TEMPORALDB_TEST_URL,'Run through P fixture harness with configured runtime');
 const root=await mkdtemp(join(tmpdir(),'temporal-browser-'));
 const cleanups:Array<()=>Promise<unknown>>=[()=>rm(root,{recursive:true,force:true})];
 try {
 const {createGateway}=await import(resolve(process.env.TEMPORALDB_HOST_CHECKOUT!,'funnel-gateway/server.mjs'));
 const {validateConfig}=await import(resolve(process.env.TEMPORALDB_HOST_CHECKOUT!,'funnel-gateway/config.mjs'));
 const token='synthetic_gateway_token_only_for_tests';
 const gatewayConfig=validateConfig({origin:'https://fixture.example.ts.net:10000',temporalDB:true},{token,apiUsername:'fixture',apiPassword:'fixture',temporalToken:process.env.TEMPORALDB_TEST_TOKEN});
 // Fixture substitutes loopback transport addresses only. Production config/auth/handlers stay real.
 gatewayConfig.temporalOrigin=process.env.TEMPORALDB_TEST_URL;
 const gateway=createGateway(gatewayConfig);
 cleanups.push(()=>gateway.closeGateway());
 gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
 const gatewayURL='http://127.0.0.1:'+gateway.address().port;
 gatewayConfig.origin=gatewayURL;
 const config=readConfig({APP_ORIGIN:'https://localhost',AUTH_SECRET:'synthetic_session_secret_only_for_tests_123',AUTH_GITHUB_ID:'fixture',AUTH_GITHUB_SECRET:'fixture',SESSION_EPOCH:'gateway-v11',GITHUB_ALLOWED_USER_IDS:'42',BACKEND_GATEWAY_ORIGIN:'https://gateway.example.test',BACKEND_GATEWAY_TOKEN:token,TEMPORALDB_V11:'true'});
 config.backend=gatewayURL;
 await cp(resolve('dist/temporal'),root,{recursive:true});
 await mkdir(join(root,'assets'),{recursive:true});
 await writeFile(join(root,'index.html'),(await readFile(join(root,'index.html'),'utf8')).replace('</body>','<script type="module" src="/assets/probe.js"></script></body>'));
 const alias=Object.fromEntries(Object.entries({'@tauri-apps/plugin-http':'http','@tauri-apps/plugin-fs':'fs','@tauri-apps/api/path':'path','@tauri-apps/api/core':'core','@tauri-apps/plugin-dialog':'dialog','@tauri-apps/plugin-opener':'opener','@tauri-apps/api/webviewWindow':'webviewWindow'}).map(([name,file])=>[name,resolve('src/browser-shim/'+file+'.ts')]));
 await build({stdin:{contents:`import {createTemporalClient} from './src/lib/temporal/client';import {discoverBackend} from './src/lib/discovery'; const backend={id:'preview-temporal',name:'TemporalDB',baseUrl:location.origin+'/temporal',authLocation:'header',validateWidgets:false};window.temporalClient=createTemporalClient(backend);window.discover=()=>discoverBackend(backend);`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',alias,outfile:join(root,'assets/probe.js')});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 const preview=createPreviewServer({config,assets:root});
 const tls=httpsServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem'))},preview.listeners('request')[0]);
 cleanups.push(async()=>{tls.closeAllConnections();await new Promise<void>(resolve=>tls.close(()=>resolve()));});
 tls.listen(0,'127.0.0.1');await once(tls,'listening');config.origin='https://localhost:'+(tls.address() as AddressInfo).port;
 const context=await browser.newContext({ignoreHTTPSErrors:true});
 cleanups.push(()=>context.close());
  const anonymous=await context.request.get(config.origin+'/temporal/widgets.json');expect(anonymous.status()).toBe(401);
  expect((await fetch(gatewayURL+'/temporal/widgets.json',{})).status).toBe(401);
  const session=await encode({token:{githubId:'42',epoch:config.epoch,deadline:Date.now()/1000+3600},secret:config.secret,salt:SESSION_COOKIE,maxAge:3600});
  await context.addCookies([{name:SESSION_COOKIE,value:session,url:config.origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();const leaked:string[]=[];const executions:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/executions'))executions.push(r.url());});
  page.on('request',r=>{const all=r.url()+JSON.stringify(r.headers())+(r.postData()??'');if(all.includes(token)||all.includes(process.env.TEMPORALDB_TEST_TOKEN!))leaked.push(r.url());});
  async function seed(target:import('@playwright/test').Page){await target.addInitScript(()=>{const files={'settings.json':'{}','backends.json':JSON.stringify([{id:'preview-temporal',name:'TemporalDB',baseUrl:location.origin+'/temporal',authLocation:'header',validateWidgets:false}]),'dashboards/d1.json':JSON.stringify({id:'d1',name:'Acceptance',tabs:[{id:'t1',name:'Acceptance',cards:[{id:'q',widgetId:'temporaldb_query',backendId:'preview-temporal',params:{},layout:{x:0,y:0,w:40,h:14}}]}]})};Object.defineProperty(window,'__bdobbSeed',{get:()=>files,set:()=>{},configurable:true});});}
  await seed(page);await page.goto(config.origin);await page.mouse.move(900,700);await page.waitForFunction(()=>Boolean(window.temporalClient));
  const discovered=await page.evaluate(()=>window.discover());expect(discovered.status,discovered.error).toBe('online');expect(discovered.service).toBe('TemporalDB');expect(discovered.widgets[0].type).toBe('query_data');expect(discovered.issues).toEqual([]);
  const definition:QueryDefinition={query_id:'11111111-1111-4111-8111-111111111111',revision:1,title:'Acceptance daily',kind:'sql',parameters:[],request:{sql:"SELECT p.effective_from, CAST(p.raw_close AS DOUBLE) AS close, p.volume, f.value AS revenue FROM prices p CROSS JOIN facts f WHERE f.metric = 'totalRevenue' ORDER BY p.effective_from",sources:{prices:'eodhd.eod',facts:'eodhd.fundamentals'},bindings:{}},temporal:{mode:'current_corrected'},schema_expectation:[],presentation:{format:'table'}};
  const source=page.locator('.widget-card').first();
  await source.getByRole('button',{name:'Open query library'}).click();
  const dialog=page.getByRole('dialog',{name:'Query library'});
  await dialog.getByText('Create or revise definition',{exact:true}).click();
  await dialog.getByLabel('Query definition',{exact:true}).fill(JSON.stringify(definition));
  await dialog.getByRole('button',{name:'Save new query',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Select Acceptance daily',exact:true})).toBeVisible();
  const otherContext=await browser.newContext({ignoreHTTPSErrors:true});cleanups.push(()=>otherContext.close());await otherContext.addCookies(await context.cookies());
  const second=await otherContext.newPage();await seed(second);await second.goto(config.origin);await second.mouse.move(900,700);
  await second.getByRole('button',{name:'Open query library'}).click();
  const other=second.getByRole('dialog',{name:'Query library'});
  await other.getByRole('button',{name:'Select Acceptance daily',exact:true}).click();
  await other.getByText('Create or revise definition',{exact:true}).click();
  const revised=JSON.parse(await other.getByLabel('Query definition',{exact:true}).inputValue());
  revised.title='Acceptance revised';
  await other.getByLabel('Query definition',{exact:true}).fill(JSON.stringify(revised));
  await other.getByRole('button',{name:'Save new revision',exact:true}).click();
  await expect(other.getByRole('button',{name:'Select Acceptance revised',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Reload library',exact:true}).click();
  await dialog.getByRole('button',{name:'Select Acceptance revised',exact:true}).click();
  await writeFile(process.env.TEMPORALDB_TEST_WORKER_START!,'start');
  await dialog.getByRole('button',{name:'Open as table widget',exact:true}).click();
  await expect(source.getByRole('cell',{name:'2',exact:true}).first()).toBeVisible({timeout:60000});
  await expect(source).toContainText('Fixed revision 2');
  await source.getByRole('button',{name:'Card menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Create linked table',exact:true}).click();
  const linked=page.locator('.widget-card').filter({hasText:'Linked table'});
  await expect(linked.getByRole('cell',{name:'2',exact:true}).first()).toBeVisible();
  await linked.getByRole('button',{name:'Card menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Export ▸',exact:true}).click();
  const downloadReady=page.waitForEvent('download');
  await page.getByRole('menuitem',{name:'JSON',exact:true}).click();
  const download=await downloadReady;
  const exported=JSON.parse(await readFile((await download.path())!,'utf8'));
  expect(exported.rows).toHaveLength(2);
  const receipt=exported.provenance.receipt.temporal;
  expect(receipt.queryRevision).toBe(2);
  const result=await page.evaluate(id=>window.temporalClient.page(id),receipt.executionId);
  expect(receipt.inputManifest).toEqual(result.receipt.input_manifest);
  expect(Object.keys(result.receipt.input_manifest.source_manifests!)).toEqual(['eodhd.eod','eodhd.fundamentals']);
  expect(exported.rows.map((row:{volume:string})=>row.volume)).toEqual(['9007199254740993','9007199254740993']);
  expect(exported.rows.map((row:{revenue:string})=>row.revenue)).toEqual(['100','100']);
  await source.getByRole('button',{name:'Card menu',exact:true}).click();
  await page.getByRole('menuitem',{name:'Create linked chart',exact:true}).click();
  const chart=page.locator('.linked-chart-renderer');
  await chart.getByLabel('Category',{exact:true}).selectOption('effective_from');
  await chart.getByLabel('close',{exact:true}).check();
  await expect(chart.locator('.js-plotly-plot')).toHaveCount(1);
  expect(executions).toHaveLength(1);
  expect(await chart.locator('.js-plotly-plot').evaluate(el=>(el as HTMLElement & {data:Array<{y:number[]}>}).data[0].y)).toEqual([2,2]);
  const audit=await page.evaluate(id=>window.temporalClient.protect(id,'Full application protected export'),receipt.executionId);
  // The second client now executes the same revision after publication commits.
  await other.getByRole('button',{name:'Select Acceptance revised',exact:true}).click();
  await other.getByRole('button',{name:'Open as table widget',exact:true}).click();
  const secondSource=second.locator('.widget-card').first();
  await expect(secondSource.getByRole('cell',{name:'3',exact:true}).first()).toBeVisible({timeout:60000});
  await secondSource.getByRole('button',{name:'Card menu',exact:true}).click();
  await second.getByRole('menuitem',{name:'Export ▸',exact:true}).click();
  const secondReady=second.waitForEvent('download');
  await second.getByRole('menuitem',{name:'JSON',exact:true}).click();
  const secondExport=JSON.parse(await readFile((await (await secondReady).path())!,'utf8'));
  const secondRef=secondExport.provenance.receipt.temporal;
  const secondResult=await second.evaluate(id=>window.temporalClient.page(id),secondRef.executionId);
  expect(secondRef.queryRevision).toBe(2);
  expect(secondRef.inputManifest).toEqual(secondResult.receipt.input_manifest);
  expect(secondResult.receipt.input_manifest.source_manifests!['eodhd.fundamentals']).toEqual(result.receipt.input_manifest.source_manifests!['eodhd.fundamentals']);
  expect(secondResult.receipt.input_manifest.source_manifests!['eodhd.eod']).not.toEqual(result.receipt.input_manifest.source_manifests!['eodhd.eod']);
  expect(await page.evaluate(id=>window.temporalClient.page(id),receipt.executionId)).toEqual(result);
  // Exact new public routes traverse preview -> H -> the installed P API.
  const publicationPath=config.origin+'/temporal/temporal/v1/audits/'+audit.run_id+'/publications';
  const published=await context.request.post(publicationPath,{headers:{Origin:config.origin},data:{format:'arrow-ipc-stream-v1',idempotency_key:'task6-browser'}});
  expect(published.status()).toBe(201);
  const publication=await published.json();
  const got=await context.request.get(publicationPath+'/'+publication.publication_id);
  expect(got.status()).toBe(200);expect(await got.json()).toEqual(publication);
  const negativeDirectory=process.env.TEMPORALDB_TEST_NEGATIVE_DIRECTORY!;
  await writeFile(join(negativeDirectory,'negative-ready'),'ready');
  await expect.poll(()=>readFile(join(negativeDirectory,'negative-go'),'utf8').catch(()=>''),{timeout:60000}).toBe('ready');
  const publicationNegative:{workspace?:{post:number;get:number};entitlement?:{post:number;get:number};malformed:number[];disabled?:{post:number;get:number};inventory_verified?:boolean}={malformed:[]};
  const originalAuthorization=gatewayConfig.temporalAuthorization;
  const originalOrigin=gatewayConfig.temporalOrigin;
  async function deniedResponse(response:import('@playwright/test').APIResponse){
    const body=await response.text();expect(body.length).toBeLessThan(4096);
    for(const secret of [token,process.env.TEMPORALDB_TEST_TOKEN!,'denied-workspace-token','denied-entitlement-token'])expect(body).not.toContain(secret);
    return response.status();
  }
  try {
    for(const scope of ['workspace','entitlement'] as const){
      gatewayConfig.temporalAuthorization='Bearer denied-'+scope+'-token';
      const post=await deniedResponse(await context.request.post(publicationPath,{headers:{Origin:config.origin},data:{format:'arrow-ipc-stream-v1',idempotency_key:'foreign-'+scope}}));
      const get=await deniedResponse(await context.request.get(publicationPath+'/'+publication.publication_id));
      expect({post,get}).toEqual({post:403,get:403});publicationNegative[scope]={post,get};
    }
    gatewayConfig.temporalAuthorization=originalAuthorization;
    for(const data of [{format:'parquet',idempotency_key:'denied'},{format:'arrow-ipc-stream-v1',idempotency_key:'denied',bucket:'forbidden'}]) {
      const status=await deniedResponse(await context.request.post(publicationPath,{headers:{Origin:config.origin},data}));
      expect(status).toBe(409);publicationNegative.malformed.push(status);
    }
    gatewayConfig.temporalOrigin=process.env.TEMPORALDB_TEST_DISABLED_URL;
    const post=await deniedResponse(await context.request.post(publicationPath,{headers:{Origin:config.origin},data:{format:'arrow-ipc-stream-v1',idempotency_key:'disabled'}}));
    const get=await deniedResponse(await context.request.get(publicationPath+'/'+publication.publication_id));
    expect({post,get}).toEqual({post:503,get:503});publicationNegative.disabled={post,get};
  } finally {gatewayConfig.temporalAuthorization=originalAuthorization;gatewayConfig.temporalOrigin=originalOrigin;}
  const crossed=config.origin+'/temporal/temporal/v1/audits/22222222-2222-4222-8222-222222222222/publications/'+publication.publication_id;
  expect([403,409]).toContain((await context.request.get(crossed)).status());
  await writeFile(join(negativeDirectory,'negative-done'),'ready');
  await expect.poll(()=>readFile(join(negativeDirectory,'negative-verified'),'utf8').catch(()=>''),{timeout:60000}).toBe('ready');
  publicationNegative.inventory_verified=true;
  await writeFile(process.env.TEMPORALDB_TEST_UI_REPORT!,JSON.stringify({publication_negative:publicationNegative,execution_id:receipt.executionId,run_id:audit.run_id,receipt:result.receipt,exported,second_receipt:secondResult.receipt,second_exported:secondExport,publication,linked_chart:true,shared_revision:2}));
  await page.screenshot({path:'e2e-results/temporal-platform.png',fullPage:true});
  expect(leaked).toEqual([]);
 } finally {for(const cleanup of cleanups.reverse())await cleanup();}
});
