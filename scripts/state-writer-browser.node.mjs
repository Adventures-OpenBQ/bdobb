// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/* global window, location, document */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium, webkit} from '@playwright/test';
import {stateWriteVersion, STATE_WRITER, STATE_SEQUENCE} from '../src/lib/stateWriteProtocol.mjs';

// Real documents and HTTP; the small commit boundary models the gateway's
// validated per-writer fence. Gateway SQLite/Postgres atomicity has its own tests.
const bundle = await build({entryPoints:[fileURLToPath(new URL('../src/browser-shim/fs.ts',import.meta.url))],bundle:true,format:'iife',globalName:'fs',platform:'browser',write:false});
const source = bundle.outputFiles[0].text;
async function until(condition) {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the state request');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function fixture(run, {unsupported = false, denied = false, holdOld = false} = {}) {
  const versions = new Map(), writes = [];
  let stored = '{}', release;
  const held = new Promise(resolve => {release = resolve;});
  const server = createServer(async (req,res) => {
    if (req.url.startsWith('/state/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const version = stateWriteVersion(req.headers[STATE_WRITER], req.headers[STATE_SEQUENCE]);
      const record = {body, ...version}; writes.push(record);
      if (holdOld && JSON.parse(body).edit === 'old') await held;
      const key = `${req.url}:${version?.writer}`, accepted = version && version.sequence > (versions.get(key) ?? 0);
      if (accepted) {versions.set(key,version.sequence); stored = body;}
      record.status = accepted ? 204 : 409;
      res.writeHead(record.status); res.end(); return;
    }
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><p class="web-preview-notice">Saved</p><script>window.__bdobbPersist=true;window.__bdobbSeed={"settings.json":'+JSON.stringify(stored)+'}</script><script>'+source+'</script>');
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const engine = process.env.STATE_WRITER_BROWSER === "webkit" ? webkit : chromium;
  const browser = await engine.launch({headless:true});
  try {
    const context = await browser.newContext();
    if (unsupported || denied) await context.addInitScript(({unsupported}) => {
      Object.defineProperty(navigator, 'locks', {value:unsupported ? undefined : {request:()=>Promise.reject(new DOMException('Storage unavailable','SecurityError'))}});
      sessionStorage.setItem('bdobb-unsaved', JSON.stringify({at:Date.now(),files:{'settings.json':'{"edit":"recover"}'}}));
    }, {unsupported});
    const page = await context.newPage(), url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await run({page,url,writes,stored:()=>stored,release});
  } finally {
    release(); await browser.close(); await new Promise(resolve => server.close(resolve));
  }
}
const write = (page,edit) => page.evaluate(async edit => {
  await window.fs.writeTextFile('settings.json',JSON.stringify({edit}));
  window.dispatchEvent(new Event('pagehide'));
},edit);

test('a same-origin cloned sessionStorage tab owns a distinct live writer', async () => {
  await fixture(async ({page,writes,stored}) => {
    await write(page,'initial'); await until(()=>stored().includes('initial'));
    await page.waitForFunction(()=>sessionStorage.getItem('bdobb-unsaved') === null);
    const popup = page.waitForEvent('popup');
    await page.evaluate(()=>window.open(location.href,'writer-clone'));
    const child = await popup; await child.waitForLoadState();
    await write(page,'parent-newer'); await until(()=>stored().includes('parent-newer'));
    await write(child,'child-newest'); await until(()=>writes.length === 3 && writes[2].status !== undefined);
    assert.notEqual(writes[2].writer,writes[1].writer);
    assert.equal(writes[2].status,204); assert.equal(stored(),'{"edit":"child-newest"}');
  });
});

test('a true reload keeps its writer and fences an older held HTTP completion', async () => {
  await fixture(async ({page,writes,stored,release}) => {
    await write(page,'old'); await until(()=>writes.length > 0);
    const previous = writes[0];
    await page.reload();
    await write(page,'new'); await until(()=>stored().includes('new'));
    const latest = writes.findLast(w=>JSON.parse(w.body).edit === 'new');
    assert.equal(latest.writer,previous.writer); assert.ok(latest.sequence > previous.sequence);
    release(); await until(()=>writes.every(w=>w.status !== undefined));
    assert.equal(previous.status,409); assert.equal(stored(),'{"edit":"new"}');
  },{holdOld:true});
});

for (const mode of ['unsupported','denied']) test(`account persistence fails safely when lock ownership is ${mode}`, async () => {
  await fixture(async ({page,writes,stored}) => {
    const message = await page.evaluate(async () => {
      try {await window.fs.writeTextFile('settings.json','{"edit":"unsafe"}'); return '';}
      catch (error) {return error.message;}
    });
    assert.match(message,/Web Locks|writer ownership/i);
    assert.equal(writes.length,0); assert.equal(stored(),'{}');
    assert.match(await page.locator('.web-preview-notice').textContent(),/could NOT be saved/);
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('bdobb-unsaved')).files['settings.json']),'{"edit":"recover"}');
    // Non-account files stay usable even where account state cannot be fenced.
    await page.evaluate(()=>window.fs.writeTextFile('imports/example.json','{}'));
  },{[mode]:true});
});
