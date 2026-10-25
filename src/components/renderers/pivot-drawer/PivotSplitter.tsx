// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef } from 'react';
import { clampSplitPct } from './drawerLayout';
export function PivotSplitter({bodyH,splitPct,onChange}:{bodyH:number;splitPct:number;onChange:(value:number)=>void}) {
 const drag=useRef<{y:number;start:number}|undefined>(undefined);
 // ARIA separator is keyboard-adjustable under the WAI-ARIA window splitter pattern.
 // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
 return <div role="separator" aria-label="Resize pivot drawer" aria-orientation="horizontal" aria-valuemin={18} aria-valuemax={92} aria-valuenow={Math.round(clampSplitPct(splitPct)*100)} tabIndex={0} className="pivot-splitter" onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={y:event.clientY,start:splitPct};}} onPointerMove={event=>{if(drag.current&&bodyH>0)onChange(clampSplitPct(drag.current.start+(event.clientY-drag.current.y)/bodyH));}} onPointerUp={event=>{drag.current=undefined;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}} onKeyDown={event=>{let value=splitPct;if(event.key==='ArrowUp')value-=.02;else if(event.key==='ArrowDown')value+=.02;else if(event.key==='Home')value=.18;else if(event.key==='End')value=.92;else return;event.preventDefault();onChange(clampSplitPct(value));}}/>;
}
