// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from 'vitest';
import {loadDashboard,makeDefaultDocks,saveDashboard} from './dashboardsFile';
import {card} from '../test/fixtures';
import {__reset} from '../test/memfs';
import {__resetJsonStoreForTests} from './jsonStore';
import type {Dashboard} from './types';
beforeEach(()=>{__reset();__resetJsonStoreForTests();});
it.each(['workspace','docks'])('restores saved video choices from the %s file after reloading',async owner=>{
 const video={display:'pip' as const,autoplay:true,muted:true};
 const dashboard:Dashboard=owner==='docks'?makeDefaultDocks():{id:'video-workspace',name:'TV',tabs:[{id:'main',name:'Main',cards:[]}]};
 dashboard.tabs[0].cards=[card({id:'live-tv',widgetId:'live_tv',params:{channel:'bloomberg-tv'},video})];
 await saveDashboard(dashboard);
 const loaded=await loadDashboard(dashboard.id);
 expect(loaded?.tabs[0].cards[0].video).toEqual(video);
 expect(loaded?.tabs[0].cards[0].params).toEqual({channel:'bloomberg-tv'});
});
