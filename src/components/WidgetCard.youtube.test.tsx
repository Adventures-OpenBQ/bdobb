// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../lib/plotly',()=>({renderPlot:async()=>{},purgePlot:()=>{},resizePlot:()=>{},REGISTERED_TRACE_TYPES:new Set()}));
vi.mock('../hooks/useWidgetData',()=>({useWidgetData:()=>({status:'ready',data:'https://youtu.be/uYyhswnZkSw',loading:false,error:null,attempt:0,retry:()=>{},query:{channel:'bloomberg'}})}));
vi.mock('../lib/youtubePip',()=>({desktopVideoPipAvailable:()=>false,closeYoutubePip:vi.fn(),openYoutubePip:vi.fn(),youtubePipIsOpen:vi.fn()}));
import {WidgetCard} from './WidgetCard';
import {useDashboardStore} from '../stores/dashboardStore';
import {useWidgetRegistryStore} from '../stores/widgetRegistryStore';
import {useBackendsStore} from '../stores/backendsStore';
import {backend,card,widget} from '../test/fixtures';
import {__reset} from '../test/memfs';
import {__resetJsonStoreForTests} from '../lib/jsonStore';
beforeEach(()=>{
 __reset();__resetJsonStoreForTests();
 useBackendsStore.setState({backends:[backend()],statuses:{b1:'online'}});
 useWidgetRegistryStore.setState({widgets:[widget({type:'youtube'})]});
 useDashboardStore.setState({dashboards:[{id:'d',name:'D',tabs:[{id:'t',name:'T',cards:[card()]}]}],activeId:'d',activeTabId:'t',viewer:false});
});
function LiveCard(){const c=useDashboardStore(s=>s.dashboards[0].tabs[0].cards[0]);return <WidgetCard card={c} onRemove={()=>{}}/>;}
it('opens playback configuration through Parameters and persists it outside backend parameters',async()=>{
 render(<LiveCard/>);
 await userEvent.click(screen.getByRole('button',{name:'Show parameters'}));
 const checkbox=await screen.findByRole('checkbox',{name:'Start muted'});
 await userEvent.click(checkbox);
 await waitFor(()=>expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].video).toEqual({display:'inline',muted:true,autoplay:false}));
 expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[0].params).toEqual({});
 expect(screen.getByRole('region',{name:'Parameters'})).toContainElement(checkbox);
});
it('does not expose writable playback configuration in a viewer',async()=>{
 useDashboardStore.setState({viewer:true});render(<LiveCard/>);
 expect(screen.queryByRole('checkbox',{name:'Start muted'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Picture in Picture'})).toBeNull();
 await screen.findByTitle('YouTube video');
});
