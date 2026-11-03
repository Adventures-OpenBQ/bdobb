// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {App,ImportResult} from '../appsJson';
import {extensionError,type ExtensionResult} from '../appsExtensionsV3';
import type {Dashboard} from '../types';
import type {QueryBinding} from './bindings';
import {finiteJson,isRecord} from './contracts';
export type TemporalAppOverlay={schemaVersion:1;cards:{tab:string;index:number;backendId:string;binding:QueryBinding}[]};
/** Sibling extension: older strict v3-v8 profiles keep their existing meaning. */
export function exportTemporalApp(dashboard:Dashboard,baseExport:(d:Dashboard)=>ExtensionResult<App>):ExtensionResult<App>{
 const cards:TemporalAppOverlay['cards']=[];
 const clean={...dashboard,tabs:dashboard.tabs.map(t=>({...t,cards:t.cards.map((card,index)=>{
  const {queryBinding,...rest}=card;if(queryBinding!==undefined){cards.push({tab:t.id,index,backendId:card.backendId,binding:structuredClone(queryBinding)});}return rest;
 })}))};
 const base=baseExport(clean);if(!base.ok||!cards.length)return base;
 if(!finiteJson(cards))extensionError('$.extensions.bdobbV11','Invalid temporal binding JSON.');
 return {ok:true,value:{...base.value,extensions:{...base.value.extensions!,bdobbV11:{schemaVersion:1,cards}}}};
}
/** A backend-served app cannot know this install's connection ids; its bindings belong to the connection that served it. */
export function servedTemporalApp<T>(app:T,backendId:string):T{
 if(!isRecord(app)||!isRecord(app.extensions)||!isRecord(app.extensions.bdobbV11)||!Array.isArray(app.extensions.bdobbV11.cards))return app;
 const copy=structuredClone(app) as unknown as {extensions:{bdobbV11:{cards:unknown[]}}};
 for(const card of copy.extensions.bdobbV11.cards)if(isRecord(card))card.backendId=backendId;
 return copy as unknown as T;
}
/** Validate portable slots before importing. Binding intent is kept verbatim;
 * a future/malformed binding is refused by acquisition, not deleted on import. */
export function prepareTemporalApps(input:unknown,prepare:(v:unknown)=>{plain:unknown;restore:(r:ImportResult)=>ImportResult}){
 const pending:{app:number;cards:TemporalAppOverlay['cards']}[]=[];
 if(Array.isArray(input))input.forEach((raw,app)=>{
  if(!isRecord(raw)||!isRecord(raw.extensions)||raw.extensions.bdobbV11===undefined)return;
  const value=raw.extensions.bdobbV11;
  if(!isRecord(value)||!finiteJson(value)||value.schemaVersion!==1||Object.keys(value).some(k=>!['schemaVersion','cards'].includes(k))||!Array.isArray(value.cards)||!isRecord(raw.tabs))extensionError('$.extensions.bdobbV11','Invalid or future temporal overlay; original file remains unchanged.');
  const cards:TemporalAppOverlay['cards']=[],seen=new Set<string>();
  for(const item of value.cards){
   if(!isRecord(item)||Object.keys(item).some(k=>!['tab','index','backendId','binding'].includes(k))||typeof item.tab!=='string'||!Object.hasOwn(raw.tabs,item.tab)||!Number.isSafeInteger(item.index)||Number(item.index)<0||typeof item.backendId!=='string'||!item.backendId||!isRecord(item.binding))extensionError('$.extensions.bdobbV11.cards','Invalid temporal binding slot.');
   const tab=raw.tabs[item.tab],slot=JSON.stringify([item.tab,item.index]);if(!isRecord(tab)||!Array.isArray(tab.layout)||Number(item.index)>=tab.layout.length||seen.has(slot))extensionError('$.extensions.bdobbV11.cards','Invalid or duplicate temporal binding slot.');
   seen.add(slot);cards.push(structuredClone(item) as TemporalAppOverlay['cards'][number]);
  }
  pending.push({app,cards});
 });
 const prepared=prepare(input);
 return {plain:prepared.plain,restore:(result:ImportResult)=>{
  const restored=prepared.restore(result);
  for(const group of pending)for(const overlay of group.cards){
   const app=restored.dashboards[group.app];const raw=Array.isArray(input)?input[group.app]:undefined;
   if(!isRecord(raw)||!isRecord(raw.tabs))extensionError('$.tabs','Missing temporal tabs.');
   // Follow the base extension's order, including numeric JSON tab keys.
   let envelope:unknown=isRecord(raw.extensions)?raw.extensions.bdobb:undefined;
   while(isRecord(envelope)&&Object.hasOwn(envelope,'base'))envelope=envelope.base;
   const order=isRecord(envelope)&&Array.isArray(envelope.tabOrder)?envelope.tabOrder:Object.keys(raw.tabs);
   const tab=app.tabs[order.indexOf(overlay.tab)];
   if(!tab?.cards[overlay.index])extensionError('$.extensions.bdobbV11.cards','Missing imported temporal card.');
   Object.assign(tab.cards[overlay.index],{backendId:overlay.backendId,queryBinding:structuredClone(overlay.binding)});
  }
  return restored;
 }};
}
