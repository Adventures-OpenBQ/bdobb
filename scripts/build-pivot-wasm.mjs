// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = 'src/lib/tableExecution/rust/generated';
const artifacts = ['pivot_wasm.js', 'pivot_wasm.d.ts', 'pivot_wasm_bg.wasm', 'pivot_wasm_bg.wasm.d.ts'];
const builds = new Map();
async function digestFiles(root, names) {
 const hash = createHash('sha256');
 for (const name of [...names].sort()) { const bytes = await readFile(join(root,name));hash.update(name);hash.update('\0');hash.update(String(bytes.length));hash.update('\0');hash.update(bytes); }
 return hash.digest('hex');
}
async function sourceNames(root) {
 const files = ['scripts/pivot-toolchain.json','scripts/build-pivot-wasm.mjs','scripts/pivot-wasm-smoke.mjs'];
 async function walk(name) {
  for (const entry of await readdir(join(root,name),{withFileTypes:true})) {
   const child=`${name}/${entry.name}`;if(entry.isDirectory())await walk(child);else files.push(child);
  }
 }
 for(const crate of ['pivot-core','pivot-wire','pivot-wasm']){
  files.push(`crates/${crate}/Cargo.toml`,`crates/${crate}/Cargo.lock`);await walk(`crates/${crate}/src`);
 }
 for(const name of ['.cargo/config','.cargo/config.toml','crates/pivot-core/build.rs','crates/pivot-wire/build.rs','crates/pivot-wasm/build.rs']){
  try {await readFile(join(root,name));files.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return files;
}
async function fingerprints(root) {
 return {sources:await digestFiles(root,await sourceNames(root)),artifacts:await digestFiles(root,artifacts.map(name=>`${generated}/${name}`))};
}
async function verify(root) {
 try {
  const stamp=JSON.parse(await readFile(join(root,generated,'build-stamp.json'),'utf8'));
  const actual=await fingerprints(root);
  if(stamp.format!==1||stamp.sources!==actual.sources||stamp.artifacts!==actual.artifacts)throw new Error('Pivot Wasm artifact is stale; run pnpm pivot:build');
 }catch(error){
  if(error.code==='ENOENT')throw new Error('Pivot Wasm artifact is missing; run pnpm pivot:build',{cause:error});
  throw error;
 }
}
async function build(root) {
 const expectedSources=await digestFiles(root,await sourceNames(root));
 const pins=JSON.parse(await readFile(join(root,'scripts/pivot-toolchain.json'),'utf8'));
 const toolchain=`+${pins.rust}`;
 const env={...process.env,RUSTFLAGS:'',CARGO_ENCODED_RUSTFLAGS:''};
 // The emitted-module smoke owns its own Node test runner, even when invoked from one.
 delete env.NODE_TEST_CONTEXT;
 const run=async(command,args)=>{const result=await exec(command,args,{cwd:root,env,maxBuffer:16*1024*1024});if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);return result.stdout.trim();};
 if(!(await run('rustc',[toolchain,'--version'])).startsWith(`rustc ${pins.rust} `))throw new Error('Pivot Rust toolchain does not match pinned metadata');
 const bindgen=process.env.PIVOT_WASM_BINDGEN||join(root,'.pivot-tools/bin/wasm-bindgen');
 try {if(await run(bindgen,['--version'])!==`wasm-bindgen ${pins.wasmBindgen}`)throw new Error('version mismatch');}
 catch(error){throw new Error(`Pivot requires wasm-bindgen ${pins.wasmBindgen}. Install with: cargo ${toolchain} install wasm-bindgen-cli --version ${pins.wasmBindgen} --locked --root .pivot-tools. PIVOT_WASM_BINDGEN can select an existing binary.`,{cause:error});}
 const output=join(root,generated),targetDir=join(root,'crates/pivot-wasm/target');await mkdir(output,{recursive:true});
 await run('cargo',[toolchain,'build','--locked','--release','--target',pins.target,'--target-dir',targetDir,'--manifest-path','crates/pivot-wasm/Cargo.toml']);
 await run(bindgen,['--target',pins.wasmBindgenTarget,'--out-dir',output,'--out-name','pivot_wasm',join(targetDir,pins.target,'release/pivot_wasm.wasm')]);
 await run(process.execPath,['--test','scripts/pivot-wasm-smoke.mjs']);
 const built=await fingerprints(root);
 if(built.sources!==expectedSources)throw new Error('Pivot Wasm artifact is stale: sources changed during the build; rebuild it');
 await writeFile(join(output,'build-stamp.json'),JSON.stringify({format:1,...built},null,2)+'\n');
 await verify(root);
}
/** Every Vite entry point builds a missing/stale artifact, or explicitly refuses in verification-only environments. */
export async function ensurePivotWasm({root=defaultRoot,verifyOnly=process.env.PIVOT_WASM_VERIFY_ONLY==='1',force=false}={}) {
 root=resolve(root);
 if(verifyOnly){await verify(root);return;}
 if(builds.has(root)){await builds.get(root);await verify(root);return;}
 const pending=(async()=>{
  if(!force){try{await verify(root);return;}catch(error){if(!/artifact is (missing|stale)/.test(error.message))throw error;}}
  await build(root);
 })();
 // Reserve the whole verification/build decision before another caller can enter.
 builds.set(root,pending);try{await pending;}finally{if(builds.get(root)===pending)builds.delete(root);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await ensurePivotWasm({verifyOnly:process.argv.includes('--verify'),force:!process.argv.includes('--verify')});
