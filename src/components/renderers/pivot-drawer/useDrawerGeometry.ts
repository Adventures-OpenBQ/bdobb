// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useLayoutEffect, useState, type RefObject } from 'react';
import { drawerLayout } from './drawerLayout';
import type { DrawerSection } from './drawerState';
export function useDrawerGeometry(root:RefObject<HTMLDivElement|null>,active:DrawerSection,splitPct:number,ready?:unknown) {
 const [size,setSize]=useState({bodyH:0,bodyW:0,headH:0,rowH:0,totalH:0,splitterH:0});
 useLayoutEffect(()=>{
  const element=root.current;if(!element)return;
  const measure=()=>{
   const rect=element.getBoundingClientRect();
   const chrome=Array.from(element.children).filter(e=>!e.matches('.pivot-drawer,.pivot-splitter,.table-execution-layout')).reduce((height,e)=>height+(e.hasAttribute('hidden')?0:e.getBoundingClientRect().height+(parseFloat(getComputedStyle(e).marginTop)||0)+(parseFloat(getComputedStyle(e).marginBottom)||0)),0);
   const header=element.querySelector('thead')?.getBoundingClientRect().height??0;
   const selection=element.querySelector('.table-selection-controls')?.getBoundingClientRect().height??0;
   const head=header>0?header+selection:0;
   const splitter=element.querySelector('.pivot-splitter')?.getBoundingClientRect().height??0;
   const total=element.querySelector('.table-total-footer')?.getBoundingClientRect().height??0;
   const row=element.querySelector('tbody tr:not(.table-spacer)')?.getBoundingClientRect().height??0;
   setSize(previous=>{const next={bodyH:Math.max(0,rect.height-chrome),bodyW:rect.width,headH:head||previous.headH,rowH:row||previous.rowH,totalH:element.querySelector('.table-total-footer')?total||previous.totalH:0,splitterH:splitter||previous.splitterH};return Object.keys(next).every(key=>next[key as keyof typeof next]===previous[key as keyof typeof next])?previous:next;});
  };
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);observer?.observe(element);for(const child of element.children)observer?.observe(child);for(const child of element.querySelectorAll('thead,tbody tr:not(.table-spacer),.table-total-footer,.table-selection-controls'))observer?.observe(child);measure();
  // First row blocks can arrive after Ready without changing the outer flex dimensions.
  const mutation=typeof MutationObserver==='undefined'?undefined:new MutationObserver(measure);mutation?.observe(element,{childList:true,subtree:true});
  return()=>{observer?.disconnect();mutation?.disconnect();};
 },[root,active,splitPct,ready]);
 const measured=size.headH>0&&size.rowH>0;
 const bodyH=Math.max(0,size.bodyH-size.totalH-size.splitterH);
 return {...drawerLayout({...size,bodyH:measured?bodyH:0,active,splitPct}),bodyH,measured};
}
