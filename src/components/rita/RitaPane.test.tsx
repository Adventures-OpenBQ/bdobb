// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { RitaPane } from "./RitaPane";

vi.mock("./ChatPane", () => ({
  ChatPane: ({ onInputFocus }: { onInputFocus: (f: boolean) => void }) => (
    <textarea aria-label="Message Rita" onFocus={() => onInputFocus(true)} onBlur={() => onInputFocus(false)} />
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.setState({ pinned: false, hasUnread: false, paneOpen: false });
  // 500ms is the shipped default; the waits below are written against it.
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
});
afterEach(() => vi.useRealTimers());

const pane = () => screen.getByRole("complementary", { name: "Rita AI pane" });

describe("RitaPane", () => {
  it("opens only after the configured delay, and closes on leave", () => {
    render(<RitaPane />);
    expect(pane().dataset.open).toBe("false");
    fireEvent.mouseEnter(pane());
    // Still shut most of the way through the delay: the rail lies along an
    // edge the pointer crosses to reach a card, and a crossing is not a hover.
    act(() => vi.advanceTimersByTime(499));
    expect(pane().dataset.open).toBe("false");
    act(() => vi.advanceTimersByTime(1));
    expect(pane().dataset.open).toBe("true");
    fireEvent.mouseLeave(pane());
    act(() => vi.advanceTimersByTime(300));
    expect(pane().dataset.open).toBe("false");
  });

  it("stays open while the input has focus", () => {
    render(<RitaPane />);
    fireEvent.mouseEnter(pane());
    act(() => vi.advanceTimersByTime(500));
    fireEvent.focus(screen.getByLabelText("Message Rita"));
    fireEvent.mouseLeave(pane());
    act(() => vi.advanceTimersByTime(300));
    expect(pane().dataset.open).toBe("true");
  });

  it("takes the delay from settings, and 0 opens on the enter itself", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaHoverDelayMs: 0 } });
    render(<RitaPane />);
    fireEvent.mouseEnter(pane());
    expect(pane().dataset.open).toBe("true");
  });

  it("does not open when the pointer crosses within the delay", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaHoverDelayMs: 500 } });
    render(<RitaPane />);
    fireEvent.mouseEnter(pane());
    act(() => vi.advanceTimersByTime(200));
    fireEvent.mouseLeave(pane());
    act(() => vi.advanceTimersByTime(1000));
    expect(pane().dataset.open).toBe("false");
  });

  it("stays open when pinned", () => {
    useChatStore.setState({ pinned: true });
    render(<RitaPane />);
    expect(pane().dataset.open).toBe("true");
  });

  it("shows the unread dot on the collapsed tab", () => {
    useChatStore.setState({ hasUnread: true });
    render(<RitaPane />);
    expect(screen.getByRole("status", { name: "New response from Rita" })).toBeInTheDocument();
    expect(screen.getByText("Rita")).toBeInTheDocument();
  });
});
