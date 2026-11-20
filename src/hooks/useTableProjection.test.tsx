// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {renderHook} from "@testing-library/react";
import {describe,expect,it} from "vitest";
import type {TableSpec} from "../lib/types";
import {buildLinkedSurface} from "../lib/linkedSurface";
import {useTableProjection} from "./useTableProjection";
describe("linked source uses the table's actual projection",()=>{
  it("keeps complete filtered/sorted rows rather than a virtualized window",()=>{
    const rows=Array.from({length:2000},(_,n)=>({n}));
    const spec:TableSpec={columns:[{field:"n",cellDataType:"number",chartDataType:"series"}]};
    const {result}=renderHook(()=>useTableProjection(rows,spec,{sorting:[{id:"n",desc:true}],columnFilters:[{id:"n",value:{min:100}}]},true));
    expect(result.current.rows).toHaveLength(1900);expect(result.current.rows[0].n).toBe(1999);expect(result.current.rows.at(-1)?.n).toBe(100);expect(rows[0].n).toBe(0);
    expect(result.current.columns[0]).toMatchObject({id:"n",dtype:"number",chartDataType:"series"});
  });
  it("uses literal dotted keys and sorts null last in both directions",()=>{
    const rows=[{"BRK.B":null},{"BRK.B":5},{"BRK.B":-2}];
    const spec:TableSpec={columns:[{field:"BRK.B",cellDataType:"number"}]};
    for(const desc of [false,true]){
      const {result,unmount}=renderHook(()=>useTableProjection(rows,spec,{sorting:[{id:"BRK.B",desc}]},true));
      expect(result.current.rows.map(r=>r["BRK.B"])).toEqual(desc?[5,-2,null]:[-2,5,null]);unmount();
    }
  });
  it("filters the displayed hover-cell scalar, preserving the original record",()=>{
    const rows=[{price:{value:4,note:"a"}},{price:{value:12,note:"b"}}];
    const spec:TableSpec={columns:[{field:"price",cellDataType:"number",renderFn:["hoverCard"],renderFnParams:{hoverCard:{cellField:"value",markdown:"{value}"}}}]};
    const {result}=renderHook(()=>useTableProjection(rows,spec,{columnFilters:[{id:"price",value:{min:10}}]},true));
    expect(result.current.rows).toEqual([{price:12}]);expect(rows[1].price).toEqual({value:12,note:"b"});
  });
  it("does not project unreferenced source data",()=>{
    const {result}=renderHook(()=>useTableProjection([{n:1}],undefined,undefined,false));
    expect(result.current.rows).toEqual([]);expect(result.current.columns).toEqual([]);
  });
});
it("retains schema-declared absent tenors as null gaps without adding visible table columns",()=>{
 const rows=[{strike:90,vol_1m:5},{strike:100,vol_1m:6}];
 const spec:TableSpec={columns:[{field:"strike",cellDataType:"number",chartDataType:"category"},{field:"vol_1m",headerName:"1M",cellDataType:"number",chartDataType:"series"},{field:"vol_2y",headerName:"2Y",cellDataType:"number",chartDataType:"series"}]};
 const {result}=renderHook(()=>useTableProjection(rows,spec,undefined,true));
 expect(result.current.columns.find(c=>c.id==="vol_2y")).toMatchObject({label:"2Y",dtype:"number",chartDataType:"series"});
 const surface=buildLinkedSurface(result.current,{type:"surface",category:"strike",measures:["vol_1m","vol_2y"]},"dark");expect(surface.ok).toBe(true);if(surface.ok)expect(surface.figure.data[0].z).toEqual([[5,6],[null,null]]);
});
