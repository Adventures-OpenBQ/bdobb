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
import { useDashboardStore } from "../../stores/dashboardStore";
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
    await userEvent.dblClick(button);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "picture_in_picture_set_muted")).toHaveLength(1);
    expect(button).toBeDisabled();
    finish({ state: "muted" });
    await waitFor(() => expect(button).toBeEnabled());
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
