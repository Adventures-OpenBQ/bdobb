// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {prepareSources} from './instrument.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(new URL('../..',import.meta.url).pathname),out=resolve(process.argv[2]??'/tmp/openbq-applymodel-instrumented');
await prepareSources(root,out);
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:out,stdio:'inherit'});
run('cargo',['+1.98.1','test','--locked','--manifest-path','crates/pivot-core/Cargo.toml','timing_probe::tests']);
run('cargo',['+1.98.1','build','--locked','--release','--target','wasm32-unknown-unknown','--manifest-path','crates/pivot-wasm/Cargo.toml']);
await mkdir(join(out,'generated'),{recursive:true});
run(process.env.PIVOT_WASM_BINDGEN??'/tmp/openbq-profile-tools/bin/wasm-bindgen',['--target','web','--out-dir',join(out,'generated'),'--out-name','pivot_wasm',join(out,'crates/pivot-wasm/target/wasm32-unknown-unknown/release/pivot_wasm.wasm')]);
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
await writeFile(join(out,'build.json'),JSON.stringify({trackedDiffSha256:createHash('sha256').update(execFileSync('git',['diff','--binary'],{cwd:root})).digest('hex'),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),instrumentedWasmSha256:await hash(join(out,'generated/pivot_wasm_bg.wasm')),stockWasmSha256:await hash(join(root,'src/lib/tableExecution/rust/generated/pivot_wasm_bg.wasm')),builderSha256:await hash(new URL('./instrument.mjs',import.meta.url)),probeSha256:await hash(new URL('./timing_probe.rs',import.meta.url))},null,2));
console.log('Profiling artifact:',out);
