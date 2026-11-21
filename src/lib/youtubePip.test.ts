// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/event',()=>({listen:async()=>()=>{}}));
vi.mock('@tauri-apps/api/core',()=>({invoke,isTauri:()=>true}));
import {closeYoutubePip,openYoutubePip} from './youtubePip';
it('serializes close after an in-flight open so removing a card cannot orphan its player',async()=>{
 let finish:()=>void=()=>{}; const order:string[]=[];
 invoke.mockImplementation(async(command:string)=>{order.push(command);if(command==='youtube_pip_open')await new Promise<void>(r=>{finish=r;});return false;});
 const opening=openYoutubePip('race-1','uYyhswnZkSw',{display:'pip',muted:true,autoplay:true});
 await vi.waitFor(()=>expect(order).toEqual(['youtube_pip_open']));
 const closing=closeYoutubePip('race-1');
 await Promise.resolve();
 expect(order).toEqual(['youtube_pip_open']);
 finish();await Promise.all([opening,closing]);
 expect(order).toEqual(['youtube_pip_open','youtube_pip_close','youtube_pip_is_open']);
});
it('does not report close complete until the actual native window disappears',async()=>{
 let present=true;invoke.mockImplementation(async(command:string)=>command==='youtube_pip_is_open'?present:undefined);
 let complete=false;const closing=closeYoutubePip('race-2').then(()=>{complete=true;});
 await new Promise(r=>setTimeout(r,20));expect(complete).toBe(false);
 present=false;await closing;expect(complete).toBe(true);
});
