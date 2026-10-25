// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

import { startMockServer, type MockServer } from "../test/mockServer";
import { __resetLoggerForTests } from "../lib/logger";
import { __read } from "../test/memfs";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import type { DashboardCard, WidgetDef } from "../lib/types";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { UNRESOLVED_BACKEND_ID } from "../lib/appsJson";
import { bundledCalendar } from "../lib/calendar";
import { stubMatchMedia, type MatchMediaStub } from "../test/matchMedia";
import { refreshIntervalMs, useWidgetData } from "./useWidgetData";
import { __resetTradingCalendarCacheForTests, useTradingCalendar } from "./useTradingCalendar";

/** Restores the real `hidden` getter Document.prototype already provides. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}
function restoreHidden() {
  delete (document as unknown as Record<string, unknown>).hidden;
}

const servers: MockServer[] = [];

const card = makeCard({ id: "c1", widgetId: "w1", params: { symbol: "AAPL" } });

function registerWidget() {
  useWidgetRegistryStore.setState({
    widgets: [
      makeWidget({
        id: "w1",
        name: "Price History",
        endpoint: "equity/price",
        dataKey: "results",
      }),
    ],
  });
}

beforeEach(() => {
  __resetLoggerForTests();
  useWidgetRegistryStore.setState({ widgets: [] });
  useBackendsStore.setState({ backends: [], statuses: {} });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useDashboardStore.setState({ refreshEpoch: 0 });
});

afterEach(async () => {
  vi.useRealTimers();
  restoreHidden();
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function serve(routes: Record<string, unknown>) {
  const s = await startMockServer(routes);
  servers.push(s);
  useBackendsStore.setState({ backends: [backend({ baseUrl: s.url })] });
  return s;
}

describe("useWidgetData", () => {
  it("re-reads staleness on the minute boundary, not on a 60-second interval of its own", () => {
    // useMinuteTick (one timeout to the next boundary) rather than a
    // free-running setInterval started whenever the card mounted.
    const every = vi.spyOn(globalThis, "setInterval");
    renderHook(() => useWidgetData(card, card.params));
    expect(every.mock.calls.filter((c) => c[1] === 60_000)).toHaveLength(0);
    every.mockRestore();
  });

  it("reports unresolved while the widget is not yet in the registry", () => {
    const { result } = renderHook(() => useWidgetData(card, card.params));
    expect(result.current.status).toBe("unresolved");
  });

  it("fetches on mount and reports the extracted data", async () => {
    await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([{ close: 1 }]);
  });

  it("sends the card's params", async () => {
    const server = await serve({ "/equity/price": { results: [] } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(server.requests[0].path).toBe("/equity/price");
    // Asserting on the path alone would pass identically even if params
    // were never forwarded — mockServer routes on pathname only, and
    // startMockServer's routes are keyed by pathname too. The query string
    // is the only place card.params = { symbol: "AAPL" } could show up.
    expect(server.requests[0].search).toBe("?symbol=AAPL");
  });

  it("does not refetch when params is a new object with the same values", async () => {
    // effectiveParams (src/lib/paramGroups.ts) returns a fresh object on
    // every call, and WidgetCard's memo can recompute for reasons that have
    // nothing to do with THIS card (see paramGroups.ts / WidgetCard.tsx).
    // The effect must key off the params' values, not the object's identity,
    // or an unrelated re-render anywhere upstream refetches every card.
    const server = await serve({ "/equity/price": { results: [] } });
    registerWidget();

    const { result, rerender } = renderHook(
      ({ params }: { params: Record<string, string> }) => useWidgetData(card, params),
      { initialProps: { params: { symbol: "AAPL" } } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(server.requests.filter((r) => r.path === "/equity/price")).toHaveLength(1);

    // A brand-new object literal, but with identical content to the first.
    rerender({ params: { symbol: "AAPL" } });

    // Give a wrongly-keyed effect a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(server.requests.filter((r) => r.path === "/equity/price")).toHaveLength(1);
  });

  it("logs a failure with the widget's name, id and backend, so a triage can tell same-id widgets apart", async () => {
    await serve({ "/equity/price": { __status: 500 } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("error"));

    await waitFor(() =>
      expect(__read("logs/bdobb.log") ?? "").toContain(
        'widget "Price History" (w1) on Local fetch failed: HTTP 500',
      ),
    );
  });

  it("does not fetch while a required param is empty, and names the param", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({
      widgets: st.widgets.map((w) => ({
        ...w,
        params: [
          { paramName: "symbol", label: "Symbol", optional: false },
          { paramName: "provider", value: "intrinio", show: false, optional: false },
        ],
      })),
    }));

    const { result, rerender } = renderHook(({ p }) => useWidgetData(card, p), {
      initialProps: { p: { symbol: "", provider: "intrinio" } },
    });

    await waitFor(() => expect(result.current.status).toBe("incomplete"));
    expect(result.current.error).toBe("Enter Symbol to load this widget.");
    expect(s.requests).toHaveLength(0);

    rerender({ p: { symbol: "AAPL", provider: "intrinio" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(s.requests).toHaveLength(1);
  });

  it("reports an error rather than throwing, and retries on demand", async () => {
    await serve({ "/equity/price": { __status: 500 } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("500");

    // Retry re-runs the fetch; still failing, so still an error.
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("retry increments the returned attempt, which is what a self-fetching renderer refreshes on", async () => {
    // A multi_file_viewer issues its own POST and has no request here to
    // repeat, so `attempt` is the only signal WidgetCard can hand it. If this
    // counter stopped being returned, that card's Refresh would go silently
    // back to doing nothing.
    await serve({ "/equity/price": { results: [{ a: 1 }] } });
    registerWidget();
    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.attempt).toBe(0);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.attempt).toBe(1));
  });

  it("retry runs a discovery sweep on an unresolved widget, and the card leaves the error state once the sweep resolves it", async () => {
    const server = await serve({
      "/widgets.json": { w1: { endpoint: "equity/price" } },
      "/equity/price": { results: [{ close: 1 }] },
    });
    // serve() only sets `backends`; mark the backend offline from a prior
    // sweep so the widget starts genuinely unresolved (registry stays empty).
    useBackendsStore.setState((s) => ({ statuses: { ...s.statuses, b1: "offline" } }));

    const { result } = renderHook(() => useWidgetData(card, card.params));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Backend is offline");
    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(0);

    act(() => result.current.retry());

    // The sweep hits widgets.json, populates the registry, and the effect's
    // normal fetch path takes over from there — proven by reaching "ready",
    // not by asserting a spy was called.
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.error).toBeUndefined();
    expect(useWidgetRegistryStore.getState().widgets).toHaveLength(1);
    expect(server.requests.some((r) => r.path === "/widgets.json")).toBe(true);
  });

  it("does not run a discovery sweep on retry when the widget is already resolved", async () => {
    const server = await serve({
      "/widgets.json": { w1: { endpoint: "equity/price" } },
      "/equity/price": { __status: 500 },
    });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("error"));

    const priceRequestsBefore = server.requests.filter((r) => r.path === "/equity/price").length;

    act(() => result.current.retry());

    await waitFor(() =>
      expect(server.requests.filter((r) => r.path === "/equity/price").length).toBe(
        priceRequestsBefore + 1,
      ),
    );

    // registerWidget() sets the widget directly, bypassing widgets.json
    // entirely — any request to it can only come from a sweep retry
    // triggered, which a resolved widget must not do.
    expect(server.requests.some((r) => r.path === "/widgets.json")).toBe(false);
  });

  it("reports an error when the card names a backend that no longer exists", async () => {
    registerWidget();
    useBackendsStore.setState({ backends: [] });

    const { result } = renderHook(() => useWidgetData(card, card.params));

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("reports a retryable error, not unresolved, when the owning backend is known offline", () => {
    useBackendsStore.setState({
      backends: [backend()],
      statuses: { b1: "offline" },
    });

    const { result } = renderHook(() => useWidgetData(card, card.params));

    expect(result.current.status).toBe("error");
    expect(result.current.retry).toBeInstanceOf(Function);
  });

  it("stays unresolved when the backend status is not yet known (discovery hasn't run)", () => {
    useBackendsStore.setState({
      backends: [backend()],
      statuses: { b1: "unknown" },
    });

    const { result } = renderHook(() => useWidgetData(card, card.params));

    expect(result.current.status).toBe("unresolved");
  });

  // -- Final-review Finding 2: the "do not fetch" guard is pinned by its use,
  // not just by builtins.test.ts's isolated check of fetchesData itself.
  // A real backend is running here; if the `!fetchesData(widget)` branch in
  // the effect above were ever deleted, these two would issue a request to
  // it (and, for the note case, land in the fetch's error branch and report
  // "Backend not configured" instead of "ready").
  describe("the do-not-fetch guard (Finding 2)", () => {
    it("issues no request and reports ready immediately for a built-in widget (no backend behind it)", async () => {
      const server = await serve({ "/equity/price": { results: [] } });
      useWidgetRegistryStore.setState({
        widgets: [
          makeWidget({
            id: "note",
            backendId: "builtin",
            name: "Note",
            type: "note",
            category: "Built-in",
            endpoint: "",
            gridData: { w: 15, h: 8 },
          }),
        ],
      });
      const noteCard: DashboardCard = { ...card, widgetId: "note", backendId: "builtin" };

      const { result } = renderHook(() => useWidgetData(noteCard, noteCard.params));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeUndefined();
      expect(server.requests).toHaveLength(0);
    });

    it("issues no request and reports ready immediately for a keys widget (its surface lives in Settings, and the tier-3 payload is never pulled for a card that can't show it)", async () => {
      const server = await serve({ "/keys": { tier: 3, rows: [] } });
      useWidgetRegistryStore.setState({
        widgets: [
          makeWidget({
            id: "provider_api_keys_panel",
            name: "Provider keys",
            type: "keys",
            category: "",
            endpoint: "keys",
          }),
        ],
      });
      const keysCard: DashboardCard = { ...card, widgetId: "provider_api_keys_panel" };

      const { result } = renderHook(() => useWidgetData(keysCard, keysCard.params));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.data).toBeNull();
      expect(server.requests).toHaveLength(0);
    });

    it("issues no request and reports ready immediately for an iframe widget (its endpoint IS the URL)", async () => {
      const server = await serve({ "/equity/price": { results: [] } });
      useWidgetRegistryStore.setState({
        widgets: [
          makeWidget({
            id: "w2",
            name: "External Page",
            type: "iframe",
            endpoint: "https://example.com/embed",
          }),
        ],
      });
      const iframeCard: DashboardCard = { ...card, widgetId: "w2" };

      const { result } = renderHook(() => useWidgetData(iframeCard, iframeCard.params));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.data).toBeNull();
      expect(server.requests).toHaveLength(0);
    });

    it.each([["ssrm_table"], ["table_ssrm"]])(
      "issues no request and reports ready immediately for a %s widget (its endpoint answers a POST, not this app's GET)",
      async (type) => {
        // The load-bearing one for the refuse design, and it belongs in this
        // block for the reason the block already states: a REAL mock backend
        // is running, so if the SSRM entry is ever dropped from fetchesData
        // this fails on the request count rather than passing on a predicate
        // tested in isolation.
        const server = await serve({ "/data-ssrm": { rowData: [], rowCount: 0 } });
        useWidgetRegistryStore.setState({
          widgets: [
            makeWidget({
              id: "w1",
              name: "Demo Financial Data (SSRM)",
              type,
              category: "demo-data",
              endpoint: "data-ssrm",
              gridData: { w: 24, h: 16 },
            }),
          ],
        });

        const { result } = renderHook(() => useWidgetData(card, card.params));

        await waitFor(() => expect(result.current.status).toBe("ready"));
        expect(result.current.data).toBeNull();
        // No request was issued, so there is no error state and nothing for a
        // Retry button to repeat.
        expect(result.current.error).toBeUndefined();
        expect(server.requests).toHaveLength(0);
      },
    );
  });

  // v5.3.0 §2/§3/§5: `earliest` comes from `data_bounds.min`; "if the widget hasn't yet
  // reported bounds, the resolver defers". Specified in v5.3 and never shipped.
  it("defers `earliest` on the first request, then asks for exactly what the data reported -- and settles", async () => {
    const server = await serve({ "/equity/price": [
      { date: "2024-03-01", close: 2 }, { date: "2019-01-02", close: 1 }, { date: "2026-09-17", close: 3 },
    ] });
    useWidgetRegistryStore.setState({
      widgets: [makeWidget({ id: "w1", name: "History", endpoint: "equity/price",
        params: [{ paramName: "start_date", type: "date" }, { paramName: "end_date", type: "date" }] })],
    });
    const { result } = renderHook(() => useWidgetData(card, { start_date: "earliest + 1y", end_date: "latest" }));
    const asked = () => server.requests.map((r) => {
      const q = new URLSearchParams(r.search);
      return [q.get("start_date"), q.get("end_date")];
    });
    await waitFor(() => expect(asked()).toHaveLength(2));
    // First: no bounds yet, so both are LEFT OUT -- never sent as the words.
    expect(asked()[0]).toEqual([null, null]);
    // Then: from the data's own first and last date, offset applied.
    expect(asked()[1]).toEqual(["2020-01-02", "2026-09-17"]);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    // The same rows came back, so the same bounds: no third request, no loop.
    expect(asked()).toHaveLength(2);
  });

  it("an offset bound against a provider that honours it settles after one bounded request", async () => {
    // A real provider answers `start_date`, so the bounded answer starts later
    // than the deferred one. Its bounds must not become the next question.
    const rows = [{ date: "2019-01-02", close: 1 }, { date: "2022-06-01", close: 2 }, { date: "2026-09-17", close: 3 }];
    const server = await serve({ "/equity/price": (url: URL) => {
      const start = url.searchParams.get("start_date");
      return start ? rows.filter((r) => r.date >= start) : rows;
    } });
    useWidgetRegistryStore.setState({
      widgets: [makeWidget({ id: "w1", name: "History", endpoint: "equity/price",
        params: [{ paramName: "start_date", type: "date" }] })],
    });
    const { result } = renderHook(() => useWidgetData(card, { start_date: "earliest + 1y" }));
    await waitFor(() => expect(server.requests).toHaveLength(2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(server.requests.map((r) => new URLSearchParams(r.search).get("start_date"))).toEqual([null, "2020-01-02"]);
  });

  it("a param change defers again, without first sending the OLD data's bounds", async () => {
    const server = await serve({ "/equity/price": [{ date: "2019-01-02", close: 1 }, { date: "2026-09-17", close: 3 }] });
    useWidgetRegistryStore.setState({
      widgets: [makeWidget({ id: "w1", name: "History", endpoint: "equity/price",
        params: [{ paramName: "start_date", type: "date" }, { paramName: "end_date", type: "date" }] })],
    });
    const { result, rerender } = renderHook(({ values }) => useWidgetData(card, values), {
      initialProps: { values: { start_date: "earliest + 1y", end_date: "latest" } },
    });
    const asked = () => server.requests.map((r) => {
      const q = new URLSearchParams(r.search);
      return [q.get("start_date"), q.get("end_date")];
    });
    await waitFor(() => expect(asked()).toHaveLength(2));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ values: { start_date: "earliest + 2y", end_date: "latest" } });
    await waitFor(() => expect(asked().length).toBeGreaterThanOrEqual(4));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    // The new question cleared the rows, so it defers like a first request,
    // then asks once with the bounds that come back. It used to send the old
    // rows' bounds first -- a request whose answer was thrown away.
    expect(asked().slice(2)).toEqual([[null, null], ["2021-01-02", "2026-09-17"]]);
  });

  it("a text param whose value is the word latest is not a data bound and never gains a request", async () => {
    const server = await serve({ "/news": [{ date: "2026-10-01", title: "a" }, { date: "2026-10-14", title: "b" }] });
    useWidgetRegistryStore.setState({
      widgets: [makeWidget({ id: "w1", name: "News", endpoint: "news", params: [{ paramName: "sort", type: "text" }] })],
    });
    const { result } = renderHook(() => useWidgetData(card, { sort: "latest" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(server.requests.map((r) => new URLSearchParams(r.search).get("sort"))).toEqual(["latest"]);
  });

  it("a card that names no data bound never computes one and never gains a request", async () => {
    const server = await serve({ "/equity/price": [{ date: "2019-01-02", close: 1 }, { date: "2026-09-17", close: 3 }] });
    useWidgetRegistryStore.setState({
      widgets: [makeWidget({ id: "w1", name: "History", endpoint: "equity/price", params: [{ paramName: "start_date", type: "date" }] })],
    });
    const { result } = renderHook(() => useWidgetData(card, { start_date: "2020-01-01" }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(server.requests).toHaveLength(1);
  });

  it("refetches when the fiscal map changes, and not when it is rebuilt with the same content", async () => {
    const server = await serve({ "/equity/price": { results: [] } });
    useWidgetRegistryStore.setState({
      widgets: [
        makeWidget({
          id: "w1",
          name: "Fiscal",
          endpoint: "equity/price",
          params: [{ paramName: "quarter", type: "quarter" }],
        }),
      ],
    });
    const { result, rerender } = renderHook(
      ({ map }: { map: Record<string, number> }) => useWidgetData(card, { quarter: "T" }, undefined, map),
      { initialProps: { map: { quarter: 9 } } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const quarters = () => server.requests.map((r) => new URLSearchParams(r.search).get("quarter"));
    // `T` is projected under the map's year end on the wire, whatever today is.
    expect(quarters()).toHaveLength(1);
    expect(quarters()[0]).toMatch(/^\d{4}-Q[1-4]$/);
    rerender({ map: { quarter: 6 } });
    await waitFor(() => expect(quarters()).toHaveLength(2));
    rerender({ map: { quarter: 6 } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(quarters()).toHaveLength(2);
  });
});

describe("refreshIntervalMs", () => {
  const widget = (over: Partial<WidgetDef>): WidgetDef =>
    makeWidget({ id: "w1", category: "", gridData: { w: 1, h: 1 }, ...over });

  it("prefers the manifest's own positive interval over the setting", () => {
    expect(refreshIntervalMs(widget({ refetchInterval: 86_400_000 }), 5)).toBe(86_400_000);
  });

  it("falls back to the setting when the manifest declares none", () => {
    expect(refreshIntervalMs(widget({}), 5)).toBe(300_000);
  });

  it.each([
    ["zero", 0],
    ["a negative number", -1],
  ])("falls back to the setting when the manifest declares %s", (_label, value) => {
    expect(refreshIntervalMs(widget({ refetchInterval: value }), 15)).toBe(900_000);
  });

  it("never polls a widget whose manifest declares refetchInterval: false, even with the setting on", () => {
    expect(refreshIntervalMs(widget({ refetchInterval: false }), 5)).toBeUndefined();
  });

  it("polls not at all when the manifest declares none and the setting is Off", () => {
    expect(refreshIntervalMs(widget({}), undefined)).toBeUndefined();
  });

  it("still honours the manifest when the setting is Off", () => {
    expect(refreshIntervalMs(widget({ refetchInterval: 60_000 }), undefined)).toBe(60_000);
  });

  it("clamps an interval past setTimeout's 32-bit ceiling, which would otherwise fire at once", () => {
    // A delay above 2^31-1 overflows setTimeout's signed 32-bit counter and
    // fires immediately — turning "every 35 days" into a hot loop.
    expect(refreshIntervalMs(widget({ refetchInterval: 3e9 }), undefined)).toBe(2_147_483_647);
  });
});

describe("useWidgetData auto-refresh", () => {
  /**
   * Fake timers, but with shouldAdvanceTime: the mock server answers on REAL
   * time and waitFor polls on timers, so a frozen clock deadlocks the test
   * before the first fetch ever resolves. shouldAdvanceTime nudges the fake
   * clock along with real time (20ms a tick), which is why every interval
   * here is minutes, not milliseconds.
   */
  function useFakeClock() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  }

  const priceRequests = (s: MockServer) => s.requests.filter((r) => r.path === "/equity/price").length;

  it("refetches on the setting's interval and never overlaps two requests", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(priceRequests(s)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(3));
  });

  it("uses the manifest's interval in preference to the setting", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({
      widgets: st.widgets.map((w) => ({ ...w, refetchInterval: 600_000 })),
    }));
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // The setting's minute passes and nothing happens: the manifest's ten
    // minutes is what was armed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(priceRequests(s)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(540_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });

  it("never has two requests in flight, even when the endpoint is far slower than the interval", async () => {
    // REAL timers here, deliberately: mockServer's own __delayMs uses the
    // same global setTimeout vi.useFakeTimers replaces, so a fake clock would
    // fire the server's delay and the refresh timer together and prove
    // nothing. A 1ms manifest interval against a 200ms endpoint is the
    // sharpest version of the question: if the timer were armed when a
    // request STARTED rather than when it finished, this would issue
    // hundreds of requests in the window below.
    const s = await serve({ "/equity/price": { __delayMs: 200, results: [] } });
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({
      widgets: st.widgets.map((w) => ({ ...w, refetchInterval: 1 })),
    }));

    // NOT `status === "ready"`: with a 1ms interval the card is back in
    // "loading" within a millisecond of every answer, so that state is never
    // observable (70 samples across this window caught it 0 times). The
    // first recorded request is the honest "the loop is running" signal.
    const { unmount } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(priceRequests(s)).toBeGreaterThanOrEqual(1));

    // NOT act(): act batches the setAttempt that re-arms the loop until it
    // exits, so the card would fetch exactly once and the test would prove
    // nothing. React only warns about updates outside act while this flag is
    // set (testing-library sets it globally), so it is cleared for the window
    // — the alternative is 15 unwrapped-update warnings on every run.
    const actEnv = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
    actEnv.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      await new Promise((resolve) => setTimeout(resolve, 700));
    } finally {
      actEnv.IS_REACT_ACT_ENVIRONMENT = wasActEnv;
    }

    // ~700ms of 200ms round trips: three or four, never more.
    const count = priceRequests(s);
    // Unmounted before the assertion so afterEach's close() is not racing a
    // still-polling card: an open keep-alive socket holds the server up.
    unmount();
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(6);
  });

  it("arms nothing at all when the manifest declares none and the setting is Off", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
    });
    expect(priceRequests(s)).toBe(1);
  });

  it("re-arms after a failed fetch, so a backend that comes back is picked up", async () => {
    const s = await serve({ "/equity/price": { __status: 500 } });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(priceRequests(s)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });

  it("arms nothing while a required param is still empty", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({
      widgets: st.widgets.map((w) => ({
        ...w,
        params: [{ paramName: "symbol", label: "Symbol", optional: false }],
      })),
    }));
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, { symbol: "" }));
    await waitFor(() => expect(result.current.status).toBe("incomplete"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(s.requests).toHaveLength(0);
  });

  it("arms nothing while the window is hidden", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    setHidden(true);
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(priceRequests(s)).toBe(1);
  });

  it("fetches immediately on becoming visible once the interval has elapsed", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    setHidden(true);
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(priceRequests(s)).toBe(1);

    await act(async () => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });

  it("arms only the remainder when the window comes back before the interval is up", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 5 } });
    setHidden(true);
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Four of the five minutes pass while hidden.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    await act(async () => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(priceRequests(s)).toBe(1);

    // Half of the remaining minute: still nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(priceRequests(s)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });

  it("refetches once per refreshEpoch bump", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(priceRequests(s)).toBe(1);

    await act(async () => {
      useDashboardStore.getState().refreshAll();
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));

    await act(async () => {
      useDashboardStore.getState().refreshAll();
    });
    await waitFor(() => expect(priceRequests(s)).toBe(3));
  });

  it("a manual Refresh re-arms the timer from that moment, rather than leaving the old one running", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));

    // The original timer would have fired 15s from here; the re-armed one
    // must not.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(priceRequests(s)).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(3));
  });

  it("clears the timer on unmount", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();

    const { result, unmount } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });
    expect(priceRequests(s)).toBe(1);
  });
});

/**
 * WidgetCard keeps its renderer mounted whenever `data` is non-null, so what
 * `data` holds DURING a "loading" pass is the whole contract: stale rows are
 * a feature when the same question is being re-asked, and a bug when the
 * question itself changed.
 */
describe("useWidgetData stale data across a loading pass", () => {
  it("drops the old payload the moment the params change, so the previous symbol's rows cannot sit under the new one", async () => {
    // 200ms, so the window between "the params changed" and "the new answer
    // landed" is wide enough to observe rather than raced past.
    await serve({ "/equity/price": { __delayMs: 200, results: [{ close: 1 }] } });
    registerWidget();

    const { result, rerender } = renderHook(({ params }) => useWidgetData(card, params), {
      initialProps: { params: { symbol: "AAPL" } },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([{ close: 1 }]);

    rerender({ params: { symbol: "MSFT" } });

    expect(result.current.status).toBe("loading");
    // Null, NOT AAPL's row: the card falls back to "Loading…" rather than
    // showing one symbol's numbers under another symbol's parameters.
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([{ close: 1 }]);
  });

  it("keeps the old payload through a manual Refresh, which is the same question asked again", async () => {
    await serve({ "/equity/price": { __delayMs: 200, results: [{ close: 1 }] } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.retry();
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.data).toEqual([{ close: 1 }]);
  });

  it("keeps the old payload through a refreshEpoch bump, for the same reason", async () => {
    await serve({ "/equity/price": { __delayMs: 200, results: [{ close: 1 }] } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      useDashboardStore.getState().refreshAll();
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.data).toEqual([{ close: 1 }]);
  });

  it("keeps the old payload when only the auto-refresh interval changes", async () => {
    await serve({ "/equity/price": { __delayMs: 200, results: [{ close: 1 }] } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.data).toEqual([{ close: 1 }]);
  });

  it("re-renders with an equal-valued params object without dropping anything, since the key is unchanged", async () => {
    await serve({ "/equity/price": { __delayMs: 200, results: [{ close: 1 }] } });
    registerWidget();

    const { result, rerender } = renderHook(({ params }) => useWidgetData(card, params), {
      initialProps: { params: { symbol: "AAPL" } },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // A fresh object with the same values — effectiveParams returns one on
    // every call. The key is value-derived, so this must not even refetch.
    rerender({ params: { symbol: "AAPL" } });

    expect(result.current.status).toBe("ready");
    expect(result.current.data).toEqual([{ close: 1 }]);
  });
});

describe("a card carrying the unresolved sentinel", () => {
  const orphan = makeCard({
    id: "c9",
    widgetId: "w1",
    backendId: UNRESOLVED_BACKEND_ID,
    params: { symbol: "AAPL" },
  });

  it("fetches against the backend that serves its widget and reaches ready", async () => {
    const server = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget(); // w1, served by b1.

    const { result } = renderHook(() => useWidgetData(orphan, orphan.params));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([{ close: 1 }]);
    // The sentinel names no BackendConfig, so the request can only have gone
    // out because the backend was resolved from the FOUND widget rather than
    // from card.backendId. Without that lookup this card reports "Backend not
    // configured" forever, and no request reaches the server at all.
    expect(server.requests[0].path).toBe("/equity/price");
    expect(server.requests[0].search).toBe("?symbol=AAPL");
  });
});

/**
 * A runButton widget does not execute when its parameters change: it fetches
 * once on load and then only when the user runs it. Everything else about the
 * hook -- the interval timer, refreshEpoch, retry, the cancelled flag -- keeps
 * working, against the params that were last RUN.
 */
describe("useWidgetData with a run button", () => {
  const paths = (s: MockServer) => s.requests.filter((r) => r.path === "/equity/price");

  /** The hook under the option, with `params` supplied per render. */
  function renderRunButton(initial: Record<string, string> = { symbol: "AAPL" }) {
    return renderHook(
      ({ params }: { params: Record<string, string> }) =>
        useWidgetData(card, params, true),
      { initialProps: { params: initial } },
    );
  }

  it("fetches once on load, with the params the card stored", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result } = renderRunButton();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(paths(s).map((r) => r.search)).toEqual(["?symbol=AAPL"]);
    // Armed and live agree, so there is nothing to run yet.
    expect(result.current.stale).toBe(false);
  });

  it("arms on the render where the widget resolves, not on mount before it does", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    // Widget starts unregistered -- mirrors the real timeline where the
    // registry is still empty on a card's first renders, so the caller only
    // has the card's own pre-resolution params to pass.
    const { result, rerender } = renderRunButton({ symbol: "PRE" });

    expect(result.current.status).toBe("unresolved");
    // Give a mount-arming effect a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(paths(s)).toHaveLength(0);

    // The widget resolves and, in the same pass, the caller now has its
    // declared param list and hands over the resolved value -- which for a
    // grouped param differs from what was live before resolution. Batched
    // in one act() so the render that first sees the resolved widget is the
    // same render that sees the post-resolution params.
    act(() => {
      registerWidget();
      rerender({ params: { symbol: "POST" } });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    // Exactly one request, and it carries the post-resolution params -- never
    // the pre-resolution ones that were live before the widget resolved.
    expect(paths(s).map((r) => r.search)).toEqual(["?symbol=POST"]);
  });

  it("fetches nothing when the parameters change, and reports the card stale", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result, rerender } = renderRunButton();
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ params: { symbol: "MSFT" } });

    // Give a wrongly-keyed effect a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(paths(s).map((r) => r.search)).toEqual(["?symbol=AAPL"]);
    expect(result.current.stale).toBe(true);
    // The payload on screen still belongs to the armed question, so it is not
    // thrown away -- the card is showing a correct answer, just not the newest
    // one the user has asked for.
    expect(result.current.data).toEqual([{ close: 1 }]);
  });

  it("run() fetches the edited parameters and clears the stale mark", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result, rerender } = renderRunButton();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ params: { symbol: "MSFT" } });
    expect(result.current.stale).toBe(true);

    act(() => result.current.run());

    await waitFor(() => expect(paths(s)).toHaveLength(2));
    expect(paths(s)[1].search).toBe("?symbol=MSFT");
    await waitFor(() => expect(result.current.stale).toBe(false));
  });

  it("run() with nothing edited re-asks the same question, bumping attempt", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result } = renderRunButton();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.attempt).toBe(0);

    act(() => result.current.run());

    // No new key to move to, so `attempt` is what makes the effect re-run --
    // and Run must never be a button that does nothing.
    await waitFor(() => expect(result.current.attempt).toBe(1));
    await waitFor(() => expect(paths(s)).toHaveLength(2));
    expect(paths(s).map((r) => r.search)).toEqual(["?symbol=AAPL", "?symbol=AAPL"]);
  });

  it("retry() hard-refreshes the armed params, never an un-run edit", async () => {
    // This is the Ctrl/Cmd-click path: a hard refresh of what is on screen,
    // which is deliberately NOT the same as running the pending edit.
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result, rerender } = renderRunButton();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ params: { symbol: "MSFT" } });

    act(() => result.current.retry());

    await waitFor(() => expect(paths(s)).toHaveLength(2));
    expect(paths(s)[1].search).toBe("?symbol=AAPL");
    // Still stale: a hard refresh answers the armed question again, it does
    // not adopt the edit.
    expect(result.current.stale).toBe(true);
  });

  it("an interval tick refetches the armed params, not the un-run edit", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({
      widgets: st.widgets.map((w) => ({ ...w, refetchInterval: 600_000 })),
    }));
    // See the auto-refresh suite above for why shouldAdvanceTime is required.
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result, rerender } = renderRunButton();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ params: { symbol: "MSFT" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000);
    });

    await waitFor(() => expect(paths(s)).toHaveLength(2));
    // The manifest's own poll keeps running -- and asks the question the user
    // last ran, so an unfinished edit can never be sent on a timer.
    expect(paths(s).map((r) => r.search)).toEqual(["?symbol=AAPL", "?symbol=AAPL"]);
  });

  it("arms the fiscal map with the params: a map change alone sends nothing, and Run sends the params under the map computed for them", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    useWidgetRegistryStore.setState({
      widgets: [
        makeWidget({
          id: "w1",
          name: "Fiscal",
          endpoint: "equity/price",
          runButton: true,
          params: [
            { paramName: "fy_end" },
            { paramName: "quarter", type: "quarter", fiscalYearEndParam: "fy_end" },
          ],
        }),
      ],
    });
    // `T` projects under today's date; pin it so each year end names one
    // known quarter. Real timers keep running for waitFor and the server.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
    type Props = { params: Record<string, string>; map: Record<string, number> };
    const { result, rerender } = renderHook(
      ({ params, map }: Props) => useWidgetData(card, params, true, map),
      { initialProps: { params: { fy_end: "September", quarter: "T" }, map: { quarter: 9 } } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const sent = () =>
      paths(s).map((r) => {
        const q = new URLSearchParams(r.search);
        return `${q.get("fy_end")} ${q.get("quarter")}`;
      });
    expect(sent()).toEqual(["September 2026-Q4"]);

    // The review's case: the sibling is edited, so the map WidgetCard derives
    // from the live params moves with it. Nothing is sent until Run, and Run
    // sends the edit under its own year end, once.
    rerender({ params: { fy_end: "December", quarter: "T" }, map: { quarter: 12 } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent()).toEqual(["September 2026-Q4"]);
    act(() => result.current.run());
    await waitFor(() => expect(sent()).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent()).toEqual(["September 2026-Q4", "December 2026-Q3"]);

    // A map change with the params untouched (an endpoint-sourced year end
    // landing): still nothing until Run, the card reports it, and Run adopts it.
    rerender({ params: { fy_end: "December", quarter: "T" }, map: { quarter: 3 } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent()).toHaveLength(2);
    expect(result.current.stale).toBe(true);
    act(() => result.current.run());
    await waitFor(() => expect(sent()).toHaveLength(3));
    expect(sent()[2]).toBe("December 2027-Q2");
    await waitFor(() => expect(result.current.stale).toBe(false));
  });

  /**
   * v5.4.0 (spec §1.3): WidgetCard folds a pending fiscal lookup into the
   * hold object, and until the lookup lands the map it passes is the
   * provisional one (December). A send a trigger held on that lookup must go
   * out under the year end that LANDED, not the one armed while it was
   * pending — and an un-run edit made meanwhile must still send nothing.
   * 26 Aug 2026 is 2026-Q3 under December, 2026-Q4 under September and
   * 2027-Q1 under June.
   */
  describe("a fiscal lookup pending on a run-button card", () => {
    type Props = { params: Record<string, string>; map: Record<string, number>; pending: boolean };
    const quarters = (s: MockServer) => paths(s).map((r) => new URLSearchParams(r.search).get("quarter"));
    const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

    async function renderFiscalHold(initialProps: Props) {
      const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
      useWidgetRegistryStore.setState({
        widgets: [
          makeWidget({
            id: "w1",
            endpoint: "equity/price",
            runButton: true,
            params: [
              { paramName: "symbol", type: "text" },
              { paramName: "quarter", type: "quarter" },
            ],
          }),
        ],
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
      // The hold object exactly as WidgetCard builds it for a pending lookup.
      const hook = renderHook(
        ({ params, map, pending }: Props) =>
          useWidgetData(card, params, true, map, { calendars: {}, pending, key: pending ? "|fiscal-pending" : "" }),
        { initialProps },
      );
      return { s, ...hook };
    }

    it("holds the first arm while the lookup is pending, then sends it once under the landed year end", async () => {
      const { s, result, rerender } = await renderFiscalHold({
        params: { symbol: "AAPL", quarter: "T" },
        map: { quarter: 12 },
        pending: true,
      });
      await waitFor(() => expect(result.current.status).toBe("loading"));
      await settle();
      expect(quarters(s)).toEqual([]);

      rerender({ params: { symbol: "AAPL", quarter: "T" }, map: { quarter: 9 }, pending: false });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      await settle();
      expect(quarters(s)).toEqual(["2026-Q4"]);
      expect(result.current.stale).toBe(false);
    });

    it("holds a Run pressed while the lookup is pending, then sends it once under the landed year end", async () => {
      const { s, result, rerender } = await renderFiscalHold({
        params: { symbol: "AAPL", quarter: "T" },
        map: { quarter: 9 },
        pending: false,
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(quarters(s)).toEqual(["2026-Q4"]);

      // A new ticker: its lookup is pending, so the map is the provisional one.
      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 12 }, pending: true });
      act(() => result.current.run());
      expect(result.current.status).toBe("loading");
      await settle();
      expect(quarters(s)).toEqual(["2026-Q4"]);

      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 6 }, pending: false });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      await settle();
      expect(quarters(s)).toEqual(["2026-Q4", "2027-Q1"]);
      expect(result.current.stale).toBe(false);
    });

    it("sends nothing when the lookup lands after an un-run edit made while holding, and goes stale", async () => {
      const { s, result, rerender } = await renderFiscalHold({
        params: { symbol: "AAPL", quarter: "T" },
        map: { quarter: 12 },
        pending: true,
      });
      await waitFor(() => expect(result.current.status).toBe("loading"));
      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 12 }, pending: true });
      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 6 }, pending: false });
      await settle();
      expect(quarters(s)).toEqual([]);
      expect(result.current.stale).toBe(true);
      // Nothing is in flight, so nothing may spin (fix round 2).
      expect(result.current.status).not.toBe("loading");

      // Run adopts the edit under the year end computed for it.
      act(() => result.current.run());
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(quarters(s)).toEqual(["2027-Q1"]);
      expect(result.current.stale).toBe(false);
    });

    // v5.4.0 fix round 3: the drop above left `armedWireRef` null, so any
    // OTHER trigger (⌘R here) still found the null ref, re-armed the wire
    // from the params still armed under the provisional map, and sent it —
    // the same send the drop just refused. Only Run may adopt a new
    // resolution (spec §1.3's Run-button rule).
    it("stays unsent on ⌘R after a dropped hold, and only Run sends it, under the landed year end", async () => {
      const { s, result, rerender } = await renderFiscalHold({
        params: { symbol: "AAPL", quarter: "T" },
        map: { quarter: 12 },
        pending: true,
      });
      await waitFor(() => expect(result.current.status).toBe("loading"));
      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 12 }, pending: true });
      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 6 }, pending: false });
      await settle();
      expect(quarters(s)).toEqual([]);
      expect(result.current.stale).toBe(true);

      // ⌘R: not Run. Must still send nothing.
      act(() => useDashboardStore.setState({ refreshEpoch: 1 }));
      await settle();
      expect(quarters(s)).toEqual([]);
      expect(result.current.stale).toBe(true);

      // Run adopts the edit under the year end computed for it.
      act(() => result.current.run());
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(quarters(s)).toEqual(["2027-Q1"]);
      expect(result.current.stale).toBe(false);
    });

    // v5.4.0 final-review fix: after a dropped hold `armedWireRef` holds the
    // " dropped" sentinel, so a LATER held trigger released by a landing
    // lookup meets the fetch effect's "wire moved" branch, which sent nothing
    // (correct) but never left the "loading" the hold had set. The card spun
    // with nothing in flight until Run.
    it("leaves loading when a trigger held after a dropped hold is released onto a moved wire", async () => {
      const { s, result, rerender } = await renderFiscalHold({
        params: { symbol: "AAPL", quarter: "T" },
        map: { quarter: 12 },
        pending: true,
      });
      await waitFor(() => expect(result.current.status).toBe("loading"));
      // An un-run ticker edit while the first arm is held: dropped.
      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 12 }, pending: true });
      rerender({ params: { symbol: "MSFT", quarter: "T" }, map: { quarter: 6 }, pending: false });
      await settle();
      expect(quarters(s)).toEqual([]);

      // A second un-run edit whose lookup is pending, then ⌘R: held.
      rerender({ params: { symbol: "GOOG", quarter: "T" }, map: { quarter: 12 }, pending: true });
      act(() => useDashboardStore.setState({ refreshEpoch: 1 }));
      await settle();
      expect(result.current.status).toBe("loading");

      // The lookup lands: the held ⌘R is released onto a moved wire.
      rerender({ params: { symbol: "GOOG", quarter: "T" }, map: { quarter: 3 }, pending: false });
      await settle();
      expect(quarters(s)).toEqual([]);
      expect(result.current.stale).toBe(true);
      expect(result.current.status).not.toBe("loading");

      // Run sends once, under the live values.
      act(() => result.current.run());
      await waitFor(() => expect(result.current.status).toBe("ready"));
      await settle();
      expect(quarters(s)).toEqual(["2027-Q2"]);
      expect(result.current.stale).toBe(false);
    });
  });

  it("leaves a widget without the option exactly as it was", async () => {
    const s = await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result, rerender } = renderHook(
      ({ params }: { params: Record<string, string> }) => useWidgetData(card, params),
      { initialProps: { params: { symbol: "AAPL" } } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Never stale, and Run IS Refresh -- the same function, so a caller can
    // wire one button to `run` and get today's behaviour on every other card.
    expect(result.current.stale).toBe(false);
    expect(result.current.run).toBe(result.current.retry);

    rerender({ params: { symbol: "MSFT" } });

    await waitFor(() => expect(paths(s)).toHaveLength(2));
    expect(paths(s)[1].search).toBe("?symbol=MSFT");
  });
});

/**
 * A themed widget's request carries the RESOLVED theme in its query string
 * (dataClient's THEMED_TYPES), so the payload it gets back is theme-specific:
 * a backend-rendered html fragment or chart image drawn for dark is simply
 * wrong on light. Nothing re-asked for it when the OS flipped, so the card
 * kept the old rendering until something else happened to refetch it.
 */
describe("a themed widget follows the resolved theme", () => {
  let media: MatchMediaStub | null = null;

  afterEach(() => {
    media?.restore();
    media = null;
  });

  function registerTyped(type: string) {
    useWidgetRegistryStore.setState({
      widgets: [makeWidget({ id: "w1", name: "Embedded", endpoint: "embed", type })],
    });
  }

  it("refetches an html widget when the OS appearance changes", async () => {
    media = stubMatchMedia(true);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "system" } });
    const server = await serve({ "/embed": "<p>hi</p>" });
    registerTyped("html");

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].search).toContain("theme=dark");

    await act(async () => {
      media!.set(false);
    });

    await waitFor(() => expect(server.requests).toHaveLength(2));
    expect(server.requests[1].search).toContain("theme=light");
  });

  // The other half, and the reason the theme is not simply in the deps: a
  // table's request carries no theme at all, so refetching it on a flip would
  // be a request that asks exactly the same question twice.
  it("leaves a table widget alone when the OS appearance changes", async () => {
    media = stubMatchMedia(true);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme: "system" } });
    const server = await serve({ "/embed": { results: [] } });
    registerTyped("table");

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(server.requests).toHaveLength(1);

    await act(async () => {
      media!.set(false);
    });

    // Settle: a wrongly-triggered refetch would arrive within a tick or two.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.requests).toHaveLength(1);
  });
});


/**
 * v5.3.0: an expression re-resolves on every refresh. A card with a run
 * button records the WIRE values it last sent; when a refresh trigger finds
 * them moved (T crossed midnight) it goes stale instead of fetching, and Run
 * adopts the new resolution. A card without a run button simply refetches.
 */
describe("useWidgetData with expressions and calendars", () => {
  const dated = () =>
    useWidgetRegistryStore.setState({
      widgets: [
        makeWidget({
          id: "w1",
          name: "Dated",
          endpoint: "equity/price",
          dataKey: "results",
          params: [
            { paramName: "symbol", type: "text" },
            { paramName: "d", type: "date" },
          ],
        }),
      ],
    });
  const paths = (s: MockServer) => s.requests.filter((r) => r.path === "/equity/price").map((r) => r.search);
  const datedCard = makeCard({ id: "c1", widgetId: "w1", params: { symbol: "AAPL", d: "T" } });

  it("a run-button card goes stale, not fetched, when T crosses midnight before a refresh; Run sends the new date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 14, 23, 59, 0));
    const s = await serve({ "/equity/price": { results: [] } });
    dated();
    const { result } = renderHook(() => useWidgetData(datedCard, datedCard.params, true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(paths(s)).toEqual(["?symbol=AAPL&d=2026-09-14"]);
    expect(result.current.stale).toBe(false);

    vi.setSystemTime(new Date(2026, 8, 15, 0, 1, 0));
    act(() => useDashboardStore.setState({ refreshEpoch: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(paths(s)).toHaveLength(1);
    expect(result.current.stale).toBe(true);

    act(() => result.current.run());
    await waitFor(() => expect(paths(s)).toHaveLength(2));
    expect(paths(s)[1]).toBe("?symbol=AAPL&d=2026-09-15");
    await waitFor(() => expect(result.current.stale).toBe(false));
  });

  it("a run-button card whose wire values did not move refetches on a refresh as before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
    const s = await serve({ "/equity/price": { results: [] } });
    dated();
    const { result } = renderHook(() => useWidgetData(datedCard, datedCard.params, true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => useDashboardStore.setState({ refreshEpoch: 1 }));
    await waitFor(() => expect(paths(s)).toHaveLength(2));
    expect(result.current.stale).toBe(false);
  });

  it("a card without a run button refetches when its calendars land, and holds its request while they are pending", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    dated();
    const cal = bundledCalendar("XNYS")!;
    const { result, rerender } = renderHook(
      ({ calendars }: { calendars: { calendars: Record<string, typeof cal>; pending: boolean; key: string } }) =>
        useWidgetData(datedCard, datedCard.params, undefined, undefined, calendars),
      { initialProps: { calendars: { calendars: {}, pending: true, key: "XNYS:weekdays:2026?|pending" } } },
    );
    expect(result.current.status).toBe("loading");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(paths(s)).toHaveLength(0);
    rerender({ calendars: { calendars: { XNYS: cal }, pending: false, key: "XNYS:backend:2026a" } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(paths(s)).toHaveLength(1);
  });

  it("drops the old payload when a param change lands while a year its resolution needs is still pending", async () => {
    await serve({ "/equity/price": { __delayMs: 200, results: [{ close: 1 }] } });
    dated();
    const cal = bundledCalendar("XNYS")!;
    const { result, rerender } = renderHook(
      ({ params, pending }: { params: Record<string, string>; pending: boolean }) =>
        useWidgetData(datedCard, params, undefined, undefined, { calendars: { XNYS: cal }, pending, key: pending ? "|pending" : "" }),
      { initialProps: { params: { symbol: "AAPL", d: "T" }, pending: false } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([{ close: 1 }]);

    // One render moves the key AND needs a year not yet cached: the hold must
    // not keep AAPL's rows up under MSFT's parameters.
    rerender({ params: { symbol: "MSFT", d: "T-400bd" }, pending: true });
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();

    rerender({ params: { symbol: "MSFT", d: "T-400bd" }, pending: false });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([{ close: 1 }]);
  });
});

/**
 * The two hooks together, as WidgetCard wires them, against a backend that
 * serves calendars. A year landing that the card's resolution did not consult
 * cannot change its wire, so it is not a refetch trigger (spec §5); a landing
 * that does change the wire refetches exactly once.
 */
describe("useWidgetData with useTradingCalendar against a calendar-serving backend", () => {
  const cardFor = (d: string) => makeCard({ id: "c1", widgetId: "w1", params: { symbol: "AAPL", d } });
  const prices = (s: MockServer) => s.requests.filter((r) => r.path === "/equity/price").map((r) => r.search);
  /** An XNYS year with no closures at all, so only the source can move a step. */
  const xnys = {
    data: {
      Name: "Mock NYSE",
      Timezone: "America/New_York",
      TradingHours: { Open: "09:30:00", Close: "16:00:00", WorkingDays: "Mon, Tue, Wed, Thu, Fri" },
      ExchangeHolidays: {},
    },
  };

  function useCalendarCard(c: DashboardCard, runButton?: boolean) {
    const widget = useWidgetRegistryStore((s) => s.find(c.backendId, c.widgetId));
    const b = useBackendsStore((s) => s.backends.find((x) => x.id === c.backendId));
    const trading = useTradingCalendar(widget, c.params, b);
    return { ...useWidgetData(c, c.params, runButton, undefined, trading), trading };
  }

  async function serveWith(calendar: (url: URL) => unknown) {
    const s = await serve({
      "/equity/price": { results: [] },
      "/api/v1/calendar/trading": (url: URL) => calendar(url),
    });
    useWidgetRegistryStore.setState({
      widgets: [
        makeWidget({
          id: "w1",
          endpoint: "equity/price",
          dataKey: "results",
          params: [
            { paramName: "symbol", type: "text" },
            { paramName: "d", type: "date" },
          ],
        }),
      ],
    });
    return s;
  }

  /** Lets anything still in flight land inside act, so a late request is counted, not warned about. */
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

  beforeEach(() => {
    __resetTradingCalendarCacheForTests();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
  });

  it("a literal-date card sends exactly one request on first load, even after the up-front years land", async () => {
    const s = await serveWith(() => ({ ...xnys, __delayMs: 150 }));
    const { result } = renderHook(() => useCalendarCard(cardFor("2026-01-02")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2025, 2026]));
    await settle();
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-01-02"]);
  });

  it("a T-1bd card sends exactly one request when 2025 lands after the 2026 it consulted", async () => {
    const s = await serveWith((url) => (url.searchParams.get("year") === "2025" ? { ...xnys, __delayMs: 400 } : xnys));
    const { result } = renderHook(() => useCalendarCard(cardFor("T-1bd")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.trading.calendars.XNYS.years).toEqual([2026]);
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2025, 2026]));
    await settle();
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-09-11"]);
  });

  it("a run-button card sends nothing when a year it did not consult lands", async () => {
    const s = await serveWith((url) => (url.searchParams.get("year") === "2025" ? { ...xnys, __delayMs: 400 } : xnys));
    const { result } = renderHook(() => useCalendarCard(cardFor("T-1bd"), true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2025, 2026]));
    await settle();
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-09-11"]);
    expect(result.current.stale).toBe(false);
  });

  it("refetches exactly once when a backend answer replaces the bundled calendar a consulted year resolved on", async () => {
    // Tue 8 Sep 2026: T-1bd skips the bundled file's Labor Day (Mon 7 Sep) to Fri 4 Sep.
    vi.setSystemTime(new Date(2026, 8, 8, 12, 0, 0));
    // 2026 is refused, so the card sends on the bundled file; 2025's answer then
    // makes XNYS a backend calendar without 2026, which the resolver walks on
    // the weekday table — Labor Day is no longer a closure.
    const s = await serveWith((url) => (url.searchParams.get("year") === "2026" ? { __status: 500 } : { ...xnys, __delayMs: 400 }));
    const { result } = renderHook(() => useCalendarCard(cardFor("T-1bd")));
    await waitFor(() => expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-09-04"]));
    expect(result.current.trading.calendars.XNYS.source).toBe("bundled");
    await waitFor(() => expect(result.current.trading.calendars.XNYS.source).toBe("backend"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await settle();
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-09-04", "?symbol=AAPL&d=2026-09-07"]);
  });

  /**
   * WidgetCard feeds useTradingCalendar the LIVE params, so on a run-button
   * card the calendar key follows edits the user has not run. It may only
   * release a send a real trigger held on a pending year; by itself it sends
   * nothing and shows no loading.
   */
  it.each([
    ["T-1bd", "T", "?symbol=AAPL&d=2026-09-11"],
    ["T", "T-1bd", "?symbol=AAPL&d=2026-09-14"],
    ["2026-01-02", "T-1bd", "?symbol=AAPL&d=2026-01-02"],
  ])("a run-button card sends nothing when an un-run edit from %s to %s moves its calendar key", async (from, to, sent) => {
    const s = await serveWith(() => xnys);
    const { result, rerender } = renderHook(({ c }: { c: DashboardCard }) => useCalendarCard(c, true), {
      initialProps: { c: cardFor(from) },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2025, 2026]));
    await settle();
    const before = result.current.trading.key;

    rerender({ c: cardFor(to) });
    await settle();
    expect(result.current.trading.key).not.toBe(before);
    expect(prices(s)).toEqual([sent]);
    expect(result.current.stale).toBe(true);
  });

  it("a run-button card neither loads nor sends on an un-run edit that needs an unloaded year, nor when that year lands", async () => {
    const s = await serveWith((url) => (url.searchParams.get("year") === "2024" ? { ...xnys, __delayMs: 400 } : xnys));
    const { result, rerender } = renderHook(({ c }: { c: DashboardCard }) => useCalendarCard(c, true), {
      initialProps: { c: cardFor("2026-01-02") },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2025, 2026]));
    await settle();

    rerender({ c: cardFor("T-600bd") });
    expect(result.current.trading.pending).toBe(true);
    expect(result.current.status).toBe("ready");
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2024, 2025, 2026]));
    await settle();
    expect(result.current.status).toBe("ready");
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-01-02"]);
    expect(result.current.stale).toBe(true);
  });

  it.each([
    ["lands", { ...xnys, __delayMs: 400 }],
    ["fails", { __status: 500, __delayMs: 400 }],
  ])("Run on an edit whose consulted year is pending holds the send, and sends it exactly once when the year %s", async (_, answer) => {
    const s = await serveWith((url) => (url.searchParams.get("year") === "2024" ? answer : xnys));
    const { result, rerender } = renderHook(({ c }: { c: DashboardCard }) => useCalendarCard(c, true), {
      initialProps: { c: cardFor("2026-01-02") },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2025, 2026]));
    await settle();

    rerender({ c: cardFor("T-600bd") });
    act(() => result.current.run());
    expect(result.current.status).toBe("loading");
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-01-02"]);
    await waitFor(() => expect(result.current.trading.pending).toBe(false));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await settle();
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-01-02", "?symbol=AAPL&d=2024-05-27"]);
    expect(result.current.stale).toBe(false);
  });

  it("⌘R and ↻ on a stale run-button card each re-send the armed request exactly once", async () => {
    const s = await serveWith(() => xnys);
    const { result, rerender } = renderHook(({ c }: { c: DashboardCard }) => useCalendarCard(c, true), {
      initialProps: { c: cardFor("T-1bd") },
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(result.current.trading.calendars.XNYS.years).toEqual([2025, 2026]));
    await settle();
    rerender({ c: cardFor("T") });
    await settle();

    act(() => useDashboardStore.setState({ refreshEpoch: 1 }));
    await settle();
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-09-11", "?symbol=AAPL&d=2026-09-11"]);
    act(() => result.current.retry());
    await settle();
    expect(prices(s)).toEqual(["?symbol=AAPL&d=2026-09-11", "?symbol=AAPL&d=2026-09-11", "?symbol=AAPL&d=2026-09-11"]);
    expect(result.current.stale).toBe(true);
  });
});

describe("useWidgetData completedAt and stalePastInterval", () => {
  it("is null until the first request completes, then a recent timestamp", async () => {
    const before = Date.now();
    await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    expect(result.current.completedAt).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.completedAt).toBeGreaterThanOrEqual(before);
    expect(result.current.stalePastInterval).toBe(false);
  });

  it("goes stale once more than the interval has elapsed since completion", async () => {
    // The interval's own refetch fires at 60s and would otherwise move
    // completedAt forward, making the card fresh again right when this test
    // means to catch it stale — so the second (and every later) request to
    // this route hangs forever, exactly like the real backend going dark,
    // and completedAt is pinned to the first answer.
    let calls = 0;
    await serve({
      "/equity/price": () => (calls++ === 0 ? { results: [{ close: 1 }] } : { __hang: true }),
    });
    registerWidget();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.stalePastInterval).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000 + 60_000);
    });
    await waitFor(() => expect(result.current.stalePastInterval).toBe(true));
  });
});
