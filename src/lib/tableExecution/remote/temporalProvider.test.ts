// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
import {createTemporalTableProvider} from './temporalProvider';
import {executionId,receipt} from '../../temporal/fixtures';
import {backend} from '../../../test/fixtures';
import type {ProviderSession,SourceBinding} from '../types';
const fake=vi.hoisted(()=>({open:vi.fn(),dispose:vi.fn()}));
vi.mock('./managedProvider',()=>({createManagedProvider:()=>({open:fake.open})}));
const proof={executionId,resultHash:receipt.result_hash};
const source:SourceBinding={kind:'remote',sourceId:executionId,snapshotId:receipt.result_hash,managed:{version:1,inputRevision:1}};
const options={protocolVersion:1,widgetId:'full',locale:'en-US'};
beforeEach(()=>{fake.open.mockReset();fake.dispose.mockReset();fake.open.mockResolvedValue({sessionId:'session',sourceSnapshotId:'snapshot',sourceReceipt:proof,result:{dispose:fake.dispose}} as unknown as ProviderSession);});
function setup(){const requests:Array<{url:string;method?:string;body?:unknown}>=[];const request:typeof fetch=async(url,init)=>{requests.push({url:String(url),method:init?.method,body:init?.body?JSON.parse(String(init.body)):undefined});return Response.json(init?.method==='DELETE'?{deleted:true}:{sourceId:'admitted'});};const provider=createTemporalTableProvider({tableBackend:backend({baseUrl:'https://table/api'}),temporalBackendId:'tdb',executionId,resultHash:receipt.result_hash,request});return {provider,requests};}
it('registers only the frozen execution identity then delegates to managed sessions',async()=>{
 const {provider,requests}=setup();const session=await provider.open(source,options);
 expect(requests[0].body).toMatchObject({binding:{backendId:'tdb',widgetId:'temporal_execution',params:{execution_id:executionId,expected_hash:receipt.result_hash}}});
 expect(fake.open).toHaveBeenCalledWith({...source,sourceId:'admitted',snapshotId:''},options);
 session.result.dispose();await vi.waitFor(()=>expect(requests.some(r=>r.method==='DELETE')).toBe(true));expect(fake.dispose).toHaveBeenCalledTimes(1);
});
it('refuses a source receipt mismatch and retires the admitted source and session',async()=>{
 fake.open.mockResolvedValueOnce({sourceReceipt:{...proof,resultHash:'b'.repeat(64)},result:{dispose:fake.dispose}} as unknown as ProviderSession);
 const {provider,requests}=setup();await expect(provider.open(source,options)).rejects.toThrow(/receipt/i);expect(fake.dispose).toHaveBeenCalledTimes(1);await vi.waitFor(()=>expect(requests.some(r=>r.method==='DELETE')).toBe(true));
});
it('rejects another execution binding before contacting a service',async()=>{
 const {provider,requests}=setup();await expect(provider.open({...source,snapshotId:'other'},options)).rejects.toThrow(/identity/i);expect(requests).toHaveLength(0);
});
