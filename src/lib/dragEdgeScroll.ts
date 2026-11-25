// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
/** Scroll only the chart strip, continuing while the pointer is held still. */
export function startDragEdgeScroll(el:HTMLElement,axis:'horizontal'|'vertical',pointer:()=>{x:number;y:number}|null,onScroll:()=>void){
 let stopped=false,frame=0,last:number|null=null;
 const tick=(at:number)=>{
  if(stopped)return;
  const p=pointer();if(!p){stopped=true;return;}
  const r=el.getBoundingClientRect(),horizontal=axis==='horizontal';
  const position=horizontal?p.x:p.y,lo=horizontal?r.left:r.top,hi=horizontal?r.right:r.bottom;
  const across=horizontal?p.y:p.x,acrossLo=horizontal?r.top:r.left,acrossHi=horizontal?r.bottom:r.right;
  const edge=Math.min(48,(hi-lo)/3);
  let speed=0;
  if(edge>0&&across>=acrossLo&&across<=acrossHi&&position>=lo&&position<=hi){
   if(position<lo+edge)speed=-600*(lo+edge-position)/edge;
   else if(position>hi-edge)speed=600*(position-hi+edge)/edge;
  }
  const dt=last===null?0:Math.min(32,Math.max(0,at-last));last=at;
  if(speed&&dt){
   const before=horizontal?el.scrollLeft:el.scrollTop;
   const max=Math.max(0,horizontal?el.scrollWidth-el.clientWidth:el.scrollHeight-el.clientHeight);
   const next=Math.max(0,Math.min(max,before+speed*dt/1000));
   if(next!==before){if(horizontal)el.scrollLeft=next;else el.scrollTop=next;el.dispatchEvent(new Event('scroll'));onScroll();}
  }
  frame=requestAnimationFrame(tick);
 };
 frame=requestAnimationFrame(tick);
 return ()=>{stopped=true;cancelAnimationFrame(frame);};
}
