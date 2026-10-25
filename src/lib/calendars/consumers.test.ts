// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import fixture from "./vendor/conformance/XNYS.json";
import { createBundleProvider } from "./provider";
import { sharedBundleCache } from "./bundles";
import { resolveCalendarFields } from "./consumers";
vi.stubGlobal("crypto", webcrypto);
const binding = { schemaVersion: 1 as const, kind: "single" as const, calendarId: "exchange:XNYS" };
it("resolves typed sibling fields once and preserves expression provenance", async () => {
  const run = await resolveCalendarFields(
    [
      { fieldId: "start", expression: "T-1bd", outputType: "date", binding },
      { fieldId: "end", expression: "session_close", outputType: "datetime", binding },
    ],
    createBundleProvider("test", sharedBundleCache, async () => fixture),
    "2026-11-27T19:00:00Z",
    new AbortController().signal,
    { start: "2026-11-25", end: "2026-11-28" },
  );
  expect(run.values).toEqual({ start: "2026-11-25", end: "2026-11-27T13:00:00-05:00" });
  expect(run.results.every((r) => r.context.referenceInstant === "2026-11-27T19:00:00Z")).toBe(true);
  expect(run.results[0]).toMatchObject({ expression: "T-1bd", authority: "client" });
});
it("stops a request when a selected calendar cannot resolve an expression", async () => {
  await expect(
    resolveCalendarFields(
      [{ fieldId: "start", expression: "T-10bd", outputType: "date", binding }],
      createBundleProvider("test", sharedBundleCache, async () => fixture),
      "2026-11-27T19:00:00Z",
      new AbortController().signal,
      { start: "2026-11-25", end: "2026-11-28" },
    ),
  ).rejects.toThrow("start: COVERAGE_UNAVAILABLE");
});
it("resolves property-name field IDs without inherited values", async () => {
  const run = await resolveCalendarFields(
    [{ fieldId: "__proto__", expression: "T-1bd", outputType: "date", binding }],
    createBundleProvider("test", sharedBundleCache, async () => fixture),
    "2026-11-27T19:00:00Z",
    new AbortController().signal,
    { start: "2026-11-25", end: "2026-11-28" },
  );
  expect(Object.hasOwn(run.values, "__proto__")).toBe(true);
  expect(run.values.__proto__).toBe("2026-11-25");
});
