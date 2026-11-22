// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {encode} from '@auth/core/jwt';
import {createPreviewServer} from './server.mjs';
import {readConfig,SESSION_COOKIE} from './config.mjs';
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
const env={APP_ORIGIN:'https://daychart.example',AUTH_SECRET:'daychart-synthetic-session-secret-not-for-production',AUTH_GITHUB_ID:'test',AUTH_GITHUB_SECRET:'synthetic',SESSION_EPOCH:'day',GITHUB_ALLOWED_USER_IDS:'42',BACKEND_GATEWAY_ORIGIN:'https://gateway.example',BACKEND_GATEWAY_TOKEN:'daychart-synthetic-gateway-token-not-for-production'};
async function fixture(t,fetchUpstream){
 const config=readConfig(env);const server=createPreviewServer({config,fetchUpstream});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const jwt=await encode({secret:config.secret,salt:SESSION_COOKIE,maxAge:3600,token:{githubId:'42',epoch:'day',deadline:Date.now()/1000+3600}});
 return (path,auth=true)=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path,headers:{host:'daychart.example',origin:config.origin,...(auth?{cookie:`${SESSION_COOKIE}=${jwt}`}:{})}},res=>{const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));});req.on('error',reject);req.end();});
}
test('Day Chart relay authenticates snapshots and matching raster logos with server credentials only',async t=>{
 const calls=[];const call=await fixture(t,async(url,options)=>{calls.push({url,options});return url.includes('symbol_logo')?new Response(png,{headers:{'content-type':'image/png'}}):new Response('{"schema_version":1,"tiles":[]}',{headers:{'content-type':'application/json'}});});
 assert.equal((await call('/grid/day_charts?symbol=AAPL%2CMSFT',false)).status,401);
 assert.equal((await call('/grid/day_charts?symbol=AAPL%2CMSFT')).status,200);
 const logo=await call('/grid/symbol_logo?symbol=AAPL');assert.equal(logo.status,200);assert.equal(logo.headers['content-type'],'image/png');assert.deepEqual(logo.body,png);
 assert.equal(calls[1].url,'https://gateway.example/grid/symbol_logo?symbol=AAPL');assert.equal(calls[1].options.headers.Authorization,`Bearer ${env.BACKEND_GATEWAY_TOKEN}`);assert.equal(calls[1].options.headers.Cookie,undefined);
 assert.equal((await call('/grid/symbol_logo?symbol=AAPL&url=https://evil.test')).status,404);
});
test('Day Chart logo relay refuses SVG, wrong signatures and oversized bytes',async t=>{
 let body=Buffer.from('<svg/>'),type='image/svg+xml';const call=await fixture(t,async()=>new Response(body,{headers:{'content-type':type}}));
 assert.equal((await call('/grid/symbol_logo?symbol=AAPL')).status,502);type='image/png';assert.equal((await call('/grid/symbol_logo?symbol=AAPL')).status,502);body=Buffer.alloc(262145);assert.equal((await call('/grid/symbol_logo?symbol=AAPL')).status,502);
});
