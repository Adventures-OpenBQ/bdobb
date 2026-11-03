// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Real browser transport qualification; P tests/test_gateway_browser.py owns fixture runtime.
import {test,expect} from '@playwright/test';
import type {TemporalClient} from '../src/lib/temporal/client';
import type {DiscoveryResult} from '../src/lib/discovery';
import type {QueryDefinition} from '../src/lib/temporal/contracts';
declare global { interface Window {temporalClient:TemporalClient;discover:()=>Promise<DiscoveryResult>} }
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
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

test('authenticated browser uses actual relay, gateway and configured TemporalDB for discovery, pages, cancel and audit',async({browser})=>{
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
 await mkdir(join(root,'assets'));
 await writeFile(join(root,'index.html'),'<html><body><h1>TemporalDB transport qualification</h1><script type="module" src="/assets/probe.js"></script></body></html>');
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
  const page=await context.newPage();const leaked:string[]=[];
  page.on('request',r=>{const all=r.url()+JSON.stringify(r.headers())+(r.postData()??'');if(all.includes(token)||all.includes(process.env.TEMPORALDB_TEST_TOKEN!))leaked.push(r.url());});
  await page.goto(config.origin);await page.waitForFunction(()=>Boolean(window.temporalClient));
  const discovered=await page.evaluate(()=>window.discover());expect(discovered.status,discovered.error).toBe('online');expect(discovered.service).toBe('TemporalDB');expect(discovered.widgets[0].type).toBe('query_data');expect(discovered.issues).toEqual([]);
  const definition:QueryDefinition={query_id:'11111111-1111-4111-8111-111111111111',revision:1,title:'Gateway daily',kind:'dataset',parameters:[],request:{dataset_id:'eodhd.eod',parameters:{symbol:'TEST.US'}},temporal:{mode:'current_corrected'},schema_expectation:[],presentation:{format:'table'}};
  const saved=await page.evaluate(d=>window.temporalClient.create(d),definition);
  const input={query_id:saved.query_id,revision:1,params:{},context:{mode:'current_corrected' as const},page_size:1};
  const cancelled=await page.evaluate(async i=>{const c=window.temporalClient;const handle=await c.start(i);return c.cancel(handle.execution_id);},input);expect(cancelled).toBe('cancelled');
  await writeFile(process.env.TEMPORALDB_TEST_WORKER_START!,'start');
  const handle=await page.evaluate(i=>window.temporalClient.start(i),input);
  await expect.poll(()=>page.evaluate(id=>window.temporalClient.status(id).then(x=>x.state),handle.execution_id),{timeout:60000}).toBe('succeeded');
  const first=await page.evaluate(id=>window.temporalClient.page(id),handle.execution_id);expect(first.rows).toHaveLength(1);expect(first.next_cursor).toBeTruthy();
  const second=await page.evaluate(({id,cursor})=>window.temporalClient.page(id,cursor??undefined),{id:handle.execution_id,cursor:first.next_cursor});expect(second.rows).toHaveLength(1);expect(second.next_cursor).toBeNull();
  expect(first.receipt.runtime_artifact).toBe(second.receipt.runtime_artifact);
  const audit=await page.evaluate(id=>window.temporalClient.protect(id,'Gateway protected run'),handle.execution_id);
  const restored=await page.evaluate(id=>window.temporalClient.audit(id),audit.run_id);expect(restored.run_id).toBe(audit.run_id);
  expect((await page.evaluate(async()=>{const r=await fetch('/temporal/temporal/v1/captures',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status;}))).toBe(404);
  expect(leaked).toEqual([]);
 } finally {for(const cleanup of cleanups.reverse())await cleanup();}
});
