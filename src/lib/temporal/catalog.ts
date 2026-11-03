// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {finiteJson,isRecord,parseContract,TemporalValidationError,type QueryDefinition,type ResultColumn} from './contracts';
/** TemporalDB's cache discovery answers (temporaldb/datasets/discovery.py), checked at the boundary. */
export type Tier='bronze'|'silver'|'gold';
export const TIERS:readonly Tier[]=['bronze','silver','gold'];
export type TierCapabilities={queryable:boolean;temporal_modes:string[]};
export type CatalogDataset={dataset_id:string;source:string;available_tiers:Tier[];accepted_cached:boolean;capabilities:Record<string,unknown>;query_capabilities:Record<Tier,TierCapabilities>};
export type DatasetPage={datasets:CatalogDataset[];next_cursor:string|null};
export type DatasetDescription={dataset_id:string;tier:Tier;query_capabilities:TierCapabilities;capabilities:Record<string,unknown>;parameters:Record<string,unknown>;declared_schema:unknown;declared_schema_basis:string;observed_schema:ResultColumn[]|null;observed_schema_basis:Record<string,unknown>;schema_complete:boolean;temporal_axes:string[]};
export type Coverage={dataset_id:string;tier:Tier;identities:Record<string,unknown>[];identity_detail:{status:string;basis:string};completeness:{status:string;evidence:unknown};clock_basis:Record<string,string|null>;next_cursor:string|null};
export type Validation={valid:true;definition:QueryDefinition};
function need(ok:unknown,what:string):asserts ok {if(!ok)throw new TemporalValidationError(`Invalid TemporalDB ${what}`);}
const isTier=(v:unknown):v is Tier=>TIERS.includes(v as Tier);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string');
const tierCaps=(v:unknown)=>isRecord(v)&&typeof v.queryable==='boolean'&&strings(v.temporal_modes);
const cursor=(v:unknown)=>v===null||typeof v==='string';
const column=(c:unknown)=>isRecord(c)&&typeof c.name==='string'&&typeof c.type==='string'&&typeof c.nullable==='boolean';
export function parseDatasetPage(v:unknown):DatasetPage{
 need(isRecord(v)&&finiteJson(v)&&Array.isArray(v.datasets)&&cursor(v.next_cursor),'dataset page');
 for(const d of v.datasets as unknown[]){
  const caps=isRecord(d)?d.query_capabilities:undefined;
  need(isRecord(d)&&typeof d.dataset_id==='string'&&typeof d.source==='string'&&Array.isArray(d.available_tiers)&&d.available_tiers.every(isTier)&&typeof d.accepted_cached==='boolean'&&isRecord(d.capabilities)&&isRecord(caps)&&TIERS.every(t=>tierCaps(caps[t])),'catalog dataset');
 }
 return v as DatasetPage;
}
export function parseDescription(v:unknown):DatasetDescription{
 need(isRecord(v)&&finiteJson(v)&&typeof v.dataset_id==='string'&&isTier(v.tier)&&tierCaps(v.query_capabilities)&&isRecord(v.capabilities)&&isRecord(v.parameters)&&typeof v.declared_schema_basis==='string'&&(v.observed_schema===null||Array.isArray(v.observed_schema)&&v.observed_schema.every(column))&&isRecord(v.observed_schema_basis)&&typeof v.schema_complete==='boolean'&&strings(v.temporal_axes),'dataset description');
 return v as DatasetDescription;
}
export function parseCoverage(v:unknown):Coverage{
 need(isRecord(v)&&finiteJson(v)&&typeof v.dataset_id==='string'&&isTier(v.tier)&&Array.isArray(v.identities)&&v.identities.every(isRecord)&&isRecord(v.identity_detail)&&typeof v.identity_detail.status==='string'&&typeof v.identity_detail.basis==='string'&&isRecord(v.completeness)&&typeof v.completeness.status==='string'&&isRecord(v.clock_basis)&&Object.values(v.clock_basis).every(x=>x===null||typeof x==='string')&&cursor(v.next_cursor),'coverage');
 return v as Coverage;
}
export function parseValidation(v:unknown):Validation{
 need(isRecord(v)&&v.valid===true,'validation');parseContract('QueryDefinition',v.definition);return v as Validation;
}
