// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { ingestFile } from './index';
import { dataFromBytes, datasetFromBytes } from '../../src/lib/localTableData';
// @ts-expect-error -- untyped .mjs fixture, shared with crates/table-service/tests/ingest.rs
import { zipBomb } from './zipBomb.fixture.mjs';
const bytes = (s: string) => new TextEncoder().encode(s);

it.each([
  ['a.csv', 'Name,Amount,Amount\nA,12,3\nB,,4\n'],
  ['a.tsv', 'Name\tAmount\tAmount\nA\t12\t3\nB\t\t4\n'],
  ['a.json', '[{"Name":"A","Amount":12,"Amount_1":3},{"Name":"B","Amount_1":4}]'],
])('keeps duplicate headers and blank cells in %s with local parser parity', async (name, text) => {
  const result = await ingestFile(name, bytes(text), 'w', 3);
  expect(result).toEqual(await datasetFromBytes(name, bytes(text), 'w', 3));
  expect(result.rows.map(r => r.values)).toEqual([{Name:'A',Amount:12,Amount_1:3},{Name:'B',Amount:null,Amount_1:4}]);
  expect(result.completeness).toMatchObject({kind:'complete',totalRowCount:2});
});
it.each(['xls', 'xlsx'] as const)('preserves both Excel epochs, blank cells and formats in %s', async bookType => {
  for (const date1904 of [false, true]) {
    const sheet = XLSX.utils.aoa_to_sheet([['Date','Value','Value','Percent','Blank'],[1,12,3,0.125,null],[2,7,4,0.5,8]]);
    sheet.A2.z='yyyy-mm-dd';sheet.A3.z='yyyy-mm-dd';sheet.D2.z='0.00%';
    const book = XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'First');
    book.Workbook={WBProps:{date1904}};
    const data = new Uint8Array(XLSX.write(book,{type:'array',bookType}));
    const result = await ingestFile(`book.${bookType}`,data,'w',3);
    expect(result).toEqual(await datasetFromBytes(`book.${bookType}`,data,'w',3));
    expect(result.rows[0].values).toEqual({Date:date1904?'1904-01-02':'1900-01-01',Value:12,Value_1:3,Percent:0.125,Blank:null});
    expect(result.rows[0].cellFormats?.Percent).toEqual({formatterFn:'normalizedPercent',decimalPlaces:2});
    expect(result.rows[0].cellFormats?.Value).toBeUndefined();
  }
});
it('sanitizes malformed content and leaves caller bytes available for retry', async () => {
  const data=bytes('private secret');const before=data.slice();
  await expect(ingestFile('bad.json',data,'w',1)).rejects.toThrow(/^Could not ingest table source$/);
  expect(data).toEqual(before);
  expect((await ingestFile('good.json',bytes('[{"x":1}]'),'w',1)).rows[0].values).toEqual({x:1});
  await expect(ingestFile('bad.exe',data,'w',1)).rejects.toThrow(/^Could not ingest table source$/);
});
it.each([
  ['broken.xlsx',new Uint8Array([0x50,0x4b,0x03,0x04])],
  ['broken.xls',new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])],
] as const)('sanitizes a truncated %s workbook with local parser parity',async(name,data)=>{
  await expect(datasetFromBytes(name,data,'w',1)).rejects.toThrow();
  await expect(ingestFile(name,data,'w',1)).rejects.toThrow(/^Could not ingest table source$/);
});
it('refuses an xlsx whose entries inflate past the cap before SheetJS inflates them', async () => {
  const bomb = new Uint8Array(await zipBomb(300 * 1024 * 1024));
  expect(bomb.length).toBeLessThan(1024 * 1024);
  // The guard's own message, not SheetJS's, so the refusal came before SheetJS inflated anything.
  await expect(dataFromBytes('bomb.xlsx', bomb)).rejects.toThrow(/^Workbook expands past 256 MB$/);
  await expect(ingestFile('bomb.xlsx', bomb, 'w', 1)).rejects.toThrow(/^Could not ingest table source$/);
}, 60000);
