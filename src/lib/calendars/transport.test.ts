// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import fixture from "./vendor/conformance/XNYS.json";
import { fetchWidgetData } from "../dataClient";
import { clearCalendarBundles } from "./bundles";
import { backend, widget } from "../../test/fixtures";
import { startMockServer, type MockServer } from "../../test/mockServer";
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
vi.stubGlobal("crypto", webcrypto);
const servers: MockServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
beforeEach(() => clearCalendarBundles());

it("submits the resolved literal through the real widget transport", async () => {
  const server = await startMockServer({ "/api/v1/calendar/trading/v1/bundle": () => fixture, "/prices": (url: URL) => [{ date: url.searchParams.get("d") }] });
  servers.push(server);
  const w = widget({ endpoint: "prices", calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" }, params: [{ paramName: "d", type: "date" }] });
  expect(await fetchWidgetData(backend({ baseUrl: server.url }), w, { d: "T-1bd" }, { now: new Date("2026-11-27T19:00:00Z") })).toEqual([{ date: "2026-11-25" }]);
});

it("does not submit a query when the calendar is unavailable, and says which field and calendar", async () => {
  const server = await startMockServer({ "/api/v1/calendar/trading/v1/bundle": () => ({ __status: 422 }), "/prices": () => [] });
  servers.push(server);
  const w = widget({ endpoint: "prices", calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XNYS" }, params: [{ paramName: "d", type: "date" }] });
  await expect(fetchWidgetData(backend({ baseUrl: server.url }), w, { d: "T-1bd" })).rejects.toThrow(/^d: XNYS calendar unavailable: /);
  expect(server.requests.filter((r) => r.path === "/prices")).toHaveLength(0);
});
