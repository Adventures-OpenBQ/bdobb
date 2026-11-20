// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type {Dashboard} from "../lib/types";
import {WidgetCard} from "./WidgetCard";
/** One source controller per referenced card, never a second acquisition beside its visible card. */
export function InactiveLinkedSources({dashboard,activeTabId,viewer=false}:{dashboard:Dashboard;activeTabId:string|null;viewer?:boolean}){
 const active=dashboard.tabs.find(t=>t.id===activeTabId);
 const sources=new Set(active?.cards.flatMap(c=>c.linkedSource?[c.linkedSource.sourceWidgetId]:[])??[]);
 return <>{dashboard.tabs.filter(t=>t.id!==activeTabId).flatMap(t=>t.cards).filter(c=>sources.has(c.id) && c.widgetId!=="linked_chart").map(c=><WidgetCard key={c.id} card={c} viewer={viewer} headless onRemove={()=>{}}/>)}</>;
}
