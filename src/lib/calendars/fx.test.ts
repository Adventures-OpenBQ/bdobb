// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { fxCalendarSet } from "./fx";
import { compileProgram } from "./program";
import { evaluateProgram } from "./resolver";
import fixture from "./vendor/conformance/XNYS.json";
import { bundleRevision, type CalendarBundle, type RunContext } from "./contracts";
it("normalizes two calendars and an optional explicit third without assuming USD", () => {
  expect(fxCalendarSet("payment:T2", "payment:BOJ")).toEqual({
    schemaVersion: 1,
    kind: "joint",
    members: ["payment:BOJ", "payment:T2"],
    mode: "all_open",
    referenceTimezone: "UTC",
  });
  expect(fxCalendarSet("payment:T2", "payment:BOJ", "payment:FEDWIRE").members).toEqual([
    "payment:BOJ",
    "payment:FEDWIRE",
    "payment:T2",
  ]);
  expect(fxCalendarSet("payment:T2", "payment:T2").members).toEqual(["payment:T2"]);
  expect(() => fxCalendarSet("exchange:XNYS", "payment:T2")).toThrow("INVALID_FX_CALENDAR");
});
it("consults the third calendar and refuses missing third-calendar coverage", () => {
  const make = (id: string, closed = false): CalendarBundle => ({
    ...(structuredClone(fixture) as CalendarBundle),
    calendarId: id,
    kind: "currency_payment",
    currency: id === "payment:T2" ? "EUR" : "JPY",
    days: fixture.days.map((d) =>
      closed && d.date === "2026-11-27" ? { ...d, state: "closed", open: null, close: null, segments: [] } : d,
    ) as CalendarBundle["days"],
  });
  const bundles = [make("payment:T2"), make("payment:BOJ"), make("payment:FEDWIRE", true)];
  const context = (third: boolean): RunContext => ({
    schemaVersion: 1,
    referenceInstant: "2026-11-28T12:00:00Z",
    binding: fxCalendarSet("payment:T2", "payment:BOJ", third ? "payment:FEDWIRE" : undefined),
    policy: "operational-v1",
    vector: bundles
      .slice(0, third ? 3 : 2)
      .map((b) => ({ calendarId: b.calendarId, revision: bundleRevision(b), digest: b.digest })),
    resolverVersion: "calendar-v1",
  });
  const program = compileProgram("T-1bd", "date");
  expect(evaluateProgram(program, context(false), bundles)).toMatchObject({ value: "2026-11-27" });
  expect(evaluateProgram(program, context(true), bundles)).toMatchObject({ value: "2026-11-25" });
  expect(evaluateProgram(program, context(true), bundles.slice(0, 2))).toMatchObject({ status: "unavailable" });
});
