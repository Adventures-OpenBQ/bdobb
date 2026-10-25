// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useRef,useState} from 'react';
import {useDashboardStore} from '../stores/dashboardStore';
import {useTableCommit} from '../hooks/useTableCommit';
import type {PivotParamView} from '../lib/tableModel/pivotParams';
import type {FacetResult} from '../lib/tableExecution/types';
import type {GroupChangeKind} from '../lib/pivotGroupChange';
import {tableExecutionStore} from '../stores/tableExecutionStore';
import {validateTableModel} from '../lib/tableModel/validation';
import {PivotGroupDialog} from './PivotGroupDialog';
export function PivotGroupLink({dashboardId,widgetId,param,members}:{dashboardId:string;widgetId:string;param:PivotParamView;members?:FacetResult['members']}){
 const dashboard=useDashboardStore(s=>s.dashboards.find(d=>d.id===dashboardId));const viewer=useDashboardStore(s=>s.viewer);const commits=useTableCommit(dashboardId,widgetId);const [open,setOpen]=useState(false),[intent,setIntent]=useState<{kind:GroupChangeKind;targetGroupId?:string}>();const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const card=dashboard?.tabs.flatMap(t=>t.cards).find(c=>c.id===widgetId);const binding=card?.bindings?.find(b=>b.paramName===param.key);const group=dashboard?.groups?.find(g=>g.id===binding?.groupId);const category=validateTableModel(tableExecutionStore.readView(dashboardId,widgetId).definition.analytical).model?.categories.find(c=>c.id===param.categoryId);
 const groups=dashboard?.groups?.filter(g=>g.groupType===category?.sourceFieldId&&!card?.bindings?.some(b=>b.groupId===g.id&&b.paramName!==param.key))??[];
 useEffect(()=>{if(!open)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing){e.stopImmediatePropagation();setOpen(false);trigger.current?.focus();}};const outside=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',outside);menu.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',outside);};},[open]);
 const choose=(kind:GroupChangeKind,targetGroupId=group?.id)=>{setOpen(false);trigger.current?.focus();setIntent({kind,targetGroupId});};
 if(viewer||!card)return null;
 return <span className="pivot-group-link"><button ref={trigger} type="button" className="param-group" data-linked={!!binding} aria-label={`Group actions for ${param.label}`} title={group?.name??'Link a group'} aria-expanded={open} disabled={!commits.canReplace||!!dashboard?.groupsDisabled} onClick={()=>setOpen(!open)}>{binding?'Group':'Link'} ▾</button>{open?<div ref={menu} className="pivot-group-menu" role="group" aria-label={`${param.label} group actions`}>{group?<><button type="button" onClick={()=>choose('edit')}>Edit shared value</button><button type="button" onClick={()=>choose('push')}>Push values to group</button><button type="button" onClick={()=>choose('unlink')}>Unlink group</button></>:null}{groups.filter(g=>g.id!==group?.id).map(g=><button type="button" key={g.id} onClick={()=>choose('link',g.id)}>Link to {g.name}</button>)}{!binding?<button type="button" onClick={()=>choose('create',undefined)}>Create group</button>:null}</div>:null}{intent?<PivotGroupDialog {...intent} dashboardId={dashboardId} widgetId={widgetId} param={param} members={members} onClose={()=>{setIntent(undefined);trigger.current?.focus();}}/>:null}</span>;
}
