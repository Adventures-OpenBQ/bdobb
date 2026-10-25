// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import fixture from "./vendor/conformance/XNYS.json";
import { parseBinding, validateBundle } from "./contracts";
it("accepts a complete bundle with per-day session boundaries", () => {
  expect(validateBundle(fixture).days[2].close).toBe("2026-11-27T18:00:00Z");
});
it.each(["unknown", "gap", "segment", "authority"])("refuses unsafe %s bundle", (kind) => {
  const b = structuredClone(fixture) as typeof fixture & { extra?: boolean };
  if (kind === "unknown") b.extra = true;
  if (kind === "gap") b.days.pop();
  if (kind === "segment") b.days[0].segments[0].end = "2026-11-25T13:00:00Z";
  if (kind === "authority") b.days[0].evidenceStatus = "market_final";
  expect(() => validateBundle(b)).toThrow();
});
it("orders mixed precision timestamps chronologically", () => {
  const b = structuredClone(fixture);
  Object.assign(b.days[0], {
    open: "2026-11-25T14:30:00.500Z",
    close: "2026-11-25T14:30:00Z",
    segments: [{ start: "2026-11-25T14:30:00.500Z", end: "2026-11-25T14:30:00Z" }],
  });
  expect(() => validateBundle(b)).toThrow("INVALID_SEGMENTS");
  Object.assign(b.days[0], {
    open: "2026-11-25T14:30:00Z",
    close: "2026-11-25T14:30:00.000001Z",
    segments: [{ start: "2026-11-25T14:30:00Z", end: "2026-11-25T14:30:00.000001Z" }],
  });
  expect(() => validateBundle(b)).not.toThrow();
});

it("accepts the library's own calendar names as ids, and nothing looser", () => {
  for (const id of ["exchange:24/7", "exchange:us_futures", "exchange:XPAR"]) {
    expect(parseBinding({ schemaVersion: 1, kind: "single", calendarId: id })).toMatchObject({ calendarId: id });
  }
  for (const id of ["exchange:", "exchange:A B", "exchange:XNYS?x=1"]) {
    expect(() => parseBinding({ schemaVersion: 1, kind: "single", calendarId: id })).toThrow("INVALID_BINDING");
  }
});
