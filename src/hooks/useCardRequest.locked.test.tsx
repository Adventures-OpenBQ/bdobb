// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

import { makeDefaultDocks } from "../lib/dashboardsFile";
import { previewExpression } from "../lib/dateExpressions";
import { __resetLoggerForTests } from "../lib/logger";
import { fieldContext, wireParams } from "../lib/params";
import type { BackendConfig, Dashboard, DashboardCard, WidgetDef } from "../lib/types";
import { useDashboardStore } from "../stores/dashboardStore";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
import { __reset } from "../test/memfs";
import { startMockServer, type MockServer } from "../test/mockServer";
import { useCardRequest } from "./useCardRequest";
import { __resetTradingCalendarCacheForTests } from "./useTradingCalendar";

/** Fabricated closures: XLON shuts Fri 11 Sep 2026, XNYS does not -- so T-1bd on Mon 14 Sep tells them apart. */
function calendarFor(url: URL): unknown {
  const mic = url.searchParams.get("exchange");
  if (mic !== "XNYS" && mic !== "XLON") return { __status: 404 };
  const holidays = mic === "XLON" && url.searchParams.get("year") === "2026" ? { "2026-09-11": { Holiday: "Fixture Day", Type: "Official" } } : {};
  return {
    data: {
      Name: `Mock ${mic}`,
      Timezone: mic === "XLON" ? "Europe/London" : "America/New_York",
      TradingHours: { Open: "09:00:00", Close: "16:00:00", WorkingDays: "Mon, Tue, Wed, Thu, Fri" },
      ExchangeHolidays: holidays,
    },
  };
}

const widget: WidgetDef = makeWidget({
  id: "w1",
  params: [
    { paramName: "symbol", type: "text" },
    { paramName: "d", type: "date" },
  ],
});
const docks: Dashboard = makeDefaultDocks();
const london = { id: "lon", name: "London", exchange: "XLON", tabs: [] } as unknown as Dashboard;
const newYork = { id: "nyc", name: "New York", exchange: "XNYS", tabs: [] } as unknown as Dashboard;
const servers: MockServer[] = [];

async function serve(): Promise<BackendConfig> {
  const s = await startMockServer({ "/api/v1/calendar/trading": (url: URL) => calendarFor(url) });
  servers.push(s);
  return backend({ baseUrl: s.url });
}

/** What the card previews (ParamControls' `wire`) and what it sends (useWidgetData), from one useCardRequest result. */
function previewAndSend(r: ReturnType<typeof useCardRequest>): { preview: string; sent: string } {
  const ctx = { exchange: r.exchange, calendars: r.trading.calendars };
  const preview = previewExpression("date", r.params.d, fieldContext(widget, widget.params[1], ctx, r.params))?.text ?? "";
  const sent = wireParams(widget, r.query, { ...ctx, fiscalYearEnd: r.fiscalYearEnd }).d;
  return { preview, sent };
}

function mount(card: DashboardCard, b: BackendConfig, dashboard: Dashboard = docks) {
  return renderHook(() => useCardRequest(card, widget, b, dashboard));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 14, 9, 30, 0));
  __reset();
  __resetLoggerForTests();
  __resetTradingCalendarCacheForTests();
  useDashboardStore.setState({ dashboards: [london, newYork], activeId: "lon", docks });
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("ruling RW8: a locked card takes the on-screen dashboard's exchange", () => {
  it("resolves a locked T-1bd card on XLON, in preview and send, on an XLON dashboard", async () => {
    const { result } = mount(makeCard({ id: "lk", widgetId: "w1", params: { d: "T-1bd" } }), await serve());
    expect(result.current.exchange).toBe("XLON");
    await waitFor(() => expect(previewAndSend(result.current).sent).toBe("2026-09-10"));
    expect(previewAndSend(result.current).preview).toContain("2026-09-10");
  });

  it("re-resolves on XNYS when the user switches to an XNYS dashboard", async () => {
    const { result } = mount(makeCard({ id: "lk", widgetId: "w1", params: { d: "T-1bd" } }), await serve());
    await waitFor(() => expect(previewAndSend(result.current).sent).toBe("2026-09-10"));
    const before = result.current.hold.key;
    act(() => useDashboardStore.setState({ activeId: "nyc" }));
    expect(result.current.exchange).toBe("XNYS");
    await waitFor(() => expect(previewAndSend(result.current).sent).toBe("2026-09-11"));
    expect(previewAndSend(result.current).preview).toContain("2026-09-11");
    // The calendars key is what useWidgetData's fetch effect depends on: it moved, so the card refetches.
    expect(result.current.hold.key).not.toBe(before);
  });

  it("keeps a locked VOD.L card on XLON on any dashboard (the symbol rung wins)", async () => {
    act(() => useDashboardStore.setState({ activeId: "nyc" }));
    const { result } = mount(makeCard({ id: "lk", widgetId: "w1", params: { symbol: "VOD.L", d: "T-1bd" } }), await serve());
    await waitFor(() => expect(previewAndSend(result.current).sent).toBe("2026-09-10"));
    expect(previewAndSend(result.current).preview).toContain("2026-09-10");
  });

  it("leaves a pinned card on its own dashboard's exchange, whatever is on screen", async () => {
    act(() => useDashboardStore.setState({ activeId: "nyc" }));
    const { result } = mount(makeCard({ id: "pc", widgetId: "w1", params: { d: "T-1bd" }, pinned: "top" }), await serve(), london);
    expect(result.current.exchange).toBe("XLON");
    await waitFor(() => expect(previewAndSend(result.current).sent).toBe("2026-09-10"));
  });
});
