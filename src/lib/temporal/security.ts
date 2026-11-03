// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {useBackendsStore} from '../../stores/backendsStore';
import {useWorkspaceStore} from '../../stores/workspaceStore';
let epoch=0;const listeners=new Set<()=>void>();
export const temporalScope=(backendId:string)=>`${backendId}:${epoch}`;
export const onTemporalScopeChange=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function invalidateTemporalScope(){epoch++;listeners.forEach(fn=>fn());}
const evict=invalidateTemporalScope;
const auth=(state:ReturnType<typeof useBackendsStore.getState>)=>JSON.stringify(state.backends.map(b=>[b.id,b.baseUrl,b.headerName,b.headerValue,b.authLocation]));
useBackendsStore.subscribe((next,prev)=>{if(auth(next)!==auth(prev))evict();});
// Session policy is server-derived; any logout/expiry/principal/scope change invalidates memory.
useWorkspaceStore.subscribe((next,prev)=>{if(JSON.stringify(next.sessions)!==JSON.stringify(prev.sessions))evict();});
