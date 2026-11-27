// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke,isTauri:()=>true}));
vi.mock('../../lib/youtubePipEvents',()=>({mayOpenYoutubePip:async()=>true}));
import {makeDefaultDocks} from '../../lib/dashboardsFile';
import {useDashboardStore} from '../../stores/dashboardStore';
import {useWidgetRegistryStore} from '../../stores/widgetRegistryStore';
import {card,widget} from '../../test/fixtures';
import {YouTubeRenderer} from './YouTubeRenderer';
beforeEach(()=>{
 vi.stubEnv('TAURI_ENV_PLATFORM','darwin');
 useWidgetRegistryStore.setState({widgets:[widget({id:'live_tv',type:'youtube',params:[{paramName:'channel',type:'text',value:'bloomberg-tv'}]})]});
 useDashboardStore.setState({dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card({id:'retire',widgetId:'live_tv',params:{channel:'picture-in-picture'}})]}]}],docks:makeDefaultDocks(),activeId:'d',activeTabId:'t',viewer:false});
});
afterEach(()=>{cleanup();vi.unstubAllEnvs();invoke.mockReset();});
it('a fresh grab mount waits for an in-flight outgoing open and prior unmount cleanup',async()=>{
 let opened!:()=>void,closed!:()=>void;
 let closeCount=0;
 invoke.mockImplementation((command:string)=>{
  if(command==='youtube_pip_open')return new Promise<void>(r=>{opened=r});
  if(command==='youtube_pip_close'&&++closeCount===1)return new Promise<void>(r=>{closed=r});
  return Promise.resolve(command==='youtube_pip_is_open'?false:command==='video_wrapper_port'?41234:{state:'no_player'});
 });
 const old=render(<YouTubeRenderer data="uYyhswnZkSw" cardId="retire" settings={{display:'pip',muted:false,autoplay:true}}/>);
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('youtube_pip_open',expect.anything()));
 old.unmount(); // A loading state removes the old component entirely.
 render(<YouTubeRenderer data="bdobb:picture-in-picture" cardId="retire"/>);
 expect(invoke.mock.calls.some(([command])=>command==='picture_in_picture_fit')).toBe(false);
 await act(async()=>opened());
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('youtube_pip_close',{card:'retire'}));
 expect(invoke.mock.calls.some(([command])=>command==='picture_in_picture_fit')).toBe(false);
 await act(async()=>closed());
 expect(await screen.findByText('Pop the video out in Chrome')).toBeInTheDocument();
 expect(invoke.mock.calls.filter(([command])=>command==='youtube_pip_close').length).toBeGreaterThanOrEqual(2);
});
