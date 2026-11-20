// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {join} from 'node:path';
export function insertOnce(source,anchor,replacement){
 if(source.split(anchor).length!==2)throw Error(`Expected unique source anchor: ${anchor.slice(0,100)}`);
 return source.replace(anchor,replacement);
}
export function summarizeSpans(spans){
 const result={};for(const s of spans){const a=result[s.name]??={inclusiveMs:0,exclusiveMs:0,calls:0};for(const k of ['inclusiveMs','exclusiveMs','calls'])a[k]+=s[k];}return result;
}
// Exact function names; reject missing or overloaded anchors before adding probes.
export function spanFunction(source,name,label,prefix='crate'){
 const matches=[...source.matchAll(new RegExp(`\\bfn ${name}(?:<[^\\n]*>)?\\(`,'g'))];
 if(matches.length!==1)throw Error(`Expected unique function anchor: ${name}`);
 const at=source.indexOf('{',matches[0].index);
 if(at<0)throw Error(`Missing function body: ${name}`);
 return source.slice(0,at+1)+`\n    let _profile_span = ${prefix}::timing_probe::span("${label}");`+source.slice(at+1);
}
export async function prepareSources(root,dest){
 await mkdir(join(dest,'crates'),{recursive:true});
 for(const crate of ['pivot-core','pivot-wire','pivot-wasm']){
  for(const file of ['Cargo.toml','Cargo.lock','src',...(crate==='pivot-core'?['tests']:[])])await cp(join(root,'crates',crate,file),join(dest,'crates',crate,file),{recursive:true});
 }
 const edit=async(path,fn)=>{const p=join(dest,path);await writeFile(p,fn(await readFile(p,'utf8')));};
 await cp(new URL('./timing_probe.rs',import.meta.url),join(dest,'crates/pivot-core/src/timing_probe.rs'));
 await edit('crates/pivot-core/src/lib.rs',s=>s+'\npub mod timing_probe;\n');
 for(const [file,name,label] of [
  ['session/legacy.rs','prepare','legacy.prepare'],['session/legacy.rs','identity_universe','identity.universe'],['session/legacy.rs','build','result.build'],
  ['session.rs','register','input.register'],['session.rs','check_registration','input.admission'],
  ['session/validation.rs','request','input.request_validation'],['session/validation.rs','dataset','input.dataset_validation'],
  ['session/prepare.rs','prepare','prepare'],['session/operations.rs','execute','execute'],
  ['session/transfer.rs','next','export.next'],['session.rs','project','rows.project'],
  ['session/resources.rs','retained_bytes','budget.retained_bytes'],['session/resources.rs','wire_size','budget.wire_size'],['session.rs','dispatch','core.dispatch'],['scopes.rs','qualify_source','filter.search'],
  ['pivot.rs','pivot','pivot'],['pivot.rs','partition','group.partition'],
  ['pivot.rs','aggregate_indices','aggregate'],['pivot.rs','values','group.values'],
  ['formulas/mod.rs','compile_with_fiscal','formula.compile'],['formulas/source.rs','evaluate_source','formula.source'],
  ['scopes.rs','eligible_pool','formula.eligible_pool'],['scopes.rs','scope_errors','formula.scope_errors'],
  ['formulas/aggregate/metadata.rs','scope_key','aggregate.scope_key'],['formulas/aggregate/metadata.rs','merge','aggregate.metadata_merge'],
  ['formulas/aggregate.rs','measure','aggregate.measure'],
  ['formulas/aggregate/input.rs','input','aggregate.input'],
  ['formulas/aggregate.rs','evaluate_aggregate','formula.aggregate'],['analytical/totals.rs','calculate','formula.scope_totals'],
  ['analytical/qualification.rs','qualify_groups','formula.qualify_groups'],
  ['analytical/projection.rs','project','formula.project'],['analytical.rs','scope_rows','formula.scope_rows'],
  ['analytical/totals.rs','scope_for','formula.scope_for'],['analytical/hierarchy.rs','visit','formula.hierarchy'],
  ['analytical/projection_columns.rs','finish_columns','formula.finish_columns'],
  ['ordering.rs','sort_by_keys','sort'],['analytical.rs','calculate_view','analytical.calculate']
 ])await edit('crates/pivot-core/src/'+file,s=>spanFunction(s,name,label));
 await edit('crates/pivot-wire/src/lib.rs',s=>{
  s=spanFunction(s,'decode_request','wire.decode_request','pivot_core');
  s=spanFunction(s,'into_core_request','wire.request_to_core','pivot_core');
  s=insertOnce(s,'        let fields: Fields<\'_> =\n            serde_json::from_str(self.request.get()).map_err(|_| "Invalid request object")?;', '        let fields: Fields<\'_> = { let _profile_fields = pivot_core::timing_probe::span("wire.request_fields");\n            serde_json::from_str(self.request.get()).map_err(|_| "Invalid request object")? };');
  s=spanFunction(s,'get','wire.typed_field','pivot_core');
  s=insertOnce(s,'    let _profile_span = pivot_core::timing_probe::span("wire.typed_field");', '    let _profile_span = (key == "input").then(||pivot_core::timing_probe::span("wire.input_decode"));');
  s=spanFunction(s,'encode_response','wire.serialize','pivot_core');
  s=insertOnce(s,'let (kind, payload) = match response.result {','let (kind, payload) = { let _profile_payload = pivot_core::timing_probe::span("wire.payload_tree"); match response.result {');
  s=insertOnce(s,'    };\n    let mut envelope = json!', '    }};\n    let mut envelope = json!');
  return insertOnce(s,'    serde_json::to_string(&Envelope {', '    let _profile_encode = pivot_core::timing_probe::span("wire.envelope_encode");\n    serde_json::to_string(&Envelope {');
 });
 await edit('crates/pivot-wire/src/subset.rs',s=>spanFunction(s,'encode','wire.subset_direct','pivot_core'));
 await edit('crates/pivot-wasm/src/lib.rs',s=>{
  s=spanFunction(s,'dispatch','wasm.dispatch','pivot_core');
  s=insertOnce(s,'    let request: pivot_wire::Request =\n        serde_json::from_str(request).map_err(|e| JsValue::from_str(&e.to_string()))?;', '    let request: pivot_wire::Request = { let _profile_envelope = pivot_core::timing_probe::span("wire.request_envelope");\n        serde_json::from_str(request).map_err(|e| JsValue::from_str(&e.to_string()))? };');
  // All Rust→JS host ordering round trips, including Rust JSON construction/parsing.
  s=spanFunction(s,'call','host.order','pivot_core');
  return s+`\n#[wasm_bindgen]\nextern "C" { #[wasm_bindgen(js_namespace = performance, js_name = now)] fn profile_clock() -> f64; }\n#[wasm_bindgen]\npub fn profile_start() { pivot_core::timing_probe::start(profile_clock); }\n#[wasm_bindgen]\npub fn profile_take() -> String { pivot_core::timing_probe::take() }\n`;
 });
}
