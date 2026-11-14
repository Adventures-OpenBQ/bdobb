// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => [] as unknown[]);
vi.mock("../lib/artsCharts/card", async () => {
  const { useEffect } = await import("react");
  return {
    default: function MockArtsChartsCard(props: Record<string, unknown>) {
      seen.push(props);
      // The renderer hands its command strip up through controlsSlot.
      const slot = props.controlsSlot as ((node: unknown) => void) | undefined;
      useEffect(() => { slot?.(<button type="button">Series</button>); return () => slot?.(null); }, [slot]);
      return <div data-testid="arts-card">{String((props.params as Record<string, string>).symbol)}</div>;
    },
  };
});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn(), confirm: vi.fn() }));
vi.mock("../hooks/useWidgetData", () => ({
  useWidgetData: () => ({ status: "ready", data: null, retry: vi.fn(), attempt: 0 }),
}));

import { artsChartWidget } from "../lib/artsCharts/widget";
import { backend as makeBackend, card as makeCard } from "../test/fixtures";
import { useArtsChartsStore } from "../stores/artsChartsStore";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { WidgetCard } from "./WidgetCard";

const layout = { x: 0, y: 0, w: 40, h: 20 };
const charts = makeBackend({ id: "c1", name: "Charts" });
const artsWidget = artsChartWidget(charts);

function renderCard(card = makeCard({
  id: "k1", widgetId: "arts_chart", backendId: "c1", layout,
  params: { symbol: "AAPL", chart_id: "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d" },
})) {
  useBackendsStore.setState({ backends: [charts] });
  useWidgetRegistryStore.setState({ widgets: [artsWidget] });
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [card] }] }],
    activeId: "d1", activeTabId: "t1",
  });
  return render(<WidgetCard card={card} onRemove={vi.fn()} />);
}

beforeEach(() => { seen.length = 0; useArtsChartsStore.setState({ reveal: null }); });

it("dispatches arts_chart to the Art's Charts card with WidgetCard's own writers", async () => {
  renderCard();
  expect(await screen.findByTestId("arts-card")).toHaveTextContent("AAPL");
  const props = seen.at(-1) as Record<string, unknown>;
  expect(Object.keys(props).sort()).toEqual(["backend", "card", "controlsSlot", "exchange", "groups", "groupsDisabled", "onParam", "params", "refreshKey", "widget"].sort());
  expect(typeof props.onParam).toBe("function");
});

it("draws the chart's command strip, handed up through controlsSlot, as a line of the card header", async () => {
  renderCard();
  const card = await screen.findByTestId("arts-card");
  const series = await screen.findByRole("button", { name: "Series" });
  expect(card).not.toContainElement(series);
  expect(series.closest(".card-header > .card-chart-strip")).not.toBeNull();
});

it("draws the refresh control on a chart card", async () => {
  renderCard();
  await screen.findByTestId("arts-card");
  expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
});

it("a reveal for this card scrolls it into view and flashes it", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  renderCard(makeCard({ id: "k1", widgetId: "arts_chart", backendId: "c1", params: {}, layout }));
  await screen.findByTestId("arts-card");
  act(() => useArtsChartsStore.getState().revealCard("k1"));
  expect(scroll).toHaveBeenCalled();
  expect(document.querySelector('[data-card-id="k1"]')).toHaveClass("card-reveal");
});

it("a reveal is one-shot: unmount and remount does not scroll again, a mount with a pending reveal does", async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const card = makeCard({ id: "k1", widgetId: "arts_chart", backendId: "c1", params: {}, layout });
  // openChart reveals before the card exists: the card handles it on mount.
  useArtsChartsStore.getState().revealCard("k1");
  const first = renderCard(card);
  await screen.findByTestId("arts-card");
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(useArtsChartsStore.getState().reveal).toBeNull();
  expect(document.querySelector('[data-card-id="k1"]')).toHaveClass("card-reveal");
  first.unmount();
  renderCard(card);
  await screen.findByTestId("arts-card");
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-card-id="k1"]')).not.toHaveClass("card-reveal");
});
