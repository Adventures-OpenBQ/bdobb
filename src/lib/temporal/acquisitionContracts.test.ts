// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest';
import {parseContract} from './contracts';
const source={dataset_id:'eodhd.eod',provider:'eodhd',account_ref:'main',symbols:['TEST.US'],date_start:'2000-01-01',date_end:'2100-01-01'};
const policy={policy_id:'11111111-1111-4111-8111-111111111111',revision:1,title:'Daily',sources:[source]};
it('parses a credential-free acquisition policy and rejects unsupported sources and secret fields',()=>{
 expect(parseContract('AcquisitionPolicy',policy)).toEqual(policy);
 for(const bad of [{...policy,credential:'secret'},{...policy,sources:[{...source,dataset_id:'unsupported'}]},{...policy,limits:{max_requests:0}}])expect(()=>parseContract('AcquisitionPolicy',bad)).toThrow();
});
it('enforces bounded source and identity arrays from the canonical schema',()=>{
 expect(()=>parseContract('AcquisitionPolicy',{...policy,sources:Array.from({length:17},()=>source)})).toThrow();
 expect(()=>parseContract('AcquisitionPolicy',{...policy,sources:[{...source,symbols:[]}]})).toThrow();
});
