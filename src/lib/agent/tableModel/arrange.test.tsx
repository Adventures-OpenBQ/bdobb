// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentEditsStore } from "../../../stores/agentEditsStore";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { buildCandidate } from "./candidate";
import { tableCommitCoordinators } from "../../../stores/tableCommitCoordinator";
import { commitDrawerModel, mountCsv } from "./testHarness";
import { SETTLE_TIMEOUT_MS } from "./arrange";
import { pivotValueKey } from "../../pivotKeys";
import { arrangeTable, describeTable } from "./tools";

vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode("region,revenue,cost,date\nA,10,4,2026-01-01\nA,20,5,2026-01-02\nB,90,30,2026-01-03\n")) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));
vi.mock("./candidate", async importOriginal => { const real = await importOriginal<typeof import("./candidate")>(); return { ...real, buildCandidate: vi.fn(real.buildCandidate) }; });

beforeEach(() => { useWidgetRegistryStore.getState().seedBuiltins(); useAgentEditsStore.getState().clear(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); tableExecutionStore.disposeDashboard("rita"); vi.unstubAllGlobals(); });

type Out = { status: string; revision?: string | null; code?: string; ids: Record<string, string>; preview: { total: number; rows: unknown[] }; errors: { code: string }[] };
type Exec = { previewDefinition: (...a: unknown[]) => Promise<unknown> };
/** Runs `after` once the live preview has returned, i.e. while arrange is between preview and write. */
function afterPreview(after: () => Promise<void> | void) {
  const exec = tableExecutionStore.readExecutor("rita", "w") as unknown as Exec;
  const real = exec.previewDefinition.bind(exec);
  vi.spyOn(exec, "previewDefinition").mockImplementation(async (...a: unknown[]) => { const r = await real(...a); await after(); return r; });
}
const replaceSpy = () => vi.spyOn(tableCommitCoordinators.peek("rita", "w")!, "replaceDefinition");
const card = () => useDashboardStore.getState().dashboards[0].tabs[0].cards[0];
const witness = async () => (await describeTable({ card_id: "w" }) as { revision: string }).revision;
const arrange = (revision: string, operations: unknown[]) => arrangeTable({ card_id: "w", expected_revision: revision, arrangement: { contract: "table-model/1", operations } }) as Promise<Out>;
const regionRevenue = [
  { op: "category.add", alias: "reg", name: "Region", source_field_id: "region", transform: "native" },
  { op: "measure.add", alias: "rev", source_field_id: "revenue", aggregation: "sum" },
  { op: "layout.set", rows: [{ alias: "reg" }], values: [{ alias: "rev" }] },
  { op: "model.enable", enabled: true },
];

it("applies a validated arrangement in one step, returns engine numbers, and registers one Undo", async () => {
  await mountCsv();
  const out = await arrange(await witness(), regionRevenue);
  expect(out).toMatchObject({ status: "applied", undo: "available" });
  expect(out.preview.total).toBe(2);
  expect(JSON.stringify(out.preview.rows)).toContain("30"); // A = 10 + 20, computed by the worker
  expect(JSON.stringify(out.preview.rows)).toContain("90");
  expect(useAgentEditsStore.getState().entries).toHaveLength(1);
  expect(card().tableDefinition?.analytical).toMatchObject({ layout: { rows: [out.ids.reg] } });
});

it("refuses a stale revision and changes nothing", async () => {
  await mountCsv();
  const revision = await witness();
  await commitDrawerModel("rita", "w", {}); // a drawer edit in between
  const before = structuredClone(card());
  const out = await arrange(revision, [{ op: "model.enable", enabled: false }]);
  expect(out).toMatchObject({ status: "refused", code: "stale-revision" });
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("is all-or-nothing: one bad operation refuses the whole request with every structural error", async () => {
  await mountCsv();
  const before = structuredClone(card());
  const out = await arrange(await witness(), [
    { op: "measure.add", source_field_id: "revenue", aggregation: "sum" },
    { op: "measure.add", source_field_id: "region", aggregation: "sum" }, // sum of text: the operator check refuses
  ]);
  expect(out).toMatchObject({ status: "refused", code: "validation-failed" });
  expect(out.errors[0]).toMatchObject({ code: "validation" });
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("returns unchanged with no Undo for a no-op", async () => {
  await mountCsv();
  const out = await arrange(await witness(), [{ op: "presentation.set", hidden: [] }]);
  expect(out).toMatchObject({ status: "unchanged" });
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("surfaces Statement update conflicts in the refused result", async () => {
  await mountCsv();
  vi.mocked(buildCandidate).mockReturnValueOnce({ ids: {}, errors: [{ code: "validation", message: "template update has conflicts", operation_index: 0 }], conflicts: [{ id: "s1", reason: "Section membership changed" }] } as never);
  const out = await arrange(await witness(), [{ op: "statement.update_template", template_version: "1.0.0" }]);
  expect(out).toMatchObject({ status: "refused", conflicts: [{ id: "s1" }] });
});

it("rechecks viewer mode right before the durable write and leaves everything unchanged", async () => {
  await mountCsv();
  const revision = await witness();
  const before = structuredClone(card());
  const write = replaceSpy();
  afterPreview(() => useDashboardStore.setState({ viewer: true }));
  const out = await arrange(revision, regionRevenue);
  expect(out).toMatchObject({ status: "refused", code: "viewer-scope" });
  expect(write).not.toHaveBeenCalled();
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("a drawer edit during the preview refuses stale-revision before the write", async () => {
  await mountCsv();
  const revision = await witness();
  const write = replaceSpy();
  afterPreview(() => commitDrawerModel("rita", "w", {}));
  const out = await arrange(revision, regionRevenue);
  expect(out).toMatchObject({ status: "refused", code: "stale-revision" });
  expect(write).not.toHaveBeenCalled();
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("reports commit-failed with nothing published and no Undo when the durable write fails", async () => {
  await mountCsv();
  const revision = await witness();
  const before = structuredClone(card());
  const real = useDashboardStore.getState().commitTableDefinition;
  useDashboardStore.setState({ commitTableDefinition: async () => { throw new Error("disk"); } } as never);
  try {
    const out = await arrange(revision, regionRevenue);
    expect(out).toMatchObject({ status: "failed", code: "commit-failed" });
  } finally { useDashboardStore.setState({ commitTableDefinition: real } as never); }
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("Undo restores the previous configuration, and refuses to overwrite a later drawer edit", async () => {
  await mountCsv();
  const before = structuredClone(card().tableDefinition);
  expect(await arrange(await witness(), regionRevenue)).toMatchObject({ status: "applied" });
  await useAgentEditsStore.getState().undoLast();
  expect(card().tableDefinition?.analytical).toEqual(before?.analytical);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);

  expect(await arrange(await witness(), regionRevenue)).toMatchObject({ status: "applied" });
  await commitDrawerModel("rita", "w", { enabled: false }); // the user edits afterwards
  const edited = structuredClone(card().tableDefinition);
  await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/changed after Rita's edit/);
  expect(useAgentEditsStore.getState().undoError).toMatch(/nothing was restored/);
  expect(card().tableDefinition).toEqual(edited);
});

// view.set switches the card's view among describe_table's `views`; the view is card state, kept by the same one Undo.
it("view.set switches the card's view, describe_table reports it, and Undo restores the default", async () => {
  await mountCsv();
  const views = (await describeTable({ card_id: "w" }) as { views: string[] }).views;
  expect(views).toEqual(expect.arrayContaining(["table", "statement"]));
  const out = await arrange(await witness(), [{ op: "view.set", view: "statement" }]);
  expect(out).toMatchObject({ status: "applied", view: "statement", undo: "available" });
  expect(card().view).toBe("statement");
  expect((await describeTable({ card_id: "w" }) as { card: { view?: string } }).card.view).toBe("statement");
  expect(await arrange(await witness(), [{ op: "view.set", view: "statement" }])).toMatchObject({ status: "unchanged" });
  await useAgentEditsStore.getState().undoLast();
  expect(card().view).toBeUndefined();
});

it("view.set with model operations applies both in one request and one Undo", async () => {
  await mountCsv();
  const before = structuredClone(card().tableDefinition);
  const out = await arrange(await witness(), [...regionRevenue, { op: "view.set", view: "statement" }]);
  expect(out).toMatchObject({ status: "applied", view: "statement" });
  expect(card().tableDefinition?.analytical).toMatchObject({ layout: { rows: [out.ids.reg] } });
  expect(useAgentEditsStore.getState().entries).toHaveLength(1);
  await useAgentEditsStore.getState().undoLast();
  expect(card().view).toBeUndefined();
  expect(card().tableDefinition?.analytical).toEqual(before?.analytical);
});

it("refuses a view the card does not offer, naming the ones it does, and changes nothing", async () => {
  await mountCsv();
  const before = structuredClone(card());
  const out = await arrange(await witness(), [...regionRevenue, { op: "view.set", view: "chart" }]) as Out & { errors: { code: string; alternatives?: string[] }[] };
  expect(out).toMatchObject({ status: "refused", code: "validation-failed" });
  expect(out.errors[0]).toMatchObject({ code: "invalid-field", operation_index: regionRevenue.length });
  expect(out.errors[0].alternatives).toContain("statement");
  expect(card()).toEqual(before);
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("Undo refuses to overwrite a view the user changed after Rita's edit", async () => {
  await mountCsv();
  expect(await arrange(await witness(), [{ op: "view.set", view: "statement" }])).toMatchObject({ status: "applied" });
  await useDashboardStore.getState().patchCardField("w", "view", null);
  await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/changed after Rita's edit/);
  expect(card().view).toBeUndefined();
});

it("returns a settled revision that describe_table agrees with and a follow-up arrange accepts", async () => {
  await mountCsv();
  const out = await arrange(await witness(), regionRevenue);
  expect(out.status).toBe("applied");
  expect(out.revision).toBe(await witness());
  expect(await arrange(out.revision as string, [{ op: "model.enable", enabled: false }])).toMatchObject({ status: "applied" });
});

it("reports revision null and recalculating when the table does not settle in time", async () => {
  await mountCsv();
  const revision = await witness();
  const real = tableExecutionStore.readView.bind(tableExecutionStore);
  const coordinator = tableCommitCoordinators.peek("rita", "w")!;
  const write = coordinator.replaceDefinition.bind(coordinator);
  let committed = false;
  vi.spyOn(coordinator, "replaceDefinition").mockImplementation(async (...a) => { const r = await write(...a); committed = true; vi.useFakeTimers(); return r; });
  // The renderer reads this through useSyncExternalStore: the stuck view must be referentially stable per real view, or React re-renders forever.
  const stuck = new WeakMap<object, ReturnType<typeof real>>();
  vi.spyOn(tableExecutionStore, "readView").mockImplementation((d, id) => {
    const v = real(d, id);
    if (!committed) return v;
    if (!stuck.has(v)) stuck.set(v, { ...v, status: "updating", stale: true });
    return stuck.get(v)!;
  });
  try {
    const pending = arrange(revision, regionRevenue);
    await vi.waitFor(() => expect(committed).toBe(true), { timeout: 10_000 });
    await vi.advanceTimersByTimeAsync(SETTLE_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ status: "applied", revision: null, recalculating: true });
  } finally { vi.useRealTimers(); }
});

it("registers Undo before the settle wait, so a drawer edit made during the wait is protected", async () => {
  await mountCsv();
  const revision = await witness();
  const real = tableExecutionStore.readView.bind(tableExecutionStore);
  const coordinator = tableCommitCoordinators.peek("rita", "w")!;
  const write = coordinator.replaceDefinition.bind(coordinator);
  let frozen = false;
  vi.spyOn(coordinator, "replaceDefinition").mockImplementation(async (...a) => { const r = await write(...a); frozen = true; return r; });
  // Hold arrange in its settle wait (referentially stable per real view, see the test below) until the drawer edit has landed.
  const stuck = new WeakMap<object, ReturnType<typeof real>>();
  vi.spyOn(tableExecutionStore, "readView").mockImplementation((d, id) => {
    const v = real(d, id);
    if (!frozen) return v;
    if (!stuck.has(v)) stuck.set(v, { ...v, status: "updating", stale: true });
    return stuck.get(v)!;
  });
  const pending = arrange(revision, regionRevenue);
  await vi.waitFor(() => expect(frozen).toBe(true), { timeout: 10_000 });
  expect(useAgentEditsStore.getState().entries).toHaveLength(1); // registered while arrange is still waiting to settle
  frozen = false;
  await commitDrawerModel("rita", "w", { enabled: false }); // the user edits inside the settle window
  const edited = structuredClone(card().tableDefinition);
  expect(await pending).toMatchObject({ status: "applied" });
  await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/changed after Rita's edit/);
  expect(card().tableDefinition).toEqual(edited);
});

it("refuses a busy coordinator with code busy and does not write", async () => {
  await mountCsv();
  const revision = await witness();
  const coordinator = tableCommitCoordinators.peek("rita", "w")!;
  const write = replaceSpy();
  vi.spyOn(coordinator, "getSnapshot").mockReturnValue({ ...coordinator.getSnapshot(), canReplace: false });
  expect(await arrange(revision, regionRevenue)).toMatchObject({ status: "refused", code: "busy" });
  expect(write).not.toHaveBeenCalled();
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("a source change during the preview refuses before the write", async () => {
  await mountCsv();
  const revision = await witness();
  const write = replaceSpy();
  afterPreview(() => { useDashboardStore.setState(s => ({ dashboards: s.dashboards.map(d => ({ ...d, tabs: d.tabs.map(t => ({ ...t, cards: t.cards.map(c => ({ ...c, params: { file: "other.csv" } })) })) })) })); });
  expect(await arrange(revision, regionRevenue)).toMatchObject({ status: "refused" });
  expect(write).not.toHaveBeenCalled();
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
});

it("a refused Undo is dropped with a visible error, and an older entry stays undoable", async () => {
  await mountCsv();
  const older = vi.fn(async () => undefined);
  useAgentEditsStore.getState().push({ summary: "older", undo: older });
  expect(await arrange(await witness(), regionRevenue)).toMatchObject({ status: "applied" });
  await commitDrawerModel("rita", "w", {});
  await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/changed after Rita's edit/);
  expect(useAgentEditsStore.getState().undoError).toMatch(/changed after Rita's edit/);
  expect(useAgentEditsStore.getState().entries).toHaveLength(1);
  await useAgentEditsStore.getState().undoLast();
  expect(older).toHaveBeenCalledOnce();
  expect(useAgentEditsStore.getState().entries).toHaveLength(0);
  expect(useAgentEditsStore.getState().undoError).toBeNull();
});

async function viewerWithTwoControls() {
  await mountCsv();
  await commitDrawerModel("rita", "w", { categories: [{ id: "reg", name: "Region", sourceFieldId: "region", transform: "native" }, { id: "dt", name: "Date", sourceFieldId: "date", transform: "native" }], measures: [{ id: "rev", sourceFieldId: "revenue", aggregation: "sum" }], layout: { rows: ["reg"], columns: [], values: ["rev"] }, params: { promotePage: false, filters: [{ id: "f1", categoryId: "reg", label: "Region", multiSelect: true }, { id: "f2", categoryId: "dt", label: "Date", multiSelect: true }] } });
  useDashboardStore.setState({ viewer: true });
  const d = await describeTable({ card_id: "w" }) as { revision: string; capabilities: { viewer_controls: { key: string }[] } };
  return { revision: d.revision, keys: d.capabilities.viewer_controls.map(c => c.key) };
}
const user = (key: string, members: string[] | null) => tableExecutionStore.setViewerParam("rita", "w", key, members);
const settleView = () => vi.waitFor(() => { const v = tableExecutionStore.readView("rita", "w"); expect(["ready", "empty"]).toContain(v.status); expect(v.stale).toBe(false); });
const params = () => tableExecutionStore.readRuntimeParams("rita", "w");

describe("viewer scope", () => {
  it("changes an existing control for the session with no durable write, then Undo restores it", async () => {
    const { revision, keys } = await viewerWithTwoControls();
    const saved = JSON.stringify(useDashboardStore.getState().dashboards[0]);
    const out = await arrange(revision, [{ op: "viewer.set", key: keys[0], member_keys: [pivotValueKey("A")] }]);
    expect(out).toMatchObject({ status: "applied", scope: "session" });
    expect(JSON.stringify(useDashboardStore.getState().dashboards[0])).toBe(saved);
    expect(params()[keys[0]]).toMatchObject({ source: "viewer" });
    await useAgentEditsStore.getState().undoLast();
    expect(params()[keys[0]]).toBeUndefined();
    expect(JSON.stringify(useDashboardStore.getState().dashboards[0])).toBe(saved);
  });
  it("refuses authoring operations and unknown controls without changing anything", async () => {
    const { revision } = await viewerWithTwoControls();
    expect(await arrange(revision, [{ op: "model.enable", enabled: false }])).toMatchObject({ status: "refused", code: "viewer-scope" });
    const out = await arrange(revision, [{ op: "viewer.set", key: "pivot:filter:nope", member_keys: null }]) as unknown as { status: string; errors: { code: string; alternatives: string[] }[] };
    expect(out.status).toBe("refused");
    expect(out.errors[0]).toMatchObject({ code: "unknown-reference" });
    expect(out.errors[0].alternatives.length).toBe(2);
    expect(params()).toEqual({});
    expect(useAgentEditsStore.getState().entries).toHaveLength(0);
  });
  it("Undo refuses to overwrite the same control the user changed afterwards", async () => {
    const { revision, keys } = await viewerWithTwoControls();
    await arrange(revision, [{ op: "viewer.set", key: keys[0], member_keys: [pivotValueKey("A")] }]);
    user(keys[0], [pivotValueKey("B")]);
    await expect(useAgentEditsStore.getState().undoLast()).rejects.toThrow(/changed after Rita's edit/);
    expect(useAgentEditsStore.getState().undoError).toMatch(/nothing was restored/);
    expect(params()[keys[0]]).toMatchObject({ memberKeys: [pivotValueKey("B")] });
  });
  it("Undo restores Rita's controls and leaves a different control the user changed afterwards", async () => {
    const { revision, keys } = await viewerWithTwoControls();
    await arrange(revision, [{ op: "viewer.set", key: keys[0], member_keys: [pivotValueKey("A")] }]);
    user(keys[1], ["x"]);
    await useAgentEditsStore.getState().undoLast();
    expect(params()[keys[0]]).toBeUndefined();
    expect(params()[keys[1]]).toMatchObject({ memberKeys: ["x"] });
  });
  it("does not leave viewer params applied when authority flips to authoring during the apply", async () => {
    const { revision, keys } = await viewerWithTwoControls();
    const real = tableExecutionStore.setViewerParam.bind(tableExecutionStore);
    vi.spyOn(tableExecutionStore, "setViewerParam").mockImplementation((...a) => { useDashboardStore.setState({ viewer: false }); return real(...a); });
    const out = await arrange(revision, [{ op: "viewer.set", key: keys[0], member_keys: [pivotValueKey("A")] }]);
    expect(out).toMatchObject({ status: "refused" });
    expect(useAgentEditsStore.getState().entries).toHaveLength(0);
    useDashboardStore.setState({ viewer: true });
    expect(params()).toEqual({});
  });
  it("a no-op is unchanged and registers no Undo", async () => {
    const { revision, keys } = await viewerWithTwoControls();
    expect(await arrange(revision, [{ op: "viewer.reset", key: keys[0] }])).toMatchObject({ status: "unchanged" });
    expect(useAgentEditsStore.getState().entries).toHaveLength(0);
  });
  it("a keyless viewer.reset clears viewer entries and Undo restores them", async () => {
    const { keys } = await viewerWithTwoControls();
    user(keys[0], [pivotValueKey("A")]);
    user(keys[1], ["x"]);
    const mine = structuredClone(params());
    await settleView();
    expect(await arrange(await witness(), [{ op: "viewer.reset" }])).toMatchObject({ status: "applied", scope: "session" });
    expect(params()).toEqual({});
    await useAgentEditsStore.getState().undoLast();
    expect(params()).toEqual(mine);
  });
  it("rolls back an earlier applied key exactly when a later operation fails", async () => {
    const { keys } = await viewerWithTwoControls();
    user(keys[0], ["prior"]);
    const before = structuredClone(params());
    await settleView();
    const real = tableExecutionStore.setViewerParam.bind(tableExecutionStore);
    let n = 0;
    vi.spyOn(tableExecutionStore, "setViewerParam").mockImplementation((...a) => { if (++n === 2 && a[2] === keys[1]) throw new Error("boom"); return real(...a); });
    const out = await arrange(await witness(), [{ op: "viewer.set", key: keys[0], member_keys: [pivotValueKey("A")] }, { op: "viewer.set", key: keys[1], member_keys: ["x"] }]);
    expect(out).toMatchObject({ status: "refused", code: "validation-failed" });
    expect(params()).toEqual(before);
    expect(useAgentEditsStore.getState().entries).toHaveLength(0);
  });
});
