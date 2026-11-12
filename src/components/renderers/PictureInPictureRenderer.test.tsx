// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuteState, PipStatus } from "../../lib/pictureInPicture";

const { invoke, tauri } = vi.hoisted(() => ({ invoke: vi.fn(), tauri: { on: true } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
  isTauri: () => tauri.on,
}));

import { RELEASE_GRACE_MS } from "../../lib/pictureInPicture";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useDashboardStore, type GridLayoutItem } from "../../stores/dashboardStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { card as makeCard } from "../../test/fixtures";
import { PictureInPictureMute, PictureInPictureRenderer } from "./PictureInPictureRenderer";

/** Puts a card in the dashboard data (`where` is a dashboard or the docks), or clears it. */
function storeHolds(id: string | null, where: "dashboard" | "docks" = "dashboard") {
  const cards = id === null ? [] : [makeCard({ id })];
  const state = useDashboardStore.getState();
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "T", cards: where === "dashboard" ? cards : [] }] }],
    docks: { ...state.docks, tabs: [{ id: "top", name: "top", cards: where === "docks" ? cards : [] }] },
  });
}

/** An IntersectionObserver the test can drive. */
function stubIntersection() {
  const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  return (isIntersecting: boolean) => callbacks.forEach((cb) => cb([{ isIntersecting }]));
}

/** Answers fit with `fit`, and the mute commands from a slider that starts at `mute`. */
function answer(fit: PipStatus, mute: MuteState = { state: "sound" }) {
  let current = mute;
  invoke.mockImplementation(async (cmd: string, args?: { muted?: boolean }) => {
    if (cmd === "picture_in_picture_fit") return fit;
    if (cmd === "picture_in_picture_mute_state") return current;
    if (cmd === "picture_in_picture_set_muted") {
      current = { state: args?.muted ? "muted" : "sound" };
      return current;
    }
    return undefined;
  });
}

const fitCall = () => expect(invoke).toHaveBeenCalledWith("picture_in_picture_fit", expect.anything());

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  storeHolds(null);
  cleanup();
  // Let the unmount's release (after its grace period) reach the mock before it is reset.
  await new Promise((resolve) => setTimeout(resolve, RELEASE_GRACE_MS + 30));
  vi.unstubAllEnvs();
  tauri.on = true;
  invoke.mockReset();
});

describe("Picture in Picture on the macOS desktop app", () => {
  beforeEach(() => vi.stubEnv("TAURI_ENV_PLATFORM", "darwin"));

  it.each([
    ["no_player", "Pop the video out in Chrome"],
    ["in_use", "The player is in use by another card"],
    ["too_small", "Make this card at least 284 × 160 to park the player here"],
    ["viewer_window", "Open this dashboard in the main window"],
    ["not_supported", "Available in the macOS desktop app"],
  ] as const)("shows %s as its message", async (state, text) => {
    answer({ state });
    render(<PictureInPictureRenderer cardId="c1" />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("sends the body's rectangle and shows nothing once the player is parked", async () => {
    answer({ state: "fitted" });
    const { container } = render(<PictureInPictureRenderer cardId="c1" />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("picture_in_picture_fit", { card: "c1", rect: { x: 0, y: 0, width: 0, height: 0 } }),
    );
    await waitFor(() => expect(container.querySelector(".picture-in-picture")).toHaveAttribute("data-state", "fitted"));
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("sends where the volume slider is only when Mute while hidden is on", async () => {
    answer({ state: "fitted" });
    render(<PictureInPictureRenderer cardId="c1" params={{ muteWhileHidden: "on", source: "Live TV", volumeLabel: "Vol" }} />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("picture_in_picture_fit", {
        card: "c1",
        rect: expect.anything(),
        mute: { source: "Live TV", label: "Vol" },
      }),
    );
    cleanup();
    invoke.mockClear();
    render(<PictureInPictureRenderer cardId="c2" params={{ muteWhileHidden: "off", source: "Live TV" }} />);
    await waitFor(fitCall);
    for (const [cmd, args] of invoke.mock.calls) if (cmd === "picture_in_picture_fit") expect(args).not.toHaveProperty("mute", expect.anything());
  });

  it("fits again with the new setting when Mute while hidden changes", async () => {
    answer({ state: "fitted" });
    const { rerender } = render(<PictureInPictureRenderer cardId="c1" params={{ muteWhileHidden: "off" }} />);
    await waitFor(fitCall);
    invoke.mockClear();
    rerender(<PictureInPictureRenderer cardId="c1" params={{ muteWhileHidden: "on" }} />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("picture_in_picture_fit", expect.objectContaining({ mute: { source: "", label: "Volume Level" } })),
    );
  });

  it("shows a failure with its reason", async () => {
    answer({ state: "failed", reason: "Accessibility refused AXSize (error -25200)" });
    render(<PictureInPictureRenderer cardId="c1" />);
    expect(await screen.findByText("Could not move the player: Accessibility refused AXSize (error -25200)")).toBeInTheDocument();
  });

  it("explains a missing permission and opens the pane on request", async () => {
    answer({ state: "no_permission" });
    render(<PictureInPictureRenderer cardId="c1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Open Accessibility settings" }));
    expect(screen.getByText(/needs Accessibility permission/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("picture_in_picture_open_settings", undefined);
  });

  it("releases the player when the card goes away", async () => {
    answer({ state: "fitted" });
    const { unmount } = render(<PictureInPictureRenderer cardId="c1" />);
    await waitFor(fitCall);
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("picture_in_picture_release", { card: "c1" }));
  });

  it("parks, not releases, when the card is scrolled fully out, and fits again when it is back", async () => {
    answer({ state: "fitted" });
    const scroll = stubIntersection();
    render(<PictureInPictureRenderer cardId="c1" />);
    await waitFor(fitCall);
    scroll(false);
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("picture_in_picture_park", { card: "c1", menu: false }));
    expect(invoke).not.toHaveBeenCalledWith("picture_in_picture_release", expect.anything());
    const fits = () => invoke.mock.calls.filter(([cmd]) => cmd === "picture_in_picture_fit").length;
    const before = fits();
    scroll(true);
    await waitFor(() => expect(fits()).toBe(before + 1));
  });

  it("tries a failed park again on the next recheck, and stops once it worked", async () => {
    let parkAnswer: PipStatus = { state: "failed", reason: "Chrome is not responding; try again in a moment" };
    invoke.mockImplementation(async (cmd: string) => (cmd === "picture_in_picture_park" ? parkAnswer : { state: "fitted" }));
    const scroll = stubIntersection();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    render(<PictureInPictureRenderer cardId="c1" />);
    await vi.advanceTimersByTimeAsync(0);
    scroll(false);
    await vi.advanceTimersByTimeAsync(0);
    const parks = () => invoke.mock.calls.filter(([cmd]) => cmd === "picture_in_picture_park").length;
    expect(parks()).toBe(1);
    parkAnswer = { state: "parked" };
    await vi.advanceTimersByTimeAsync(3000);
    expect(parks()).toBe(2);
    await vi.advanceTimersByTimeAsync(9000);
    expect(parks()).toBe(2);
  });

  it("parks while the card's menu is open and fits again when it closes", async () => {
    answer({ state: "fitted" });
    const { rerender } = render(<PictureInPictureRenderer cardId="c1" menuOpen={false} />);
    await waitFor(fitCall);
    invoke.mockClear();
    rerender(<PictureInPictureRenderer cardId="c1" menuOpen />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("picture_in_picture_park", { card: "c1", menu: true }));
    // Nothing fits, and nothing is released, while the menu is open.
    await new Promise((resolve) => setTimeout(resolve, RELEASE_GRACE_MS + 50));
    expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(["picture_in_picture_park"]);
    rerender(<PictureInPictureRenderer cardId="c1" menuOpen={false} />);
    await waitFor(fitCall);
    expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(["picture_in_picture_park", "picture_in_picture_fit"]);
  });

  it("shows nothing once the player is parked", async () => {
    answer({ state: "parked" });
    const { container } = render(<PictureInPictureRenderer cardId="c1" />);
    await waitFor(() => expect(container.querySelector(".picture-in-picture")).toHaveAttribute("data-state", "parked"));
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("never lets the release overtake a fit still in flight", async () => {
    let finish: (status: PipStatus) => void = () => undefined;
    invoke.mockImplementation((cmd: string) =>
      cmd === "picture_in_picture_fit" ? new Promise<PipStatus>((resolve) => (finish = resolve)) : Promise.resolve(undefined),
    );
    const { unmount } = render(<PictureInPictureRenderer cardId="c1" />);
    await waitFor(fitCall);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalledWith("picture_in_picture_release", expect.anything());
    finish({ state: "fitted" });
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("picture_in_picture_release", { card: "c1" }));
  });

  it("mutes and unmutes through the card's settings", async () => {
    answer({ state: "fitted" });
    render(<PictureInPictureMute params={{ source: "Live TV", volumeLabel: "Volume" }} />);
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Mute"));
    expect(invoke).toHaveBeenCalledWith("picture_in_picture_mute_state", { source: "Live TV", label: "Volume" });
    await userEvent.click(button);
    expect(invoke).toHaveBeenCalledWith("picture_in_picture_set_muted", { source: "Live TV", label: "Volume", muted: true });
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("ignores a second click while the first mute call is in flight", async () => {
    let finish: (state: MuteState) => void = () => undefined;
    invoke.mockImplementation((cmd: string) =>
      cmd === "picture_in_picture_set_muted"
        ? new Promise<MuteState>((resolve) => (finish = resolve))
        : Promise.resolve({ state: "sound" }),
    );
    render(<PictureInPictureMute params={{}} />);
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Mute"));
    button.focus();
    await userEvent.dblClick(button);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "picture_in_picture_set_muted")).toHaveLength(1);
    // aria-disabled, not disabled: the button keeps keyboard focus while the call is in flight.
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    finish({ state: "muted" });
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "false"));
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an unavailable mute with its reason and does nothing on click", async () => {
    answer({ state: "fitted" }, { state: "unavailable", reason: "Select the stream's tab in its window." });
    render(<PictureInPictureMute params={{}} />);
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Select the stream's tab in its window."));
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(invoke).not.toHaveBeenCalledWith("picture_in_picture_set_muted", expect.anything());
  });
});

describe("Picture in Picture remounts", () => {
  beforeEach(() => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    answer({ state: "fitted" });
  });
  const calls = () => invoke.mock.calls.map(([cmd]) => cmd as string);
  const firstFit = () => vi.waitFor(() => expect(calls()).toContain("picture_in_picture_fit"));
  const releases = () => calls().filter((c) => c === "picture_in_picture_release");

  it("does not release when the same card remounts within the grace period", async () => {
    const first = render(<PictureInPictureRenderer cardId="c1" />);
    await firstFit();
    first.unmount();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS - 1);
    render(<PictureInPictureRenderer cardId="c1" />);
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS * 2);
    expect(releases()).toEqual([]);
  });

  it("releases exactly once, only after the grace period, when the card does not come back", async () => {
    const { unmount } = render(<PictureInPictureRenderer cardId="c1" />);
    await firstFit();
    unmount();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS - 1);
    expect(releases()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS * 2);
    expect(releases()).toEqual(["picture_in_picture_release"]);
  });

  it("keeps release-then-fit in order for a card that comes back after the grace period", async () => {
    const first = render(<PictureInPictureRenderer cardId="c2" />);
    await firstFit();
    first.unmount();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    render(<PictureInPictureRenderer cardId="c2" />);
    await vi.waitFor(() => expect(calls()).toEqual(["picture_in_picture_fit", "picture_in_picture_release", "picture_in_picture_fit"]));
  });

  it("parks, not releases, a card that left the screen but is still in the dashboard data", async () => {
    storeHolds("c5");
    const { unmount } = render(<PictureInPictureRenderer cardId="c5" />);
    await firstFit();
    unmount();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith("picture_in_picture_park", { card: "c5", menu: false }));
    expect(releases()).toEqual([]);
    // It comes back (the user returns to the dashboard): a fit, which un-parks.
    render(<PictureInPictureRenderer cardId="c5" />);
    await vi.waitFor(() => expect(calls()).toEqual(["picture_in_picture_fit", "picture_in_picture_park", "picture_in_picture_fit"]));
  });

  it("counts a card in the docks as still existing", async () => {
    storeHolds("c6", "docks");
    const { unmount } = render(<PictureInPictureRenderer cardId="c6" />);
    await firstFit();
    unmount();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    await vi.waitFor(() => expect(calls()).toContain("picture_in_picture_park"));
    expect(releases()).toEqual([]);
  });

  it("releases a parked player when its card is removed from the dashboard data", async () => {
    storeHolds("c7");
    const { unmount } = render(<PictureInPictureRenderer cardId="c7" />);
    await firstFit();
    unmount();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    await vi.waitFor(() => expect(calls()).toContain("picture_in_picture_park"));
    expect(releases()).toEqual([]);
    storeHolds(null);
    await vi.waitFor(() => expect(releases()).toEqual(["picture_in_picture_release"]));
  });

  it("stops watching for removal once the card is back", async () => {
    storeHolds("c8");
    const first = render(<PictureInPictureRenderer cardId="c8" />);
    await firstFit();
    first.unmount();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    await vi.waitFor(() => expect(calls()).toContain("picture_in_picture_park"));
    render(<PictureInPictureRenderer cardId="c8" />);
    storeHolds(null);
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS * 2);
    expect(releases()).toEqual([]);
  });

  it("holds the next mount's fit behind the release, which waits on the old mount's unresolved fit", async () => {
    let finish: (status: PipStatus) => void = () => undefined;
    let first = true;
    invoke.mockImplementation((cmd: string) => {
      if (cmd !== "picture_in_picture_fit") return Promise.resolve(undefined);
      if (!first) return Promise.resolve({ state: "fitted" });
      first = false;
      return new Promise<PipStatus>((resolve) => (finish = resolve));
    });
    const old = render(<PictureInPictureRenderer cardId="c9" />);
    await firstFit();
    old.unmount();
    // The grace period expires while the old mount's fit is still unresolved, and the card remounts.
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    render(<PictureInPictureRenderer cardId="c9" />);
    // Real animation frames, so the new mount has every chance to send its fit.
    for (let i = 0; i < 4; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    await vi.advanceTimersByTimeAsync(10);
    // A queue per mount would already have sent the second fit.
    expect(calls()).toEqual(["picture_in_picture_fit"]);
    finish({ state: "fitted" });
    await vi.waitFor(() => expect(calls()).toEqual(["picture_in_picture_fit", "picture_in_picture_release", "picture_in_picture_fit"]));
  });

  it("only cancels the release of its own card", async () => {
    const first = render(<PictureInPictureRenderer cardId="c3" />);
    await firstFit();
    first.unmount();
    render(<PictureInPictureRenderer cardId="c4" />);
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 1);
    expect(invoke).toHaveBeenCalledWith("picture_in_picture_release", { card: "c3" });
  });
});

describe("Picture in Picture on iPad", () => {
  beforeEach(() => vi.stubEnv("TAURI_ENV_PLATFORM", "ios"));

  it("is a reserved space with the hint, no controller and no mute button", () => {
    render(<PictureInPictureRenderer cardId="c1" />);
    expect(screen.getByText("Park a picture-in-picture video here")).toBeInTheDocument();
    const { container } = render(<PictureInPictureMute params={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Picture in Picture on Windows and in the web preview", () => {
  it.each([
    ["the Windows app", "windows", true],
    ["the web preview", undefined, false],
  ] as const)("shows the placeholder in %s", (_name, platform, inTauri) => {
    if (platform) vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    tauri.on = inTauri;
    render(<PictureInPictureRenderer cardId="c1" />);
    expect(screen.getByText("Available in the macOS desktop app")).toBeInTheDocument();
    const { container } = render(<PictureInPictureMute params={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("the card's height follows its width", () => {
  // 20 px rows, a 10 px gap: h rows are 30h - 10 px tall. The card adds 50 px around the body.
  // A 640 px wide body holds a 640 x 360 player: 50 + 360 = 410 px -> 14 rows.
  const NEEDED = 14;
  const size = { card: { width: 660, height: 600 }, body: { width: 640, height: 550 } };
  const writes: GridLayoutItem[][] = [];
  let rects: { mockRestore: () => void } | undefined;

  /** Puts a card in the dashboard data with a layout; a layout write is recorded and applied. */
  function place(layout: { x: number; y: number; w: number; h: number }, over: Partial<ReturnType<typeof makeCard>> = {}, dockRows?: number, where: "dashboard" | "docks" = "dashboard") {
    const cards = [makeCard({ id: "c1", layout, ...over })];
    const state = useDashboardStore.getState();
    const docked = where === "docks";
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "T", cards: docked ? [] : cards }] }],
      docks: { ...state.docks, ...(dockRows === undefined ? {} : { dockRows: { top: dockRows, bottom: dockRows } }), tabs: [{ id: "top", name: "top", cards: docked ? cards : [] }] },
      updateLayouts: async (layouts) => {
        writes.push(layouts);
        const l = layouts[0];
        const apply = (cs: typeof cards) => cs.map((c) => (c.id === l.i ? { ...c, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : c));
        useDashboardStore.setState((s) => ({
          dashboards: s.dashboards.map((d) => ({ ...d, tabs: d.tabs.map((t) => ({ ...t, cards: apply(t.cards) })) })),
          docks: { ...s.docks, tabs: s.docks.tabs.map((t) => ({ ...t, cards: apply(t.cards) })) },
        }));
      },
    });
  }
  const mounted = (props: { readOnly?: boolean } = {}) => (
    <div className="widget-card">
      <PictureInPictureRenderer cardId="c1" {...props} />
    </div>
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  beforeEach(() => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    writes.length = 0;
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, widgetGap: 10 } });
    answer({ state: "fitted" });
    const rectOf = (box: { width: number; height: number }) => ({ left: 0, top: 0, x: 0, y: 0, right: box.width, bottom: box.height, ...box, toJSON: () => ({}) });
    rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("widget-card")) return rectOf(size.card) as DOMRect;
      if (this.classList.contains("picture-in-picture")) return rectOf(size.body) as DOMRect;
      return rectOf({ width: 0, height: 0 }) as DOMRect;
    });
  });
  afterEach(() => {
    rects?.mockRestore();
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
  });

  it("sets the fewest rows that hold the player when the card mounts too tall, then settles", async () => {
    place({ x: 2, y: 3, w: 20, h: 30 });
    render(mounted());
    await waitFor(() => expect(writes).toEqual([[{ i: "c1", x: 2, y: 3, w: 20, h: NEEDED }]]));
    await settle();
    expect(writes).toHaveLength(1);
  });

  it("follows a change of width", async () => {
    place({ x: 0, y: 0, w: 20, h: NEEDED });
    render(mounted());
    await settle();
    expect(writes).toHaveLength(0);
    size.body = { width: 1000, height: 550 }; // 1000 x 563 player -> 50 + 563 = 613 px -> 21 rows
    useDashboardStore.setState((s) => ({
      dashboards: s.dashboards.map((d) => ({ ...d, tabs: d.tabs.map((t) => ({ ...t, cards: t.cards.map((c) => ({ ...c, layout: { ...c.layout, w: 30 } })) })) })),
    }));
    await waitFor(() => expect(writes).toEqual([[{ i: "c1", x: 0, y: 0, w: 30, h: 21 }]]));
    size.body = { width: 640, height: 550 };
  });

  it("leaves a card alone when only its pixels change", async () => {
    place({ x: 0, y: 0, w: 20, h: NEEDED });
    const { rerender } = render(mounted());
    await settle();
    size.body = { width: 900, height: 700 };
    rerender(mounted());
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(writes).toHaveLength(0);
    size.body = { width: 640, height: 550 };
  });

  it("writes nothing when the height is already right", async () => {
    place({ x: 0, y: 0, w: 20, h: NEEDED });
    render(mounted());
    await settle();
    expect(writes).toHaveLength(0);
  });

  it("writes nothing in a read-only context", async () => {
    place({ x: 0, y: 0, w: 20, h: 30 });
    render(mounted({ readOnly: true }));
    await settle();
    expect(writes).toHaveLength(0);
  });

  it("writes nothing when the card is not measured yet", async () => {
    place({ x: 0, y: 0, w: 20, h: 30 });
    size.body = { width: 0, height: 0 };
    render(mounted());
    await settle();
    expect(writes).toHaveLength(0);
    size.body = { width: 640, height: 550 };
  });

  it("snaps a card in a dock and keeps it within the band", async () => {
    place({ x: 0, y: 2, w: 20, h: 30 }, {}, 20, "docks");
    render(mounted());
    await waitFor(() => expect(writes).toEqual([[{ i: "c1", x: 0, y: 2, w: 20, h: NEEDED }]]));
  });

  it("clamps a dock card to the band's rows", async () => {
    place({ x: 0, y: 5, w: 20, h: 30 }, {}, 8, "docks");
    render(mounted());
    await waitFor(() => expect(writes).toEqual([[{ i: "c1", x: 0, y: 0, w: 20, h: 8 }]]));
    await settle();
    expect(writes).toHaveLength(1);
  });

  it("does not rewrite a dashboard card pinned to an edge", async () => {
    place({ x: 0, y: 0, w: 20, h: 30 }, { pinned: "top" });
    render(mounted());
    await settle();
    expect(writes).toHaveLength(0);
  });
});
