// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuteState, PortalStatus } from "../../lib/windowPortal";

const { invoke, tauri } = vi.hoisted(() => ({ invoke: vi.fn(), tauri: { on: true } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
  isTauri: () => tauri.on,
}));

import { WindowPortalMute, WindowPortalRenderer } from "./WindowPortalRenderer";

/** Answers fit with `fit`, and the mute commands from a slider that starts at `mute`. */
function answer(fit: PortalStatus, mute: MuteState = { state: "sound" }) {
  let current = mute;
  invoke.mockImplementation(async (cmd: string, args?: { muted?: boolean }) => {
    if (cmd === "window_portal_fit") return fit;
    if (cmd === "window_portal_mute_state") return current;
    if (cmd === "window_portal_set_muted") {
      current = { state: args?.muted ? "muted" : "sound" };
      return current;
    }
    return undefined;
  });
}

const fitCall = () => expect(invoke).toHaveBeenCalledWith("window_portal_fit", expect.anything());

afterEach(async () => {
  cleanup();
  // Let the unmount's queued release reach the mock before it is reset.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllEnvs();
  tauri.on = true;
  invoke.mockReset();
});

describe("Window Portal on the macOS desktop app", () => {
  beforeEach(() => vi.stubEnv("TAURI_ENV_PLATFORM", "darwin"));

  it.each([
    ["no_player", "Pop the video out in Chrome"],
    ["in_use", "The player is in use by another card"],
    ["too_small", "Make this card at least 284 × 160 to park the player here"],
    ["viewer_window", "Open this dashboard in the main window"],
    ["not_supported", "Available in the macOS desktop app"],
  ] as const)("shows %s as its message", async (state, text) => {
    answer({ state });
    render(<WindowPortalRenderer cardId="c1" />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("sends the body's rectangle and shows nothing once the player is parked", async () => {
    answer({ state: "fitted" });
    const { container } = render(<WindowPortalRenderer cardId="c1" />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("window_portal_fit", { card: "c1", rect: { x: 0, y: 0, width: 0, height: 0 } }),
    );
    await waitFor(() => expect(container.querySelector(".window-portal")).toHaveAttribute("data-state", "fitted"));
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("shows a failure with its reason", async () => {
    answer({ state: "failed", reason: "Accessibility refused AXSize (error -25200)" });
    render(<WindowPortalRenderer cardId="c1" />);
    expect(await screen.findByText("Could not move the player: Accessibility refused AXSize (error -25200)")).toBeInTheDocument();
  });

  it("explains a missing permission and opens the pane on request", async () => {
    answer({ state: "no_permission" });
    render(<WindowPortalRenderer cardId="c1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Open Accessibility settings" }));
    expect(screen.getByText(/needs Accessibility permission/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("window_portal_open_settings", undefined);
  });

  it("releases the player when the card goes away", async () => {
    answer({ state: "fitted" });
    const { unmount } = render(<WindowPortalRenderer cardId="c1" />);
    await waitFor(fitCall);
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("window_portal_release", { card: "c1" }));
  });

  it("never lets the release overtake a fit still in flight", async () => {
    let finish: (status: PortalStatus) => void = () => undefined;
    invoke.mockImplementation((cmd: string) =>
      cmd === "window_portal_fit" ? new Promise<PortalStatus>((resolve) => (finish = resolve)) : Promise.resolve(undefined),
    );
    const { unmount } = render(<WindowPortalRenderer cardId="c1" />);
    await waitFor(fitCall);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalledWith("window_portal_release", expect.anything());
    finish({ state: "fitted" });
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("window_portal_release", { card: "c1" }));
  });

  it("mutes and unmutes through the card's settings", async () => {
    answer({ state: "fitted" });
    render(<WindowPortalMute params={{ source: "Bloomberg", volumeLabel: "Volume" }} />);
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Mute"));
    expect(invoke).toHaveBeenCalledWith("window_portal_mute_state", { source: "Bloomberg", label: "Volume" });
    await userEvent.click(button);
    expect(invoke).toHaveBeenCalledWith("window_portal_set_muted", { source: "Bloomberg", label: "Volume", muted: true });
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("shows an unavailable mute with its reason and does nothing on click", async () => {
    answer({ state: "fitted" }, { state: "unavailable", reason: "Select the stream's tab in its window." });
    render(<WindowPortalMute params={{}} />);
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Select the stream's tab in its window."));
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(invoke).not.toHaveBeenCalledWith("window_portal_set_muted", expect.anything());
  });
});

describe("Window Portal on iPad", () => {
  beforeEach(() => vi.stubEnv("TAURI_ENV_PLATFORM", "ios"));

  it("is a reserved space with the hint, no controller and no mute button", () => {
    render(<WindowPortalRenderer cardId="c1" />);
    expect(screen.getByText("Park a picture-in-picture video here")).toBeInTheDocument();
    const { container } = render(<WindowPortalMute params={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Window Portal on Windows and in the web preview", () => {
  it.each([
    ["the Windows app", "windows", true],
    ["the web preview", undefined, false],
  ] as const)("shows the placeholder in %s", (_name, platform, inTauri) => {
    if (platform) vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    tauri.on = inTauri;
    render(<WindowPortalRenderer cardId="c1" />);
    expect(screen.getByText("Available in the macOS desktop app")).toBeInTheDocument();
    const { container } = render(<WindowPortalMute params={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});
