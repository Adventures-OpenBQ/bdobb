// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// D-012: arrange_table mode "preview" answers a read-only ask with worker numbers and never commits.
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalTableRenderer } from "../../../components/renderers/LocalTableRenderer";
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { tableCommitCoordinators } from "../../../stores/tableCommitCoordinator";
import { __reset } from "../../../test/memfs";
import { mountCsv } from "./testHarness";
import { arrangeTable, describeTable } from "./tools";

const SMALL = "region,revenue,cost,date\nA,10,4,2026-01-01\nA,20,5,2026-01-02\nB,90,30,2026-01-03\n";
const file = vi.hoisted(() => ({ csv: "" }));
vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode(file.csv)) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));

beforeEach(() => { __reset(); file.csv = SMALL; useWidgetRegistryStore.getState().seedBuiltins(); useAgentEditsStore.getState().clear(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); tableExecutionStore.disposeDashboard("rita"); vi.unstubAllGlobals(); });

type Previewed = Record<string, unknown> & { preview: { rows: unknown[]; total: number; truncated: boolean } };
const cardOf = (id: string) => useDashboardStore.getState().dashboards.find(d => d.id === "rita")!.tabs[0].cards.find(c => c.id === id)!;
const card = () => cardOf("w");
const witness = async (card_id = "w") => (await describeTable({ card_id }) as { revision: string }).revision;
const ops = [
  { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
  { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation: "sum" },
  { op: "measure.add", alias: "n", source_field_id: "revenue", aggregation: "count" },
  { op: "layout.set", rows: [{ alias: "reg" }], values: [{ alias: "rev" }, { alias: "n" }] },
  { op: "model.enable", enabled: true },
];
const preview = (revision: string, operations: unknown[] = ops, card_id = "w") =>
  arrangeTable({ card_id, expected_revision: revision, mode: "preview", arrangement: { contract: "table-model/1", operations } }) as Promise<Previewed>;

it("mode preview returns worker numbers and never writes, publishes or registers Undo", async () => {
  await mountCsv();
  const revision = await witness();
  const before = structuredClone(card());
  const replace = vi.spyOn(tableCommitCoordinators.peek("rita", "w")!, "replaceDefinition");
  const out = await preview(revision);
  expect(out).toMatchObject({ status: "previewed", committed: false, revision, preview: { total: 2, truncated: false } });
  expect(JSON.stringify(out.preview.rows)).toContain("30"); // A = 10 + 20, by the worker
  expect(replace).not.toHaveBeenCalled();
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
  expect(await witness()).toBe(revision);
  expect(out).not.toHaveProperty("undo");
});

it("mode preview still checks the revision and validation", async () => {
  await mountCsv();
  expect(await preview("tm1-nope")).toMatchObject({ status: "refused", code: "stale-revision" });
  expect(await preview(await witness(), [{ op: "measure.add", source_field_id: "region", aggregation: "sum" }])).toMatchObject({ status: "refused", code: "validation-failed" });
});

it("mode preview of an empty arrangement previews the current table rather than answering unchanged", async () => {
  await mountCsv();
  const out = await preview(await witness(), []);
  expect(out).toMatchObject({ status: "previewed", committed: false, preview: { total: 3, truncated: false } });
});

it("mode preview returns at most 20 rows and says when it truncated", async () => {
  file.csv = "region,revenue\n" + Array.from({ length: 25 }, (_, i) => `R${i},${i}`).join("\n") + "\n";
  await mountCsv();
  const out = await preview(await witness(), []);
  expect(out).toMatchObject({ status: "previewed", preview: { total: 25, truncated: true } });
  expect(out.preview.rows).toHaveLength(20);
});

it("mode preview is read-only in viewer mode too: authoring operations preview, nothing is written", async () => {
  await mountCsv();
  const revision = await witness();
  useDashboardStore.setState({ viewer: true });
  const before = structuredClone(card());
  const out = await preview(revision);
  expect(out).toMatchObject({ status: "previewed", committed: false });
  expect(card()).toEqual(before);
  expect(tableExecutionStore.readRuntimeParams("rita", "w")).toEqual({});
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("mode preview of a linked child calculates on its source's rows and writes neither card", async () => {
  await mountCsv();
  const d = useDashboardStore.getState().dashboards.find(x => x.id === "rita")!;
  const linkedId = (await useDashboardStore.getState().addLinkedCard({ dashboardId: d.id, tabId: d.tabs[0].id, sourceWidgetId: "w", presentation: "table" }))!;
  tableExecutionStore.syncDashboard(useDashboardStore.getState().dashboards.find(x => x.id === "rita") as never);
  render(<LocalTableRenderer executionIdentity={{ dashboardId: d.id, widgetId: linkedId }} file="" label="Linked" refreshKey={0} state={{}} onStateChange={() => undefined} filterRow />);
  await waitFor(() => expect(tableExecutionStore.readView(d.id, linkedId).status).toMatch(/ready|empty/));
  const revision = await witness(linkedId);
  const [beforeChild, beforeSource] = [structuredClone(cardOf(linkedId)), structuredClone(card())];
  const out = await preview(revision, ops, linkedId);
  expect(out).toMatchObject({ status: "previewed", committed: false, card_id: linkedId, preview: { total: 2 } });
  expect(cardOf(linkedId)).toEqual(beforeChild);
  expect(card()).toEqual(beforeSource);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("refuses an unknown mode instead of applying", async () => {
  await mountCsv();
  const before = structuredClone(card());
  const out = await arrangeTable({ card_id: "w", expected_revision: await witness(), mode: "dry-run", arrangement: { contract: "table-model/1", operations: ops } });
  expect(out).toMatchObject({ status: "refused", code: "invalid-arrangement" });
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("refuses an invented dry_run argument instead of falling through to an apply", async () => {
  await mountCsv();
  const before = structuredClone(card());
  const replace = vi.spyOn(tableCommitCoordinators.peek("rita", "w")!, "replaceDefinition");
  const out = await arrangeTable({ card_id: "w", expected_revision: await witness(), dry_run: true, arrangement: { contract: "table-model/1", operations: ops } });
  expect(out).toMatchObject({ status: "refused", code: "invalid-arrangement" });
  expect(String(out.message)).toContain("dry_run");
  expect(replace).not.toHaveBeenCalled();
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});
