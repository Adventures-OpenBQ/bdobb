// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Against the REAL react-grid-layout (DashboardGrid.test.tsx stubs it): an
// imported app's coordinates must survive first display. The reference
// Onboarding app reserves rows 0-1 on every tab, so its Grouping cards sit at
// y=2 and y=11; vertical compaction used to pull them to 0 and 9 on mount and
// the grid's onLayoutChange wrote that back to disk (bdobb#6, bdobb-v2#317).
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter"]),
}));

import { __resetLoggerForTests } from "../lib/logger";
import { DEFAULT_SETTINGS } from "../lib/settingsFile";
import { GRID_ROW_HEIGHT, useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { __reset as __resetFs } from "../test/memfs";
import { card as makeCard, widget as makeWidget } from "../test/fixtures";
import { DashboardGrid } from "./DashboardGrid";

const grouping = [
  makeCard({ id: "details", widgetId: "w1", layout: { x: 0, y: 2, w: 19, h: 9 } }),
  makeCard({ id: "performance", widgetId: "w1", layout: { x: 19, y: 2, w: 21, h: 9 } }),
  makeCard({ id: "table", widgetId: "w1", layout: { x: 0, y: 11, w: 19, h: 9 } }),
  makeCard({ id: "managed", widgetId: "w1", layout: { x: 19, y: 11, w: 21, h: 9 } }),
];

beforeEach(() => {
  __resetLoggerForTests();
  __resetFs();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useWidgetRegistryStore.setState({ widgets: [makeWidget({ id: "w1", name: "Price History", endpoint: "equity/price" })] });
  useDashboardStore.setState({
    dashboards: [{ id: "d1", name: "Onboarding", tabs: [{ id: "t1", name: "Grouping", cards: grouping }] }],
    activeId: "d1",
    activeTabId: "t1",
    maximizedCardId: null,
  });
});

describe("DashboardGrid first display (real react-grid-layout)", () => {
  it("keeps imported coordinates instead of compacting and persisting them", async () => {
    const updateLayouts = vi.fn().mockResolvedValue(undefined);
    useDashboardStore.setState({ updateLayouts });

    const { container } = render(<DashboardGrid onOpenLibrary={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".react-grid-item")).toHaveLength(4));

    expect(updateLayouts).not.toHaveBeenCalled();
    // Drawn at row 2, not row 0: react-grid-layout positions an item at
    // y * (rowHeight + marginY) + marginY, with the default 10px margin.
    const first = container.querySelector<HTMLElement>(".react-grid-item")!;
    const translateY = Number(/translate\([^,]+,\s*([\d.]+)px\)/.exec(first.style.transform)?.[1]);
    expect(translateY).toBe(2 * (GRID_ROW_HEIGHT + 10) + 10);
  });
});
