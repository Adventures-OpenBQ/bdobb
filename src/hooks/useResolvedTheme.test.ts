// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useResolvedTheme } from "./useResolvedTheme";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { useSettingsStore } from "../stores/settingsStore";
import { stubMatchMedia, type MatchMediaStub } from "../test/matchMedia";

let media: MatchMediaStub | null = null;

function setTheme(theme: "dark" | "light" | "system") {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme } });
}

afterEach(() => {
  // Unmount before touching the store: a hook still mounted would re-render
  // on the reset below, outside act(), which React reports as a warning.
  cleanup();
  media?.restore();
  media = null;
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, draft: null });
});

describe("useResolvedTheme", () => {
  it("passes an explicit theme through untouched", () => {
    media = stubMatchMedia(true);
    setTheme("light");
    expect(renderHook(() => useResolvedTheme()).result.current).toBe("light");

    setTheme("dark");
    expect(renderHook(() => useResolvedTheme()).result.current).toBe("dark");
  });

  it("never consults matchMedia for an explicit theme", () => {
    media = stubMatchMedia(false);
    setTheme("dark");
    renderHook(() => useResolvedTheme());
    expect(media.queries).toEqual([]);
  });

  it("follows the media query under system", () => {
    media = stubMatchMedia(false);
    setTheme("system");
    expect(renderHook(() => useResolvedTheme()).result.current).toBe("light");
    expect(media.queries).toContain("(prefers-color-scheme: dark)");

    media.restore();
    media = stubMatchMedia(true);
    expect(renderHook(() => useResolvedTheme()).result.current).toBe("dark");
  });

  it("re-resolves when the OS appearance changes", () => {
    media = stubMatchMedia(true);
    setTheme("system");
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");

    act(() => media!.set(false));
    expect(result.current).toBe("light");

    act(() => media!.set(true));
    expect(result.current).toBe("dark");
  });

  it("re-resolves when the setting itself changes to and from system", () => {
    media = stubMatchMedia(false);
    setTheme("dark");
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");

    act(() => setTheme("system"));
    expect(result.current).toBe("light");

    act(() => setTheme("dark"));
    expect(result.current).toBe("dark");
  });

  it("unsubscribes on unmount", () => {
    media = stubMatchMedia(true);
    setTheme("system");
    const { unmount } = renderHook(() => useResolvedTheme());
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("unsubscribes when the setting leaves system", () => {
    media = stubMatchMedia(true);
    setTheme("system");
    const { result } = renderHook(() => useResolvedTheme());
    expect(media.listenerCount()).toBe(1);

    act(() => setTheme("light"));
    expect(media.listenerCount()).toBe(0);
    expect(result.current).toBe("light");
  });

  it("falls back to dark where matchMedia does not exist", () => {
    setTheme("system");
    expect(renderHook(() => useResolvedTheme()).result.current).toBe("dark");
  });

  it("previews a staged draft theme before it is committed", () => {
    // The real setting stays "dark" -- only the draft says "system" -- so
    // this only passes if the hook reads through selectEffective rather
    // than s.settings.theme directly.
    media = stubMatchMedia(false);
    setTheme("dark");
    useSettingsStore.setState({
      draft: { snapshot: { ...DEFAULT_SETTINGS, theme: "dark" }, patch: { theme: "system" } },
    });
    expect(renderHook(() => useResolvedTheme()).result.current).toBe("light");
  });
});
