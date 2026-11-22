// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invoke, owned } = vi.hoisted(() => ({ invoke: vi.fn(), owned: { open: vi.fn(), close: vi.fn(), isOpen: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args), isTauri: () => true }));
vi.mock("../../lib/youtubePip", () => ({ desktopVideoPipAvailable: () => ["darwin","windows"].includes(import.meta.env.TAURI_ENV_PLATFORM??""), openYoutubePip: owned.open, closeYoutubePip: owned.close, youtubePipIsOpen: owned.isOpen }));
import userEvent from "@testing-library/user-event";
import { enqueuePlayerOp, RELEASE_GRACE_MS } from "../../lib/pictureInPicture";
import { makeDefaultDocks } from "../../lib/dashboardsFile";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { card, widget } from "../../test/fixtures";
import { YouTubeRenderer } from "./YouTubeRenderer";

const marker = "bdobb:picture-in-picture";
const url = "https://youtu.be/uYyhswnZkSw";

it("uses captured-player audio without changing the saved YouTube preference", async () => {
  const host = document.createElement("span"); document.body.appendChild(host);
  const save = vi.fn(async () => {});
  invoke.mockImplementation(async (command: string, args?: {toggle?: boolean}) => {
    if (command === "picture_in_picture_captured_audio") return args?.toggle ? {state: "muted"} : {state: "unavailable", reason: "Controls hidden"};
    return {state: "fitted"};
  });
  const view = render(<YouTubeRenderer data={marker} cardId="grab" rowZeroHost={host} onSettingsChange={save} settings={{display: "inline", autoplay: false, muted: false}} readOnly />);
  try {
    const button = await screen.findByRole("button", {name: "Toggle captured audio"});
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(await screen.findByRole("button", {name: "Unmute"})).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  } finally { view.unmount(); host.remove(); }
});

it("does not offer native captured audio to a viewer window", async () => {
  const host = document.createElement("span"); document.body.appendChild(host);
  const view = render(<YouTubeRenderer data={marker} cardId="grab" rowZeroHost={host} viewer />);
  try {
    expect(host.querySelector("button")).toBeNull();
  } finally { view.unmount(); host.remove(); }
});

it.each(["menu", "unmount"])("cancels queued audio before %s can hide its captured player", async transition => {
  const host = document.createElement("span"); document.body.appendChild(host);
  const view = render(<YouTubeRenderer data={marker} cardId="grab" rowZeroHost={host} />);
  let finish!: () => void;
  try {
    await waitFor(() => expect(screen.getByRole("button", {name: "Toggle captured audio"})).toBeEnabled());
    const predecessor = enqueuePlayerOp("grab", () => new Promise<void>(resolve => { finish = resolve; }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await userEvent.click(screen.getByRole("button", {name: "Toggle captured audio"}));
    if (transition === "menu") view.rerender(<YouTubeRenderer data={marker} cardId="grab" rowZeroHost={host} menuOpen />);
    else view.unmount();
    await act(async () => { finish(); await predecessor; await enqueuePlayerOp("grab", async () => {}); });
    expect(invoke.mock.calls.filter(([command, args]) => command === "picture_in_picture_captured_audio" && args?.toggle)).toEqual([]);
  } finally { finish?.(); view.unmount(); host.remove(); }
});
beforeEach(() => {
  vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
  invoke.mockImplementation(async (command: string) => command === "video_wrapper_port" ? 41234 : { state: "no_player" });
  owned.open.mockReset().mockResolvedValue(true);
  owned.close.mockReset().mockResolvedValue(undefined);
  owned.isOpen.mockReset().mockResolvedValue(true);
  useWidgetRegistryStore.setState({ widgets: [widget({ id: "live_tv", type: "youtube", params: [{ paramName: "channel", type: "text", value: "bloomberg-tv" }] })] });
  useDashboardStore.setState({ dashboards: [{ id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [card({ id: "grab", widgetId: "live_tv", params: { channel: "picture-in-picture" } })] }] }], docks: makeDefaultDocks(), activeId: "d", activeTabId: "t", viewer: false });
});
afterEach(async () => {
  cleanup();
  useDashboardStore.setState({ dashboards: [], docks: makeDefaultDocks() });
  await new Promise(resolve => setTimeout(resolve, RELEASE_GRACE_MS + 30));
  invoke.mockReset();
  vi.unstubAllEnvs();
});

it("uses the real Chrome grab renderer for the exact local marker, without a YouTube frame", async () => {
  render(<YouTubeRenderer data={marker} cardId="grab" />);
  expect(await screen.findByText("Pop the video out in Chrome")).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("picture_in_picture_fit", expect.objectContaining({ card: "grab" }));
  expect(invoke.mock.calls.map(([command]) => command)).not.toContain("video_wrapper_port");
  expect(screen.queryByTitle("YouTube video")).toBeNull();
});

it("does not interpret a marker with an appended URL as a grab request", () => {
  render(<YouTubeRenderer data={`${marker}?url=https://example.invalid`} cardId="grab" />);
  expect(screen.getByText("No video is currently available for the selected source.")).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps the explicit iPadOS limitation instead of invoking another app's player", async () => {
  vi.stubEnv("TAURI_ENV_PLATFORM", "ios");
  render(<YouTubeRenderer data={marker} cardId="grab" />);
  expect(await screen.findByText(/iPadOS cannot move Chrome/)).toHaveTextContent(/YouTube.*inline/);
  expect(invoke).not.toHaveBeenCalled();
});

it("waits for its outgoing player to close before grabbing Chrome's player", async () => {
  const prefs = { display: "pip" as const, autoplay: false, muted: false };
  const view = render(<YouTubeRenderer data={url} cardId="grab" settings={prefs} />);
  await waitFor(() => expect(owned.open).toHaveBeenCalled());
  let finish!: () => void;
  owned.close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  view.rerender(<YouTubeRenderer data={marker} cardId="grab" settings={prefs} />);
  await waitFor(() => expect(owned.close).toHaveBeenCalledWith("grab"));
  expect(invoke.mock.calls.some(([command]) => command === "picture_in_picture_fit")).toBe(false);
  finish();
  expect(await screen.findByText("Pop the video out in Chrome")).toBeInTheDocument();
});

it("releases Chrome when the source changes even if the replacement never renders", async () => {
  const view = render(<YouTubeRenderer data={marker} cardId="grab" />);
  await screen.findByText("Pop the video out in Chrome");
  await act(() => useDashboardStore.getState().applyCardParams("grab", { cardParams: { channel: "yahoo-finance" }, groupEdits: [] }));
  view.unmount(); // The replacement request may fail or stay loading.
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("picture_in_picture_release", { card: "grab" }));
});

it("releases a parked grab when its source is changed on a hidden tab", async () => {
  const view = render(<YouTubeRenderer data={marker} cardId="grab" />);
  await screen.findByText("Pop the video out in Chrome");
  view.unmount();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("picture_in_picture_park", { card: "grab", menu: false }));
  await act(() => useDashboardStore.getState().applyCardParams("grab", { cardParams: { channel: "bloomberg-tv" }, groupEdits: [] }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("picture_in_picture_release", { card: "grab" }));
});

it("keeps a locked band's stored height while fitting the grabbed player", async () => {
  const grabbed = useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
  grabbed.layout = { ...grabbed.layout, h: 4 };
  const docks = makeDefaultDocks();
  docks.tabs[0].cards = [grabbed];
  useDashboardStore.setState({ dashboards: [], docks });
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, left: 0, top: 0, width: 640, height: this.classList.contains("widget-card") ? 300 : 200, right: 640, bottom: 300, toJSON: () => ({}) };
  });
  try {
    const view = render(<div className="widget-card"><YouTubeRenderer data={marker} cardId="grab" readOnly /></div>);
    await screen.findByText("Pop the video out in Chrome");
    await act(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(useDashboardStore.getState().docks.tabs[0].cards[0].layout.h).toBe(4);
    view.unmount();
  } finally { geometry.mockRestore(); }
});

it("parks the grabbed player while the card menu is open and refits after closing", async () => {
  const view = render(<YouTubeRenderer data={marker} cardId="grab" menuOpen />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("picture_in_picture_park", { card: "grab", menu: true }));
  expect(invoke.mock.calls.some(([command]) => command === "picture_in_picture_fit")).toBe(false);
  view.rerender(<YouTubeRenderer data={marker} cardId="grab" menuOpen={false} />);
  expect(await screen.findByText("Pop the video out in Chrome")).toBeInTheDocument();
});

it("fits the incoming Chrome player on Windows instead of a platform placeholder", async () => {
  vi.stubEnv("TAURI_ENV_PLATFORM", "windows");
  render(<YouTubeRenderer data={marker} cardId="grab" />);
  expect(await screen.findByText("Pop the video out in Chrome")).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("picture_in_picture_fit", expect.objectContaining({ card: "grab" }));
});

it("does not mount a grab from a backend marker when another source is selected", async () => {
  useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:t.cards.map(c=>({...c,params:{channel:'bloomberg-tv'}}))}))}))}));
  const view=render(<YouTubeRenderer data={marker} cardId="grab" />);
  expect(await screen.findByText("No video is currently available for the selected source.")).toBeInTheDocument();
  expect(view.container.querySelector('.picture-in-picture')).toBeNull();
  expect(invoke.mock.calls.some(([c])=>c==='picture_in_picture_fit')).toBe(false);
});
it("does not treat a remote manifest's grab default as a local source selection",async()=>{
  useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,tabs:d.tabs.map(t=>({...t,cards:t.cards.map(c=>({...c,params:{}}))}))}))}));
  useWidgetRegistryStore.setState({widgets:[widget({id:'live_tv',type:'youtube',params:[{paramName:'channel',value:'picture-in-picture'}]})]});
  const view=render(<YouTubeRenderer data={marker} cardId="grab" />);
  expect(await screen.findByText("No video is currently available for the selected source.")).toBeInTheDocument();
  expect(view.container.querySelector('.picture-in-picture')).toBeNull();
  expect(invoke.mock.calls.some(([c])=>c==='picture_in_picture_fit')).toBe(false);
});
it("parks Chrome while a row-zero native dropdown is in use and refits after it closes",async()=>{
  render(<><select aria-label="Channel"><option>One</option><option>Two</option></select><YouTubeRenderer data={marker} cardId="grab"/></>);
  await screen.findByText("Pop the video out in Chrome");invoke.mockClear();
  await userEvent.click(screen.getByRole('combobox',{name:'Channel'}));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('picture_in_picture_park',{card:'grab',menu:true}));
  invoke.mockClear();await userEvent.selectOptions(screen.getByRole('combobox',{name:'Channel'}),'Two');
  await waitFor(()=>expect(invoke.mock.calls.some(([c])=>c==='picture_in_picture_fit')).toBe(true));
});

it("honours an explicit local channel group and releases when that group changes",async()=>{
  useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,groups:[{id:'channels',name:'Sources',paramName:'channel',groupType:'channel',value:'picture-in-picture'}],tabs:d.tabs.map(t=>({...t,cards:t.cards.map(c=>({...c,params:{},bindings:[{paramName:'channel',groupId:'channels'}]}))}))}))}));
  render(<YouTubeRenderer data={marker} cardId="grab"/>);
  await screen.findByText("Pop the video out in Chrome");invoke.mockClear();
  await act(()=>useDashboardStore.setState(s=>({dashboards:s.dashboards.map(d=>({...d,groups:d.groups?.map(g=>({...g,value:'bloomberg-tv'}))}))})));
  await waitFor(()=>expect(invoke).toHaveBeenCalledWith('picture_in_picture_release',{card:'grab'}));
});
