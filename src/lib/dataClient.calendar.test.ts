// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";

// plugin-http's fetch is a drop-in for the platform fetch; the real one here
// exercises the mock server over genuine HTTP, as useParamOptions.test.tsx does.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

import { backend } from "../test/fixtures";
import { startMockServer, type MockServer } from "../test/mockServer";
import { CALENDAR_PATH, fetchTradingCalendar } from "./dataClient";

const servers: MockServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("fetchTradingCalendar", () => {
  it("asks the well-known path with exchange and year, carrying the backend's credential", async () => {
    const s = await startMockServer({
      [`/${CALENDAR_PATH}`]: (url: URL) =>
        url.searchParams.get("exchange") === "XNYS" ? { data: { Timezone: "America/New_York" } } : { __status: 404 },
    });
    servers.push(s);
    const b = backend({ baseUrl: s.url, headerName: "Authorization", headerValue: "Basic abc", authLocation: "header" });
    const payload = await fetchTradingCalendar(b, "XNYS", 2026);
    expect(payload).toEqual({ data: { Timezone: "America/New_York" } });
    expect(s.requests[0].path).toBe("/api/v1/calendar/trading");
    expect(s.requests[0].search).toBe("?exchange=XNYS&year=2026");
    expect(s.requests[0].headers.authorization).toBe("Basic abc");
  });

  it("resolves null on a 404 — a backend without the route is an answer, not a failure", async () => {
    const s = await startMockServer({});
    servers.push(s);
    await expect(fetchTradingCalendar(backend({ baseUrl: s.url }), "XLON", 2026)).resolves.toBeNull();
  });

  it("throws on any other failure, with the status in the message", async () => {
    const s = await startMockServer({ [`/${CALENDAR_PATH}`]: { __status: 500 } });
    servers.push(s);
    await expect(fetchTradingCalendar(backend({ baseUrl: s.url }), "XNYS", 2026)).rejects.toThrow("HTTP 500");
  });
});
