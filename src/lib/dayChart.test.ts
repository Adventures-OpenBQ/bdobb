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
