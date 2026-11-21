// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({present:false,opens:0,listeners:new Set<(e:{payload:string})=>void>()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:async(command:string)=>{
 if(command==='video_wrapper_port')return 41234;
 if(command==='youtube_pip_open'){native.present=true;native.opens++;return;}
 if(command==='youtube_pip_close'){native.present=false;return;}
 if(command==='youtube_pip_is_open')return native.present;
}}));
vi.mock('@tauri-apps/api/event',()=>({listen:async(_event:string,handler:(e:{payload:string})=>void)=>{native.listeners.add(handler);return ()=>native.listeners.delete(handler);}}));
import {YouTubeRenderer} from './YouTubeRenderer';
import {useDashboardStore} from '../../stores/dashboardStore';
import {card} from '../../test/fixtures';
import {makeDefaultDocks} from '../../lib/dashboardsFile';
import {__reset} from '../../test/memfs';
import {__resetJsonStoreForTests} from '../../lib/jsonStore';
let cardId='';let serial=0;
beforeEach(()=>{
 vi.stubEnv('TAURI_ENV_PLATFORM','darwin');__reset();__resetJsonStoreForTests();native.present=false;native.opens=0;cardId=`close-${++serial}`;
 useDashboardStore.setState({viewer:false,activeId:'d',activeTabId:'t',dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card({id:cardId,video:{display:'pip',muted:true,autoplay:true}})]}]}]});
});
afterEach(()=>{cleanup();vi.unstubAllEnvs();});
const saved=()=>useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
function Connected(){const c=useDashboardStore(s=>s.dashboards[0].tabs[0].cards[0]);return <YouTubeRenderer data="uYyhswnZkSw" cardId={c.id} settings={c.video} onSettingsChange={v=>useDashboardStore.getState().patchCardField(c.id,'video',v)}/>;}
it('persists native user close after navigation unmount before the polling interval',async()=>{
 const view=render(<Connected/>);await screen.findByText('Playing in Picture in Picture');
 act(()=>{native.present=false;for(const listener of native.listeners)listener({payload:cardId});});
 view.unmount();
 await waitFor(()=>expect(saved().video?.display).toBe('inline'));
 render(<Connected/>);await screen.findByTitle('YouTube video');expect(native.opens).toBe(1);
});
it('retains the floating preference for ordinary navigation while the player was still open',async()=>{
 const view=render(<Connected/>);await screen.findByText('Playing in Picture in Picture');view.unmount();
 await waitFor(()=>expect(native.present).toBe(false));expect(saved().video?.display).toBe('pip');
 render(<Connected/>);await screen.findByText('Playing in Picture in Picture');expect(native.opens).toBe(2);
});

it('keeps locked playback configuration unchanged when its floating window is closed',async()=>{
 const video={display:'pip' as const,muted:true,autoplay:true};const docks=makeDefaultDocks();
 docks.tabs.find(t=>t.id==='top')!.cards=[card({id:cardId,video})];
 useDashboardStore.setState({dashboards:[],docks,dockEdit:null});
 const view=render(<YouTubeRenderer data="uYyhswnZkSw" cardId={cardId} settings={video}/>);
 await screen.findByText('Playing in Picture in Picture');
 await act(async()=>{native.present=false;for(const listener of native.listeners)listener({payload:cardId});await new Promise(r=>setTimeout(r,30));});
 expect(useDashboardStore.getState().docks.tabs.find(t=>t.id==='top')!.cards[0].video).toEqual(video);
 view.unmount();
});

it('saves a user close while the dock card is being edited',async()=>{
 const video={display:'pip' as const,muted:true,autoplay:true};const docks=makeDefaultDocks();
 docks.tabs.find(t=>t.id==='top')!.cards=[card({id:cardId,video})];
 useDashboardStore.setState({dashboards:[],docks,dockEdit:null});useDashboardStore.getState().beginDockEdit('top');
 render(<YouTubeRenderer data="uYyhswnZkSw" cardId={cardId} settings={video}/>);
 await screen.findByText('Playing in Picture in Picture');
 act(()=>{native.present=false;for(const listener of native.listeners)listener({payload:cardId});});
 await waitFor(()=>expect(useDashboardStore.getState().docks.tabs.find(t=>t.id==='top')!.cards[0].video?.display).toBe('inline'));
});
