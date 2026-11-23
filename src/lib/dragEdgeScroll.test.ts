// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it,vi} from 'vitest';
import {startDragEdgeScroll} from './dragEdgeScroll';
it.each(['horizontal','vertical'] as const)('keeps scrolling %s while held at the edge, and stops on cancel',axis=>{
 let frame:FrameRequestCallback=()=>{};vi.stubGlobal('requestAnimationFrame',vi.fn((fn)=>{frame=fn;return 1;}));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const el=document.createElement('div');Object.defineProperties(el,{clientWidth:{value:300},clientHeight:{value:200},scrollWidth:{value:900},scrollHeight:{value:800}});el.getBoundingClientRect=()=>({left:0,top:0,right:300,bottom:200,width:300,height:200} as DOMRect);
 let pointer={x:axis==='horizontal'?298:150,y:axis==='vertical'?198:100};const changed=vi.fn();const stop=startDragEdgeScroll(el,axis,()=>pointer,changed);
 frame(0);frame(100);frame(200);
 expect(axis==='horizontal'?el.scrollLeft:el.scrollTop).toBeGreaterThan(0);expect(changed).toHaveBeenCalled();
 const before=axis==='horizontal'?el.scrollLeft:el.scrollTop;pointer={x:150,y:100};frame(300);expect(axis==='horizontal'?el.scrollLeft:el.scrollTop).toBe(before);
 stop();frame(400);expect(cancelAnimationFrame).toHaveBeenCalled();vi.unstubAllGlobals();
});
it('scrolls backward, clamps at the boundary, and ignores pointers outside the strip',()=>{
 let frame:FrameRequestCallback=()=>{};vi.stubGlobal('requestAnimationFrame',vi.fn(fn=>{frame=fn;return 1;}));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const el=document.createElement('div');Object.defineProperties(el,{clientWidth:{value:300},scrollWidth:{value:600}});el.getBoundingClientRect=()=>({left:0,right:300,top:0,bottom:200} as DOMRect);el.scrollLeft=5;
 let p={x:0,y:100};const stop=startDragEdgeScroll(el,'horizontal',()=>p,vi.fn());frame(0);frame(32);expect(el.scrollLeft).toBe(0);
 el.scrollLeft=100;p={x:299,y:250};frame(64);expect(el.scrollLeft).toBe(100);
 stop();vi.unstubAllGlobals();
});
