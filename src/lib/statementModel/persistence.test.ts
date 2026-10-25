// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { StatementIntent } from './types';
import { expect, it } from 'vitest';
import { fixture } from './compileFixtures';
import { exportCompatibleApp, importApps } from '../appsJson';
import { persistedCard, remapWidgetReferences } from '../widgetData/persistence';
import { compileStatement } from './compile';
import type { Dashboard, DashboardCard } from '../types';
function compatible(dashboard: Dashboard) { const result = exportCompatibleApp(dashboard); if (!result.ok) throw new Error(result.issue.message); return result.value; }
const card = ():DashboardCard => ({id:'owner',widgetId:'prices',backendId:'backend',params:{},layout:{x:0,y:0,w:10,h:10},tableDefinition:{table:{},search:'',analytical:fixture().statement},tableSelection:{kind:'none'}});
it('snapshotReopensWithoutCatalog: Workspace interchange carries the exact pinned snapshot and remaps linked owners',()=>{
 const source = card(); const {ids,source:input} = fixture(); const statement=source.tableDefinition!.analytical as StatementIntent;
 statement.overrides.labels[ids.line('revenue')]='Sales'; statement.page={categoryId:ids.company,memberKeys:['ACME','OTHER']};
 const child:DashboardCard={...card(),id:'child',widgetId:'linked_table',linkedSource:{kind:'widget',sourceWidgetId:source.id}};
 const dashboard:Dashboard={id:'d',name:'Statement',tabs:[{id:'tab',name:'Main',cards:[source,child]}],groups:[]};
 const exported=JSON.parse(JSON.stringify(compatible(dashboard))); const imported=importApps([exported],[]).dashboards[0].tabs[0].cards;
 expect(imported[0].tableDefinition).toEqual(source.tableDefinition);
 expect(imported[0].id).not.toBe(source.id); expect(imported[1].linkedSource?.sourceWidgetId).toBe(imported[0].id);
 expect(compileStatement(imported[0].tableDefinition!.analytical as StatementIntent,input.columns).templateIdentity).toEqual({id:'income',version:'1.0.0'});
});
it('overridesSurviveCopyAndRename: native detached persistence preserves local identities and excludes compiled state',()=>{
 const source=card(); const {ids}=fixture(); const statement=source.tableDefinition!.analytical as StatementIntent;
 statement.overrides.labels[ids.line('revenue')]='Sales';
 const copy=remapWidgetReferences(source,new Map([['owner','copy']]));
 expect(copy.tableDefinition).toEqual(source.tableDefinition); expect(copy.tableDefinition).not.toBe(source.tableDefinition);
 const reopened=JSON.parse(JSON.stringify(persistedCard({...copy,title:'Renamed'})));
 expect(reopened.tableDefinition.analytical.overrides.labels[ids.line('revenue')]).toBe('Sales');
 expect(reopened.tableDefinition.analytical).not.toHaveProperty('execution');
});
it('retains unknown snapshots inert in native persistence and refuses unsupported portable export',()=>{
 const source=card(); source.tableDefinition!.analytical={schemaVersion:44,kind:'statement',opaque:{keep:true}};
 const dashboard:Dashboard={id:'d',name:'Unknown',tabs:[{id:'tab',name:'Main',cards:[source]}],groups:[]};
 const imported=JSON.parse(JSON.stringify(persistedCard(source))) as DashboardCard;
 expect(exportCompatibleApp(dashboard).ok).toBe(false);
 expect(imported.tableDefinition).toEqual(source.tableDefinition);
 expect(()=>compileStatement(imported.tableDefinition!.analytical as StatementIntent,[])).toThrow();
});
it('round trips referenced ordinary producers across tabs while omitting unrelated optional fields',()=>{
 const producer=card(); delete producer.tableDefinition;delete producer.tableSelection;
 const unrelated={...producer,id:'unrelated'};
 const child={...card(),id:'child',linkedSource:{kind:'widget' as const,sourceWidgetId:producer.id}};
 const dashboard:Dashboard={id:'d',name:'Raw links',tabs:[{id:'children',name:'Children',cards:[child]},{id:'producers',name:'Producers',cards:[producer,unrelated]}],groups:[]};
 const exported=compatible(dashboard);
 expect(JSON.stringify(exported)).not.toContain(producer.id);
 expect(exported.tabs.producers.layout[1]).not.toHaveProperty('ownerId');
 const imported=importApps(JSON.parse(JSON.stringify([exported])),[]).dashboards[0];
 expect(imported.tabs[0].cards[0].linkedSource?.sourceWidgetId).toBe(imported.tabs[1].cards[0].id);
});
it('refuses foreign portable owners instead of guessing a link target',()=>{
 const child={...card(),id:'child',linkedSource:{kind:'widget' as const,sourceWidgetId:'foreign'}};
 const dashboard:Dashboard={id:'d',name:'Owners',tabs:[{id:'tab',name:'Main',cards:[child]}],groups:[]};
 expect(exportCompatibleApp(dashboard).ok).toBe(false);
});
for(const key of ['ownerId','tableDefinition','tableSelection','linkedSource','linkedChart']) {
 for(const throwing of [false,true]) it(`never evaluates optional ${key} ${throwing?'throwing':'counting'} accessors`,()=>{
  let calls=0;const item={i:'raw'};
  Object.defineProperty(item,key,{enumerable:true,get(){calls++;if(throwing)throw new Error('Accessor executed');return key==='ownerId'?'unsafe':{};}});
  expect(()=>importApps([{name:'Unsafe',tabs:{one:{layout:[item]}}}],[])).not.toThrow(); expect(calls).toBe(0);
 });
}
for(const key of ['kind','sourceWidgetId']) {
 for(const throwing of [false,true]) it(`never evaluates nested link ${key} ${throwing?'throwing':'counting'} accessors`,()=>{
  let calls=0;const link:Record<string,unknown>={kind:'widget',sourceWidgetId:'source'};
  Object.defineProperty(link,key,{enumerable:true,get(){calls++;if(throwing)throw new Error('Accessor executed');return key==='kind'?'widget':'source';}});
  const imported=importApps([{name:'Unsafe',tabs:{one:{layout:[{i:'linked',linkedSource:link}]}}}],[]);
  expect(calls).toBe(0);expect(imported.dashboards[0].tabs[0].cards[0].linkedSource).toBeUndefined();
 });
}
it('refuses cyclic and excessively deep optional envelopes without losing the ordinary card',()=>{
 const cyclic:Record<string,unknown>={table:{},search:''};cyclic.analytical=cyclic;
 let deep:Record<string,unknown>={};for(let n=0;n<300;n++)deep={child:deep};
 const cards=importApps([{name:'Unsafe',tabs:{one:{layout:[{i:'raw',tableDefinition:cyclic},{i:'raw',tableDefinition:{table:{},search:'',analytical:deep}}]}}}],[]).dashboards[0].tabs[0].cards;
 expect(cards).toHaveLength(2);cards.forEach(c=>expect(c.tableDefinition).toBeUndefined());
});
