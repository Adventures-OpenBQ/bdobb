// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { clientTableResult, localTableCall } from "./tableResultSummary";

const call = { tool: "arrange_table" as const, cardId: "w" };
const preview = { columns: [{ id: "region", label: "Region" }, { id: "amount", label: "Amount" }], rows: [{ values: { region: "East", amount: 360 } }, { values: { region: "North", amount: 210 } }, { values: { region: "West", amount: 615 } }] };
const applied = { status: "applied", card_id: "w", preview, warnings: [], undo: "available" };
it("renders engine rows without calculating an absent grand total", () => {
  const result = clientTableResult(call, applied);
  expect(result).toMatchObject({ kind: "result", cardId: "w", ending: "Undo is available." });
  expect(result && "text" in result && result.text).toContain("| East | 360 |");
  expect(JSON.stringify(result)).not.toContain("1185");
});
it("labels a read-only preview without promising Undo", () => {
  const result = clientTableResult(call, { ...applied, status: "previewed", committed: false, undo: undefined });
  expect(result).toMatchObject({ ending: "Nothing was changed." });
  expect(JSON.stringify(result)).not.toContain("Undo is available");
});
it("carries only an exact source count from a matching inspection", () => {
  const inspection = { status: "ok", card: { id: "w" }, completeness: { totalRowCount: 12, totalRowCountKind: "exact" } };
  expect(clientTableResult({ tool: "describe_table", cardId: "w" }, inspection)).toMatchObject({ sourceRows: 12 });
  expect(clientTableResult({ tool: "describe_table", cardId: "w" }, { ...inspection, completeness: { totalRowCount: 12, totalRowCountKind: "estimate" } })).not.toHaveProperty("sourceRows");
  expect(clientTableResult({ tool: "describe_table", cardId: "other" }, inspection)).toBeUndefined();
});
it("escapes untrusted Markdown in labels, cells and warnings", () => {
  const result = clientTableResult(call, { ...applied, preview: { columns: [{ id: "v", label: "[label](evil)" }], rows: [{ values: { v: "<img>|**bold**\nnext" } }] }, warnings: [{ code: "hint", message: "[click](evil)" }] });
  const text = result && "text" in result ? result.text : "";
  expect(text).not.toContain("<img>");
  expect(text).not.toContain("[click](evil)");
  expect(text).toContain("\\|");
});
it("renders the actual provider warning and pending recalculation", () => {
  const result = clientTableResult(call, { ...applied, recalculating: true, warnings: [{ code: "provider-aggregation-hint", message: "Units: sum chosen, provider suggests last" }] });
  expect(result && "text" in result && result.text).toContain("provider-aggregation-hint");
  expect(result && "text" in result && result.text).toContain("recalculation is pending");
});
it("keeps refusals and unchanged results distinct from applied results", () => {
  expect(clientTableResult(call, { status: "refused", code: "validation-failed", message: "Cannot sum a text column" })).toMatchObject({ text: expect.stringContaining("refused"), ending: "Nothing was changed by this call." });
  expect(clientTableResult(call, { status: "unchanged", card_id: "w" })).toMatchObject({ text: "No table change was needed.", ending: "" });
});
it("bounds very large previews without inventing counts", () => {
  const rows = Array.from({ length: 1000 }, () => ({ values: { region: "x".repeat(500), amount: 360 } }));
  const result = clientTableResult(call, { ...applied, preview: { ...preview, rows } });
  expect(JSON.stringify(result).length).toBeLessThan(12_500);
  expect(result && "text" in result && result.text).toContain("omitted");
});
it("recognises only the reserved local table call, never remote MCP", () => {
  const payload = { function: "execute_agent_tool", input_arguments: { server_id: "bdobb-local", tool_name: "arrange_table", parameters: { card_id: "w" } } };
  expect(localTableCall(payload)).toEqual(call);
  expect(localTableCall({ ...payload, input_arguments: { ...payload.input_arguments, server_id: "remote" } })).toBeNull();
  expect(localTableCall({ ...payload, function: "get_widget_data" })).toBeNull();
});

it("keeps provider override warnings visible among many diagnostics", () => {
  const warnings = [...Array.from({ length: 12 }, () => ({ code: "diagnostic", message: "Other warning" })), { code: "provider-aggregation-hint", message: "Units: explicit sum overrides last" }];
  const result = clientTableResult(call, { ...applied, warnings });
  expect(result && "text" in result && result.text).toContain("provider-aggregation-hint");
  expect(result && "text" in result && result.text).toContain("Additional engine warnings omitted");
});
it("shows validation reasons on a refused call and marks clipped strings", () => {
  const refused = clientTableResult(call, { status: "refused", message: "Invalid arrangement", errors: [{ message: "Region is text and cannot be summed" }] });
  expect(refused && "text" in refused && refused.text).toContain("Region is text and cannot be summed");
  const result = clientTableResult(call, { ...applied, preview: { ...preview, rows: [{ values: { region: "x".repeat(200), amount: 360 } }] } });
  expect(result && "text" in result && result.text).toContain("…");
});


it("carries trusted inspection refusals and unavailable reasons for mixed table workflows", () => {
  const inspection = { tool: "describe_table" as const, cardId: "w" };
  expect(clientTableResult(inspection, { status: "refused", message: "The cursor is stale" })).toMatchObject({ kind: "result", text: expect.stringContaining("The cursor is stale") });
  expect(clientTableResult(inspection, { status: "unavailable", reason: "runtime-not-ready", message: "Open the table tab" })).toMatchObject({ kind: "result", text: expect.stringContaining("Open the table tab") });
});
