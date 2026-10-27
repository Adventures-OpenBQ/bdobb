// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

const openChartCard = vi.fn(async (_id: string) => {});
vi.mock("../artsChartsHost", () => ({ reconfigure: vi.fn(), openChartCard }));
vi.mock("./desktopSocket", () => ({ installChartsSocketShim: () => () => {} }));
const { useArtsChartsStore } = await import("../../stores/artsChartsStore");
const { useBackendsStore } = await import("../../stores/backendsStore");
const { useDashboardStore } = await import("../../stores/dashboardStore");
const { handleArtsLink } = await import("./runtime");

const ID = "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d";
const charts = { id: "c1", name: "Charts", baseUrl: "https://door.example.com", authLocation: "header" as const, validateWidgets: true, kind: "arts-charts" as const, door: "gateway" as const };
const notice = () => useArtsChartsStore.getState().notice;

beforeEach(() => {
  openChartCard.mockClear();
  useArtsChartsStore.setState({ focusItem: null, focusNonce: 0, notice: null });
  useBackendsStore.setState({ backends: [charts] });
  useDashboardStore.setState({ loaded: true });
});

describe("handleArtsLink (B12)", () => {
  it("inbox/<id> focuses the rail inbox; chart/<id> calls openChart; nothing else happens", async () => {
    await handleArtsLink({ kind: "inbox", id: ID });
    expect(useArtsChartsStore.getState().focusItem).toBe(ID);
    expect(openChartCard).not.toHaveBeenCalled();
    await handleArtsLink({ kind: "chart", id: ID });
    expect(openChartCard).toHaveBeenCalledWith(ID);
  });
  it("with no connection shows a notice and does nothing else", async () => {
    useBackendsStore.setState({ backends: [] });
    await handleArtsLink({ kind: "chart", id: ID });
    expect(openChartCard).not.toHaveBeenCalled();
    expect(notice()).toBe("This link needs an Art's Charts connection.");
    await handleArtsLink({ kind: "inbox", id: ID });
    expect(useArtsChartsStore.getState().focusItem).toBeNull();
  });
  it("holds a link that arrives before the dashboards have loaded, and runs it once they have", async () => {
    useDashboardStore.setState({ loaded: false });
    const p = handleArtsLink({ kind: "chart", id: ID });
    await Promise.resolve();
    expect(openChartCard).not.toHaveBeenCalled();
    useDashboardStore.setState({ loaded: true });
    await p;
    expect(openChartCard).toHaveBeenCalledWith(ID);
  });
});
