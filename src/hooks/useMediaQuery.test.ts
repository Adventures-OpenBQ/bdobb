// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMediaQuery } from "./useMediaQuery";
import { stubMatchMedia, type MatchMediaStub } from "../test/matchMedia";

let media: MatchMediaStub | null = null;

afterEach(() => {
  cleanup();
  media?.restore();
  media = null;
});

describe("useMediaQuery", () => {
  it("returns true when query matches", () => {
    media = stubMatchMedia(true);
    expect(renderHook(() => useMediaQuery("(prefers-color-scheme: dark)")).result.current).toBe(true);
  });

  it("returns false when query does not match", () => {
    media = stubMatchMedia(false);
    expect(renderHook(() => useMediaQuery("(prefers-color-scheme: dark)")).result.current).toBe(false);
  });

  it("returns null for null query", () => {
    expect(renderHook(() => useMediaQuery(null)).result.current).toBeNull();
  });

  it("switches live when media changes", () => {
    media = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(prefers-color-scheme: dark)"));
    expect(result.current).toBe(false);
    act(() => media!.set(true));
    expect(result.current).toBe(true);
    act(() => media!.set(false));
    expect(result.current).toBe(false);
  });

  it("unsubscribes on unmount", () => {
    media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery("(prefers-color-scheme: dark)"));
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
