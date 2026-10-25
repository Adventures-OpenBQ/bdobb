// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter", "candlestick"]),
}));

// Stands in for the real drag-and-drop library, exactly as
// DashboardGrid.test.tsx does — it pulls in ResizeObserver-dependent DOM
// machinery this test has no interest in. What's left is real:
// DashboardGrid, WidgetCard, ParamControls, the dashboard store, and
// useWidgetData all run unmocked, against a real HTTP server.
vi.mock("react-grid-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="grid">{children}</div>
  ),
  WidthProvider: (Comp: React.ComponentType) => Comp,
}));

import { __reset } from "../test/memfs";
import { __resetParamOptionsCacheForTests } from "../hooks/useParamOptions";
import { BUILTIN_BACKEND_ID } from "../lib/builtins";
import { __resetJsonStoreForTests } from "../lib/jsonStore";
import { __resetLoggerForTests } from "../lib/logger";
import { startMockServer, type MockServer } from "../test/mockServer";
import type { Dashboard, DashboardCard, WidgetDef } from "../lib/types";
import { backend, card as makeCard, widget as makeWidget } from "../test/fixtures";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { DashboardGrid } from "./DashboardGrid";

/**
 * Every other test of this area mocks something in the middle of the chain:
 * ParamControls.test.tsx mocks onApply, WidgetCard.test.tsx mocks
 * useWidgetData wholesale, dashboardStore.test.ts calls applyCardParams with
 * hand-built edits. None of them proves that a user edit actually reaches
 * the network exactly once — this test renders the real DashboardGrid
 * (which hands each card its live object from the store, the way the app
 * does) and counts requests against a real HTTP server.
 */

const widget: WidgetDef = makeWidget({
  id: "w1",
  name: "Price History",
  endpoint: "equity/price",
  params: [{ paramName: "symbol", label: "Symbol", type: "text" }],
});

const card: DashboardCard = makeCard({ id: "c1", widgetId: "w1", params: { symbol: "AAPL" } });

/** A second card, elsewhere on the dashboard, bound to a group of its own. */
const otherCard: DashboardCard = makeCard({
  id: "c2",
  widgetId: "w1",
  params: { symbol: "MSFT" },
  layout: { x: 0, y: 9, w: 20, h: 9 },
  bindings: [{ groupId: "g1", paramName: "symbol" }],
});

const servers: MockServer[] = [];

async function serve() {
  const s = await startMockServer({ "/equity/price": { results: [] } });
  servers.push(s);
  useBackendsStore.setState({
    backends: [backend({ baseUrl: s.url })],
    statuses: { b1: "online" },
  });
  return s;
}

/**
 * Counts requests for c1 specifically, by the query string its own symbol
 * value produces — c1 and c2 hit the same endpoint, so counting by path
 * alone would conflate the two cards' fetches.
 */
function c1RequestCount(server: MockServer, symbol: string): number {
  return server.requests.filter((r) => r.path === "/equity/price" && r.search === `?symbol=${symbol}`)
    .length;
}

/**
 * No request should land within this window if none is expected. Wrapped in
 * act() because a fetch that DOES land while we wait resolves into a state
 * update — asserting a negative still means giving that a chance to happen.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

beforeEach(() => {
  __reset();
  __resetJsonStoreForTests();
  __resetLoggerForTests();
  __resetParamOptionsCacheForTests();
  useWidgetRegistryStore.setState({ widgets: [widget] });
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe("param-apply flow (integration, real store + real DashboardGrid/WidgetCard/ParamControls)", () => {
  it("issues exactly one request on mount, one more on a committed edit, and none for an unrelated dashboard edit", async () => {
    const server = await serve();
    const dashboard: Dashboard = {
      id: "d1",
      name: "D",
      tabs: [{ id: "t1", name: "Main", cards: [card, otherCard] }],
      groups: [{ id: "g1", name: "Ticker", paramName: "symbol", groupType: "symbol", value: "MSFT" }],
    };
    useDashboardStore.setState({
      dashboards: [dashboard],
      activeId: "d1",
      activeTabId: "t1",
      previousId: null,
    });

    const { rerender } = render(<DashboardGrid onOpenLibrary={() => {}} />);

    // 1. Mount issues exactly one request for card c1.
    await waitFor(() => expect(c1RequestCount(server, "AAPL")).toBe(1));
    await settle();
    expect(c1RequestCount(server, "AAPL")).toBe(1);

    // Re-rendering with nothing changed must not add another request.
    rerender(<DashboardGrid onOpenLibrary={() => {}} />);
    await settle();
    expect(c1RequestCount(server, "AAPL")).toBe(1);

    // 2. A real edit through the real ParamControls, committed through the
    // real store, issues exactly one further request — for card c1 only.
    const input = screen.getAllByLabelText("Symbol")[0];
    await userEvent.clear(input);
    await userEvent.type(input, "TSLA");
    // A typed control commits when focus leaves it; there is no Apply.
    await userEvent.tab();

    await waitFor(() => expect(c1RequestCount(server, "TSLA")).toBe(1));
    await settle();
    expect(c1RequestCount(server, "TSLA")).toBe(1);
    expect(c1RequestCount(server, "AAPL")).toBe(1);

    // 3. An edit to an unrelated part of the dashboard — c2's group, which
    // c1 is not bound to — must not refetch c1. Before the Finding-1 fix,
    // applyCardParams rebuilding dashboard.groups would recompute c1's
    // params (a new object with the same values) and the old identity-keyed
    // effect would refetch anyway.
    await act(async () => {
      await useDashboardStore.getState().applyCardParams("c2", {
        cardParams: { symbol: "MSFT" },
        groupEdits: [{ groupId: "g1", value: "GOOG" }],
      });
    });

    await settle();
    expect(c1RequestCount(server, "TSLA")).toBe(1);
  });
});

const iframeWidget: WidgetDef = makeWidget({
  id: "w2",
  name: "External Page",
  type: "iframe",
  // An iframe widget's endpoint is a full URL, not a backend path.
  endpoint: "https://example.com/embed",
});

const iframeCard: DashboardCard = makeCard({ id: "c3", widgetId: "w2" });

describe("iframe widgets issue no request (Finding 1, real store + real DashboardGrid/WidgetCard)", () => {
  it("renders the frame and issues zero requests to the backend", async () => {
    const server = await serve();
    useWidgetRegistryStore.setState({ widgets: [widget, iframeWidget] });
    const dashboard: Dashboard = {
      id: "d1",
      name: "D",
      tabs: [{ id: "t1", name: "Main", cards: [iframeCard] }],
    };
    useDashboardStore.setState({
      dashboards: [dashboard],
      activeId: "d1",
      activeTabId: "t1",
      previousId: null,
    });

    render(<DashboardGrid onOpenLibrary={() => {}} />);

    expect(await screen.findByTitle("Embedded page")).toHaveAttribute(
      "src",
      "https://example.com/embed",
    );

    await settle();
    expect(server.requests).toHaveLength(0);
  });
});

const noteWidget: WidgetDef = makeWidget({
  id: "note",
  backendId: BUILTIN_BACKEND_ID,
  name: "Note",
  type: "note",
  category: "Built-in",
  endpoint: "",
  gridData: { w: 15, h: 8 },
});

const noteCard: DashboardCard = makeCard({
  id: "c4",
  widgetId: "note",
  backendId: BUILTIN_BACKEND_ID,
  params: { text: "hello" },
  layout: { x: 0, y: 0, w: 15, h: 8 },
});

describe("built-in widgets issue no request (Finding 2, real store + real DashboardGrid/WidgetCard)", () => {
  it("renders the note and issues zero requests to the backend", async () => {
    const server = await serve();
    useWidgetRegistryStore.setState({ widgets: [widget, noteWidget] });
    const dashboard: Dashboard = {
      id: "d1",
      name: "D",
      tabs: [{ id: "t1", name: "Main", cards: [noteCard] }],
    };
    useDashboardStore.setState({
      dashboards: [dashboard],
      activeId: "d1",
      activeTabId: "t1",
      previousId: null,
    });

    render(<DashboardGrid onOpenLibrary={() => {}} />);

    expect(await screen.findByText("hello")).toBeInTheDocument();

    await settle();
    expect(server.requests).toHaveLength(0);
  });
});

const endpointWidget: WidgetDef = makeWidget({
  id: "w3",
  name: "Congress",
  category: "Government",
  endpoint: "congress",
  params: [
    { paramName: "chamber", label: "Chamber", type: "endpoint", optionsEndpoint: "chambers" },
  ],
});

const endpointCard: DashboardCard = makeCard({
  id: "c5",
  widgetId: "w3",
  params: { chamber: "house" },
});

describe("WidgetCard hands ParamControls the card's backend", () => {
  it("fetches the endpoint param's options through the real store and renders them", async () => {
    // ParamControls cannot fetch without a BackendConfig, and WidgetCard is
    // the only place it can come from. Rendering the real grid + card + strip
    // against a real server is the honest proof the prop is wired.
    const s = await startMockServer({
      "/congress": { results: [] },
      "/chambers": [
        { label: "House", value: "house" },
        { label: "Senate", value: "senate" },
      ],
    });
    servers.push(s);
    useBackendsStore.setState({
      backends: [backend({ baseUrl: s.url })],
      statuses: { b1: "online" },
    });
    useWidgetRegistryStore.setState({ widgets: [endpointWidget] });
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [endpointCard] }] }],
      activeId: "d1",
      activeTabId: "t1",
      previousId: null,
    });

    render(<DashboardGrid onOpenLibrary={() => {}} />);

    const select = await screen.findByLabelText("Chamber");
    await waitFor(() =>
      expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
        "House",
        "Senate",
      ]),
    );
  });
});
