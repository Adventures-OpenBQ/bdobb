// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import xlon from "./vendor/conformance/XLON.json";
import xtai from "./vendor/conformance/XTAI.json";
import xtks from "./vendor/conformance/XTKS.json";
import { canonical, sha256 } from "./artifact";
import { LIMITS } from "./contracts";
import {
  clearCalendarBundles,
  forgetCalendarRefusal,
  loadCalendarBundle,
  loadWidgetCalendars,
  peekCalendarBundle,
  peekWidgetCalendars,
} from "./bundles";
import { bundleWindow, calendarWindow } from "./window";
import { HttpError } from "../dataClient";
import { wireParams } from "../params";
import { backend, widget } from "../../test/fixtures";

vi.stubGlobal("crypto", webcrypto);
beforeEach(() => clearCalendarBundles());

const bound = widget({ calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, params: [{ paramName: "d", type: "date" }] });
const now = new Date("2026-12-29T12:00:00Z");
const signal = () => new AbortController().signal;

describe("bundleWindow (review I2)", () => {
  it("sizes whole years to the expressions' reach", () => {
    expect(bundleWindow(["T-1bd"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2024-01-01", end: "2028-12-31" });
    expect(bundleWindow(["T-5y"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2019-01-01", end: "2033-12-31" });
    expect(bundleWindow(["T-300bd"], new Date("2026-01-05T00:00:00Z"))).toEqual({ start: "2023-01-01", end: "2029-12-31" });
    expect(bundleWindow(["2026-01-01", "AAPL"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2025-01-01", end: "2027-12-31" });
  });

  it("stops inside the contract's 20-year limit", () => {
    expect(bundleWindow(["T-9999bd"], new Date("2026-06-01T00:00:00Z"))).toEqual({ start: "2017-01-01", end: "2035-12-31" });
  });
});

describe("the shared bundle cache (review I3)", () => {
  const window = { start: "2025-01-01", end: "2027-12-31" };

  it("fetches once per scope, and never shares across credentials", async () => {
    const fetch = vi.fn(async () => xlon);
    const a = backend({ headerName: "Authorization", headerValue: "a" });
    const b = backend({ headerName: "Authorization", headerValue: "b" });
    await loadCalendarBundle(a, "exchange:XLON", window, fetch, signal());
    await loadCalendarBundle(a, "exchange:XLON", window, fetch, signal());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(peekCalendarBundle(b, "exchange:XLON", window).bundle).toBeUndefined();
    await loadCalendarBundle(b, "exchange:XLON", window, fetch, signal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("drops an in-flight answer when the scope is cleared (review focus 4)", async () => {
    let finish!: (v: unknown) => void;
    const pending = loadCalendarBundle(backend(), "exchange:XLON", window, () => new Promise((r) => (finish = r)), signal());
    clearCalendarBundles();
    finish(xlon);
    await expect(pending).rejects.toThrow("CALENDAR_SCOPE_CHANGED");
    expect(peekCalendarBundle(backend(), "exchange:XLON", window).bundle).toBeUndefined();
  });

  it("refuses a bundle past LIMITS.bytes, and remembers why", async () => {
    const huge = async () => ({ pad: "x".repeat(LIMITS.bytes) });
    await expect(loadCalendarBundle(backend(), "exchange:XLON", window, huge, signal())).rejects.toThrow("larger than");
    expect(peekCalendarBundle(backend(), "exchange:XLON", window).refusal).toMatch(/larger than/);
  });
});

describe("a calendar's earliest date (P11)", () => {
  it("clamps the window's start to what XTAI and XTKS advertise, and leaves the rest alone", async () => {
    const fetch = vi.fn(async (id: string) => (id === "exchange:XTAI" ? xtai : xtks));
    const window = bundleWindow(["T-9999bd"], new Date("2026-06-01T00:00:00Z"));
    await loadCalendarBundle(backend(), "exchange:XTAI", window, fetch, signal());
    await loadCalendarBundle(backend(), "exchange:XTKS", { start: "1990-01-01", end: "2027-12-31" }, fetch, signal());
    expect(fetch.mock.calls).toEqual([
      ["exchange:XTAI", { start: "2019-01-01", end: "2035-12-31" }],
      ["exchange:XTKS", { start: "1997-01-01", end: "2027-12-31" }],
    ]);
    expect(peekCalendarBundle(backend(), "exchange:XTAI", window).bundle?.calendarId).toBe("exchange:XTAI");
  });
});

describe("the provider's real bounds (ruling R10b)", () => {
  it("cuts every calendar's window to 1990-01-01 .. 2040-12-31", async () => {
    const fetch = vi.fn(async () => xlon);
    await loadCalendarBundle(backend(), "exchange:XLON", bundleWindow(["T-40y"], new Date("1995-06-01T00:00:00Z")), fetch, signal());
    await loadCalendarBundle(backend(), "exchange:XLON", bundleWindow(["T+20y"], new Date("2035-06-01T00:00:00Z")), fetch, signal());
    expect(fetch.mock.calls).toEqual([
      ["exchange:XLON", { start: "1990-01-01", end: "2004-12-31" }],
      ["exchange:XLON", { start: "2026-01-01", end: "2040-12-31" }],
    ]);
  });

  it("errors only the atom that reaches past the bundle; its sibling still resolves", async () => {
    const w = widget({
      calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" },
      params: ["d", "e", "f"].map((paramName) => ({ paramName, type: "date" })),
    });
    const values = { d: "T-1bd", e: "T+20y+1bd", f: "T-40y-1bd" };
    const { calendars } = await loadWidgetCalendars(backend(), w, values, undefined, now, async () => xlon, signal());
    const errors: Record<string, string> = {};
    expect(wireParams(w, values, { now, calendars, errors })).toEqual({ d: "2026-12-24", e: "", f: "" });
    expect(Object.keys(errors)).toEqual(["e", "f"]);
    expect(errors.e).toMatch(/COVERAGE_UNAVAILABLE/);
    expect(errors.f).toMatch(/COVERAGE_UNAVAILABLE/);
  });
});

describe("the catalogue's bounds (2026-10-24, review focus 1)", () => {
  it("clamps both ends into a calendar's served dates, never past them", () => {
    expect(calendarWindow("exchange:XSHG", { start: "1989-01-01", end: "1992-12-31" })).toEqual({ start: "1990-12-03", end: "1992-12-31" });
    expect(calendarWindow("exchange:XSES", { start: "2025-01-01", end: "2029-12-31" })).toEqual({ start: "2025-01-01", end: "2026-12-31" });
    expect(calendarWindow("exchange:XSES", { start: "2029-01-01", end: "2033-12-31" })).toEqual({ start: "2026-12-31", end: "2026-12-31" });
    expect(calendarWindow("exchange:XTAI", { start: "1993-01-01", end: "1997-12-31" })).toEqual({ start: "2019-01-01", end: "2019-01-01" });
    expect(calendarWindow("payment:T2", { start: "1980-01-01", end: "2050-12-31" })).toEqual({ start: "1990-01-01", end: "2040-12-31" });
  });

  it("errors an XSES atom that needs a day past 2026-12-31, sends nothing for it, and clamps the window (fix round 1, item 5)", async () => {
    // XSES as openbq-docker serves it: coverage stops at the catalogue's 2026-12-31. Re-digested, as bundleCalendar checks.
    const content = {
      ...Object.fromEntries(Object.entries(xlon).filter(([k]) => k !== "digest" && k !== "generatedAt")),
      calendarId: "exchange:XSES",
      name: "Singapore Exchange",
      timezone: "Asia/Singapore",
      coverage: { ...xlon.coverage, end: "2026-12-31" },
      days: xlon.days.filter((d) => d.date <= "2026-12-31"),
    };
    const xses = { ...content, generatedAt: xlon.generatedAt, digest: await sha256(canonical(content)) };
    const fetch = vi.fn(async () => xses as unknown as typeof xlon);
    const w = widget({
      calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XSES" },
      params: [
        ...["d", "e", "f"].map((paramName) => ({ paramName, type: "date" })),
        { paramName: "g", type: "datetime" },
      ],
    });
    const values = { d: "T+3mo+1bd(XSES)", e: "T-1bd(XSES)", f: "T+3mo(XSES)", g: "T+3mo@close(XSES)" };
    const { calendars } = await loadWidgetCalendars(backend(), w, values, undefined, now, fetch, signal());
    const [[, asked]] = fetch.mock.calls as unknown as [[string, { start: string; end: string }]];
    expect(asked).toEqual({ start: "2024-01-01", end: "2026-12-31" });
    const errors: Record<string, string> = {};
    // T+3mo counts calendar months and needs no session, so it still sends (the calendar-free rule, review focus 3).
    expect(wireParams(w, values, { now, calendars, errors })).toEqual({ d: "", e: "2026-12-24", f: "2027-03-29", g: "" });
    expect(Object.keys(errors).sort()).toEqual(["d", "g"]);
    expect(errors.d).toMatch(/COVERAGE_UNAVAILABLE/);
    expect(errors.g).toMatch(/COVERAGE_UNAVAILABLE/);
  });
});

describe("which failures are remembered (ruling R10a)", () => {
  const window = { start: "2025-01-01", end: "2027-12-31" };

  it("asks again after a network error or a 5xx", async () => {
    const fetch = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("network unreachable"))
      .mockRejectedValueOnce(new HttpError("HTTP 503", 503, ""))
      .mockResolvedValueOnce(xlon);
    await expect(loadCalendarBundle(backend(), "exchange:XLON", window, fetch, signal())).rejects.toThrow("network");
    expect(peekCalendarBundle(backend(), "exchange:XLON", window).refusal).toBeUndefined();
    await expect(loadCalendarBundle(backend(), "exchange:XLON", window, fetch, signal())).rejects.toThrow("HTTP 503");
    expect((await loadCalendarBundle(backend(), "exchange:XLON", window, fetch, signal())).calendarId).toBe("exchange:XLON");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("remembers a 422, and Retry's forget asks again", async () => {
    const fetch = vi.fn<() => Promise<unknown>>().mockRejectedValueOnce(new HttpError("HTTP 422", 422, "")).mockResolvedValue(xlon);
    await expect(loadCalendarBundle(backend(), "exchange:XLON", window, fetch, signal())).rejects.toThrow("HTTP 422");
    await expect(loadCalendarBundle(backend(), "exchange:XLON", window, fetch, signal())).rejects.toThrow("HTTP 422");
    expect(fetch).toHaveBeenCalledTimes(1);
    forgetCalendarRefusal(backend(), "exchange:XLON", window);
    expect((await loadCalendarBundle(backend(), "exchange:XLON", window, fetch, signal())).calendarId).toBe("exchange:XLON");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("widget calendars", () => {
  it("serves a placeholder while loading, then the bundle calendar", async () => {
    const before = peekWidgetCalendars(backend(), bound, { d: "T-1bd" }, undefined, now);
    expect(before.pending).toBe(true);
    expect(before.calendars.XLON.unavailable).toBe("XLON calendar unavailable: still loading");
    const after = await loadWidgetCalendars(backend(), bound, { d: "T-1bd" }, undefined, now, async () => xlon, signal());
    expect(after.pending).toBe(false);
    expect(after.calendars.XLON.sessionIndex).toBeDefined();
  });

  it("never holds a card whose values are literal (PR #67 kept literal cards off the bundle path)", () => {
    expect(peekWidgetCalendars(backend(), bound, { d: "2026-12-01" }, undefined, now).pending).toBe(false);
  });

  it("names a refusal in the placeholder", async () => {
    const refused = await loadWidgetCalendars(backend(), bound, { d: "T-1bd" }, undefined, now, async () => {
      throw new HttpError("HTTP 422", 422, "");
    }, signal());
    expect(refused.calendars.XLON.unavailable).toBe("XLON calendar unavailable: HTTP 422");
  });
});
