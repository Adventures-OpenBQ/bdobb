// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {createSharedQueryLibraryStore} from './sharedQueryLibraryStore';
import type {TemporalClient} from '../lib/temporal/client';
import {definition} from '../lib/temporal/fixtures';
it('loads offline errors explicitly and evicts privileged definitions on scope changes',async()=>{
 const c={list:vi.fn(async()=>[definition])} as unknown as TemporalClient;const library=createSharedQueryLibraryStore();
 await library.getState().load('scope-a',c);expect(library.getState().entries).toEqual([definition]);
 vi.mocked(c.list).mockRejectedValue(new Error('offline'));await library.getState().load('scope-a',c);expect(library.getState()).toMatchObject({status:'error',error:'offline',entries:[definition],stale:true});
 library.getState().clear();expect(library.getState().entries).toEqual([]);
 let done!:(value:typeof definition[])=>void;vi.mocked(c.list).mockImplementation(()=>new Promise(resolve=>{done=resolve}));const pending=library.getState().load('scope-b',c);library.getState().clear();done([definition]);await pending;expect(library.getState().entries).toEqual([]);
});
it('saves revisioned definitions and preserves unavailable imports in exact export reports',async()=>{
 const report={import_id:definition.query_id,entries:[{index:0,status:'unavailable' as const,reason:'unsupported'}]};
 const c={list:async()=>[definition],create:async()=>definition,revise:vi.fn(async()=>({...definition,revision:3})),importEntries:async()=>report,exportQuery:async()=>({version:1 as const,entries:[{version:1,source_backend:'temporaldb',definition}]}),exportImport:async()=>({version:1,entries:[{version:99}]})} as unknown as TemporalClient;
 const library=createSharedQueryLibraryStore();await library.getState().load('scope',c);await library.getState().save(c,definition,2);expect(c.revise).toHaveBeenCalledWith(definition.query_id,2,definition);
 expect(await library.getState().importEntries(c,[{version:99}])).toEqual(report);expect(await library.getState().exportQuery(c,definition.query_id,2)).toMatchObject({entries:[{definition}]});
});
