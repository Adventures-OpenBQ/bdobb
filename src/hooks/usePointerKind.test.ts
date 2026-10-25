// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTouch } from "./usePointerKind";
import { stubMatchMedia, type MatchMediaStub } from "../test/matchMedia";

let media: MatchMediaStub | null = null;

afterEach(() => {
  cleanup();
  media?.restore();
  media = null;
});

describe("useTouch", () => {
  it("reports no touch when the pointer can hover", () => {
    media = stubMatchMedia(true);
    expect(renderHook(() => useTouch()).result.current).toBe(false);
  });

  it("reports touch when it cannot", () => {
    media = stubMatchMedia(false);
    expect(renderHook(() => useTouch()).result.current).toBe(true);
  });

  it("asks about (any-pointer: fine), which is what a docked iPad trackpad flips", () => {
    media = stubMatchMedia(true);
    renderHook(() => useTouch());
    expect(media.queries).toContain("(any-pointer: fine)");
    expect(media.queries).not.toContain("(pointer: fine)");
  });

  it("switches live when a keyboard is docked mid-session", () => {
    // The whole point of reading the query reactively rather than once at
    // mount: attaching a Magic Keyboard changes the dialect with no restart
    // and no setting.
    media = stubMatchMedia(false);
    const { result } = renderHook(() => useTouch());
    expect(result.current).toBe(true);
    act(() => media!.set(true));
    expect(result.current).toBe(false);
    act(() => media!.set(false));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount", () => {
    media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useTouch());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it("falls back to no touch where there is no matchMedia at all", () => {
    // jsdom implements none. Desktop is the app's home, so a host that cannot
    // answer is treated as a desktop rather than silently switching every
    // hover panel to a tap dialect.
    expect(renderHook(() => useTouch()).result.current).toBe(false);
  });
});
