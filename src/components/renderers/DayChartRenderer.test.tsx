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
  expect(screen.getByRole("status")).toHaveTextContent(/2026-11-20.*closed/);
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
it("uses vertical wheel/navigation for a column and refetches when trading days change",async()=>{
 const {container,rerender}=render(<DayChartRenderer backend={backend} params={{symbol:"AAPL,MSFT",rows:"",columns:"1",days:"1"}}/>);
 await waitFor(()=>expect(container.querySelectorAll(".day-chart-price")).toHaveLength(2));
 const strip=screen.getByRole("list",{name:"Day charts"});
 fireEvent.wheel(strip,{deltaY:100});expect(strip.scrollLeft).toBe(0);
 Object.defineProperty(strip,"scrollHeight",{value:1000,configurable:true});
 fireEvent.click(screen.getByRole("button",{name:"End"}));expect(strip.scrollTop).toBe(1000);
 rerender(<DayChartRenderer backend={backend} params={{symbol:"AAPL,MSFT",rows:"2",columns:"1",days:"2"}}/>);
 await waitFor(()=>expect(vi.mocked(fetchEndpoint).mock.lastCall?.[2]).toEqual({symbol:"AAPL,MSFT",days:"2"}));
});
it("shows percent axes, dividers and a truthful missing-baseline message",async()=>{
 vi.mocked(fetchEndpoint).mockResolvedValue({schema_version:1,tiles:[{...tile("AAPL"),chart_previous_close:100,sessions:[{date:"2026-11-19",previous_close:100,opened:"2026-11-19T14:30:00Z",closed:"2026-11-19T21:00:00Z"},{date:"2026-11-20",previous_close:101,opened:"2026-11-20T14:30:00Z",closed:"2026-11-20T21:00:00Z"}]}]});
 const {container,rerender}=render(<DayChartRenderer backend={backend} params={{symbol:"AAPL",scale:"percent"}}/>);
 await waitFor(()=>expect(container.querySelector(".day-chart-divider")).not.toBeNull());
 expect(screen.getByText("2.00%")).toBeInTheDocument();
 const references=container.querySelectorAll(".day-chart-reference");expect(references).toHaveLength(2);expect(references[0].getAttribute("y1")).not.toBe(references[1].getAttribute("y1"));
 vi.mocked(fetchEndpoint).mockResolvedValue({schema_version:1,tiles:[{...tile("MSFT"),previous_close:null}]});
 rerender(<DayChartRenderer backend={backend} params={{symbol:"MSFT",scale:"percent"}}/>);
 await waitFor(()=>expect(screen.getByText("Previous close unavailable for % scale")).toBeInTheDocument());
});
it("snaps a hover crosshair to a real bar and shows date/time/price/cumulative percent",async()=>{
 const {container}=render(<DayChartRenderer backend={backend} params={{symbol:"AAPL",scale:"percent"}}/>);
 const plot=await screen.findByRole("img",{name:"AAPL intraday prices"});
 vi.spyOn(plot,"getBoundingClientRect").mockReturnValue({left:0,top:0,width:274,height:112,right:274,bottom:112,x:0,y:0,toJSON(){}});
 fireEvent(plot,new MouseEvent("pointermove",{bubbles:true,clientX:270,clientY:50}));
 expect(await screen.findByRole("tooltip")).toHaveTextContent("102.00");
 expect(screen.getByRole("tooltip")).toHaveTextContent("+2.00%");
 expect(screen.getByRole("tooltip")).toHaveTextContent("2026");
 expect(container.querySelectorAll(".day-chart-crosshair")).toHaveLength(2);
 fireEvent.pointerLeave(plot);expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
 fireEvent.focus(plot);fireEvent.keyDown(plot,{key:"End"});expect(screen.getByRole("tooltip")).toHaveTextContent("102.00");
});
it("publishes the clicked tile symbol without changing the watchlist and supports keyboard selection",async()=>{
 const onSelectSymbol=vi.fn();
 render(<DayChartRenderer backend={backend} params={{symbol:"AAPL,MSFT",selected_symbol:"AAPL"}} onSelectSymbol={onSelectSymbol}/>);
 await screen.findByText("MSFT Company");
 const tiles=screen.getAllByRole("listitem");
 fireEvent.click(tiles[1]);expect(onSelectSymbol).toHaveBeenLastCalledWith("MSFT");
 fireEvent.keyDown(tiles[0],{key:"Enter"});expect(onSelectSymbol).toHaveBeenLastCalledWith("AAPL");
 expect(screen.getAllByRole("listitem")).toHaveLength(2);
 expect(tiles[0]).toHaveAttribute("aria-current","true");
});
