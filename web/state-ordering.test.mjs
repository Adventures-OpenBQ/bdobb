// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import {encode} from '@auth/core/jwt';
import {createPreviewServer} from './server.mjs';
import {readConfig, SESSION_COOKIE} from './config.mjs';
import {STATE_WRITER, STATE_SEQUENCE} from '../src/lib/stateWriteProtocol.mjs';
const env = {APP_ORIGIN:'https://preview.example.com',AUTH_SECRET:'state-ordering-test-only-not-production',AUTH_GITHUB_ID:'test',AUTH_GITHUB_SECRET:'synthetic',SESSION_EPOCH:'state',GITHUB_ALLOWED_USER_IDS:'42',BACKEND_GATEWAY_ORIGIN:'https://gateway.example.com',BACKEND_GATEWAY_TOKEN:'state-ordering-test-only-gateway-token'};
const writer = '11111111-1111-4111-8111-111111111111';
async function fixture(t, upstream) {
  const config = readConfig(env);
  const server = createPreviewServer({config,fetchUpstream:upstream});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const jwt=await encode({token:{githubId:'42',epoch:'state',deadline:Date.now()/1000+3600},secret:env.AUTH_SECRET,salt:SESSION_COOKIE,maxAge:3600});
  return (headers={},method='PUT')=>new Promise((resolve,reject)=>{
    const body=method==='DELETE'?undefined:'{"value":1}';
    const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/state/settings.json',method,headers:{host:'preview.example.com',origin:config.origin,cookie:`${SESSION_COOKIE}=${jwt}`,...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...headers}},res=>{
      res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));
    });req.on('error',reject);req.end(body);
  });
}
test('versioned state writes relay the validated fence and acknowledge only the matching committed version',async t=>{
  const calls=[];
  const call=await fixture(t,async(url,init)=>{calls.push({url,init});return new Response(null,{status:204,headers:{[STATE_WRITER]:writer,[STATE_SEQUENCE]:'2'}});});
  const answer=await call({[STATE_WRITER]:writer,[STATE_SEQUENCE]:'2'});
  assert.equal(answer.status,204);
  assert.equal(calls[0].init.headers[STATE_WRITER],writer);
  assert.equal(calls[0].init.headers[STATE_SEQUENCE],'2');
  assert.equal(answer.headers[STATE_WRITER],writer);
  assert.equal(answer.headers[STATE_SEQUENCE],'2');
});
test('a versioned save cannot be reported successful by an older store without a matching fence acknowledgement',async t=>{
  const call=await fixture(t,async()=>new Response(null,{status:204}));
  assert.equal((await call({[STATE_WRITER]:writer,[STATE_SEQUENCE]:'2'})).status,502);
});
test('stale state writes report conflict and legacy clients retain their existing save contract',async t=>{
  let n=0;
  const call=await fixture(t,async()=>new Response(null,{status:n++===0?409:204}));
  assert.equal((await call({[STATE_WRITER]:writer,[STATE_SEQUENCE]:'1'},'DELETE')).status,409);
  assert.equal((await call()).status,204);
});
test('malformed or incomplete state fences are refused before the account store',async t=>{
  let calls=0;
  const call=await fixture(t,async()=>{calls++;return new Response(null,{status:204});});
  for(const headers of [{[STATE_WRITER]:writer},{[STATE_SEQUENCE]:'1'},{[STATE_WRITER]:'invalid',[STATE_SEQUENCE]:'1'},{[STATE_WRITER]:writer,[STATE_SEQUENCE]:'01'},{[STATE_WRITER]:writer,[STATE_SEQUENCE]:'9007199254740992'}]) assert.equal((await call(headers)).status,400);
  assert.equal(calls,0);
});
