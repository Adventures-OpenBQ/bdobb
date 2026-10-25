// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Shared by the table-model tool tests. The tests themselves keep their vi.mock("../../localFiles") and
// vi.mock("@tanstack/react-virtual") calls: Vitest hoists those per file.
import { render, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import { LocalTableRenderer } from "../../../components/renderers/LocalTableRenderer";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { tableCommitCoordinators } from "../../../stores/tableCommitCoordinator";
import { Boundary } from "../../../test/tableWorkerBoundary";
import type { TableModelV1 } from "../../tableModel/types";

export function mountCsv(dashboardId = "rita") {
  vi.stubGlobal("Worker", Boundary);
  const card = { id: "w", widgetId: "local_table", backendId: "builtin", params: { file: "data.csv" }, table: {}, layout: { x: 0, y: 0, w: 1, h: 1 } };
  const dashboard = { id: dashboardId, name: "Rita", tabs: [{ id: "t", name: "T", cards: [card] }] };
  // Other dashboards stay, so two cards can be mounted side by side; the same id is replaced.
  useDashboardStore.setState({ dashboards: [...useDashboardStore.getState().dashboards.filter(d => d.id !== dashboardId), dashboard as never], activeId: dashboardId, activeTabId: "t", viewer: false, pendingCardRemoval: null });
  tableExecutionStore.syncDashboard(dashboard as never);
  render(<LocalTableRenderer executionIdentity={{ dashboardId, widgetId: "w" }} file="data.csv" label="Data" refreshKey={0} state={{}} onStateChange={() => undefined} filterRow />);
  return waitFor(() => expect(tableExecutionStore.readView(dashboardId, "w").status).toBe("ready"));
}

export async function commitDrawerModel(d: string, id: string, patch: Partial<TableModelV1>) {
  const coordinator = tableCommitCoordinators.peek(d, id)!;
  const base: TableModelV1 = { schemaVersion: 1, enabled: true, params: { promotePage: false, filters: [] }, categories: [], measures: [], formulas: [], layout: { rows: [], columns: [], values: [] }, checklists: [], resultFilters: [], subtotals: { grandTotal: false, groups: false }, ...patch };
  expect(await coordinator.replaceModel(coordinator.authoringBase(), base)).toEqual({ status: "saved" });
  await waitFor(() => expect(tableExecutionStore.readView(d, id).status).toMatch(/ready|empty/));
}
