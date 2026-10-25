// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { KeyCheck } from "./providerKeys";
import { credentialUsage, usageCardLine, usageResetLine, usageSummary } from "./providerUsage";

const cred = (usage: unknown): KeyCheck => ({ result: "ok", detail: "HTTP 200", kind: "credential", usage } as KeyCheck);
const n = (x: number) => x.toLocaleString();

describe("credentialUsage", () => {
  it("takes the credential check's usage", () => {
    const u = { used: 1234, limit: 100000, window: "day", resets_at: "2026-10-18T00:00:00Z", extra: 5000 };
    expect(credentialUsage([{ result: "ok", detail: "", kind: "connectivity" }, cred(u)])).toEqual(u);
  });

  it("ignores usage on a connectivity check", () => {
    const c = { result: "ok", detail: "", kind: "connectivity", usage: { used: 1, limit: 2, window: "day" } } as KeyCheck;
    expect(credentialUsage([c])).toBeUndefined();
  });

  it("is undefined without checks or usage", () => {
    expect(credentialUsage(undefined)).toBeUndefined();
    expect(credentialUsage([cred(undefined)])).toBeUndefined();
  });

  it("drops usage with non-numeric or negative values", () => {
    for (const bad of [
      { used: "12", limit: 100, window: "day" },
      { used: 1, limit: 0, window: "day" },
      { used: -1, limit: 100, window: "day" },
      { used: 1, limit: Number.NaN, window: "day" },
      { used: 1, limit: 100, window: "week" },
      "1/100",
      null,
    ]) {
      expect(credentialUsage([cred(bad)])).toBeUndefined();
    }
  });

  it("drops a bad optional field but keeps the usage", () => {
    expect(credentialUsage([cred({ used: 1, limit: 2, window: "hour", resets_at: 5, extra: "x" })])).toEqual({
      used: 1, limit: 2, window: "hour",
    });
  });
});

describe("formatting", () => {
  const day = { used: 1234, limit: 100000, window: "day" } as const;

  it("card line per window", () => {
    expect(usageCardLine(day)).toBe(`API calls: ${n(1234)} / ${n(100000)} today`);
    expect(usageCardLine({ used: 12, limit: 5000, window: "hour" })).toBe(`API calls: 12 / ${n(5000)} this hour`);
    expect(usageCardLine({ used: 1, limit: 200, window: "minute" })).toBe("API calls: 1 / 200 this minute");
    expect(usageCardLine({ used: 1, limit: 2, window: "period" })).toBe("API calls: 1 / 2 this period");
  });

  it("summary with one-decimal percentage", () => {
    expect(usageSummary(day)).toBe(`${n(1234)} of ${n(100000)} calls today (1.2%)`);
  });

  it("reset line within a day, beyond a day, past, and unparseable", () => {
    const now = new Date("2026-10-17T14:48:00Z");
    expect(usageResetLine({ ...day, resets_at: "2026-10-18T00:00:00Z" }, now)).toBe("Resets 00:00 UTC · in 9h 12m");
    expect(usageResetLine({ ...day, resets_at: "2026-10-20T06:00:00Z" }, now)).toBe("Resets 2026-10-20 06:00 UTC · in 2d 15h");
    expect(usageResetLine({ ...day, resets_at: "2026-10-17T14:48:30Z" }, now)).toBe("Resets 14:48 UTC · in under a minute");
    expect(usageResetLine({ ...day, resets_at: "2026-10-17T14:00:00Z" }, now)).toBe("Resets 14:00 UTC");
    expect(usageResetLine({ ...day, resets_at: "soon" }, now)).toBeUndefined();
    expect(usageResetLine(day, now)).toBeUndefined();
  });
});
