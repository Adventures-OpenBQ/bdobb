// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {YoutubePlayback} from './youtubePlayback';

export function desktopVideoPipAvailable():boolean {
  return isTauri()&&['darwin','windows'].includes(import.meta.env.TAURI_ENV_PLATFORM??'');
}
export function youtubePipLabel(card:string):string {
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(card))throw Error('Invalid video card identity');
  return `youtube-pip-${card}`;
}
// Native open/close cross the UI thread. Serialize by card, including removal
// while an open is still in flight; failure must not poison later cleanup.
const pending = new Map<string, Promise<unknown>>();
function owned<T>(card:string, action:()=>Promise<T>):Promise<T> {
  youtubePipLabel(card);
  const result = (pending.get(card) ?? Promise.resolve()).catch(()=>undefined).then(action);
  pending.set(card,result);
  void result.finally(()=>{if(pending.get(card)===result)pending.delete(card);}).catch(()=>undefined);
  return result;
}
export function openYoutubePip(card:string,id:string,prefs:YoutubePlayback,focus=false):Promise<void> {
  return owned(card,()=>invoke('youtube_pip_open',{card,id,muted:prefs.muted,autoplay:prefs.autoplay,focus}));
}
export function closeYoutubePip(card:string):Promise<void> {
  return owned(card,async()=>{
    await invoke('youtube_pip_close',{card});
    const deadline=Date.now()+5000;
    while(await invoke<boolean>('youtube_pip_is_open',{card})) {
      if(Date.now()>=deadline)throw Error('The floating player has not closed');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  });
}
export function youtubePipIsOpen(card:string):Promise<boolean> {return owned(card,()=>invoke('youtube_pip_is_open',{card}));}
