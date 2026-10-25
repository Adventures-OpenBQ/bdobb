// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { it, expect } from "vitest";
import fixture from "./vendor/conformance/XNYS.json";
import { compileProgram } from "./program";
import { evaluateProgram, localResolutionService } from "./resolver";
import { bundleRevision, type CalendarBundle, type RunContext } from "./contracts";
import xhkg from "./vendor/conformance/XHKG.json";
import xtai from "./vendor/conformance/XTAI.json";
import { bundleCalendar } from "./resolver";
import { resolveValue } from "../dateExpressions";
import { newTrace } from "../calendar";
const b = fixture as CalendarBundle;
const context: RunContext = {
  schemaVersion: 1,
  referenceInstant: "2026-11-27T19:00:00Z",
  binding: { schemaVersion: 1, kind: "single", calendarId: b.calendarId },
  policy: "operational-v1",
  vector: [{ calendarId: b.calendarId, revision: bundleRevision(b), digest: b.digest }],
  resolverVersion: "calendar-v1",
};
it("uses actual early-close session anchors and ordered business-day offsets", () => {
  expect(evaluateProgram(compileProgram("session_close", "datetime"), context, [b])).toMatchObject({
    status: "resolved",
    value: "2026-11-27T13:00:00-05:00",
  });
  expect(evaluateProgram(compileProgram("T-1bd", "date"), context, [b])).toMatchObject({ value: "2026-11-25" });
  expect(evaluateProgram(compileProgram("trade_date", "date"), context, [b])).toMatchObject({ value: "2026-11-27" });
});
it("refuses an unverified vector and missing selected calendar", () => {
  expect(evaluateProgram(compileProgram("T-1bd", "date"), { ...context, vector: [] }, [b])).toMatchObject({
    status: "unavailable",
  });
});
it("uses the same operation program through a swappable service", async () => {
  const program = compileProgram("T-1bd", "date");
  const results = await localResolutionService.resolveBatch(
    {
      schemaVersion: 1,
      referenceInstant: context.referenceInstant,
      fields: [{ fieldId: "start", program, context }],
      bundles: [b],
    },
    new AbortController().signal,
  );
  expect(results[0]).toMatchObject({ fieldId: "start", value: "2026-11-25", authority: "client" });
});
const single = (mic: string) => ({ schemaVersion: 1 as const, kind: "single" as const, calendarId: `exchange:${mic}` });
it("keeps a bundle's revision distinct from its content digest", () => {
  expect(bundleRevision(b)).toBe(`${b.definitionRevision}@${b.source.ruleDigest}`);
  expect(bundleRevision(b)).not.toBe(b.digest);
});
it("caps the business-day steps of both directions together", () => {
  // Offset keeps its sign apart from its amount, so the sum is already absolute; this pins it.
  expect(() => compileProgram("T+5000bd-5001bd", "date")).toThrow("RESOURCE_LIMIT");
});
it("reads the XHKG and XTAI fixtures through bundleCalendar", () => {
  const hk = bundleCalendar([xhkg as CalendarBundle], single("XHKG"), "operational-v1");
  // The lunch break splits the session; the close is the last segment's end.
  expect(
    resolveValue("datetime", "session_close", {
      now: new Date("2026-01-02T02:00:00Z"),
      zone: "Asia/Hong_Kong",
      calendar: hk,
      exchange: "XHKG",
    }),
  ).toBe("2026-01-02T16:00:00+08:00");
  const tw = bundleCalendar([xtai as CalendarBundle], single("XTAI"), "operational-v1");
  // 2025-02-08 is a government make-up workday, not an exchange session.
  expect(
    resolveValue("date", "T-1bd", {
      now: new Date("2025-02-10T06:00:00Z"),
      zone: "Asia/Taipei",
      calendar: tw,
      exchange: "XTAI",
    }),
  ).toBe("2025-02-07");
});
it("marks the trace provisional under planning-v1", () => {
  const p = structuredClone(b) as CalendarBundle;
  p.days[0].evidenceStatus = "provisional";
  const trace = newTrace();
  const cal = bundleCalendar([p], single("XNYS"), "planning-v1");
  expect(
    resolveValue("date", "T-1bd", {
      now: new Date("2026-11-27T19:00:00Z"),
      zone: "America/New_York",
      calendar: cal,
      exchange: "XNYS",
      trace,
    }),
  ).toBe("2026-11-25");
  expect(trace.provisional).toBe(true);
});
it("names the calendar, revision and coverage when an operation has no answer", () => {
  const cal = bundleCalendar([b], single("XNYS"), "operational-v1");
  const errors: string[] = [];
  resolveValue("date", "T-10bd", {
    now: new Date("2026-11-27T19:00:00Z"),
    zone: "America/New_York",
    calendar: cal,
    exchange: "XNYS",
    onError: (m) => errors.push(m),
  });
  expect(errors).toEqual([`exchange:XNYS COVERAGE_UNAVAILABLE (revision ${bundleRevision(b)}, coverage 2026-11-25 to 2026-11-28)`]);
});
