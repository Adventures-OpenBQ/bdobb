// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest';
import { __reset, __read } from '../test/memfs';
import { __resetJsonStoreForTests } from '../lib/jsonStore';
import { useDashboardStore } from './dashboardStore';
import type { DashboardCard } from '../lib/types';
beforeEach(()=>{__reset();__resetJsonStoreForTests();useDashboardStore.setState({dashboards:[],activeId:null,activeTabId:null,viewer:false});});
it('creates a linked metric card with source identity and persists its intent',async()=>{
 await useDashboardStore.getState().load();
 const state=useDashboardStore.getState(),dashboardId=state.activeId!,tabId=state.activeTabId!;
 const source:DashboardCard={id:'source',widgetId:'local_table',backendId:'builtin',params:{file:'source.json'},layout:{x:0,y:0,w:12,h:8}};
 useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:[source]}))}))}));
 const id=await useDashboardStore.getState().addLinkedCard({dashboardId,tabId,sourceWidgetId:'source',presentation:'metric'});
 const metric=useDashboardStore.getState().dashboards[0].tabs[0].cards.find(c=>c.id===id);
 expect(metric).toMatchObject({widgetId:'linked_metric',backendId:'builtin',linkedSource:{kind:'widget',sourceWidgetId:'source'}});
 expect(metric?.tableDefinition).toBeUndefined();
 expect(JSON.parse(__read(`dashboards/${dashboardId}.json`)!)).toMatchObject({tabs:[{cards:[{}, {widgetId:'linked_metric'}]}]});
});

it('commits only validated metric settings while the captured source guard is current',async()=>{
 await useDashboardStore.getState().load();
 const {activeId:dashboardId,activeTabId:tabId}=useDashboardStore.getState();
 const source:DashboardCard={id:'source',widgetId:'local_table',backendId:'builtin',params:{file:'source.json'},layout:{x:0,y:0,w:12,h:8}};
 useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:[source]}))}))}));
 const id=(await useDashboardStore.getState().addLinkedCard({dashboardId:dashboardId!,tabId:tabId!,sourceWidgetId:'source',presentation:'metric'}))!;
 const options={version:1,metric:'dividend_yield',valueField:'dividend_yield',observation:{mode:'latest'},view:'card'} as const;
 expect(await useDashboardStore.getState().commitLinkedMetricSettings(dashboardId!,id,options,()=>false)).toBe(false);
 expect(useDashboardStore.getState().dashboards[0].tabs[0].cards[1].linkedMetric).toBeUndefined();
 expect(await useDashboardStore.getState().commitLinkedMetricSettings(dashboardId!,id,options,()=>true)).toBe(true);
 expect(JSON.parse(__read(`dashboards/${dashboardId}.json`)!)).toMatchObject({tabs:[{cards:[{}, {linkedMetric:options}]}]});
 expect(await useDashboardStore.getState().commitLinkedMetricSettings(dashboardId!,id,{...options,valueField:''},()=>true)).toBe(false);
});
