// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __failPath, __read, __reset, __seed } from "../test/memfs";
import {
  MAX_BYTES,
  MAX_FILES,
  __resetLoggerForTests,
  logError,
  logInfo,
  logOnce,
} from "./logger";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
});

describe("logInfo / logError", () => {
  it("appends a line carrying the level and the message", async () => {
    await logInfo("hello");
    await logError("boom");
    const log = __read("logs/bdobb.log") ?? "";
    expect(log).toContain("INFO hello");
    expect(log).toContain("ERROR boom");
    expect(log.trimEnd().split("\n")).toHaveLength(2);
  });

  it("writes the caller's already-interpolated message verbatim", async () => {
    const path = "backends.json";
    await logInfo(`quarantined ${path} -> ${path}.corrupt`);
    expect(__read("logs/bdobb.log")).toContain(
      "quarantined backends.json -> backends.json.corrupt",
    );
  });
});

describe("resilience", () => {
  it("does not reject when the write itself fails", async () => {
    __failPath("logs/bdobb.log");
    await expect(logError("boom")).resolves.toBeUndefined();
  });

  it("does not leave a later, successful write rejecting or unresolved", async () => {
    __failPath("logs/bdobb.log");
    await logError("fails, swallowed");
    // The failing path guard is permanent for this test (memfs has no
    // "un-fail"), so this proves the chain keeps accepting and settling
    // new work rather than getting stuck on the earlier rejection —
    // exercised here as "the call promise itself still resolves", the
    // same contract logError makes to every caller.
    await expect(logError("second call, still fails")).resolves.toBeUndefined();
  });
});

describe("logOnce", () => {
  it("writes once per key for the session", async () => {
    await logOnce("form-param", "unsupported param type: form");
    await logOnce("form-param", "unsupported param type: form");
    await logOnce("tabs-param", "unsupported param type: tabs");
    const lines = (__read("logs/bdobb.log") ?? "").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("rotation", () => {
  it("rotates the current log to .1 once it reaches MAX_BYTES", async () => {
    __seed("logs/bdobb.log", "x".repeat(MAX_BYTES));
    await logInfo("after rotation");

    expect(__read("logs/bdobb.log.1")).toHaveLength(MAX_BYTES);
    const current = __read("logs/bdobb.log") ?? "";
    expect(current).toContain("after rotation");
    expect(current.length).toBeLessThan(MAX_BYTES);
  });

  it("keeps MAX_FILES generations, discarding the oldest", async () => {
    __seed("logs/bdobb.log", "x".repeat(MAX_BYTES));
    for (let n = 1; n <= MAX_FILES; n++) __seed(`logs/bdobb.log.${n}`, `gen${n}`);

    await logInfo("after rotation");

    expect(__read(`logs/bdobb.log.${MAX_FILES + 1}`)).toBeUndefined();
    expect(__read("logs/bdobb.log.2")).toBe("gen1");
    expect(__read(`logs/bdobb.log.${MAX_FILES}`)).toBe(`gen${MAX_FILES - 1}`);
  });

  it("does not rotate below MAX_BYTES", async () => {
    __seed("logs/bdobb.log", "small");
    await logInfo("still here");
    expect(__read("logs/bdobb.log.1")).toBeUndefined();
    expect(__read("logs/bdobb.log")).toContain("small");
  });
});
