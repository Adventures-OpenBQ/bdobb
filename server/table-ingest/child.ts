// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { readFile, stat } from 'node:fs/promises';
import { frame, readFrame } from './protocol';
import { admitDataset, ingestFile } from './index';
import { acquireBackend, type BackendBinding, type ServerBackendConfig } from './backend';
import { encodeRequest } from '../../src/lib/tableExecution/rust/protocol';

type Command={widgetId:string;inputRevision:number;limits:{maxBytes:number;maxRows:number;maxColumns:number;timeoutMs:number}} &
 ({operation:'file';name:string;bytes:string}|{operation:'backend';binding:BackendBinding});
const option=(key:string)=>{const index=process.argv.indexOf(key);return index<0?undefined:process.argv[index+1];};
const bound=(name:string)=>{const n=Number(option(name));if(!Number.isSafeInteger(n)||n<1||n>0xffffffff)throw new Error();return n;};
async function main() {
  let maxOutput=4096;
  try {
    const maxInput=bound('--max-request-bytes');maxOutput=bound('--max-output-bytes');
    const command=JSON.parse(await readFrame(process.stdin,maxInput)) as Command;
    const operationFields=command.operation==='file'?['name','bytes']:command.operation==='backend'?['binding']:undefined;
    if(!operationFields)throw new Error();
    const fields=['operation','widgetId','inputRevision','limits',...operationFields];
    if(Object.keys(command).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(command,key)))throw new Error();
    const limitFields=['maxBytes','maxRows','maxColumns','timeoutMs'] as const;
    if(!command.limits||Object.keys(command.limits).length!==limitFields.length)throw new Error();
    for(const key of limitFields)if(!Number.isSafeInteger(command.limits[key])||command.limits[key]<1)throw new Error();
    if(typeof command.widgetId!=='string'||command.widgetId.length<1||command.widgetId.length>128||!Number.isSafeInteger(command.inputRevision)||command.inputRevision<0)throw new Error();
    let dataset;
    if(command.operation==='file') {
      if(typeof command.bytes!=='string'||command.bytes.length>Math.ceil(command.limits.maxBytes/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(command.bytes))throw new Error();
      const bytes=Buffer.from(command.bytes,'base64');if(bytes.length>command.limits.maxBytes)throw new Error();
      dataset=await ingestFile(command.name,bytes,command.widgetId,command.inputRevision);
    } else if(command.operation==='backend') {
      const path=option('--backend-config');if(!path||(await stat(path)).size>1024*1024)throw new Error();
      const config=JSON.parse(await readFile(path,'utf8')) as ServerBackendConfig;
      dataset=await acquireBackend(command.binding,{...config,maxBytes:Math.min(config.maxBytes,command.limits.maxBytes),maxRows:Math.min(config.maxRows,command.limits.maxRows),maxColumns:Math.min(config.maxColumns,command.limits.maxColumns),timeoutMs:Math.min(config.timeoutMs,command.limits.timeoutMs),targetWidgetId:command.widgetId,inputRevision:command.inputRevision});
    } else throw new Error();
    admitDataset(dataset,command.limits.maxRows,command.limits.maxColumns);
    const json=encodeRequest({kind:'registerInput',requestId:'ingest',revision:{widgetId:command.widgetId,input:command.inputRevision,model:0,output:0},inputRevision:command.inputRevision,input:dataset},'en-US',0);
    process.stdout.write(frame(json,maxOutput));
  } catch {
    // No parser exceptions, upstream bodies, URLs, filesystem paths or credentials cross IPC.
    try {process.stdout.write(frame('{"error":"ingestion_failed"}',Math.max(maxOutput,32)));} catch { /* parent observes empty/failed child */ }
    process.exitCode=1;
  }
}
void main();
