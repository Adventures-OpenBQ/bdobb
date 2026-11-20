// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from "vitest";
import {buildLinkedSurface, type SurfaceDataset} from "./linkedSurface";
const base: SurfaceDataset = {
  columns: [{id:"pair",label:"Pair"},{id:"date",label:"Date"},{id:"strike",label:"Strike",dtype:"number"},{id:"1M",label:"1M",dtype:"number"},{id:"3M",label:"3M",dtype:"number"}],
  rows: [{pair:"EURUSD",date:"2026-10-08",strike:100,"1M":10,"3M":20},{pair:"EURUSD",date:"2026-10-08",strike:110,"1M":null,"3M":22}],
};
const settings = {type:"surface" as const,category:"strike",measures:["3M","1M"]};
describe("V3 existing FX linked surface port",()=>{
  it("retains strike coordinates, expiry-column order and missing cells",()=>{
    const r=buildLinkedSurface(base,settings,"dark");expect(r.ok).toBe(true);if(!r.ok)return;
    expect(r.figure.data).toHaveLength(1);expect(r.figure.data[0]).toMatchObject({type:"surface",x:[100,110],y:[0,1],z:[[10,null],[20,22]]});
    expect(r.figure.layout).toMatchObject({scene:{yaxis:{ticktext:["1M","3M"]}},coloraxis:{colorscale:"Viridis"}});
  });
  it("splits pair/date scopes with one shared colour scale",()=>{
    const r=buildLinkedSurface({...base,rows:[...base.rows,...base.rows.map(x=>({...x,pair:"USDJPY"}))]},settings,"light");expect(r.ok).toBe(true);if(!r.ok)return;
    expect(r.figure.data).toHaveLength(2);expect(r.figure.data.map(x=>x.coloraxis)).toEqual(["coloraxis","coloraxis"]);
  });
  it("draws one expiry as a line rather than a degenerate mesh",()=>{
    const r=buildLinkedSurface(base,{...settings,measures:["1M"]},"dark");expect(r.ok).toBe(true);if(!r.ok)return;
    expect(r.figure.data[0]).toMatchObject({type:"scatter",x:[100,110],y:[10,null],connectgaps:false});
  });
  it("refuses more than six groups and undersized plots",()=>{
    const rows=Array.from({length:7},(_,i)=>base.rows.map(x=>({...x,pair:`PAIR${i}`}))).flat();
    expect(buildLinkedSurface({...base,rows},settings,"dark")).toMatchObject({ok:false,refused:true});
    expect(buildLinkedSurface({...base,rows:base.rows.slice(0,1)},settings,"dark")).toMatchObject({ok:false,refused:true});
  });
  it("makes an empty successful source explicit",()=>{
    expect(buildLinkedSurface({...base,rows:[]},settings,"dark")).toMatchObject({ok:false,message:expect.stringMatching(/no rows/i)});
  });
  it("rejects unavailable, duplicate and non-numeric fields",()=>{
    for(const measures of [["missing"],["1M","1M"],["pair"]])expect(buildLinkedSurface(base,{...settings,measures},"dark").ok).toBe(false);
    expect(buildLinkedSurface({...base,rows:base.rows.map(x=>({...x,"1M":"10"}))},settings,"dark").ok).toBe(false);
  });
  it("does not merge distinct group values whose display labels coincide",()=>{
    const rows=[...base.rows.map(x=>({...x,pair:"a — b",date:"c"})),...base.rows.map(x=>({...x,pair:"a",date:"b — c"}))];
    const r=buildLinkedSurface({...base,rows},settings,"dark");expect(r.ok).toBe(true);if(r.ok)expect(r.figure.data).toHaveLength(2);
  });
  it("rejects nonfinite strike coordinates",()=>{
    expect(buildLinkedSurface({...base,rows:base.rows.map(x=>({...x,strike:NaN}))},settings,"dark").ok).toBe(false);
  });
});
