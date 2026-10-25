// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import fixture from "./vendor/conformance/XNYS.json";
import { createBundleProvider, prepareCalendarBatch } from "./provider";
import { CalendarCache } from "./cache";
import { bundleScope, clearCalendarBundles, peekCalendarBundle, sharedBundleCache } from "./bundles";
import { backend } from "../../test/fixtures";
import { bundleRevision, type CalendarBundle } from "./contracts";
import { compileProgram } from "./program";
vi.stubGlobal("crypto", webcrypto);
beforeEach(() => clearCalendarBundles());
it("verifies retained bundles without requiring supplier code", async () => {
  const provider = createBundleProvider("retained", sharedBundleCache, async () => fixture);
  const b = await provider.load(
    { calendarId: "exchange:XNYS", start: "2026-11-25", end: "2026-11-28" },
    new AbortController().signal,
  );
  expect(b.days[2].close).toBe("2026-11-27T18:00:00Z");
  const altered = structuredClone(fixture);
  altered.days[2].close = "2026-11-27T19:00:00Z";
  altered.days[2].segments[0].end = altered.days[2].close;
  await expect(
    createBundleProvider("bad", sharedBundleCache, async () => altered).load(
      { calendarId: "exchange:XNYS", start: "2026-11-25", end: "2026-11-28" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("DIGEST_MISMATCH");
});
it("discarding scope prevents a delayed private response from repopulating cache", async () => {
  const cache = new CalendarCache();
  let finish!: (v: unknown) => void;
  const promise = cache.load(
    "scope-A",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    new AbortController().signal,
  );
  cache.clear();
  finish(fixture);
  await expect(promise).rejects.toThrow("CALENDAR_SCOPE_CHANGED");
  expect(cache.size).toBe(0);
});
it("captures one batch reference instant and exact bundle vector", async () => {
  const provider = createBundleProvider("retained", sharedBundleCache, async () => fixture);
  const batch = await prepareCalendarBatch(
    {
      referenceInstant: "2026-11-27T19:00:00Z",
      fields: [
        {
          fieldId: "date",
          program: compileProgram("T-1bd", "date"),
          binding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" },
          policy: "operational-v1",
        },
      ],
    },
    provider,
    new AbortController().signal,
    { start: "2026-11-25", end: "2026-11-28" },
  );
  expect(batch.fields[0].context.referenceInstant).toBe("2026-11-27T19:00:00Z");
  expect(batch.fields[0].context.vector[0].digest).toBe(fixture.digest);
});
it("reuses a cached bundle instead of re-downloading it on every load", async () => {
  const fetch = vi.fn(async () => fixture);
  const provider = createBundleProvider("retained", sharedBundleCache, fetch);
  const request = { calendarId: "exchange:XNYS", start: "2026-11-25", end: "2026-11-28" };
  await provider.load(request, new AbortController().signal);
  await provider.load(request, new AbortController().signal);
  await provider.load({ ...request, revision: bundleRevision(fixture as CalendarBundle) }, new AbortController().signal);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("never remembers an aborted fetch as a refusal (review minor, ruling R10a)", async () => {
  const fetch = vi
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"))
    .mockResolvedValueOnce(fixture);
  const provider = createBundleProvider("retained", sharedBundleCache, fetch);
  const request = { calendarId: "exchange:XNYS", start: "2026-11-25", end: "2026-11-28" };
  await expect(provider.load(request, new AbortController().signal)).rejects.toThrow("Cancelled");
  expect((await provider.load(request, new AbortController().signal)).calendarId).toBe("exchange:XNYS");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("loads into the app's shared, credential-scoped cache, which a credential change clears (ruling RF1)", async () => {
  const b = backend();
  const fetch = vi.fn(async () => fixture);
  const window = { start: "2026-11-25", end: "2026-11-28" };
  await createBundleProvider(bundleScope(b), sharedBundleCache, fetch).load({ calendarId: "exchange:XNYS", ...window }, new AbortController().signal);
  expect(peekCalendarBundle(b, "exchange:XNYS", window).bundle?.digest).toBe(fixture.digest);
  clearCalendarBundles();
  expect(peekCalendarBundle(b, "exchange:XNYS", window).bundle).toBeUndefined();
});
