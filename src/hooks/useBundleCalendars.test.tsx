// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import cmes from "../lib/calendars/vendor/conformance/CMES-2026-01.json";
import xlon from "../lib/calendars/vendor/conformance/XLON.json";
import xnys from "../lib/calendars/vendor/conformance/XNYS-2026-12.json";
import { weekdayCalendar } from "../lib/calendar";
import { clearCalendarBundles, peekCalendarBundle } from "../lib/calendars/bundles";
import { bundleWindow } from "../lib/calendars/window";
import { formSubmitBody, sendParams, wireParams } from "../lib/params";
import { backend, widget } from "../test/fixtures";
import { startMockServer, type MockServer } from "../test/mockServer";
import { useBundleCalendars, withOvernight } from "./useBundleCalendars";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
// Final review I-B: when set, the next widget load evicts its own bundles (32 other windows through the shared FIFO
// cache) after it lands and before the hook re-renders -- another card's loads doing exactly that.
const evict = vi.hoisted(() => ({ next: false }));
vi.mock("../lib/calendars/bundles", async (orig) => {
  const real = await orig<typeof import("../lib/calendars/bundles")>();
  return {
    ...real,
    loadWidgetCalendars: async (...args: Parameters<typeof real.loadWidgetCalendars>) => {
      const result = await real.loadWidgetCalendars(...args);
      if (evict.next) {
        evict.next = false;
        const [b, , , , , fetchBundle, signal] = args;
        for (let y = 1995; y < 2027; y++) {
          await real.loadCalendarBundle(b, "exchange:XLON", { start: `${y}-01-01`, end: `${y}-01-02` }, fetchBundle, signal);
        }
      }
      return result;
    },
  };
});
vi.stubGlobal("crypto", webcrypto);
const servers: MockServer[] = [];
beforeEach(() => clearCalendarBundles());
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const w = widget({ calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, params: [{ paramName: "d", type: "date" }] });
const now = new Date("2026-12-29T12:00:00Z");
const BUNDLE = "/api/v1/calendar/trading/v1/bundle";

async function serve() {
  const server = await startMockServer({ [BUNDLE]: () => xlon });
  servers.push(server);
  return server;
}

it("holds the card on a placeholder, then serves the bundle calendar", async () => {
  const server = await serve();
  const { result } = renderHook(() => useBundleCalendars(w, { d: "T-1bd" }, backend({ baseUrl: server.url }), undefined, now));
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(wireParams(w, { d: "T-1bd" }, { now, calendars: result.current.calendars })).toEqual({ d: "2026-12-24" });
});

it("re-asks under a new credential (review focus 4)", async () => {
  const server = await serve();
  const { result, rerender } = renderHook(({ value }) => useBundleCalendars(w, { d: "T-1bd" }, backend({ baseUrl: server.url, headerName: "Authorization", headerValue: value }), undefined, now), {
    initialProps: { value: "a" },
  });
  await waitFor(() => expect(result.current.pending).toBe(false));
  rerender({ value: "b" });
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(server.requests.filter((r) => r.path === BUNDLE)).toHaveLength(2);
});

it("lets the shared fetch finish after the card unmounts, without publishing to it", async () => {
  const server = await serve();
  const b = backend({ baseUrl: server.url });
  const { unmount } = renderHook(() => useBundleCalendars(w, { d: "T-1bd" }, b, undefined, now));
  unmount();
  await waitFor(() => expect(peekCalendarBundle(b, "exchange:XLON", bundleWindow(["T-1bd"], now)).bundle).toBeDefined());
});

it("shows a 5xx as an error, not endless loading, and Retry asks again (review I1)", async () => {
  let asked = 0;
  const server = await startMockServer({ [BUNDLE]: () => (asked++ === 0 ? { __status: 503 } : xlon) });
  servers.push(server);
  const { result } = renderHook(() => useBundleCalendars(w, { d: "T-1bd" }, backend({ baseUrl: server.url }), undefined, now));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(Object.values(result.current.calendars).map((c) => c.unavailable)).toEqual([expect.stringContaining("calendar unavailable")]);
  act(() => result.current.retry?.());
  await waitFor(() => expect(wireParams(w, { d: "T-1bd" }, { now, calendars: result.current.calendars })).toEqual({ d: "2026-12-24" }));
  expect(server.requests.filter((r) => r.path === BUNDLE)).toHaveLength(2);
});

it("drops a bundle still in flight when the credential changes, and loads under the new one (review focus 4)", async () => {
  // The old credential's answer arrives late and wrong (another calendar's bundle): shown, it would be an error.
  let asked = 0;
  const server = await startMockServer({
    [BUNDLE]: () => (asked++ === 0 ? { __delayMs: 300, __status: 200, __body: xnys } : xlon),
  });
  servers.push(server);
  const seen: string[] = [];
  const { result, rerender } = renderHook(
    ({ value }) => {
      const r = useBundleCalendars(w, { d: "T-1bd" }, backend({ baseUrl: server.url, headerName: "Authorization", headerValue: value }), undefined, now);
      for (const c of Object.values(r.calendars)) if (c.unavailable) seen.push(c.unavailable);
      return r;
    },
    { initialProps: { value: "a" } },
  );
  await waitFor(() => expect(server.requests.filter((r) => r.path === BUNDLE)).toHaveLength(1));
  rerender({ value: "b" });
  await waitFor(() => expect(result.current.pending).toBe(false));
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(wireParams(w, { d: "T-1bd" }, { now, calendars: result.current.calendars })).toEqual({ d: "2026-12-24" });
  expect(server.requests.filter((r) => r.path === BUNDLE).map((r) => r.headers.authorization)).toEqual(["a", "b"]);
  expect(seen.filter((m) => !m.endsWith("still loading"))).toEqual([]);
});

it("refetches a bundle evicted between its load and the re-render, without an edit or Retry (final review I-B)", async () => {
  const server = await serve();
  const b = backend({ baseUrl: server.url });
  evict.next = true;
  const { result } = renderHook(() => useBundleCalendars(w, { d: "T-1bd" }, b, undefined, now));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(wireParams(w, { d: "T-1bd" }, { now, calendars: result.current.calendars })).toEqual({ d: "2026-12-24" });
  expect(peekCalendarBundle(b, "exchange:XLON", bundleWindow(["T-1bd"], now)).bundle).toBeDefined();
});

it("loads a bound card's bundle for a form date field when the card has no date param, and POSTs it (final rereview I-A)", async () => {
  const server = await serve();
  const go = { paramName: "go", type: "button" as const, label: "Go" };
  const form = { endpoint: "x", inputs: [{ paramName: "d", type: "date" as const }, go] };
  const fw = widget({ calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, params: [{ paramName: "f", type: "form", form }] });
  const values = { "f.d": "T-1bd" };
  const { result } = renderHook(() => useBundleCalendars(fw, values, backend({ baseUrl: server.url }), undefined, now));
  // Submitted before the bundle lands: refused, and the message says it is still loading (ruling RF5 item 3).
  expect(() => formSubmitBody("f", form, values, go, { now, calendars: result.current.calendars, widget: fw })).toThrow(/still loading/);
  await waitFor(() => expect(formSubmitBody("f", form, values, go, { now, calendars: result.current.calendars, widget: fw })).toEqual({ d: "2026-12-24", go: true }));
  expect(server.requests.filter((r) => r.path === BUNDLE)).toHaveLength(1);
});

const legacyCme = widget({ exchange: "CMES", params: [{ paramName: "d", type: "datetime" }] });
const monday = new Date("2026-01-05T15:00:00Z");

it("serves a legacy card's overnight calendar from the bundle route (spec: overnight calendars)", async () => {
  const server = await startMockServer({ [BUNDLE]: () => cmes });
  servers.push(server);
  const { result } = renderHook(() => useBundleCalendars(legacyCme, { d: "T@open" }, backend({ baseUrl: server.url }), undefined, monday));
  expect(result.current.pending).toBe(true);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(server.requests.filter((r) => r.path === BUNDLE)).toHaveLength(1);
  expect(wireParams(legacyCme, { d: "T@open" }, { now: monday, calendars: result.current.calendars })).toEqual({
    d: "2026-01-04T17:00:00-06:00",
  });
});

it("shows a legacy overnight card's refused bundle as an error, never weekdays", async () => {
  const server = await startMockServer({
    [BUNDLE]: { __status: 422, __body: { error: { code: "CALENDAR_UNAVAILABLE", message: "refused" } } },
  });
  servers.push(server);
  const { result } = renderHook(() => useBundleCalendars(legacyCme, { d: "T@open" }, backend({ baseUrl: server.url }), undefined, monday));
  await waitFor(() => expect(result.current.calendars.CMES?.unavailable).toMatch(/^CMES calendar unavailable/));
  expect(() => sendParams(legacyCme, { d: "T@open" }, { now: monday, calendars: result.current.calendars })).toThrow(
    /CMES calendar unavailable/,
  );
});

it("asks nothing for a legacy card on an ordinary calendar, and leaves its calendars as they are", async () => {
  const server = await serve();
  const plain = widget({ exchange: "XLON", params: [{ paramName: "d", type: "date" }] });
  const { result } = renderHook(() => useBundleCalendars(plain, { d: "T-1bd" }, backend({ baseUrl: server.url }), undefined, now));
  expect(result.current).toMatchObject({ calendars: {}, pending: false });
  await new Promise((r) => setTimeout(r, 20));
  expect(server.requests).toHaveLength(0);
  const legacy = { calendars: { XLON: weekdayCalendar("XLON") }, pending: false, key: "k" };
  expect(withOvernight(legacy, result.current)).toBe(legacy);
});
