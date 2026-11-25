// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {reply,native}=vi.hoisted(()=>({reply:{status:'ready',data:'bdobb:picture-in-picture' as unknown,error:null as string|null},native:vi.fn()}));
vi.mock('../lib/plotly',()=>({renderPlot:async()=>{},purgePlot:()=>{},resizePlot:()=>{},REGISTERED_TRACE_TYPES:new Set()}));
vi.mock('../hooks/useWidgetData',()=>({useWidgetData:()=>({...reply,loading:false,attempt:0,retry:()=>{}})}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:(command:string,args:unknown)=>native(command,args)}));
import {WidgetCard} from './WidgetCard';
import {useDashboardStore} from '../stores/dashboardStore';
import {useWidgetRegistryStore} from '../stores/widgetRegistryStore';
import {useBackendsStore} from '../stores/backendsStore';
import {makeDefaultDocks} from '../lib/dashboardsFile';
import {backend,card,widget} from '../test/fixtures';
import {__reset} from '../test/memfs';
import {__resetJsonStoreForTests} from '../lib/jsonStore';

// jsdom has no ResizeObserver. Playback/capture tests do not measure layout;
// WidgetCard.test.tsx separately drives the real title-strip overflow lifecycle.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

beforeEach(()=>{
 __reset();__resetJsonStoreForTests();vi.stubEnv('TAURI_ENV_PLATFORM','darwin');
 native.mockReset().mockImplementation(async(command:string)=>command==='picture_in_picture_fit'?{state:'fitted'}:command==='youtube_pip_is_open'?false:undefined);
 Object.assign(reply,{status:'ready',data:'bdobb:picture-in-picture',error:null});
 useBackendsStore.setState({backends:[backend()],statuses:{b1:'online'}});
 useWidgetRegistryStore.setState({widgets:[widget({id:'live_tv',type:'youtube',params:[{paramName:'channel',value:'bloomberg-tv'}]})]});
 useDashboardStore.setState({dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card({id:'grab',widgetId:'live_tv',params:{channel:'picture-in-picture'}})]}]}],docks:makeDefaultDocks(),activeId:'d',activeTabId:'t',viewer:false});
});
afterEach(async()=>{cleanup();useDashboardStore.setState({dashboards:[]});await act(async()=>{await new Promise(r=>setTimeout(r,280));});vi.unstubAllEnvs();});
function Live(){return <WidgetCard card={useDashboardStore.getState().dashboards[0].tabs[0].cards[0]} onRemove={()=>{}}/>;}
it.each([
 {name:'request error',status:'error',data:null,error:'Provider failed'},
 {name:'empty response',status:'ready',data:null,error:null},
 {name:'invalid replacement',status:'ready',data:'not a video',error:null},
])('restores Chrome when a visible grab becomes $name without changing Channel',async(next)=>{
 const view=render(<Live/>);
 await waitFor(()=>expect(view.container.querySelector('.picture-in-picture')).toHaveAttribute('data-state','fitted'));
 native.mockClear();Object.assign(reply,next);view.rerender(<Live/>);
 await waitFor(()=>expect(native).toHaveBeenCalledWith('picture_in_picture_release',{card:'grab'}));
 expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params.channel).toBe('picture-in-picture');
 expect(view.container.querySelector('.picture-in-picture')).toBeNull();
 if(next.error)expect(screen.getByText(next.error)).toBeInTheDocument();
});
