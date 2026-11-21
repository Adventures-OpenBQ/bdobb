// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invoke, owned } = vi.hoisted(() => ({ invoke: vi.fn(), owned: { open: vi.fn(), close: vi.fn(), isOpen: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args), isTauri: () => true }));
vi.mock("../../lib/youtubePip", () => ({ desktopVideoPipAvailable: () => true, openYoutubePip: owned.open, closeYoutubePip: owned.close, youtubePipIsOpen: owned.isOpen }));
import { RELEASE_GRACE_MS } from "../../lib/pictureInPicture";
import { makeDefaultDocks } from "../../lib/dashboardsFile";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { card, widget } from "../../test/fixtures";
import { YouTubeRenderer } from "./YouTubeRenderer";

const marker = "bdobb:picture-in-picture";
const url = "https://youtu.be/uYyhswnZkSw";
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

it("keeps the explicit iPadOS limitation instead of invoking another app's player", () => {
  vi.stubEnv("TAURI_ENV_PLATFORM", "ios");
  render(<YouTubeRenderer data={marker} cardId="grab" />);
  expect(screen.getByText("Park a picture-in-picture video here")).toBeInTheDocument();
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
