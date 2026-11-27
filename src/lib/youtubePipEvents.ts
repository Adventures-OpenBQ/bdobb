// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {listen} from '@tauri-apps/api/event';
import {ownerOfCard,useDashboardStore} from '../stores/dashboardStore';
import {logError} from './logger';
import {DOCKS_ID} from './dashboardsFile';

// Owned by the main app, not a mounted card. A user close must survive navigation.
let listening:Promise<void>|undefined;
const closed=new Set<string>();
const writes=new Map<string,Promise<void>>();
export function observeYoutubePipClosures():Promise<void> {
  return listening??=listen<unknown>('youtube-pip-user-closed',event=>{
    const id=event.payload;
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))return;
    closed.add(id);
    const state=useDashboardStore.getState();
    const owner=ownerOfCard(state,id);
    const tab=owner?.tabs.find(tab=>tab.cards.some(c=>c.id===id));
    const card=tab?.cards.find(c=>c.id===id);
    if(card?.video?.display!=='pip')return;
    // Locked bands have the same no-configuration-write contract as their UI.
    if(owner?.id===DOCKS_ID && state.dockEdit?.edge!==tab?.id)return;
    const write=state.patchCardField(id,'video',{...card.video,display:'inline'});
    writes.set(id,write);
    void write.catch(error=>logError(`failed to save native video close for ${id}: ${error}`)).finally(()=>{if(writes.get(id)===write)writes.delete(id);});
  }).then(()=>undefined).catch(error=>{listening=undefined;throw error;});
}
/** Wait out a close save before a new renderer can restore stale PiP preferences. */
export async function mayOpenYoutubePip(card:string,explicit:boolean):Promise<boolean> {
  await observeYoutubePipClosures();
  await writes.get(card);
  if(explicit)closed.delete(card);
  return !closed.has(card);
}
