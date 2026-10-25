// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {createSourceClient} from './sourceClient';
const backend={id:'b',name:'Server',baseUrl:'https://tables.test/private',authLocation:'header' as const,validateWidgets:true};
it('uploads raw bounded bytes with a fresh idempotency identity and persists only a source reference',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({sourceId:'private/id'})));
 const client=createSourceClient(backend,{request,maxUploadBytes:4});
 await expect(client.uploadFile(new File(['12345'],'large.csv'))).rejects.toThrow(/limit/);
 expect(request).not.toHaveBeenCalled();
 const file=new File(['a\n1'],'data.csv');
 expect(await client.uploadFile(file)).toEqual({sourceId:'private/id',kind:'upload',version:1});
 expect(request.mock.calls[0][0]).toBe('https://tables.test/private/sources/uploads');
 expect(request.mock.calls[0][1]?.body).toBe(file);
 expect(new Headers(request.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBeTruthy();
 await client.deleteSource('private/id');
 expect(request.mock.calls[1][0]).toBe('https://tables.test/private/sources/private%2Fid');
});
it('registers only allowed backend binding data and bounds discovery responses',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({sourceId:'backend-ref'})));
 const client=createSourceClient(backend,{request});
 expect(await client.registerBackend({backendId:'upstream',widgetId:'prices',params:{symbol:'AAPL'}})).toEqual({sourceId:'backend-ref',kind:'backend',version:1});
 expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({binding:{backendId:'upstream',widgetId:'prices',params:{symbol:'AAPL'}}});
 await expect(client.registerBackend({backendId:'x',widgetId:'y',params:{authorization:'secret'}})).rejects.toThrow(/parameter/i);
});

it('uses a single UTF-8 URI component for Unicode and literal percent filenames',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({sourceId:'unicode'})));
 const client=createSourceClient(backend,{request});
 await client.uploadFile(new File(['x\n1'],'数 %2F +.csv'));
 expect(new Headers(request.mock.calls[0][1]?.headers).get('X-Upload-Filename')).toBe('%E6%95%B0%20%252F%20%2B.csv');
});
