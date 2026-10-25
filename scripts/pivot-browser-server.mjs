// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Test-only composition of Vite assets and the real authenticated private server.
import { build, createServer as createViteServer } from 'vite';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { encode } from '@auth/core/jwt';
import { createPreviewServer } from '../web/server.mjs';
import { readConfig, SESSION_COOKIE } from '../web/config.mjs';

const root=resolve('e2e/fixtures'),out=resolve('dist/pivot-conformance');
function workerGraph() {
 return {name:'pivot-test:reachable-worker-graph',generateBundle(){
  const entry=[...this.getModuleIds()].find(id=>this.getModuleInfo(id)?.isEntry&&id.split('?')[0].endsWith('/rust.worker.ts'));
  if(!entry)return;const seen=new Set();
  const walk=id=>{if(seen.has(id))return;seen.add(id);const info=this.getModuleInfo(id);for(const child of [...(info?.importedIds??[]),...(info?.dynamicallyImportedIds??[])])walk(child);};walk(entry);
  this.emitFile({type:'asset',fileName:'rust-worker-graph.json',source:JSON.stringify({entry:relative(process.cwd(),entry),modules:[...seen].map(id=>relative(process.cwd(),id)).sort()})});
 }};
}
for(const [name,base] of [['root','/'],['nested','/nested/']]){
 await build({configFile:resolve('vite.config.ts'),root,base,worker:{format:'es',plugins:()=>[workerGraph()]},build:{outDir:resolve(out,name),emptyOutDir:true,sourcemap:true,rollupOptions:{input:resolve(root,'rust-pivot.html')}}});
 await cp(resolve(out,name,'rust-pivot.html'),resolve(out,name,'index.html'));
}
const tauri=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
const csp=Object.entries(tauri.app.security.csp).map(([key,value])=>`${key} ${value}`).join('; ');
const staticServer=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/health'){if(process.env.PIVOT_BENCHMARK_OWNER)res.setHeader('X-Pivot-Benchmark-Owner',process.env.PIVOT_BENCHMARK_OWNER);res.end('ready');return;}
 const prefix=pathname.startsWith('/nested/')?'/nested/':'/built/';
 const relative=pathname.slice(prefix.length),dir=prefix==='/nested/'?'nested':'root';
 if(!pathname.startsWith(prefix)||relative.includes('..')){res.writeHead(404).end();return;}
 try {const bytes=await readFile(resolve(out,dir,relative||'index.html'));res.writeHead(200,{'Content-Security-Policy':csp,'Content-Type':({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.map':'application/json'})[extname(relative||'index.html')]??'application/octet-stream'}).end(bytes);}
 catch {res.writeHead(404).end();}
});
// Root build asset URLs are /assets/...; serve them next to /built/index.html.
const listener=staticServer.listeners('request')[0];staticServer.removeAllListeners('request');
staticServer.on('request',(req,res)=>{if(req.url.startsWith('/assets/'))req.url='/built'+req.url;return listener(req,res);});
await new Promise(resolve=>staticServer.listen(4175,'127.0.0.1',resolve));
const dev=await createViteServer({configFile:resolve('vite.config.ts'),root,base:'/dev/',server:{port:4176,strictPort:true,host:'127.0.0.1',hmr:false,watch:null}});await dev.listen();
await mkdir(resolve(out,'tls'),{recursive:true});
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',resolve(out,'tls/key.pem'),'-out',resolve(out,'tls/cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
const config=readConfig({APP_ORIGIN:'https://localhost:4177',AUTH_SECRET:'synthetic-pivot-session-secret-only-for-tests',AUTH_GITHUB_ID:'synthetic-client',AUTH_GITHUB_SECRET:'synthetic-secret',SESSION_EPOCH:'pivot-test',GITHUB_ALLOWED_USER_IDS:'42'});
const privateApp=createPreviewServer({config,assets:resolve(out,'root')});
const privateServer=createHttpsServer({key:await readFile(resolve(out,'tls/key.pem')),cert:await readFile(resolve(out,'tls/cert.pem'))},(req,res)=>privateApp.emit('request',req,res));
await new Promise(resolve=>privateServer.listen(4177,'127.0.0.1',resolve));
const value=await encode({token:{githubId:'42',epoch:config.epoch,deadline:Date.now()/1000+3600},secret:config.secret,salt:SESSION_COOKIE,maxAge:3600});
await writeFile(resolve(out,'session.json'),JSON.stringify({name:SESSION_COOKIE,value,domain:'localhost',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}));
console.log('Pivot built/dev/private servers ready');
async function shutdown(){await dev.close();for(const server of [staticServer,privateServer]){server.closeAllConnections();server.close();}process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
