// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// V9-P2 on a managed table (walk 2026-10-15): ingest puts the provider hint on the source column's metadata, the
// managed session carries it to describe_table, and arrange_table's fill-in behaves as on a worker table.
// Its own file: the shared tableExecutionStore is swapped for one backed by the real-runtime managed fixture.
import { afterAll, beforeAll, expect, it } from "vitest";
import { createRemoteProviderFixture } from "../../tableExecution/rust/remoteProviderFixture";
import { input } from "../../tableExecution/fixtures";
import { normalizeWidgets } from "../../widgetsJson";
import { realRustRuntime } from "../../../test/tableProviderBoundary";
import { createTableExecutionStore, tableExecutionStore } from "../../../stores/tableExecutionStore";
import { tableCommitCoordinators } from "../../../stores/tableCommitCoordinator";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import type { Dashboard, DashboardCard } from "../../types";
import { arrangeTable, describeTable } from "./tools";

const hint = { time: "last", frequencies: ["quarter"], entity: "require_selection", status: "conditional", ruleset: "eodhd-1" };
// Revenue 10, 20, 90 in 2026 Q1: last is 90, sum would be 120.
const hinted = { ...input, columns: input.columns.map(c => (c.id === "revenue" ? { ...c, metadata: { aggregationHint: hint } } : c)) };

beforeAll(async () => {
  const fixture = createRemoteProviderFixture({ runtime: await realRustRuntime(), sourceId: "s", snapshotId: "", input: hinted });
  Object.assign(tableExecutionStore, createTableExecutionStore({ source: () => { throw new Error("no client acquisition"); }, executor: () => { throw new Error("no client worker"); }, managedProvider: () => ({ open: fixture.provider.open }) }));
  useWidgetRegistryStore.setState({ widgets: normalizeWidgets({ managed: { type: "table_ssrm", provider: "managed-native", protocolVersion: 1, endpoint: "/sessions" } }, "b").widgets });
  const card: DashboardCard = { id: "m", widgetId: "managed", backendId: "b", params: {}, layout: { x: 0, y: 0, w: 1, h: 1 }, managedSource: { sourceId: "s", kind: "upload", version: 1 } };
  const d = { id: "d", name: "D", tabs: [{ id: "t", name: "T", cards: [card] }] } as Dashboard;
  useDashboardStore.setState({ dashboards: [d], activeId: "d", activeTabId: "t", viewer: false });
  tableExecutionStore.syncDashboard(d); tableExecutionStore.ensureTable("d", "m"); tableCommitCoordinators.get("d", "m");
  await tableExecutionStore.settled("d");
});
afterAll(() => tableExecutionStore.disposeDashboard("d"));

type Preview = { status: string; preview: { rows: { values: Record<string, unknown> }[] }; warnings: { code?: string; message?: string }[] };
const arrange = async (category: Record<string, unknown>, aggregation?: string) => {
  const description = await describeTable({ card_id: "m" }) as { revision: string; card: { source_kind: string }; fields: { id: string; hint?: unknown }[] };
  expect(description.card.source_kind).toBe("managed-native");
  expect(description.fields.find(f => f.id === "revenue")?.hint).toEqual(hint);
  return await arrangeTable({ card_id: "m", expected_revision: description.revision, mode: "preview", arrangement: { contract: "table-model/1", operations: [
    { op: "category.add", alias: "g", name: "G", ...category },
    { op: "measure.add", alias: "r", source_field_id: "revenue", ...(aggregation ? { aggregation } : {}) },
    { op: "layout.set", rows: [{ alias: "g" }], columns: [], values: [{ alias: "r" }] },
    { op: "model.enable", enabled: true },
  ] } }) as Preview;
};
const values = (p: Preview) => p.preview.rows.flatMap(r => Object.values(r.values).filter(v => typeof v === "number"));

it("fills in the provider's operator on a managed table when the arrangement meets the rule", async () => {
  const out = await arrange({ source_field_id: "date", transform: "Q" });
  expect(out.status).toBe("previewed");
  expect(out.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-applied", message: "revenue: last applied, the provider's operator for this column" }));
  expect(values(out)).toContain(90);
  expect(values(out)).not.toContain(120);
});

it("leaves a managed table's omitted aggregation alone off the rule, and keeps a named one with the warning", async () => {
  const off = await arrange({ source_field_id: "region", transform: "native" });
  expect(off.warnings.some(w => w.code === "provider-aggregation-applied")).toBe(false);
  const named = await arrange({ source_field_id: "date", transform: "Q" }, "sum");
  expect(named.warnings.some(w => w.code === "provider-aggregation-applied")).toBe(false);
  expect(named.warnings).toContainEqual(expect.objectContaining({ code: "provider-aggregation-hint" }));
  expect(values(named)).toContain(120);
});
