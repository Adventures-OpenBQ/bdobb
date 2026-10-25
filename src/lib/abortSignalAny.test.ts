// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node
//
// Node has a native AbortSignal.any, so each case removes it first to stand in
// for WebKit below 17.4, and puts it back after.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAbortSignalAny } from "./abortSignalAny";

const native = AbortSignal.any;

beforeEach(() => {
  delete (AbortSignal as { any?: unknown }).any;
});
afterEach(() => {
  AbortSignal.any = native;
});

describe("installAbortSignalAny", () => {
  it("aborts the combined signal when any input aborts, with that input's reason", () => {
    installAbortSignalAny();
    const a = new AbortController();
    const b = new AbortController();
    const combined = AbortSignal.any([a.signal, b.signal]);
    expect(combined.aborted).toBe(false);
    b.abort("gone");
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe("gone");
  });

  it("is already aborted when an input already was", () => {
    installAbortSignalAny();
    const a = new AbortController();
    a.abort("early");
    const combined = AbortSignal.any([new AbortController().signal, a.signal]);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe("early");
  });

  it("leaves a native implementation alone", () => {
    AbortSignal.any = native;
    installAbortSignalAny();
    expect(AbortSignal.any).toBe(native);
  });
});
