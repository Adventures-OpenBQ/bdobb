// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {createTemporalPager} from './paging';
import {definition,executionId,fixed,page,receipt} from './fixtures';
import type {TemporalClient} from './client';
import type {ResultPage} from './contracts';
const signal=()=>new AbortController().signal;
const rows=(start:number,count:number)=>Array.from({length:count},(_,i)=>({Revenue:start+i}));
function client(){return {get:vi.fn(async()=>definition),start:vi.fn(async()=>({execution_id:executionId,state:'queued' as const})),status:vi.fn(async()=>({execution_id:executionId,state:'succeeded' as const,error:null})),page:vi.fn(async(_id:string,cursor?:string)=>({...page,total_count:2001,rows:rows(cursor==='p2'?2000:cursor==='p1'?1000:0,cursor==='p2'?1:1000),next_cursor:cursor==='p2'?null:cursor==='p1'?'p2':'p1'}))} as unknown as TemporalClient;}
it('traverses 2001 retained rows and returns to the same page with exactly one execution',async()=>{
 const c=client(),pager=createTemporalPager(c,fixed);
 expect(await pager.open(signal())).toMatchObject({executionId,offset:0,pageNumber:1,hasPrevious:false,hasNext:true});
 expect(await pager.next(signal())).toMatchObject({offset:1000,pageNumber:2,hasPrevious:true,hasNext:true,page:{rows:rows(1000,1000)}});
 expect(await pager.next(signal())).toMatchObject({offset:2000,pageNumber:3,hasNext:false});
 expect(await pager.previous(signal())).toMatchObject({offset:1000,pageNumber:2});
 expect(c.start).toHaveBeenCalledTimes(1);expect(c.page).toHaveBeenLastCalledWith(executionId,'p1',expect.any(AbortSignal));
});
it.each(['receipt','schema','cursor','empty','count','oversized-cursor'] as const)('refuses inconsistent %s and keeps the previously accepted page',async corruption=>{
 const c=client(),pager=createTemporalPager(c,fixed);await pager.open(signal());
 const next={...page,total_count:2001,rows:rows(1000,1000),next_cursor:'p2'};
 if(corruption==='receipt')next.receipt={...receipt,result_hash:'b'.repeat(64)};
 if(corruption==='schema'){next.schema=[{name:'Revenue',type:'float',nullable:false}];next.receipt={...receipt,schema:next.schema};}
 if(corruption==='cursor')next.next_cursor='p1';
 if(corruption==='empty')next.rows=[];
 if(corruption==='count')next.total_count=2002;
 if(corruption==='oversized-cursor')next.next_cursor='x'.repeat(4097);
 vi.mocked(c.page).mockResolvedValueOnce(next);await expect(pager.next(signal())).rejects.toThrow();
 expect(await pager.open(signal())).toMatchObject({offset:0,pageNumber:1});expect(c.start).toHaveBeenCalledTimes(1);
});
it('rejects cancellation even when a response ignores its signal',async()=>{
 const c=client(),pager=createTemporalPager(c,fixed);await pager.open(signal());let finish!:(p:ResultPage)=>void;
 vi.mocked(c.page).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const abort=new AbortController(),pending=pager.next(abort.signal);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));abort.abort();finish({...page,total_count:2001,rows:rows(1000,1000),next_cursor:'p2'});
 await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(await pager.open(signal())).toMatchObject({offset:0});
});
it('allows only one in-flight page request and invalidates a disposed pager',async()=>{
 const c=client(),pager=createTemporalPager(c,fixed);await pager.open(signal());let finish!:(p:ResultPage)=>void;
 vi.mocked(c.page).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=pager.next(signal());await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 await expect(pager.next(signal())).rejects.toThrow(/progress/i);pager.dispose();finish({...page,total_count:2001,rows:rows(1000,1000),next_cursor:'p2'});
 await expect(pending).rejects.toMatchObject({name:'AbortError'});await expect(pager.open(signal())).rejects.toMatchObject({name:'AbortError'});
});
it('never starts a new query for a pinned execution',async()=>{
 const c=client(),pager=createTemporalPager(c,{kind:'execution',executionId});await pager.open(signal());await pager.next(signal());expect(c.start).not.toHaveBeenCalled();
});
it('bounds page rows and bytes before admitting a page',async()=>{
 const c=client();vi.mocked(c.page).mockResolvedValueOnce({...page,total_count:2001,rows:rows(0,1001)});
 await expect(createTemporalPager(c,fixed).open(signal())).rejects.toThrow(/row limit/i);
 const schema=[{name:'Revenue',type:'string',nullable:false}];
 vi.mocked(c.page).mockResolvedValueOnce({...page,schema,receipt:{...receipt,schema},total_count:1,rows:[{Revenue:'x'.repeat(2*1024*1024)}],next_cursor:null} as unknown as ResultPage);
 await expect(createTemporalPager(c,fixed).open(signal())).rejects.toThrow(/byte limit/i);
});
it('bounds cursor history and refuses a 1001st page without requesting it',async()=>{
 const c=client();vi.mocked(c.page).mockImplementation(async(_id,cursor)=>({...page,total_count:2001,rows:[{Revenue:1}],next_cursor:String(Number(cursor??0)+1)}));
 const pager=createTemporalPager(c,fixed);await pager.open(signal());
 for(let n=1;n<1000;n++)await pager.next(signal());
 await expect(pager.next(signal())).rejects.toThrow(/history limit/i);expect(c.page).toHaveBeenCalledTimes(1000);
});
it('does not let a consumer mutate the cached retained page or receipt',async()=>{
 const pager=createTemporalPager(client(),fixed),first=await pager.open(signal());first.page.rows[0].Revenue=1234;first.page.receipt.parameters.changed=true;
 const same=await pager.open(signal());expect(same.page.rows[0].Revenue).toBe(0);expect(same.page.receipt.parameters).toEqual({});
});
it('accepts an explicit managed execution target but rejects malformed routing metadata',async()=>{
 const binding={...fixed,tableExecution:{kind:'managed' as const,version:1 as const,backendId:'tables',sourceBackendId:'tdb'}};
 const c=client();await expect(createTemporalPager(c,binding).open(signal())).resolves.toMatchObject({executionId});
 for(const tableExecution of [{kind:'unknown',backendId:'tables',sourceBackendId:'tdb'},{kind:'managed',backendId:'tables',sourceBackendId:'tdb',url:'https://other'},{kind:'managed',backendId:'',sourceBackendId:'tdb'}])expect(()=>createTemporalPager(c,{...fixed,tableExecution:{...tableExecution,version:1}} as unknown as typeof binding)).toThrow();
});
