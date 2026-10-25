// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { dispatchDrawer, getDismissOnOutside, getDrawerState, subscribeDrawer } from '../../../stores/pivotDrawerStore';
import { DrawerFooterTarget } from './DrawerFooterTarget';
import { SectionIcon } from './SectionIcon';
import type { DrawerSection } from './drawerState';
/** tabOf: the section has no tab of its own and is reached through that section's tab;
 *  subLabel names it in the shared tab's switcher (e.g. Saved: Definitions | Statement template). */
export type SectionSpec = {id:DrawerSection;label:string;hint:string;render:()=>ReactNode;foot?:()=>ReactNode;badge?:{text:string;tone:'count'|'on'|'warn'};tabOf?:DrawerSection;subLabel?:string};
export function useDrawer(dashboardId:string,widgetId:string) {
 return useSyncExternalStore(listener=>subscribeDrawer(dashboardId,widgetId,listener),()=>getDrawerState(dashboardId,widgetId));
}
export function useDismissOnOutside(dashboardId:string,widgetId:string) {
 return useSyncExternalStore(listener=>subscribeDrawer(dashboardId,widgetId,listener),()=>getDismissOnOutside(dashboardId,widgetId));
}
function SectionBodyFooter({body, foot, done}: {body: ReactNode; foot: ReactNode; done: () => void}) {
 const [target,setTarget]=useState<HTMLSpanElement|null>(null);
 return <DrawerFooterTarget value={target}><div className="pivot-drawer-body">{body}</div>
 <div className="pivot-drawer-foot"><span ref={setTarget} className="pivot-drawer-editor-foot"/>{foot}<span className="pivot-drawer-foot-spacer"/><button type="button" className="pivot-drawer-done" onClick={done}>Done</button></div></DrawerFooterTarget>;
}
function DrawerShell({dashboardId,widgetId,sections,layout,splitPct}: {dashboardId:string;widgetId:string;sections:SectionSpec[];layout:{mode:'split'|'fill';cramped:boolean;orientation:'vertical'|'horizontal';short:boolean;bodyH?:number};splitPct?:number}) {
 const state=useDrawer(dashboardId,widgetId); const prefix=useId(); const root=useRef<HTMLDivElement>(null); const strip=useRef<HTMLDivElement>(null);
 const tabs=useRef(new Map<DrawerSection,HTMLButtonElement>());const visited=useRef(new Set<DrawerSection>());
 if(state.open)visited.current.add(state.active);
 const [overflow,setOverflow]=useState({start:false,end:false});
 const wasOpen=useRef(false);
 const narrow=layout.orientation==='horizontal';
 const owner=(id:DrawerSection)=>sections.find(s=>s.id===id)?.tabOf??id;
 const tabbed=sections.filter(s=>!s.tabOf);
 const activeTab=owner(state.active);
 const members=(id:DrawerSection)=>sections.filter(s=>owner(s.id)===id);
 useLayoutEffect(()=>{
  const scroller=strip.current;if(!scroller)return;
  const measure=()=>setOverflow({start:scroller.scrollLeft>1,end:scroller.scrollLeft+scroller.clientWidth<scroller.scrollWidth-1});
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);observer?.observe(scroller);scroller.addEventListener('scroll',measure);measure();
  return()=>{observer?.disconnect();scroller.removeEventListener('scroll',measure);};
 },[narrow,state.open]);
 useLayoutEffect(()=>{
  const justOpened=state.open&&!wasOpen.current;wasOpen.current=state.open;
  if(state.open){const focused=document.activeElement;const hiddenFocus=root.current?.contains(focused)&&focused?.closest('[hidden]');if(justOpened||hiddenFocus)tabs.current.get(activeTab)?.focus();tabs.current.get(activeTab)?.scrollIntoView?.({block:'nearest',inline:'nearest'});return;}
  if(!state.returnFocus)return;
  const selector=state.returnFocus==='toolbar'?'.pivot-toggle':'[data-pivot-table]';
  const candidates=Array.from(document.querySelectorAll<HTMLElement>(selector));
  const target=candidates.find(e=>e.dataset.dashboard===dashboardId&&(state.returnFocus==='toolbar'?e.dataset.widget:e.dataset.pivotTable)===widgetId&&!e.hidden&&!e.closest('[hidden]'));
  const toolbar=Array.from(document.querySelectorAll<HTMLElement>('.pivot-toggle')).find(e=>e.dataset.dashboard===dashboardId&&e.dataset.widget===widgetId&&!e.hidden&&!e.closest('[hidden]'));
  (target??toolbar)?.focus();
 },[state,activeTab,dashboardId,widgetId]);
 // A bubble listener lets nested menus/popovers consume Escape first.
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&state.open&&root.current?.contains(event.target as Node)){
   event.preventDefault();dispatchDrawer(dashboardId,widgetId,{kind:'escape'});
   if(state.active!=='arrange')tabs.current.get('arrange')?.focus();
  }};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);
 },[state,dashboardId,widgetId]);
 const select=(id:DrawerSection,focus=false)=>{dispatchDrawer(dashboardId,widgetId,{kind:'select',section:id});if(focus)tabs.current.get(owner(id))?.focus();};
 const tab=(section:SectionSpec)=> <button type="button" role="tab" key={`tab:${section.id}`} data-section={section.id} id={`${prefix}-${section.id}-tab`} aria-controls={`${prefix}-${activeTab===section.id?state.active:section.id}-panel`} aria-selected={activeTab===section.id} tabIndex={activeTab===section.id?0:-1} aria-label={section.label} className="pivot-drawer-tab" ref={e=>{if(e)tabs.current.set(section.id,e);else tabs.current.delete(section.id);}} onClick={()=>{if(activeTab!==section.id)select(section.id);}} onKeyDown={e=>{
  const index=tabbed.findIndex(s=>s.id===section.id);let next=index;
  if(e.key==='Home')next=0;else if(e.key==='End')next=tabbed.length-1;
  else if(e.key===(narrow?'ArrowRight':'ArrowDown'))next=(index+1)%tabbed.length;
  else if(e.key===(narrow?'ArrowLeft':'ArrowUp'))next=(index+tabbed.length-1)%tabbed.length;else return;
  e.preventDefault();select(tabbed[next].id,true);
 }}><SectionIcon section={section.id}/><span className="pivot-drawer-tab-label">{section.label}</span>{section.badge?<span className="pivot-drawer-badge" data-tone={section.badge.tone}>{section.badge.text}</span>:null}</button>;
 const panel=(section:SectionSpec)=>{
  const group=members(owner(section.id));const title=sections.find(s=>s.id===owner(section.id))!.label;
  return <div className="pivot-drawer-panel" key={`panel:${section.id}`} data-section={section.id} id={`${prefix}-${section.id}-panel`} role="tabpanel" aria-labelledby={`${prefix}-${owner(section.id)}-tab`} tabIndex={-1} hidden={state.active!==section.id}>
  <div className="pivot-drawer-head"><strong className="pivot-drawer-title">{title}</strong>
   {group.length>1?<span className="pivot-drawer-switch" role="group" aria-label={`${title} views`}>{group.map(g=><button type="button" key={g.id} aria-pressed={g.id===section.id} onClick={()=>select(g.id)}>{g.subLabel??g.label}</button>)}</span>:null}
   <span className="pivot-drawer-hint">{section.hint}</span>{section.id!=='arrange'?<button type="button" onClick={()=>select('arrange',true)}>Back to Arrange</button>:null}<button type="button" aria-label="Close pivot drawer" onClick={()=>dispatchDrawer(dashboardId,widgetId,{kind:'close'})}>×</button></div>
  <SectionBodyFooter body={visited.current.has(section.id)?section.render():null} foot={section.foot?.()} done={()=>dispatchDrawer(dashboardId,widgetId,{kind:'done'})}/>
 </div>;};
 return <div ref={root} className="pivot-drawer" style={layout.mode==='split'&&layout.bodyH!==undefined&&splitPct!==undefined?{height:layout.bodyH*splitPct}:undefined} hidden={!state.open} data-mode={layout.mode} data-orientation={layout.orientation} data-short={layout.short?'':undefined}>
  {narrow?<div className="pivot-drawer-strip" data-overflow-start={overflow.start?'':undefined} data-overflow-end={overflow.end?'':undefined}>
   <div ref={strip} className="pivot-drawer-strip-scroll" role="tablist" aria-label="Pivot sections" aria-orientation="horizontal">{tabbed.map(s=><div role="presentation" key={s.id}>{tab(s)}</div>)}</div>
   {(['start','end'] as const).map(dir=><button key={dir} type="button" className="pivot-drawer-strip-arrow" data-dir={dir} hidden={!overflow[dir]} aria-label={`Scroll sections ${dir}`} onClick={()=>strip.current?.scrollBy({left:(dir==='start'?-1:1)*(strip.current?.clientWidth??0)*.75})}>{dir==='start'?'‹':'›'}</button>)}
  </div>:null}
  {/* Wide cards: Arrange's tab is pinned at the far left, the open panel fills the middle and every
      other tab stands in one rail on the right (CSS order). Narrow cards show only the open panel. */}
  <div className="pivot-drawer-wide" role={narrow?undefined:'tablist'} aria-label={narrow?undefined:'Pivot sections'} aria-orientation={narrow?undefined:'vertical'}>{!narrow?tabbed.map(tab):null}{sections.map(panel)}</div>
 </div>;
}

export function PivotDrawer(props:Parameters<typeof DrawerShell>[0]) {
 return <DrawerShell key={JSON.stringify([props.dashboardId,props.widgetId])} {...props}/>;
}
