// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useState} from 'react';

/** A native select's OS popup is outside our modal stack and DOM. Keep the
 * foreign always-on-top player aside through pointer and keyboard selection. */
export function useParameterDropdownOpen():boolean {
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  const select=(target:EventTarget|null)=>target instanceof HTMLSelectElement;
  const pointer=(event:Event)=>setOpen(select(event.target));
  const focus=(event:Event)=>{if(select(event.target))setOpen(true);};
  const close=(event:Event)=>{if(select(event.target))setOpen(false);};
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'||event.key==='Tab')setOpen(false);
   else if(select(event.target)&&['ArrowDown','ArrowUp','Enter',' '].includes(event.key))setOpen(true);
  };
  document.addEventListener('pointerdown',pointer,true);
  document.addEventListener('focusin',focus,true);
  document.addEventListener('focusout',close,true);
  document.addEventListener('change',close,true);
  document.addEventListener('keydown',key,true);
  return ()=>{
   document.removeEventListener('pointerdown',pointer,true);
   document.removeEventListener('focusin',focus,true);
   document.removeEventListener('focusout',close,true);
   document.removeEventListener('change',close,true);
   document.removeEventListener('keydown',key,true);
  };
 },[]);
 return open;
}
