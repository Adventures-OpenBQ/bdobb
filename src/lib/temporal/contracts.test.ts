// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {parseContract,parseResultPage,parseWireInputManifest} from './contracts';
import {page,receipt,queryId} from './fixtures';

it.each([0,42,Number.MAX_SAFE_INTEGER,'9007199254740992','9223372036854775807'])('validates snapshot ID %s using its exact service wire representation',snapshot_id=>{
 const input_manifest={manifest_id:queryId,pins:[{catalog_id:'facts',snapshot_id}],projection_versions:{facts:'v1'}};
 const parsed=parseResultPage({...page,receipt:{...receipt,input_manifest}});
 expect(parsed.receipt.input_manifest.pins[0].snapshot_id).toBe(snapshot_id);
 expect(JSON.parse(JSON.stringify(parsed)).receipt.input_manifest.pins[0].snapshot_id).toBe(snapshot_id);
});

it.each(['-1','-9007199254740992','9007199254740992.5','9.007199254740992e15','+9007199254740992','09007199254740992',' 9007199254740992','9007199254740992 ','','NaN','0','42','9007199254740991',-1,1.5,Number.MAX_SAFE_INTEGER+1])('rejects malformed or noncanonical snapshot wire identity %s',snapshot_id=>{
 expect(()=>parseResultPage({...page,receipt:{...receipt,input_manifest:{manifest_id:queryId,pins:[{catalog_id:'facts',snapshot_id}],projection_versions:{}}}})).toThrow();
});

it('keeps generated B1 domain validation strict and checks the other manifest and pin constraints',()=>{
 const input_manifest={manifest_id:queryId,pins:[{catalog_id:'facts',snapshot_id:'9223372036854775807'}],projection_versions:{}};
 expect(()=>parseContract('InputManifest',input_manifest)).toThrow();
 for(const invalid of [{...input_manifest,schema_version:2},{...input_manifest,extra:true},{...input_manifest,pins:[{catalog_id:'',snapshot_id:'9223372036854775807'}]},{...input_manifest,pins:[{catalog_id:'facts',snapshot_id:'9223372036854775807',extra:true}]},{...input_manifest,pins:[{catalog_id:'facts',snapshot_id:'9223372036854775807',schema_version:2}]}])expect(()=>parseResultPage({...page,receipt:{...receipt,input_manifest:invalid}})).toThrow();
});

it('preserves exact large snapshot IDs inside accepted source vectors',()=>{
 const child={manifest_id:queryId,pins:[{catalog_id:'hot',snapshot_id:'9223372036854775807'}],projection_versions:{'gold.eodhd.eod':'daily-v1'}};
 const vector={...child,source_manifests:{'eodhd.eod':child}};
 expect(parseWireInputManifest(JSON.parse(JSON.stringify(vector)))).toEqual(vector);
 expect(()=>parseWireInputManifest({...vector,source_manifests:{'eodhd.eod':{...child,pins:[{catalog_id:'hot',snapshot_id:9007199254740992}]}}})).toThrow();
});

it.each(['CAPABILITY_UNAVAILABLE','RESOURCE_LIMIT'])('accepts canonical metadata error %s',code=>{
 expect(parseContract('ErrorEnvelope',{error:{code,message:'metadata unavailable',request_id:queryId,details:{}}}).error.code).toBe(code);
});
