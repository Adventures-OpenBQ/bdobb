// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,cp,readdir,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
export const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
export function applyPinnedPatch(source,patch) {
 if(checksum(source)!==patch.sha256)throw Error('Profiling patch source checksum mismatch');
 for(const {from,to} of patch.edits){if(source.split(from).length!==2)throw Error('Profiling patch anchor is not unique');source=source.replace(from,to);}return source;
}
const here=dirname(fileURLToPath(import.meta.url));
async function sourceFingerprint(root) {
 const files=[];async function walk(dir){for(const e of await readdir(join(root,dir),{withFileTypes:true})){const name=join(dir,e.name);if(e.isDirectory()){if(!['target','generated'].includes(e.name))await walk(name);}else files.push(name);}}
 for(const dir of ['crates/pivot-core/src','crates/pivot-wire/src','crates/pivot-wasm/src','src/lib'])await walk(dir);
 for(const crate of ['pivot-core','pivot-wire','pivot-wasm'])files.push(`crates/${crate}/Cargo.toml`,`crates/${crate}/Cargo.lock`);
 files.push('package.json','pnpm-lock.yaml','scripts/pivot-toolchain.json');
 return checksum(Buffer.concat(await Promise.all(files.sort().map(async f=>Buffer.concat([Buffer.from(f+'\0'),await readFile(join(root,f))])))));
}
/** Isolated external directory only; default release sources and targets are never touched. */
export async function buildProfile({root=resolve(here,'../..'),outputDir,bindgen=process.env.PIVOT_WASM_BINDGEN, instrumented=true}) {
 root=resolve(root);outputDir=resolve(outputDir);if(outputDir===root||outputDir.startsWith(root+'/'))throw Error('Profiling output must be outside checkout');
 const originalSourceChecksum=await sourceFingerprint(root);
 await mkdir(outputDir,{recursive:false});
 const manifestBytes=await readFile(join(here,'profiling-patches/pinned.json'));const manifest=JSON.parse(manifestBytes);
 // Check all pinned files before copying or compiling anything.
 for(const [file,patch] of Object.entries(manifest.files))applyPinnedPatch(await readFile(join(root,file),'utf8'),patch);
 for(const dir of ['src','crates'])await cp(join(root,dir),join(outputDir,dir),{recursive:true,filter:p=>!/(\/target|\/generated)(\/|$)/.test(p)});
 await writeFile(join(outputDir,'package.json'),' {"type":"module"}\n');
 if(instrumented){
  for(const [file,patch] of Object.entries(manifest.files))await writeFile(join(outputDir,file),applyPinnedPatch(await readFile(join(root,file),'utf8'),patch));
  await cp(join(here,'profiling-patches/probe.rs'),join(outputDir,'crates/pivot-core/src/private_profile.rs'));
 }
 const {build}=await import('esbuild');
 const exports=`export {calculateView} from './src/lib/tableExecution/engine.ts'; export {createResultStore} from './src/lib/tableExecution/resultStore.ts'; export {captureBaseline,oracleCases} from './src/lib/tableExecution/rust/oracle.ts'; export {decodeWire,encodeWire} from './src/lib/tableExecution/rust/wireCodec.ts'; export {encodeRequest,decodeResponse,presentationShape} from './src/lib/tableExecution/rust/protocol.ts'; export {LocaleOrderBridge} from './src/lib/tableExecution/rust/orderingBridge.ts';`;
 const tsProbe=instrumented?`export {__pivot_profile_reset,__pivot_profile_read} from './private-probe.mjs';`:'';
 if(instrumented)await cp(join(here,'profiling-patches/probe.mjs'),join(outputDir,'private-probe.mjs'));
 await build({stdin:{contents:exports+tsProbe,resolveDir:outputDir},bundle:true,platform:'node',format:'esm',outfile:join(outputDir,'typescript.mjs'),nodePaths:[join(root,'node_modules')],logLevel:'silent'});
 const pins=JSON.parse(await readFile(join(root,'scripts/pivot-toolchain.json')));
 if(!bindgen)throw Error('Explicit pinned PIVOT_WASM_BINDGEN required');
 const run=(cmd,args)=>execFileSync(cmd,args,{cwd:outputDir,encoding:'utf8',env:{...process.env,RUSTFLAGS:'',CARGO_ENCODED_RUSTFLAGS:''},stdio:['ignore','pipe','pipe']});
 if(run(bindgen,['--version']).trim()!==`wasm-bindgen ${pins.wasmBindgen}`)throw Error('Pinned bindgen required');
 run('cargo',[`+${pins.rust}`,'build','--locked','--release','--target',pins.target,'--target-dir',join(outputDir,'target'),'--manifest-path','crates/pivot-wasm/Cargo.toml']);
 await mkdir(join(outputDir,'wasm'));run(bindgen,['--target','web','--out-dir',join(outputDir,'wasm'),'--out-name','pivot_wasm',join(outputDir,'target',pins.target,'release/pivot_wasm.wasm')]);
 const sourceChecksum=await sourceFingerprint(root);if(sourceChecksum!==originalSourceChecksum)throw Error('Sources changed during profiling build');
 const identity={format:1,sourceCommit:run('git',['-C',root,'rev-parse','HEAD']).trim(),sourceChecksum,patchChecksum:checksum(Buffer.concat([manifestBytes,await readFile(join(here,'profiling-patches/probe.rs')),await readFile(join(here,'profiling-patches/probe.mjs'))])),instrumented,typescriptChecksum:checksum(await readFile(join(outputDir,'typescript.mjs'))),artifactChecksum:checksum(await readFile(join(outputDir,'wasm/pivot_wasm.js'))),wasmChecksum:checksum(await readFile(join(outputDir,'wasm/pivot_wasm_bg.wasm'))),pins};
 await writeFile(join(outputDir,'identity.json'),JSON.stringify(identity,null,2)+'\n');return identity;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await buildProfile({outputDir:process.argv[2],instrumented:!process.argv.includes('--clean')}));

/** Verify old isolated P2 sources against today's source bytes before using them
 * under actual worker handlers. No trust in labels or sourceCommit alone. */
export async function verifyPerformanceArtifacts({root=resolve(here,'../..'),directory}) {
 root=resolve(root);directory=await realpath(resolve(directory));
 const identityBytes=await readFile(join(directory,'identity.json'));
 const identity=JSON.parse(identityBytes);
 assert.equal(identity.format,1,'Invalid build identity');
 assert.equal(typeof identity.instrumented,'boolean','Invalid instrumented identity');
 assert.equal(identity.sourceChecksum,await sourceFingerprint(root),'Private source identity mismatch');
 const manifestBytes=await readFile(join(here,'profiling-patches/pinned.json'));
 const patches=JSON.parse(manifestBytes).files;
 assert.equal(identity.patchChecksum,checksum(Buffer.concat([manifestBytes,await readFile(join(here,'profiling-patches/probe.rs')),await readFile(join(here,'profiling-patches/probe.mjs'))])),'Probe identity mismatch');
 assert.deepEqual(identity.pins,JSON.parse(await readFile(join(root,'scripts/pivot-toolchain.json'))),'Toolchain identity mismatch');
 async function sourceNames(base){const names=[];async function walk(dir){for(const e of await readdir(join(base,dir),{withFileTypes:true})){const name=join(dir,e.name);if(e.isDirectory()){if(e.name!=='generated')await walk(name);}else names.push(name);}}await walk('src');return names.sort();}
 const names=await sourceNames(root);assert.deepEqual(await sourceNames(directory),names,'Private source file set mismatch');
 // Exact source comparison binds every transitively importable source, including
 // support/wire modules. Patched copies must match the pinned transformation.
 for(const name of names){let expected=await readFile(join(root,name));if(identity.instrumented&&patches[name])expected=Buffer.from(applyPinnedPatch(expected.toString(),patches[name]));assert.equal(checksum(await readFile(join(directory,name))),checksum(expected),`Private source bytes changed: ${name}`);}
 const files={typescript:'typescript.mjs',module:'wasm/pivot_wasm.js',wasm:'wasm/pivot_wasm_bg.wasm'};
 for(const [key,name] of Object.entries(files))assert.equal(checksum(await readFile(join(directory,name))),identity[{typescript:'typescriptChecksum',module:'artifactChecksum',wasm:'wasmChecksum'}[key]],`Private ${key} artifact checksum mismatch`);
 const probePath=identity.instrumented?join(directory,'private-probe.mjs'):undefined;
 if(probePath)assert.equal(checksum(await readFile(probePath)),checksum(await readFile(join(here,'profiling-patches/probe.mjs'))),'Probe support bytes changed');
 return {identity,identityChecksum:checksum(identityBytes),directory,probePath,modulePath:join(directory,files.module),wasmPath:join(directory,files.wasm)};
}
