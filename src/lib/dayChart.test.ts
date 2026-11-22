// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { daySymbols, parseDayCharts, dayLine } from "./dayChart";
import { normalizeWidgets } from "./widgetsJson";
import { fetchesData } from "./builtins";
import { effectiveParams } from "./paramGroups";
import { exportApp, importApps } from "./appsJson";
import { widget } from "../test/fixtures";
import { RENDERED_TYPES } from "./widgetTypes";

describe("Day Chart contract", () => {
  it("retains normalized positional duplicates and explicit blank, with a hard 50-entry limit", () => {
    expect(daySymbols(" aapl, MSFT,,aapl ")).toEqual(["AAPL", "MSFT", "AAPL"]);
    expect(daySymbols("")).toEqual([]);
    expect(() => daySymbols(Array(51).fill("AAPL").join(","))).toThrow(/50/);
  });
  it("recognizes a self-fetching Day Chart manifest", () => {
    const w = normalizeWidgets({ dc: { name: "Day Chart", type: "day_chart", endpoint: "day_charts" } }, "b").widgets[0];
    expect(RENDERED_TYPES.has(w.type)).toBe(true);
    expect(fetchesData(w)).toBe(false);
  });
  it("isolates malformed tiles, rejects foreign schema, and never plots null values as zero", () => {
    const tiles = parseDayCharts({ schema_version: 1, tiles: [
      { symbol: "AAPL", status: "partial", session: { date: "2026-11-20", timezone: "America/New_York", label: "Regular", status: "closed" }, price: 12, previous_close: 10, points: [{ time: "2026-11-20T14:30:00Z", value: 11 }, { time: "2026-11-20T14:31:00Z", value: null }, { time: "2026-11-20T14:32:00Z", value: 12 }] },
      { symbol: "MSFT", points: "bad" },
    ] });
    expect(tiles.AAPL.points).toHaveLength(3);
    expect(tiles.MSFT.status).toBe("error");
    expect(dayLine(tiles.AAPL.points, 10).path.match(/M/g)).toHaveLength(2);
    expect(() => parseDayCharts({ schema_version: 2, tiles: [] })).toThrow(/schema/);
  });
});

it("normalizes US aliases to one acquisition identity without removing duplicate positions", () => {
  expect(daySymbols("AAPL,aapl.US, MSFT.us")).toEqual(["AAPL","AAPL","MSFT"]);
});

it("uses the existing group binding for lists, updates, blank, disable/deletion and portable persistence", () => {
  const w=widget({id:"day_chart",type:"day_chart",params:[{paramName:"symbol",type:"text",multiSelect:true,groupType:"symbol"}]});
  const app={name:"Day watchlist",tabs:{day:{name:"Day",layout:[{i:"day_chart",x:0,y:0,w:40,h:12,groups:["Watchlist"],state:{params:{symbol:"NVDA"}}}]}},groups:[{name:"Watchlist",type:"param",paramName:"symbol",defaultValue:"aapl.US,MSFT,aapl"}]};
  const dashboard=importApps([app],[w]).dashboards[0];
  const card=dashboard.tabs[0].cards[0];
  const resolve=()=>daySymbols(effectiveParams(card,dashboard.groups,w).symbol);
  expect(resolve()).toEqual(["AAPL","MSFT","AAPL"]);
  const roundtrip=importApps([exportApp(JSON.parse(JSON.stringify(dashboard)))],[w]).dashboards[0];
  expect(daySymbols(effectiveParams(roundtrip.tabs[0].cards[0],roundtrip.groups,w).symbol)).toEqual(["AAPL","MSFT","AAPL"]);
  dashboard.groups![0].value="TSLA";
  expect(resolve()).toEqual(["TSLA"]);
  dashboard.groups![0].value="";
  expect(resolve()).toEqual([]);
  expect(effectiveParams(card,dashboard.groups,w,true).symbol).toBe("NVDA");
  dashboard.groups=[];
  expect(resolve()).toEqual(["NVDA"]);
});

it("uses feed-qualified crypto and forex identities for honest unsupported tiles",()=>{
  expect(daySymbols("BTC-USD.CC,EURUSD.FOREX,EURUSD.US,AAPL.LSE")).toEqual(["BTC-USD","EURUSD","EURUSD.US","AAPL.LSE"]);
});

it("chooses scroll direction without discarding symbols beyond a fitted grid", async()=>{
 const {dayLayout}=await import("./dayChart");
 expect(dayLayout("1","",9)).toMatchObject({axis:"horizontal",rows:1,columns:null});
 expect(dayLayout("","1",9)).toMatchObject({axis:"vertical",rows:null,columns:1});
 expect(dayLayout("2","3",9)).toMatchObject({axis:"vertical",rows:2,columns:3});
 expect(dayLayout("","",9)).toMatchObject({axis:"horizontal",rows:1});
 expect(()=>dayLayout("0","",9)).toThrow();
 expect(()=>dayLayout("1.5","",9)).toThrow();
 expect(()=>dayLayout("","11",9)).toThrow();
});
it("percent scale uses previous close, preserves gaps and rejects absent/zero baselines", async()=>{
 const {dayScale}=await import("./dayChart");
 const points=[{time:"2026-11-20T14:30:00Z",value:110},{time:"2026-11-20T14:31:00Z",value:null}];
 expect(dayScale(points,100,"percent")).toEqual({points:[{...points[0],value:10},{...points[1]}],reference:0,available:true});
 expect(dayScale(points,0,"percent").available).toBe(false);
 expect(dayScale(points,null,"percent").available).toBe(false);
 expect(dayScale(points,100,"price").points).toEqual(points);
});
it("compresses overnight gaps and marks the boundary between trading sessions",()=>{
 const sessions=[{opened:"2026-11-19T14:30:00Z",closed:"2026-11-19T21:00:00Z"},{opened:"2026-11-20T14:30:00Z",closed:"2026-11-20T21:00:00Z"}];
 const line=dayLine([{time:sessions[0].opened,value:100},{time:"2026-11-19T20:59:00Z",value:101},{time:sessions[1].opened,value:102}],100,sessions);
 expect(line.dividers).toEqual([137]);
 expect(line.path.match(/M/g)).toHaveLength(2);
});
