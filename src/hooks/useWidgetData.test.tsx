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
import { refreshIntervalMs, useWidgetData } from "./useWidgetData";

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

  // OBBject warnings (e.g. "MBS truncated at the first 250,000 records") ride
  // beside `results`; the card must be told, not have them dropped.
  it("reports an OBBject's warnings beside its data, and none when there are none", async () => {
    await serve({ "/equity/price": { results: [{ close: 1 }], warnings: [{ category: "UserWarning", message: "MBS truncated at the first 250,000 records" }] } });
    registerWidget();
    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.data).toEqual([{ close: 1 }]);
    expect(result.current.warnings).toEqual(["MBS truncated at the first 250,000 records"]);
  });

  it("reports no warnings for a payload without them", async () => {
    await serve({ "/equity/price": { results: [{ close: 1 }] } });
    registerWidget();
    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.warnings).toEqual([]);
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
});

describe("refreshIntervalMs", () => {
  const widget = (over: Partial<WidgetDef>): WidgetDef =>
    makeWidget({ id: "w1", category: "", gridData: { w: 1, h: 1 }, ...over });

  it("leaves a cron widget off the app-wide interval", () => {
    expect(refreshIntervalMs(widget({ refetchCron: "0 * * * *" }), 5)).toBeUndefined();
  });

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

  /** Registers w1 with a cron refetchInterval, already normalised. */
  function registerCron(expr: string) {
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({ widgets: st.widgets.map((w) => ({ ...w, refetchCron: expr })) }));
  }

  it("refetches on each minute boundary the cron matches, and on no other", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerCron("*/5 * * * *");
    useFakeClock();
    vi.setSystemTime(new Date(2026, 9, 29, 10, 0, 30));

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(priceRequests(s)).toBe(1);

    // 10:01 through 10:04 pass without a match.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    expect(priceRequests(s)).toBe(1);

    // 10:05 matches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });

  it("does not refetch on a minute boundary the expression does not match, and ignores the app-wide interval", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerCron("0 0 1 * *"); // monthly: far past setTimeout's ceiling
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoRefreshMinutes: 1 } });
    useFakeClock();
    vi.setSystemTime(new Date(2026, 9, 29, 10, 0, 30));

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(priceRequests(s)).toBe(1);
    expect(result.current.intervalMs).toBeUndefined();
  });

  it("catches up once on becoming visible when a cron boundary passed while hidden", async () => {
    const s = await serve({ "/equity/price": { results: [] } });
    registerCron("*/5 * * * *");
    useFakeClock();
    vi.setSystemTime(new Date(2026, 9, 29, 10, 0, 30));

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 60_000);
    });
    expect(priceRequests(s)).toBe(1);

    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(priceRequests(s)).toBe(2));
  });

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

  it("reports data stale once it is older than staleTime, and fresh again after a refetch", async () => {
    await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useWidgetRegistryStore.setState((st) => ({ widgets: st.widgets.map((w) => ({ ...w, staleTime: 120_000 })) }));
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.dataStale).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(result.current.dataStale).toBe(true);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.dataStale).toBe(false));
  });

  it("never reports stale for a widget that declares no staleTime", async () => {
    await serve({ "/equity/price": { results: [] } });
    registerWidget();
    useFakeClock();

    const { result } = renderHook(() => useWidgetData(card, card.params));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
    });
    expect(result.current.dataStale).toBe(false);
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
