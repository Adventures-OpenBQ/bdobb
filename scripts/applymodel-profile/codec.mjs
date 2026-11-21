// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {build} from 'esbuild';
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir,cpus} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {codecPlugin} from './codec-plugin.mjs';
import {workloads} from '../matched-executors-workloads.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname),output=resolve(process.argv[2]??'/tmp/openbq-codec-phases.json');
const dir=await mkdtemp(join(tmpdir(),'codec-phases-'));
const probe={values:{},add(name,ms){const value=this.values[name]??={ms:0,calls:0};value.ms+=ms;value.calls++;},reset(){this.values={};},take(){return structuredClone(this.values);}};
globalThis.__codecProbe=probe;
try{
 const contents=`export {encodeRequest,decodeResponse,presentationShape} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/protocol.ts'))};export {decodeWire} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))};export {LocaleOrderBridge} from ${JSON.stringify(join(root,'src/lib/tableExecution/rust/orderingBridge.ts'))};`;
 for(const profile of [false,true])await build({stdin:{contents,resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:join(dir,profile?'profile.mjs':'control.mjs'),plugins:profile?[codecPlugin()]:(process.env.CODEC_CONTROL_PROTOCOL||process.env.CODEC_CONTROL_WIRE)?[{name:'original-codec',setup(b){b.onLoad({filter:/\/rust\/(protocol|wireCodec)\.ts$/},async({path})=>{const original=path.endsWith('/wireCodec.ts')?process.env.CODEC_CONTROL_WIRE:process.env.CODEC_CONTROL_PROTOCOL;return original?{contents:await readFile(original,'utf8'),loader:'ts',resolveDir:dirname(path)}:undefined;});}}]:[],logLevel:'silent'});
 const tools=await import(pathToFileURL(join(dir,'profile.mjs')).href),control=await import(pathToFileURL(join(dir,'control.mjs')).href);
 const wasmDir=resolve(process.env.CODEC_PROFILE_WASM??process.env.CODEC_WASM??join(root,'src/lib/tableExecution/rust/generated'));
 const module=await import(pathToFileURL(join(wasmDir,'pivot_wasm.js')).href);
 const traced=Boolean(process.env.CODEC_PROFILE_WASM);
 if(traced)assert.equal(typeof module.profile_start,'function');
 const bytes=await readFile(join(wasmDir,'pivot_wasm_bg.wasm'));await module.default({module_or_path:bytes});
 const cases=await workloads(tools),report={schemaVersion:1,instrumentedRust:traced,measuredAt:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),wasmSha256:createHash('sha256').update(bytes).digest('hex'),node:process.version,cpu:cpus()[0]?.model,controlProtocolSha256:process.env.CODEC_CONTROL_PROTOCOL?createHash('sha256').update(await readFile(process.env.CODEC_CONTROL_PROTOCOL)).digest('hex'):null,controlWireSha256:process.env.CODEC_CONTROL_WIRE?createHash('sha256').update(await readFile(process.env.CODEC_CONTROL_WIRE)).digest('hex'):null,wireSha256:createHash('sha256').update(await readFile(join(root,'src/lib/tableExecution/rust/wireCodec.ts'))).digest('hex'),protocolSha256:createHash('sha256').update(await readFile(join(root,'src/lib/tableExecution/rust/protocol.ts'))).digest('hex'),samples:10,warmups:3,method:'Sequential Node emitted-WASM diagnostics, fresh session per trial, one warmed module. Probes use benchmark-only source transforms. validate includes structuredClone; validation.clone is its nested subset. Tagged phases include strict graph validation and conversion. Preflight compares exact encoded bytes and deep decoded responses with uninstrumented control; timing trials omit control work. No worker transport, UI, native HTTP or browser timing. Medians are diagnostic, not a browser speedup claim.',cases:[]};
 for(const name of ['largeRaw','representative','formula']){
  const c=cases[name],observations=[];
  for(let trial=-4;trial<10;trial++){
   const bridge=new tools.LocaleOrderBridge('en-US');
   const host={nativeFiniteNumbers:true,wire:JSON.stringify({protocolVersion:1,locale:'en-US'}),order(json){const q=JSON.parse(json);let v;switch(q.kind){case'raw':{const x=bridge.compareRaw(q.a,q.b);v=Number.isNaN(x)?'unordered':Math.sign(x)||0;break;}case'scalar':v=bridge.compare(q.a,q.b);break;case'recipe':v=bridge.compareRecipe(q.a,q.b);break;case'sort':v=bridge.sortPermutation(q.values,q.descending);break;default:throw Error('Unknown host command');}return JSON.stringify({ok:v});}};
   const handle=module.open_session(host),revision={widgetId:'source',input:c.dataset.resultRevision,model:1,output:1};let id=0,shape='raw',streamId;
   const commands=[];
   const call=command=>{
    const requestId=command.kind==='nextSubset'?streamId:`q${++id}`;if(command.kind==='presented')streamId=requestId;
    const request={...command,revision,requestId};
    probe.reset();let start=performance.now();const encoded=tools.encodeRequest(request,'en-US',handle);const encodeMs=performance.now()-start,encoding=probe.take();
    if(trial===-4)assert.equal(encoded,control.encodeRequest(request,'en-US',handle));
    if(traced)module.profile_start();
    start=performance.now();const text=module.dispatch(handle,encoded);const dispatchMs=performance.now()-start;
    const rustSpans=traced?JSON.parse(module.profile_take()):undefined;
    probe.reset();start=performance.now();const response=tools.decodeResponse(text,request,handle,shape);const decodeMs=performance.now()-start,decoding=probe.take();
    assert.notEqual(response?.kind,'error',JSON.stringify(response));
    if(trial===-4)assert.deepEqual(response,control.decodeResponse(text,request,handle,shape));
    if(request.kind==='applyModel')shape=tools.presentationShape(request.definition);
    if(trial>=0)commands.push({kind:request.kind,encodeMs,dispatchMs,decodeMs,inputBytes:Buffer.byteLength(encoded),responseBytes:Buffer.byteLength(text),encoding,decoding,...(traced?{rustSpans}:{})});
    return response;
   };
   try{
    call({kind:'registerInput',input:c.dataset,inputRevision:revision.input});
    call({kind:'applyModel',definition:c.definition,selection:{kind:'none'},reconcileMissing:false,runtimeParams:c.runtimeParams});
    let sequence=0;for(;;){const response=call(sequence===0?{kind:'presented',transferId:'export',ignoreSelection:true}:{kind:'nextSubset',transferId:'export',sequence});if(response.final)break;sequence++;}
    if(trial>=0)observations.push({trial,commands});
   }finally{module.close_session(handle);}
  }
  report.cases.push({name,inputRows:c.dataset.rows.length,preflight:'exact encode/decode parity with uninstrumented control passed',observations});
  console.error(name+': 10 phase observations complete');
 }
 await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{delete globalThis.__codecProbe;await rm(dir,{recursive:true,force:true});}
