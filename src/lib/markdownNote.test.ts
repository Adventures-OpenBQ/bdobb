// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKDOWN_FILE_MAX_BYTES, debounced, markdownFileRefusal } from "./markdownNote";

describe("debounced", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once after the last call settles", () => {
    const fn = vi.fn();
    const d = debounced(fn, 500);
    d.call();
    vi.advanceTimersByTime(400);
    d.call();
    vi.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush runs a pending call immediately and cancels the timer", () => {
    const fn = vi.fn();
    const d = debounced(fn, 500);
    d.call();
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing pending does nothing; cancel drops a pending call", () => {
    const fn = vi.fn();
    const d = debounced(fn, 500);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
    d.call();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("markdownFileRefusal", () => {
  it("accepts a file at the limit and refuses one byte over, naming the file and the limit", () => {
    expect(markdownFileRefusal("notes.md", MARKDOWN_FILE_MAX_BYTES)).toBeNull();
    expect(markdownFileRefusal("notes.md", MARKDOWN_FILE_MAX_BYTES + 1)).toBe(
      "notes.md is 1.1 MB; the limit is 1 MB.",
    );
  });
});
