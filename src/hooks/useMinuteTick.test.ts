// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinuteTick } from "./useMinuteTick";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useMinuteTick", () => {
  it("returns the current time immediately", () => {
    vi.setSystemTime(new Date("2026-01-15T17:30:20Z"));
    const { result } = renderHook(() => useMinuteTick());
    expect(result.current.toISOString()).toBe("2026-01-15T17:30:20.000Z");
  });

  it("schedules to the next minute boundary, not a fixed interval", () => {
    vi.setSystemTime(new Date("2026-01-15T17:30:20Z"));
    const spy = vi.spyOn(globalThis, "setTimeout");
    renderHook(() => useMinuteTick());
    // 40 seconds remain until 17:31:00.
    expect(spy.mock.calls[0][1]).toBe(40_000);
  });

  it("updates on the boundary and reschedules a full minute", () => {
    vi.setSystemTime(new Date("2026-01-15T17:30:20Z"));
    const { result } = renderHook(() => useMinuteTick());

    act(() => void vi.advanceTimersByTime(40_000));
    expect(result.current.toISOString()).toBe("2026-01-15T17:31:00.000Z");

    act(() => void vi.advanceTimersByTime(60_000));
    expect(result.current.toISOString()).toBe("2026-01-15T17:32:00.000Z");
  });

  it("does not fire before the boundary", () => {
    vi.setSystemTime(new Date("2026-01-15T17:30:20Z"));
    const { result } = renderHook(() => useMinuteTick());
    act(() => void vi.advanceTimersByTime(39_000));
    expect(result.current.toISOString()).toBe("2026-01-15T17:30:20.000Z");
  });

  it("clears its timer on unmount", () => {
    vi.setSystemTime(new Date("2026-01-15T17:30:20Z"));
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderHook(() => useMinuteTick());
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
