// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import test from "node:test";
import assert from "node:assert/strict";
import {createServer,request} from "node:http";
import {once} from "node:events";
import {encode} from "@auth/core/jwt";
import {createPreviewServer} from "./server.mjs";
import {readConfig,SESSION_COOKIE} from "./config.mjs";
const unauthorized={cookie:""};
const refusedControlHeaders = [[{origin:"https://evil.example.com"},403]];
async function makeServer(backend,overrides) {
  const env={APP_ORIGIN:"https://preview.example.com",AUTH_SECRET:"test-only-secret-never-use-in-production-123",AUTH_GITHUB_ID:"test-client",AUTH_GITHUB_SECRET:"test-client-secret",SESSION_EPOCH:"test-1",GITHUB_ALLOWED_USER_IDS:"42",BACKEND_GATEWAY_ORIGIN:"https://gateway.example.com",BACKEND_GATEWAY_TOKEN:"test-only-gateway-token-not-a-real-credential",TABLE_RELAY_TOKEN:"test-only-distinct-relay-token-1234567890"};
  const cfg={...readConfig(env),backend,ssrmRoutes:["/api/api/v1/test/rows"],...overrides};
  const cookie=`${SESSION_COOKIE}=${await encode({token:{githubId:"42",epoch:"test-1",deadline:Date.now()/1000+3600},secret:env.AUTH_SECRET,salt:SESSION_COOKIE,maxAge:3600})}`;
  return {server:createPreviewServer({config:cfg}),headers:{host:"preview.example.com",cookie,origin:env.APP_ORIGIN}};
}

// These requests cross real loopback HTTP servers. Holding upstream responses
// catches a shared gate, an unbounded bypass, and leaked permits on every exit.
const waitFor = async predicate => {
  const until = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < until, "request reached upstream / released admission");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
async function fixture(t, overrides = {}) {
  const held = new Map();
  const upstream = createServer(async (req, res) => {
    for await (const chunk of req) { void chunk; /* drain bounded relay body */ }
    const path = req.url.replace(/^\/table/, "");
    if (path.includes("/hold-")) {
      held.set(path, res);
      res.once("close", () => held.delete(path));
      return;
    }
    if (path.includes("/fail/")) { res.destroy(); return; }
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({path, principal:req.headers["x-table-principal"]}));
  });
  upstream.listen(0,"127.0.0.1"); await once(upstream,"listening");
  const {server, headers} = await makeServer(`http://127.0.0.1:${upstream.address().port}`, overrides);
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(async () => {
    server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);
  });
  const call = (path, method="POST", patch={}, body=method==="POST"?"{}":undefined) => {
    let req;
    const done = new Promise((resolve,reject)=>{
      req=request({hostname:"127.0.0.1",port:server.address().port,path,method,
        headers:{...headers,...(body!==undefined?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}:{}),...patch}},res=>{
          const chunks=[];res.on("data",c=>chunks.push(c));
          res.on("end",()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
      });
      req.on("error",reject);req.end(body);
    });
    // Abort tests observe the rejection explicitly; attach immediately to avoid a
    // transient unhandled rejection while waiting for upstream disconnect.
    done.catch(()=>{});
    return {done, abort:()=>req.destroy()};
  };
  const finish = path => { const res=held.get(path);assert.ok(res,path);res.writeHead(200,{"Content-Type":"application/json"});res.end('{}'); };
  return {held,call,finish};
}
test("saturation reserves exactly two authenticated control slots and reclaims success and disconnect",async t=>{
  const {held,call,finish}=await fixture(t);
  const normal=Array.from({length:4},(_,i)=>call(`/table/sessions/hold-${i}/commands`));
  await waitFor(()=>held.size===4);
  for(const [path,method] of [["/table/sessions/s/cancel","POST"],["/table/sessions/s","DELETE"],["/table/exports/e","DELETE"]]) {
    const response=await call(path,method).done;
    assert.equal(response.status,200,`${method} ${path} must reach upstream under saturation`);
    assert.equal(JSON.parse(response.body).path,path.slice(6));
    assert.equal(JSON.parse(response.body).principal,"github:42");
  }
  for(const [path,method,status] of [
    ["/table/sources/s","DELETE",429],["/table/sessions/s/derive","POST",429],
    ["/table/sessions/s/commands","POST",429],["/table/sessions/s/exports","POST",429],
    ["/api/api/v1/test/rows","POST",429],
    ["/table/sessions/s/cancel?x=1","POST",404],["/table/sessions/s/cancel/","POST",404],
    ["/table/sessions/s/cancel","DELETE",404],["/table/sessions/s","POST",404],
    ["/table/sessions/s%2fother/cancel","POST",421]]) {
    assert.equal((await call(path,method).done).status,status,`${method} ${path}`);
  }
  assert.equal((await call("/table/sessions/s/cancel","POST",unauthorized).done).status,401);
  for (const [headers,status] of refusedControlHeaders) {
    assert.equal((await call("/table/sessions/s/cancel","POST",headers).done).status,status);
  }
  const a=call("/table/sessions/hold-a/cancel"), b=call("/table/sessions/hold-b/cancel");
  await waitFor(()=>held.size===6);
  assert.equal((await call("/table/exports/e","DELETE").done).status,429);
  assert.equal((await call("/table/sessions/s/commands").done).status,429);
  finish("/sessions/hold-a/cancel");assert.equal((await a.done).status,200);
  const c=call("/table/sessions/hold-c/cancel");await waitFor(()=>held.has("/sessions/hold-c/cancel"));
  b.abort();await assert.rejects(b.done);await waitFor(()=>!held.has("/sessions/hold-b/cancel"));
  assert.equal((await call("/table/sessions/s","DELETE").done).status,200);
  finish("/sessions/hold-c/cancel");await c.done;
  for(let i=0;i<4;i++) finish(`/sessions/hold-${i}/commands`);
  assert.ok((await Promise.all(normal.map(p=>p.done))).every(r=>r.status===200));
  assert.equal((await call("/table/sessions/s/commands").done).status,200);
});
test("control errors and deadlines return both slots",async t=>{
  const {held,call}=await fixture(t,{tableTimeoutMs:100});
  const pending=[call("/table/sessions/hold-a/cancel"),call("/table/sessions/hold-b/cancel")];
  await waitFor(()=>held.size===2);
  assert.equal((await call("/table/exports/e","DELETE").done).status,429);
  assert.deepEqual((await Promise.all(pending.map(p=>p.done))).map(r=>r.status),[502,502]);
  await waitFor(()=>held.size===0);
  for(let i=0;i<3;i++)assert.equal((await call("/table/sessions/fail/cancel").done).status,502);
  for(let i=0;i<3;i++)assert.equal((await call("/table/sessions/s/cancel","POST",{},"{").done).status,400);
  const a=call("/table/sessions/hold-c/cancel"),b=call("/table/sessions/hold-d/cancel");
  await waitFor(()=>held.size===2);
  assert.deepEqual((await Promise.all([a.done,b.done])).map(r=>r.status),[502,502]);
});
