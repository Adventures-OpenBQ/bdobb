// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {compareSorted,LABEL_FIELD} from '../pivotTable';
import type {DatasetRow} from '../widgetData/types';
import type {LogicalGroup} from '../tableExecution/types';
import type {TableCardState} from '../types';
export type DisplaySortKey={categoryId:string;value:unknown};
export type DisplayOrderEntry={index:number;groupKey?:DisplaySortKey};
export function sortDisplay<T>(items:T[],sorting:TableCardState['sorting'],valueOf:(item:T,id:string)=>unknown):void {
 if(!sorting?.length)return;
 items.sort((a,b)=>{for(const sort of sorting){const c=compareSorted(valueOf(a,sort.id),valueOf(b,sort.id),sort.desc);if(c)return c;}return 0;});
}
export function sourceDisplayValue(row:DatasetRow,id:string,bind:boolean,source:ReadonlyMap<string,DatasetRow>,bindings:ReadonlyMap<string,string>,structural:ReadonlySet<string>):unknown {
 const field=bind&&!structural.has(id)?bindings.get(id)??id:id,values=source.get(row.id)!.values;
 return Object.hasOwn(values,field)?values[field]:undefined;
}
export function groupDisplayValue(node:LogicalGroup,id:string,key:DisplaySortKey,structural:ReadonlySet<string>):unknown {
 if(id===LABEL_FIELD)return key.value;
 if(structural.has(id))return id===key.categoryId?key.value:undefined;
 const values=node.rows[0].values;return Object.hasOwn(values,id)?values[id]:undefined;
}
