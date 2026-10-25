// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { frame, readFrame } from './protocol';
const root=fileURLToPath(new URL('../../',import.meta.url));
beforeAll(async()=>{await promisify(execFile)(process.execPath,['scripts/build-table-ingest.mjs'],{cwd:root,timeout:10000});});
async function invoke(input:Buffer) {
  const child=spawn(process.execPath,['--max-old-space-size=128',`${root}server/table-ingest/dist/child.mjs`,'--max-request-bytes','100000','--max-output-bytes','100000'],{env:{LANG:'C.UTF-8'}});
  const completed=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  child.stderr.resume();child.stdin.on('error',()=>{});child.stdin.end(input);
  const output=await readFrame(child.stdout,100000);return {output,status:await completed};
}
it.each(['xls','xlsx'] as const)('runs the built private child on %s files with both date epochs',async bookType=>{
  for(const date1904 of [false,true]) {
    const sheet=XLSX.utils.aoa_to_sheet([['Date','Ratio'],[1,0.125]]);sheet.A2.z='yyyy-mm-dd';sheet.B2.z='0.00%';
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Data');book.Workbook={WBProps:{date1904}};
    const result=await invoke(frame(JSON.stringify({operation:'file',name:`a.${bookType}`,bytes:Buffer.from(XLSX.write(book,{type:'array',bookType})).toString('base64'),widgetId:'w',inputRevision:3,limits:{maxBytes:100000,maxRows:100,maxColumns:10,timeoutMs:1000}}),100000));
    expect(result.status).toBe(0);const input=JSON.parse(result.output).request.input;
    expect(input.rows[0].values).toEqual({Date:{tag:'string',value:date1904?'1904-01-02':'1900-01-01'},Ratio:{tag:'f64',value:0.125}});
    expect(input.rows[0].cellFormats.Ratio).toEqual({formatterFn:'normalizedPercent',decimalPlaces:2});
  }
});
it('fails closed on malformed frames and refuses executable command strings',async()=>{
  for(const data of [Buffer.from([0,0,0,100,123]),Buffer.from([255,255,255,255]),frame(JSON.stringify({operation:'shell',command:'echo private secret'}),100000)]) {
    const result=await invoke(data);expect(result.status).toBe(1);expect(result.output).toBe('{"error":"ingestion_failed"}');
  }
});
it('rejects absent limit fields and a disallowed extra command field',async()=>{
  for(const command of [
    {operation:'file',name:'a.json',bytes:Buffer.from('[]').toString('base64'),widgetId:'w',inputRevision:1,limits:{}},
    {operation:'file',name:'a.json',bytes:Buffer.from('[]').toString('base64'),widgetId:'w',inputRevision:1,limits:{maxBytes:100,maxRows:10,maxColumns:10,timeoutMs:1000},url:'http://unconfigured.invalid'},
  ]) {const result=await invoke(frame(JSON.stringify(command),100000));expect(result.status).toBe(1);expect(result.output).toBe('{"error":"ingestion_failed"}');}
});

it('builds a runnable artifact when the checkout path contains spaces',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'table ingest '));
  try {
    await mkdir(join(dir,'scripts'),{recursive:true});await mkdir(join(dir,'server/table-ingest'),{recursive:true});
    await writeFile(join(dir,'scripts/build-table-ingest.mjs'),await readFile(join(root,'scripts/build-table-ingest.mjs')));
    await symlink(join(root,'node_modules'),join(dir,'node_modules'),'dir');
    await writeFile(join(dir,'server/table-ingest/child.ts'),"process.stdout.write('space path works');");
    await promisify(execFile)(process.execPath,[join(dir,'scripts/build-table-ingest.mjs')],{timeout:10000});
    const result=await promisify(execFile)(process.execPath,[join(dir,'server/table-ingest/dist/child.mjs')],{timeout:10000});
    expect(result.stdout).toBe('space path works');
  } finally {await rm(dir,{recursive:true,force:true});}
});
