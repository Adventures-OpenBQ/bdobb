// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import xlon from "./vendor/conformance/XLON.json";
import { clearCalendarBundles, peekWidgetCalendars } from "./bundles";
import { fetchWidgetData } from "../dataClient";
import { previewExpression } from "../dateExpressions";
import { fieldContext, wireParams } from "../params";
import { backend, widget } from "../../test/fixtures";
import { startMockServer, type MockServer } from "../../test/mockServer";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
vi.stubGlobal("crypto", webcrypto);
const servers: MockServer[] = [];
beforeEach(() => clearCalendarBundles());
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

it("gives one field the same value in preview, the Run check and the bundle GET (spec Tests)", async () => {
  const server = await startMockServer({
    "/api/v1/calendar/trading/v1/bundle": () => xlon,
    "/prices": (url: URL) => [{ date: url.searchParams.get("d") }],
  });
  servers.push(server);
  const b = backend({ baseUrl: server.url });
  const w = widget({ endpoint: "prices", calendarBinding: { schemaVersion: 1, kind: "single", calendarId: "exchange:XLON" }, params: [{ paramName: "d", type: "date" }] });
  const values = { d: "T-1bd" };
  const now = new Date("2026-12-29T12:00:00Z");

  expect(await fetchWidgetData(b, w, values, { now })).toEqual([{ date: "2026-12-24" }]);
  const { calendars, pending } = peekWidgetCalendars(b, w, values, undefined, now);
  expect(pending).toBe(false);
  expect(wireParams(w, values, { now, calendars })).toEqual({ d: "2026-12-24" });
  expect(previewExpression("date", "T-1bd", { now, ...fieldContext(w, w.params[0], { calendars }, values) })?.text).toBe("2026-12-24");
  // Data bounds still answer earliest/latest on a bound card (moved from PR #67's widget.test).
  expect(wireParams(w, { d: "earliest" }, { now, calendars, bounds: { min: new Date("2026-12-22T09:00:00Z"), max: now } })).toEqual({ d: "2026-12-22" });
});
