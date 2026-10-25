// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import base from "./vendor/conformance/XNYS.json";
import type { CalendarBundle } from "./contracts";
import { createIndex, shiftSessionDate, rollSessionDate, jointDates, lastCompleted, sessionBounds } from "./operations";
export function bundle(
  id = "exchange:A",
  open = ["2026-01-02", "2026-01-05", "2026-01-07", "2026-01-08", "2026-01-09"],
): CalendarBundle {
  const days = Array.from({ length: 8 }, (_, n) => {
    const d = `2026-01-${String(n + 2).padStart(2, "0")}`;
    return {
      date: d,
      state: open.includes(d) ? "open" : "closed",
      evidenceStatus: "library_baseline",
      open: open.includes(d) ? d + "T09:00:00Z" : null,
      close: open.includes(d) ? d + "T17:00:00Z" : null,
      segments: open.includes(d) ? [{ start: d + "T09:00:00Z", end: d + "T17:00:00Z" }] : [],
      evidence: [],
      candidates: [],
      selectedBranch: null,
    };
  });
  return {
    ...base,
    calendarId: id,
    timezone: "UTC",
    coverage: { start: "2026-01-02", end: "2026-01-09", complete: true },
    days,
  } as CalendarBundle;
}
it("shifts strictly around closed anchors and keeps zero unchanged", () => {
  const i = createIndex(bundle());
  expect(shiftSessionDate(i, "2026-01-03", 1)).toMatchObject({ status: "resolved", value: "2026-01-05" });
  expect(shiftSessionDate(i, "2026-01-07", -1)).toMatchObject({ value: "2026-01-05" });
  expect(shiftSessionDate(i, "2026-01-03", 0)).toMatchObject({ value: "2026-01-03" });
  expect(shiftSessionDate(i, "2026-01-03", 10001)).toMatchObject({ status: "unavailable", reason: "RESOURCE_LIMIT" });
});
it("counts explicit Saturday openings rather than weekdays", () => {
  const i = createIndex(bundle("exchange:XTAI", ["2026-01-02", "2026-01-03", "2026-01-07"]));
  expect(shiftSessionDate(i, "2026-01-02", 1)).toMatchObject({ value: "2026-01-03" });
  expect(rollSessionDate(i, "2026-01-05", "following")).toMatchObject({ value: "2026-01-07" });
});
it("does not conflate FX currency-payment closure with quoting availability", () => {
  const a = createIndex(bundle("exchange:FX", ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]));
  const b = createIndex({
    ...bundle("payment:EU-T2", ["2026-01-02", "2026-01-06", "2026-01-07"]),
    kind: "currency_payment",
    currency: "EUR",
  });
  expect(jointDates([a, b], "all_open", "2026-01-02", "2026-01-07")).toMatchObject({
    value: ["2026-01-02", "2026-01-06", "2026-01-07"],
  });
  expect(jointDates([a, b], "any_open", "2026-01-02", "2026-01-07")).toMatchObject({
    value: ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"],
  });
});
it("requires all member coverage even for union", () => {
  const b = bundle();
  b.days.shift();
  b.coverage.start = "2026-01-03";
  expect(jointDates([createIndex(bundle()), createIndex(b)], "any_open", "2026-01-02", "2026-01-05")).toMatchObject({
    status: "unavailable",
    reason: "COVERAGE_UNAVAILABLE",
  });
});
it("blocks provisional and conflict days under operational-v1 and resolves confirmed ones (ruling 2026-10-23)", () => {
  for (const status of ["library_baseline", "authority_confirmed", "market_final", "operator_final"] as const) {
    const b = bundle();
    b.days[3].evidenceStatus = status;
    expect(shiftSessionDate(createIndex(b), "2026-01-03", 1)).toMatchObject({ status: "resolved", value: "2026-01-05" });
  }
  const provisional = bundle();
  provisional.days[3].evidenceStatus = "provisional";
  expect(shiftSessionDate(createIndex(provisional), "2026-01-03", 1)).toMatchObject({
    status: "unavailable",
    reason: "PROVISIONAL_CALENDAR",
  });
  expect(shiftSessionDate(createIndex(provisional), "2026-01-03", 1, "planning-v1")).toMatchObject({
    status: "provisional",
    value: "2026-01-05",
  });
  const conflict = bundle();
  conflict.days[3].evidenceStatus = "conflict";
  expect(shiftSessionDate(createIndex(conflict), "2026-01-03", 1, "planning-v1")).toMatchObject({
    status: "unavailable",
    reason: "AMBIGUOUS_CALENDAR",
  });
});
it("retains actual early closes and uses inclusive completed close", () => {
  const i = createIndex(base as CalendarBundle);
  expect(sessionBounds(i, "2026-11-27")).toMatchObject({
    value: { open: "2026-11-27T14:30:00Z", close: "2026-11-27T18:00:00Z" },
  });
  expect(lastCompleted(i, "2026-11-27T18:00:00Z")).toMatchObject({ value: "2026-11-27" });
});
