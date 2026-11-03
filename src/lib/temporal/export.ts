// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {toCsv} from '../export';
import type {DatasetProvenance,DatasetCompleteness} from '../widgetData/types';
export type TemporalExportMetadata={schemaVersion:1;provenance:DatasetProvenance;completeness:DatasetCompleteness;csv?:{recordKindColumn:string;provenanceColumn:string;completenessColumn:string;metadataColumn:string}};
export function temporalExportMetadata(provenance:DatasetProvenance,completeness:DatasetCompleteness):TemporalExportMetadata{return structuredClone({schemaVersion:1,provenance,completeness});}
export function temporalJson(rows:Record<string,unknown>[],metadata:TemporalExportMetadata):string {return JSON.stringify({...metadata,rows},null,2);}
/** Standard CSV with collision-safe reserved columns. Zero data rows carry one
 * explicitly marked metadata record, never a fabricated source observation. */
export function temporalCsv(rows:Record<string,unknown>[],columns:string[],metadata:TemporalExportMetadata):string {
 const used=new Set(columns);const reserve=(base:string)=>{let name=base;for(let i=2;used.has(name);i++)name=`${base}_${i}`;used.add(name);return name;};
 const recordKindColumn=reserve('__temporaldb_record_kind_v1'),provenanceColumn=reserve('__temporaldb_provenance_v1'),completenessColumn=reserve('__temporaldb_completeness_v1'),metadataColumn=reserve('__temporaldb_export_v1');
 const fields={recordKindColumn,provenanceColumn,completenessColumn,metadataColumn};
 const values=rows.length?rows:[Object.fromEntries(columns.map(k=>[k,null]))];
 return toCsv(values.map(row=>({...row,[recordKindColumn]:rows.length?'data':'metadata',[provenanceColumn]:JSON.stringify(metadata.provenance),[completenessColumn]:JSON.stringify(metadata.completeness),[metadataColumn]:JSON.stringify({schemaVersion:1,csv:fields,dataRowCount:rows.length})})),[...columns,...Object.values(fields)]);
}
