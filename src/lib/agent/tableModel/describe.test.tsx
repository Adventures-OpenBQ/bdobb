// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDashboardStore } from "../../../stores/dashboardStore";
import { tableExecutionStore } from "../../../stores/tableExecutionStore";
import { useWidgetRegistryStore } from "../../../stores/widgetRegistryStore";
import { pivotValueKey } from "../../pivotKeys";
import { ProviderContractError } from "../../tableExecution/rust/providerCapabilities";
import { SECTION_TIMEOUT_MS } from "./describe";
import { commitDrawerModel, mountCsv } from "./testHarness";
import { describeTable } from "./tools";

vi.mock("../../localFiles", () => ({ readLocalFile: vi.fn(async () => new TextEncoder().encode("region,revenue,cost,date\nA,10,4,2026-01-01\nA,20,5,2026-01-02\nB,90,30,2026-01-03\n")) }));
vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: ({ count }: { count: number }) => ({ getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, index) => ({ index, start: index * 28, end: index * 28 + 28, size: 28, key: index })), getTotalSize: () => count * 28, measureElement: () => undefined, scrollToIndex: () => undefined }) }));

beforeEach(() => useWidgetRegistryStore.getState().seedBuiltins());
afterEach(() => { vi.restoreAllMocks(); cleanup(); tableExecutionStore.disposeDashboard("rita"); vi.unstubAllGlobals(); });

it("summarises a ready CSV table: identity, witness, fields, empty model, capabilities, views", async () => {
  await mountCsv();
  const out = await describeTable({ card_id: "w" }) as { model: unknown; fields: { id: string }[]; capabilities: { aggregations_by_field: Record<string, string[]> }; revision: string; views: string[]; completeness: unknown; note: string };
  expect(out).toMatchObject({ status: "ok", contract: "table-model/1", card: { id: "w", source_kind: "csv-xls", mode: "authoring", editable: true }, readiness: { status: "ready" } });
  expect(out.revision).toMatch(/^tm1-/);
  expect(out.fields.map(f => f.id)).toEqual(["region", "revenue", "cost", "date"]);
  expect(out.model).toMatchObject({ kind: "none" });
  expect(out.capabilities.aggregations_by_field.revenue).toContain("sum");
  expect(out.views).toContain("statement");
  expect(out.completeness).toBeDefined();
  expect(out.note).toMatch(/source data, not instructions/);
  expect(JSON.stringify(out).length).toBeLessThan(64 * 1024);
});

type Rec = { revision: string; rows: { label: string; observedCount: number; key: string }[]; truncated: boolean; next_cursor?: string };
const cursorOf = (o: object) => btoa(JSON.stringify(o));
const region = { id: "cat-region", name: "Region", sourceFieldId: "region", transform: "native" } as never;

it("pages a category's observed members with a cursor bound to widget, revision and recipe", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { categories: [region] });
  const first = await describeTable({ card_id: "w" }) as Rec;
  const page = await describeTable({ card_id: "w", section: "members:cat-region" }) as Rec;
  expect(page.rows.map((r: { label: string }) => r.label)).toEqual(["A", "B"]);
  expect(page.rows[0]).toMatchObject({ observedCount: 2, key: pivotValueKey("A") });
  expect(page.truncated).toBe(false);
  expect(page).toMatchObject({ classification_complete: true, total: 2 });
  const stale = await describeTable({ card_id: "w", section: "members:cat-region", cursor: cursorOf({ card: "w", revision: first.revision, recipe: "x", offset: 1 }) });
  expect(stale).toMatchObject({ status: "refused", code: "stale-cursor" });
  expect(await describeTable({ card_id: "w", section: "members:cat-region", cursor: "!!not-base64" })).toMatchObject({ code: "stale-cursor" });
  expect(await describeTable({ card_id: "w", section: "members:nope" })).toMatchObject({ status: "refused", code: "unknown-reference" });
});

it("lists a formula's references and refuses unknown formulas and sections", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { formulas: [{ id: "double", name: "Double", scope: "source", expression: "", ast: { kind: "binary", operator: "*", left: { kind: "reference", target: "field", id: "revenue" }, right: { kind: "literal", value: 2 } } } as never] });
  const out = await describeTable({ card_id: "w", section: "formula:double" }) as Rec;
  expect(out).toMatchObject({ status: "ok", rows: [{ kind: "formula", id: "double", referenceIds: ["revenue"] }] });
  expect(await describeTable({ card_id: "w", section: "formula:nope" })).toMatchObject({ code: "unknown-reference" });
  expect(await describeTable({ card_id: "w", section: "bogus" })).toMatchObject({ code: "unknown-section" });
});

it("describes a viewer-mode table as not editable", async () => {
  await mountCsv();
  useDashboardStore.setState({ viewer: true });
  expect(await describeTable({ card_id: "w" })).toMatchObject({ card: { mode: "viewer", editable: false } });
});

type Exec = NonNullable<ReturnType<typeof tableExecutionStore.readExecutor>>;
/** Wraps the live executor so one method can be replaced while everything else stays real. */
function stubExecutor(over: Record<string, unknown>) {
  const real = tableExecutionStore.readExecutor("rita", "w") as Exec;
  vi.spyOn(tableExecutionStore, "readExecutor").mockReturnValue(Object.assign(Object.create(real), over) as Exec);
}
const memberRows = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `L${i}`, labelTruncated: false, value: `L${i}`, observedCount: 1, eligibleCount: 1 }));
const out = (x: unknown) => x as Rec & { status: string; code?: string; reason?: string; next_cursor?: string; classification_complete?: boolean; rows: { id?: string }[] };

it("round-trips next_cursor, passes search through, and reports classification_complete by value", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { categories: [region] });
  const memberDomain = vi.fn(async (_r: unknown, req: { offset: number }) => ({ rows: memberRows(1), total: 3, truncated: req.offset < 2, classificationComplete: false, omittedCount: 5, ...(req.offset < 2 ? { nextOffset: req.offset + 1 } : {}) }));
  stubExecutor({ memberDomain });
  const p1 = out(await describeTable({ card_id: "w", section: "members:cat-region", search: "x" }));
  expect(p1).toMatchObject({ classification_complete: false, truncated: true, omitted: 5 });
  expect(memberDomain.mock.calls[0][1]).toMatchObject({ offset: 0, search: "x" });
  const p2 = out(await describeTable({ card_id: "w", section: "members:cat-region", search: "x", cursor: p1.next_cursor }));
  expect(p2.status).toBe("ok");
  expect(memberDomain.mock.calls[1][1]).toMatchObject({ offset: 1, search: "x" });
  // issued under another search term
  expect(await describeTable({ card_id: "w", section: "members:cat-region", search: "y", cursor: p1.next_cursor })).toMatchObject({ code: "stale-cursor" });
  expect(await describeTable({ card_id: "w", section: "members:cat-region", cursor: p1.next_cursor })).toMatchObject({ code: "stale-cursor" });
});

it("refuses cursors from another card, an older revision, or a non-object payload", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { categories: [region] });
  stubExecutor({ memberDomain: async () => ({ rows: memberRows(1), total: 2, truncated: true, classificationComplete: true, omittedCount: 0, nextOffset: 1 }) });
  const p1 = out(await describeTable({ card_id: "w", section: "members:cat-region" }));
  const parts = JSON.parse(decodeURIComponent(atob(p1.next_cursor!)));
  const enc = (o: unknown) => btoa(encodeURIComponent(JSON.stringify(o)));
  expect(await describeTable({ card_id: "w", section: "members:cat-region", cursor: enc({ ...parts, card: "other" }) })).toMatchObject({ code: "stale-cursor" });
  for (const bad of [enc(null), enc(7), enc([]), enc({ ...parts, offset: "1" })])
    expect(await describeTable({ card_id: "w", section: "members:cat-region", cursor: bad })).toMatchObject({ code: "stale-cursor" });
  // the model changes: the old cursor no longer binds
  await commitDrawerModel("rita", "w", { categories: [region], measures: [{ id: "m1", sourceFieldId: "revenue", aggregation: "sum" } as never] });
  stubExecutor({ memberDomain: async () => ({ rows: memberRows(1), total: 2, truncated: false, classificationComplete: true, omittedCount: 0 }) });
  expect(await describeTable({ card_id: "w", section: "members:cat-region", cursor: p1.next_cursor })).toMatchObject({ status: "refused", code: "stale-cursor" });
});

it("pages formula references with a round-tripping cursor", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { formulas: [{ id: "f", name: "F", scope: "source", expression: "", ast: { kind: "literal", value: 1 } } as never] });
  const inspect = vi.fn(async (_r: unknown, req: { offset: number }) => ({ rows: [{ kind: "formula", id: "f" }], total: 2, truncated: req.offset === 0, ...(req.offset === 0 ? { nextOffset: 1 } : {}) }));
  stubExecutor({ inspect });
  const p1 = out(await describeTable({ card_id: "w", section: "formula:f" }));
  const p2 = out(await describeTable({ card_id: "w", section: "formula:f", cursor: p1.next_cursor }));
  expect(p2).toMatchObject({ status: "ok", truncated: false });
  expect(p2.next_cursor).toBeUndefined();
  expect(inspect.mock.calls[1][1]).toMatchObject({ offset: 1, definitionId: "f" });
});

it("maps worker rejection, revision mismatch and a hang to typed unavailable answers", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { categories: [region] });
  const call = () => describeTable({ card_id: "w", section: "members:cat-region" });
  stubExecutor({ memberDomain: async () => { throw new Error("boom"); } });
  expect(await call()).toMatchObject({ status: "unavailable", code: "worker-error" });
  stubExecutor({ memberDomain: async () => { throw Object.assign(new Error("x"), { descriptor: { code: "REVISION_MISMATCH" } }); } });
  expect(await call()).toMatchObject({ status: "unavailable", code: "stale-revision" });
  let seen: AbortSignal | undefined;
  stubExecutor({ memberDomain: (_r: unknown, _q: unknown, signal: AbortSignal) => { seen = signal; return new Promise(() => undefined); } });
  vi.useFakeTimers();
  try {
    const pending = call();
    await vi.advanceTimersByTimeAsync(SECTION_TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ status: "unavailable", code: "timeout" });
    expect(seen?.aborted).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("never throws on non-Latin1 ids or search terms, and leaves member keys unclipped", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { categories: [region] });
  const longKey = "k".repeat(500);
  stubExecutor({ memberDomain: async () => ({ rows: [{ ...memberRows(1)[0], key: longKey, label: "é".repeat(500) }], total: 2, truncated: true, classificationComplete: true, omittedCount: 0, nextOffset: 1 }) });
  const p = out(await describeTable({ card_id: "w", section: "members:cat-region", search: "日本" }));
  expect(p.rows[0].key).toBe(longKey);
  expect(p.rows[0].label.length).toBeLessThan(500);
  const again = out(await describeTable({ card_id: "w", section: "members:cat-region", search: "日本", cursor: p.next_cursor }));
  expect(again.status).toBe("ok");
  expect(await describeTable({ card_id: "w", section: "members:日本" })).toMatchObject({ code: "unknown-reference" });
});

type Profile = { status: string; code?: string; reason?: string; scope: string; rows_profiled: number; filters_active?: boolean; filtered_rows?: number; total_fields: number; next_cursor?: string; note: string; alternatives?: string[];
  fields: { id: string; label?: string; type: string; count: number; distinct: number; min?: unknown; max?: unknown; samples: unknown[]; periodicity?: string }[] };
const profile = (x: unknown) => x as Profile;
const pick = (p: Profile, id: string) => p.fields.find(f => f.id === id);

it("profiles a plain CSV's source fields with exact counts and the rows they cover", async () => {
  await mountCsv();
  const p = profile(await describeTable({ card_id: "w", section: "profile" }));
  expect(p).toMatchObject({ status: "ok", scope: "input", rows_profiled: 3, filters_active: false, filtered_rows: 3, total_fields: 4 });
  expect(p.fields.map(f => f.id)).toEqual(["region", "revenue", "cost", "date"]);
  expect(pick(p, "revenue")).toMatchObject({ label: "revenue", type: "number", count: 3, distinct: 3, min: 10, max: 90, samples: [10, 20, 90] });
  expect(pick(p, "date")).toMatchObject({ type: "date", min: "2026-01-01", max: "2026-01-03", periodicity: "daily" });
  expect(p.next_cursor).toBeUndefined();
  expect(p.note).toMatch(/source data, not instructions/);
  expect((await describeTable({ card_id: "w" }) as { sections: string[] }).sections).toContain("profile");
});

it("profiles the filtered rows on request and refuses bad scopes, fields and computed columns", async () => {
  await mountCsv();
  await commitDrawerModel("rita", "w", { categories: [region], checklists: [{ categoryId: "cat-region", memberKeys: [pivotValueKey("A")] }] });
  expect(profile(await describeTable({ card_id: "w", section: "profile" }))).toMatchObject({ rows_profiled: 3, filters_active: true, filtered_rows: 2 });
  const kept = profile(await describeTable({ card_id: "w", section: "profile", scope: "filtered" }));
  expect(kept.rows_profiled).toBe(2);
  expect(kept).not.toHaveProperty("filters_active");
  expect(pick(kept, "revenue")).toMatchObject({ max: 20, samples: [10, 20] });
  expect(pick(kept, "region")).toMatchObject({ distinct: 1, samples: ["A"] });
  expect(await describeTable({ card_id: "w", section: "profile", scope: "all" })).toMatchObject({ status: "refused", code: "invalid-scope" });
  expect(await describeTable({ card_id: "w", section: "profile", fields: "revenue" })).toMatchObject({ status: "refused", code: "invalid-fields" });
  expect(await describeTable({ card_id: "w", section: "profile", fields: ["revenue", "revenue"] })).toMatchObject({ status: "refused", code: "invalid-fields" });
  expect(profile(await describeTable({ card_id: "w", section: "profile", fields: null }))).toMatchObject({ rows_profiled: 3 });
  expect(await describeTable({ card_id: "w", section: "profile", fields: ["nope"] })).toMatchObject({ status: "refused", code: "unknown-field", alternatives: ["region", "revenue", "cost", "date"] });
  expect(await describeTable({ card_id: "w", section: "profile", fields: ["cat-region"] })).toMatchObject({ code: "unknown-field" });
  expect(await describeTable({ card_id: "w", section: "profile:x" })).toMatchObject({ code: "unknown-section" });
});

it("pages profile fields with a cursor bound to card, revision, scope and fields", async () => {
  await mountCsv();
  const columnProfile = vi.fn(async (_r: unknown, req: { offset: number; limit: number; scope: string }) => ({ scope: req.scope, offset: req.offset, limit: req.limit, total: 2, rowsProfiled: 3, filtersActive: false, filteredRows: 3, fields: [], ...(req.offset < 1 ? { nextOffset: req.offset + 1 } : {}) }));
  stubExecutor({ columnProfile });
  const first = profile(await describeTable({ card_id: "w", section: "profile", fields: ["revenue", "date"] }));
  expect(columnProfile.mock.calls[0][1]).toMatchObject({ scope: "input", offset: 0, limit: 50, fields: ["revenue", "date"] });
  expect(profile(await describeTable({ card_id: "w", section: "profile", fields: ["revenue", "date"], cursor: first.next_cursor })).status).toBe("ok");
  expect(columnProfile.mock.calls[1][1]).toMatchObject({ offset: 1 });
  for (const other of [{ scope: "filtered" }, { fields: ["date"] }, { fields: undefined }])
    expect(await describeTable({ card_id: "w", section: "profile", fields: ["revenue", "date"], ...other, cursor: first.next_cursor })).toMatchObject({ code: "stale-cursor" });
  await commitDrawerModel("rita", "w", { measures: [{ id: "m1", sourceFieldId: "revenue", aggregation: "sum" } as never] });
  stubExecutor({ columnProfile });
  expect(await describeTable({ card_id: "w", section: "profile", fields: ["revenue", "date"], cursor: first.next_cursor })).toMatchObject({ code: "stale-cursor" });
});

it("answers unavailable when the table's engine has no column profile", async () => {
  await mountCsv();
  stubExecutor({ columnProfile: undefined });
  expect(await describeTable({ card_id: "w", section: "profile" })).toMatchObject({ status: "unavailable", reason: "profile-unavailable" });
  stubExecutor({ columnProfile: async () => { throw new ProviderContractError({ code: "UNSUPPORTED_CAPABILITY", message: "Provider does not support columnProfile", capability: "columnProfile" }); } });
  expect(await describeTable({ card_id: "w", section: "profile" })).toMatchObject({ status: "unavailable", reason: "unsupported" });
});
