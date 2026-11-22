// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DayChartRenderer } from "./DayChartRenderer";
import { fetchEndpoint } from "../../lib/dataClient";
import type { BackendConfig } from "../../lib/types";
vi.mock("../../lib/dataClient", async (original) => ({...await original<typeof import("../../lib/dataClient")>(), fetchEndpoint:vi.fn()}));
const backend = {id:"b",name:"b",baseUrl:"https://host/backend"} as BackendConfig;
const tile = (symbol:string) => ({symbol,name:`${symbol} Company`,logo_path:null,session:{date:"2026-11-20",timezone:"America/New_York",label:"Regular session",status:"closed"},price:102,change:2,change_percent:2,previous_close:100,points:[{time:"2026-11-20T14:30:00Z",value:100},{time:"2026-11-20T14:31:00Z",value:102}],status:"ok",source:"eodhd"});
let intersect: IntersectionObserverCallback;
let resize: ResizeObserverCallback;
const disconnect=vi.fn();
beforeEach(() => {
  vi.mocked(fetchEndpoint).mockReset().mockImplementation(async (_b,_p,params) => ({schema_version:1,tiles:params.symbol.split(",").map(tile)}));
  vi.stubGlobal("IntersectionObserver", class { constructor(cb:IntersectionObserverCallback) {intersect=cb;} observe(){} disconnect=disconnect; });
  vi.stubGlobal("ResizeObserver", class { constructor(cb:ResizeObserverCallback){resize=cb;} observe(){} disconnect(){} });
});
afterEach(() => vi.unstubAllGlobals());
it("renders duplicate positions with real lines/session basis and initials; loads only nearby entries", async () => {
  const symbols = ["AAPL","MSFT","AAPL",...Array.from({length:30},(_,i)=>`S${i}`)].join(",");
  const {container} = render(<DayChartRenderer backend={backend} params={{symbol:symbols}} />);
  await waitFor(() => expect(container.querySelectorAll(".day-chart-price")).toHaveLength(3));
  expect(screen.getAllByText("AAPL Company")).toHaveLength(2);
  expect(screen.getAllByText(/2026-11-20.*closed/)).toHaveLength(3);
  expect(screen.getAllByRole("img",{name:/intraday prices/})).toHaveLength(3);
  expect(vi.mocked(fetchEndpoint).mock.calls[0][2]).toEqual({symbol:"AAPL,MSFT"});
  const cards=container.querySelectorAll("[data-day-index]");
  act(() => intersect(Array.from(cards, (target,i) => ({target,isIntersecting:i===32})) as IntersectionObserverEntry[], {} as IntersectionObserver));
  await waitFor(() => expect(vi.mocked(fetchEndpoint).mock.lastCall?.[2]).toEqual({symbol:"S29"}));
  act(() => resize([],{} as ResizeObserver));
  expect(container.querySelectorAll("[data-day-index]")).toHaveLength(33);
});
it("supports manual wheel/buttons and per-tile failures while explicit blank clears", async () => {
  vi.mocked(fetchEndpoint).mockResolvedValue({schema_version:1,tiles:[tile("AAPL"),{...tile("BAD"),status:"error",points:[],error_code:"unsupported_symbol"}]});
  const {container,rerender}=render(<DayChartRenderer backend={backend} params={{symbol:"AAPL,BAD"}}/>);
  await waitFor(() => expect(screen.getByText("No day data · unsupported_symbol")).toBeInTheDocument());
  const strip=container.querySelector(".day-chart-strip") as HTMLElement;
  fireEvent.wheel(strip,{deltaY:100,deltaX:0});
  expect(strip.scrollLeft).toBe(100);
  fireEvent.click(screen.getByRole("button",{name:"Beginning"}));
  expect(strip.scrollLeft).toBe(0);
  rerender(<DayChartRenderer backend={backend} params={{symbol:""}}/>);
  expect(screen.getByText("Choose symbols to chart.")).toBeInTheDocument();
  expect(screen.queryByText("102.00")).not.toBeInTheDocument();
});

it("draws a visible marker for a one-bar session",async()=>{
  vi.mocked(fetchEndpoint).mockResolvedValue({schema_version:1,tiles:[{...tile("AAPL"),points:tile("AAPL").points.slice(0,1)}]});
  const {container}=render(<DayChartRenderer backend={backend} params={{symbol:"AAPL.US"}}/>);
  await waitFor(()=>expect(container.querySelector("svg circle")).not.toBeNull());
  expect(vi.mocked(fetchEndpoint).mock.calls[0][2]).toEqual({symbol:"AAPL"});
});
