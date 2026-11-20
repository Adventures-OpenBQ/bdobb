// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {extensionError} from "./appsExtensionsV3";
import type {V3CardExtension} from "./appsExtensionsV3";
import type {DashboardCard} from "./types";
export type PortableLinkedIdentity={instanceId?:string;sourceRef?:string};
/** Opaque transport references carry no local ids and never identify by widget definition. */
export function linkedReferences(cards:DashboardCard[]):Map<string,string>{
 if(!cards.some(c=>c.linkedSource!==undefined || c.linkedChart!==undefined))return new Map();
 const refs=new Map(cards.map((c,i)=>[c.id,`c${i}`]));
 if(refs.size!==cards.length)extensionError("$.cards","Duplicate source card identity.");
 for(const c of cards)if(c.linkedSource){
  const target=cards.find(s=>s.id===c.linkedSource?.sourceWidgetId);
  if(!target || target===c || target.widgetId==="linked_chart")extensionError("$.cards","Linked source must be a source card in this dashboard.");
 }
 return refs;
}
export function portableLinkedIdentity(card:DashboardCard,refs:Map<string,string>):PortableLinkedIdentity{
 const instanceId=refs.get(card.id);
 return instanceId?{instanceId,...(card.linkedSource?{sourceRef:refs.get(card.linkedSource.sourceWidgetId)}:{})}:{};
}
/** Resolve only after every placed card has received its fresh local identity. */
export function restoreLinkedReferences(items:{card:DashboardCard;native?:V3CardExtension}[]):void{
 const refs=new Map<string,DashboardCard>();
 for(const {card,native} of items)if(native?.instanceId!==undefined){
  if(refs.has(native.instanceId))extensionError("$.cards","Duplicate portable card reference.");
  refs.set(native.instanceId,card);
 }
 for(const {card,native} of items)if(native?.sourceRef!==undefined){
  const source=refs.get(native.sourceRef);
  if(!source || source===card || source.widgetId==="linked_chart")extensionError("$.cards","Missing or invalid linked source reference.");
  card.linkedSource={kind:"widget",sourceWidgetId:source.id};
 }
}
