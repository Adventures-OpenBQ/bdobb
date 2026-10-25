// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  isTauri: false,
  // What readCurrentScreen resolves to next; a function gets called.
  current: null as unknown,
  moved: [] as Array<() => void>,
  scaled: [] as Array<() => void>,
  unlistened: 0,
}));

vi.mock("../lib/screenFit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/screenFit")>()),
  readCurrentScreen: vi.fn(() =>
    typeof tauri.current === "function" ? (tauri.current as () => unknown)() : Promise.resolve(tauri.current),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => tauri.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onMoved: (cb: () => void) => {
      tauri.moved.push(cb);
      return Promise.resolve(() => {
        tauri.unlistened++;
      });
    },
    onScaleChanged: (cb: () => void) => {
      tauri.scaled.push(cb);
      return Promise.resolve(() => {
        tauri.unlistened++;
      });
    },
  }),
}));

import { useScreenSize } from "./useScreenSize";

function setScreen(width: number, height: number) {
  Object.defineProperty(window, "screen", { configurable: true, value: { width, height } });
}

/** Lets pending promise callbacks (the monitor read, listen()) run. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  tauri.isTauri = false;
  tauri.current = null;
  tauri.moved = [];
  tauri.scaled = [];
  tauri.unlistened = 0;
});
afterEach(() => vi.useRealTimers());

describe("useScreenSize", () => {
  it("reads window.screen, in logical pixels", () => {
    setScreen(1512, 982);
    const { result } = renderHook(() => useScreenSize());
    expect(result.current).toEqual({ width: 1512, height: 982 });
  });

  it("re-reads on resize, and keeps the same object when nothing changed", async () => {
    setScreen(1920, 1080);
    const { result } = renderHook(() => useScreenSize());
    const first = result.current;
    act(() => window.dispatchEvent(new Event("resize")));
    await flush();
    expect(result.current).toBe(first);
    act(() => {
      setScreen(3440, 1440);
      window.dispatchEvent(new Event("resize"));
    });
    await flush();
    expect(result.current).toEqual({ width: 3440, height: 1440 });
  });

  it("does not listen for window moves outside Tauri", async () => {
    setScreen(1920, 1080);
    renderHook(() => useScreenSize());
    await flush();
    expect(tauri.moved).toHaveLength(0);
    expect(tauri.scaled).toHaveLength(0);
  });
});

describe("useScreenSize in Tauri (spec §4.1)", () => {
  beforeEach(() => {
    tauri.isTauri = true;
  });

  it("takes the current monitor's size on mount over a stale window.screen", async () => {
    setScreen(1920, 1080);
    tauri.current = { width: 2560, height: 1440 };
    const { result } = renderHook(() => useScreenSize());
    expect(result.current).toEqual({ width: 1920, height: 1080 });
    await flush();
    expect(result.current).toEqual({ width: 2560, height: 1440 });
  });

  it("re-reads the monitor after a move between same-scale screens, where no resize fires", async () => {
    vi.useFakeTimers();
    setScreen(1920, 1080);
    tauri.current = { width: 1920, height: 1080 };
    const { result } = renderHook(() => useScreenSize());
    await flush();
    expect(tauri.moved).toHaveLength(1);

    // Dragged onto a 1440p screen at the same 100%: window.screen still
    // says 1080p, and there is no resize event -- only moved.
    tauri.current = { width: 2560, height: 1440 };
    act(() => tauri.moved[0]());
    await flush();
    expect(result.current).toEqual({ width: 1920, height: 1080 });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await flush();
    expect(result.current).toEqual({ width: 2560, height: 1440 });
  });

  it("debounces a drag's stream of moves into one read", async () => {
    vi.useFakeTimers();
    setScreen(1920, 1080);
    let reads = 0;
    tauri.current = () => {
      reads++;
      return Promise.resolve({ width: 1920, height: 1080 });
    };
    renderHook(() => useScreenSize());
    await flush();
    const afterMount = reads;
    act(() => {
      for (let i = 0; i < 20; i++) {
        tauri.moved[0]();
        vi.advanceTimersByTime(10);
      }
    });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await flush();
    expect(reads - afterMount).toBe(1);
  });

  it("re-reads after a scale change", async () => {
    vi.useFakeTimers();
    setScreen(3840, 2160);
    tauri.current = { width: 3840, height: 2160 };
    const { result } = renderHook(() => useScreenSize());
    await flush();
    tauri.current = { width: 1920, height: 1080 };
    act(() => tauri.scaled[0]());
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await flush();
    expect(result.current).toEqual({ width: 1920, height: 1080 });
  });

  it("falls back to window.screen when the monitor is unknown (Wayland)", async () => {
    vi.useFakeTimers();
    setScreen(1920, 1080);
    tauri.current = null;
    const { result } = renderHook(() => useScreenSize());
    await flush();
    setScreen(2560, 1440);
    act(() => tauri.moved[0]());
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    await flush();
    expect(result.current).toEqual({ width: 2560, height: 1440 });
  });

  it("drops a read that finishes after a newer one", async () => {
    setScreen(1920, 1080);
    let resolveSlow: (v: unknown) => void = () => {};
    tauri.current = () => new Promise((r) => (resolveSlow = r));
    const { result } = renderHook(() => useScreenSize());
    // The mount read is still pending; a resize starts a newer, fast one.
    tauri.current = { width: 3440, height: 1440 };
    act(() => window.dispatchEvent(new Event("resize")));
    await flush();
    expect(result.current).toEqual({ width: 3440, height: 1440 });
    resolveSlow({ width: 1280, height: 800 });
    await flush();
    expect(result.current).toEqual({ width: 3440, height: 1440 });
  });

  it("stops listening on unmount", async () => {
    setScreen(1920, 1080);
    tauri.current = { width: 1920, height: 1080 };
    const { unmount } = renderHook(() => useScreenSize());
    await flush();
    unmount();
    await flush();
    expect(tauri.unlistened).toBe(2);
  });

  it("stops listening even when unmounted before listen() resolved", async () => {
    setScreen(1920, 1080);
    const { unmount } = renderHook(() => useScreenSize());
    unmount();
    await flush();
    expect(tauri.unlistened).toBe(2);
  });
});
