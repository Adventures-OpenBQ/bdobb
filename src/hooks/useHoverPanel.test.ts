// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoverPanel } from "./useHoverPanel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// onDragLeave reads relatedTarget/currentTarget off the event (see
// useHoverPanel.ts), so calls below stand in for a leave with nowhere
// related to go — e.g. off the panel entirely.
const dragLeaveEvent = () =>
  ({ relatedTarget: null, currentTarget: null }) as unknown as Parameters<
    ReturnType<typeof useHoverPanel>["handlers"]["onDragLeave"]
  >[0];

// 300ms is the hook's own collapse delay; the timer assertions below are
// written against it.
describe("useHoverPanel", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useHoverPanel());
    expect(result.current.open).toBe(false);
  });

  it("opens immediately on mouse enter", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    expect(result.current.open).toBe(true);
  });

  it("collapses only after the delay", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.handlers.onMouseLeave());

    act(() => void vi.advanceTimersByTime(299));
    expect(result.current.open).toBe(true);

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(false);
  });

  it("cancels a pending collapse when the pointer returns", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.handlers.onMouseLeave());
    act(() => void vi.advanceTimersByTime(200));
    act(() => result.current.handlers.onMouseEnter());
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.open).toBe(true);
  });

  it("close() collapses immediately", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it("opens on dragenter, because a drag suppresses mouseenter", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onDragEnter());
    expect(result.current.open).toBe(true);
  });

  it("collapses after dragleave on the same delay as the mouse", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onDragEnter());
    act(() => result.current.handlers.onDragLeave(dragLeaveEvent()));

    expect(result.current.open).toBe(true);
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current.open).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(false);
  });

  it("a dragenter cancels a pending mouseleave collapse", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.handlers.onMouseLeave());
    act(() => result.current.handlers.onDragEnter());
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current.open).toBe(true);
  });
});
