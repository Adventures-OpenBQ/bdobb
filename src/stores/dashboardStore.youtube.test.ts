// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from 'vitest';
import {useDashboardStore} from './dashboardStore';
import {widget} from '../test/fixtures';
import {__reset} from '../test/memfs';
import {__resetJsonStoreForTests} from '../lib/jsonStore';
beforeEach(async()=>{__reset();__resetJsonStoreForTests();useDashboardStore.setState({dashboards:[],activeId:null,activeTabId:null,viewer:false});await useDashboardStore.getState().load();});
const remote=()=>widget({id:'live_tv',type:'youtube',params:[{paramName:'channel',value:'picture-in-picture'}]});
it('seeds an inline source instead of granting Chrome grab from a remote manifest default',async()=>{
 const id=await useDashboardStore.getState().addCard(remote());
 const c=useDashboardStore.getState().dashboards.flatMap(d=>d.tabs.flatMap(t=>t.cards)).find(c=>c.id===id)!;
 expect(c.params.channel).toBe('bloomberg-tv');
 expect(c.paramsOpen).not.toBe(true);
});
it('preserves an explicitly supplied local Chrome grab choice',async()=>{
 const id=await useDashboardStore.getState().addCard(remote(),{channel:'picture-in-picture'});
 const c=useDashboardStore.getState().dashboards.flatMap(d=>d.tabs.flatMap(t=>t.cards)).find(c=>c.id===id)!;
 expect(c.params.channel).toBe('picture-in-picture');
});
