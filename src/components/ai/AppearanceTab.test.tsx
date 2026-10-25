// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useSettingsStore } from "../../stores/settingsStore";
import { AppearanceTab } from "./AppearanceTab";

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
  // A draft must already be open for stageDraft to do anything -- AILibrary's
  // beginDraft() on mount, reproduced here since this tab is also rendered
  // standalone in these tests.
  useSettingsStore.getState().beginDraft();
});

describe("AppearanceTab", () => {
  it("shows the stored delay in ms", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, ritaHoverDelayMs: 750 },
    });
    render(<AppearanceTab />);
    expect(screen.getByRole("slider", { name: "Rita rail opens after" })).toHaveValue("750");
    expect(screen.getByText("750 ms")).toBeInTheDocument();
  });

  it("stages on release, not on every tick of the drag", () => {
    const stageDraftSpy = vi.spyOn(useSettingsStore.getState(), "stageDraft");
    render(<AppearanceTab />);
    const slider = screen.getByRole("slider", { name: "Rita rail opens after" });
    // `input` is every pixel of the drag; `change` is the release. Only the
    // second may reach the store -- see RangeRow.
    fireEvent.input(slider, { target: { value: "250" } });
    expect(stageDraftSpy).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: "250" } });
    expect(stageDraftSpy).toHaveBeenCalledWith({ ritaHoverDelayMs: 250 });
    stageDraftSpy.mockRestore();
  });
});
