// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { IPrimitivePaneRenderer, SeriesAttachedParameter } from 'lightweight-charts';
import { CandleWicks } from './candleWicks';

const bar = {time:1,open:10,high:30,low:5,close:20,volume:1};
function fixture({ratio=1,spacing=6,visible=true,range={from:0,to:0}}={}) {
  const fills: Array<{color:string;x:number;y:number;width:number;height:number}> = [];
  const context = {fillStyle:'',save() {},restore() {},fillRect(x:number,y:number,width:number,height:number) { fills.push({color:this.fillStyle,x,y,width,height}); }};
  const target = {useBitmapCoordinateSpace(callback:(scope:unknown)=>void) {callback({context,horizontalPixelRatio:ratio,verticalPixelRatio:ratio,bitmapSize:{width:400,height:400}});}} as unknown as Parameters<IPrimitivePaneRenderer['draw']>[0];
  const series = {priceToCoordinate:vi.fn((price:number)=>100-price),options:()=>({wickVisible:visible,wickUpColor:'#1a2',wickDownColor:'#b34'})};
  const chart = {timeScale:()=>({getVisibleLogicalRange:()=>range,logicalToCoordinate:(index:number)=>10+(index-range.from)*spacing,options:()=>({barSpacing:spacing})})};
  const requestUpdate=vi.fn();
  const primitive=new CandleWicks(2);
  primitive.attached({chart,series,requestUpdate} as unknown as SeriesAttachedParameter);
  primitive.setBars([bar]);
  return {primitive,target,fills,series,requestUpdate};
}
describe('candle wick primitive',()=>{
  it.each([1,2])('draws crisp 2 CSS pixel upper and lower wicks without covering the body at ratio %s',ratio=>{
    const {primitive,target,fills}=fixture({ratio});
    primitive.paneViews()[0].renderer()!.draw(target);
    expect(fills).toEqual([
      {color:'#1a2',x:9*ratio,y:70*ratio,width:2*ratio,height:10*ratio},
      {color:'#1a2',x:9*ratio,y:90*ratio,width:2*ratio,height:5*ratio},
    ]);
    expect(primitive.paneViews()[0].zOrder?.()).toBe('bottom');
  });
  it('keeps the wick within available bar spacing when zoomed out',()=>{
    const {primitive,target,fills}=fixture({ratio:2,spacing:0.75});
    primitive.paneViews()[0].renderer()!.draw(target);
    expect(fills).toHaveLength(2);
    expect(fills.every(rect=>rect.width===1&&Number.isInteger(rect.x))).toBe(true);
  });
  it('honors hidden wicks and preserves custom downward wick colors',()=>{
    const hidden=fixture({visible:false});
    hidden.primitive.paneViews()[0].renderer()!.draw(hidden.target);
    expect(hidden.fills).toEqual([]);
    const down=fixture();
    down.primitive.setBars([{...bar,open:20,close:10}]);
    down.primitive.paneViews()[0].renderer()!.draw(down.target);
    expect(down.fills.map(rect=>rect.color)).toEqual(['#b34','#b34']);
  });
  it('projects only visible candles plus edge neighbors and stops drawing after detach',()=>{
    const {primitive,target,fills,series,requestUpdate}=fixture({range:{from:100,to:102}});
    primitive.setBars(Array.from({length:2000},(_,n)=>({...bar,time:n+1})));
    primitive.paneViews()[0].renderer()!.draw(target);
    expect(series.priceToCoordinate.mock.calls.length).toBeLessThanOrEqual(5*4);
    expect(fills).toHaveLength(10);
    primitive.detached();
    fills.length=0;requestUpdate.mockClear();
    primitive.setBars([bar]);
    primitive.paneViews()[0].renderer()!.draw(target);
    expect(fills).toEqual([]);
    expect(requestUpdate).not.toHaveBeenCalled();
  });
});
