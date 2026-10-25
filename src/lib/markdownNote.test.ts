// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARKDOWN_FILE_MAX_BYTES,
  createNoteSync,
  debounced,
  emitIfChanged,
  loaded,
  markdownFileRefusal,
  needsReload,
} from "./markdownNote";

describe("note sync", () => {
  it("starts with nothing known, so any non-empty text needs a load and empty text does not", () => {
    const sync = createNoteSync();
    expect(needsReload(sync, "")).toBe(false);
    expect(needsReload(sync, "# Hi")).toBe(true);
  });

  it("does not reload the text it was just loaded with", () => {
    const sync = createNoteSync();
    loaded(sync, "# Hi");
    expect(needsReload(sync, "# Hi")).toBe(false);
    expect(needsReload(sync, "# Hi\n\nmore")).toBe(true);
  });

  it("emits a serialisation only when it differs from the last known string, and then knows it", () => {
    const sync = createNoteSync();
    loaded(sync, "a");
    expect(emitIfChanged(sync, "a")).toBeNull();
    expect(emitIfChanged(sync, "b")).toBe("b");
    // What this editor emitted must not come back as an external change:
    // the param round-trips through the store and arrives as the text prop.
    expect(needsReload(sync, "b")).toBe(false);
  });
});

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
