// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {insertOnce} from './instrument.mjs';
// Benchmark-only source transforms; no clocks or probe fields enter product code.
export function codecPlugin(){return {name:'codec-phase-probes',setup(build){
 build.onLoad({filter:/\/rust\/protocol\.ts$/},async({path})=>{
  let s=await readFile(path,'utf8');
  s=insertOnce(s,' assertUnicodeScalarGraph(raw);',` const p=(globalThis as any).__codecProbe; let tick=performance.now();\n assertUnicodeScalarGraph(raw);p.add('encode.unicode',performance.now()-tick);tick=performance.now();`);
  s=insertOnce(s,' const request=validateExecutionRequest(raw);',` const request=validateExecutionRequest(raw);p.add('encode.validate',performance.now()-tick);tick=performance.now();`);
  s=insertOnce(s,' return stringifyRequest({protocolVersion:PIVOT_PROTOCOL_VERSION,sessionId,request:command})!;',` p.add('encode.tagged',performance.now()-tick);tick=performance.now();\n const json=stringifyRequest({protocolVersion:PIVOT_PROTOCOL_VERSION,sessionId,request:command})!;p.add('encode.stringify',performance.now()-tick);return json;`);
  s=insertOnce(s,' const wire=JSON.parse(json) as',` const p=(globalThis as any).__codecProbe;let tick=performance.now();\n const wire=JSON.parse(json) as`);
  s=insertOnce(s," if(wire.protocolVersion!==PIVOT_PROTOCOL_VERSION",` p.add('decode.parse',performance.now()-tick);tick=performance.now();\n if(wire.protocolVersion!==PIVOT_PROTOCOL_VERSION`);
  s=insertOnce(s,' assertUnicodeScalarGraph(response);',` p.add('decode.tagged',performance.now()-tick);tick=performance.now();\n assertUnicodeScalarGraph(response);p.add('decode.unicode',performance.now()-tick);tick=performance.now();`);
  s=insertOnce(s,' const validated=validateExecutionResponse(response,request.revision,request.requestId);',` p.add('decode.normalize',performance.now()-tick);tick=performance.now();\n const validated=validateExecutionResponse(response,request.revision,request.requestId);p.add('decode.validate',performance.now()-tick);tick=performance.now();`);
  s=insertOnce(s,' return {...validated,revision:{widgetId,input,model,output,...extra}};',` const result={...validated,revision:{widgetId,input,model,output,...extra}};p.add('decode.publish',performance.now()-tick);return result;`);
  return {contents:s,loader:'ts'};
 });
 build.onLoad({filter:/\/tableExecution\/validation\.ts$/},async({path})=>{
  let s=await readFile(path,'utf8');
  s=insertOnce(s,'function clone<T>(v: T): T { try { return structuredClone(v); } catch { return fail("Payload is not structured-cloneable"); } }',`function clone<T>(v:T):T {const start=performance.now();try {return structuredClone(v);}catch{return fail("Payload is not structured-cloneable");}finally{(globalThis as any).__codecProbe.add('validation.clone',performance.now()-start);}}`);
  return {contents:s,loader:'ts'};
 });
}};}
