// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import * as XLSX from 'xlsx';
import {temporalCsv,temporalJson,temporalExportMetadata} from './export';
import {toXlsx} from '../export';
import {page} from './fixtures';
const provenance={sourceWidgetId:'source',receipt:{temporal:{executionId:page.receipt.execution_id,queryId:page.receipt.query_id,queryRevision:2,resultHash:page.receipt.result_hash}}};
const completeness={kind:'paged' as const,acquiredRowCount:1,totalRowCount:2000,totalRowCountKind:'exact' as const,warnings:['Loaded page only']};
const metadata=temporalExportMetadata(provenance,completeness);
it('writes lossless JSON receipt and paged completeness alongside actual rows',()=>{
 const value=JSON.parse(temporalJson([{id:'9223372036854775807',decimal:'1.00000000000000001',date:'2026-10-15'}],metadata));expect(value.rows[0]).toEqual({id:'9223372036854775807',decimal:'1.00000000000000001',date:'2026-10-15'});expect(value.provenance).toEqual(provenance);expect(value.completeness).toEqual(completeness);
});
it('writes standard CSV metadata columns without overwriting colliding source fields, including zero rows',()=>{
 const csv=temporalCsv([{Revenue:10,__temporaldb_provenance_v1:'real source'}],['Revenue','__temporaldb_provenance_v1'],metadata);
 const book=XLSX.read(csv,{type:'string'});const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]]);
 expect(rows[0].Revenue).toBe(10);expect(rows[0].__temporaldb_provenance_v1).toBe('real source');expect(JSON.parse(String(rows[0].__temporaldb_provenance_v1_2))).toEqual(provenance);expect(JSON.parse(String(rows[0].__temporaldb_completeness_v1))).toEqual(completeness);
 const empty=XLSX.read(temporalCsv([],['Revenue'],metadata),{type:'string'});const records=XLSX.utils.sheet_to_json<Record<string,unknown>>(empty.Sheets[empty.SheetNames[0]]);expect(records[0].__temporaldb_record_kind_v1).toBe('metadata');
});
it('writes an actual Excel metadata sheet while keeping exact strings and normal data sheet',async()=>{
 const bytes=await toXlsx([{id:'9223372036854775807'}],['id'],undefined,{},metadata);const book=XLSX.read(bytes,{type:'array'});expect(book.SheetNames).toEqual(['Data','TemporalDB']);const rows=XLSX.utils.sheet_to_json<Record<string,string>>(book.Sheets.TemporalDB);expect(JSON.parse(rows.find(r=>r.Field==='provenance')!.JSON)).toEqual(provenance);expect(XLSX.utils.sheet_to_json(book.Sheets.Data)[0]).toEqual({id:'9223372036854775807'});
});
