// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { parseArrangement, type Arrangement } from "./contract";
import { buildCandidate } from "./candidate";
import type { DatasetColumn } from "../../widgetData/types";
import raw from "../../../skills/arrange-table/SKILL.md?raw";

const blocks = () => [...raw.matchAll(/```json\n([\s\S]*?)```/g)].map(m => JSON.parse(m[1]));

it("seeds the table-model/1 arrange-table skill", () => {
  for (const must of ["describe_table", "arrange_table", "table-model/1", "expected_revision", "unweighted", "aggregate ratio", "fiscal", "checklist.set", "result_filter.add", "Undo", "server-execution-pending", "Ask one question",
    "measure.add", "layout.set", "runtime-not-ready", "recalculating", "viewer.set", "stale-revision", "busy", "timeout", "statement.update_template", "untrusted",
    // roles a 35B model confused live, and the Task 15 wording minors
    "category.add", "transform", "alias", "never a field id", "preview.rows", "unavailable", "<every company key to keep>", "already has a Volume measure", "grand total", "row count",
    // D-012: read-only asks preview and never commit
    "## 0. Read-only asks never commit", "\"mode\": \"preview\"", "committed: false", "Nothing was changed.", "completeness.totalRowCount", "rows_profiled"]) expect(raw).toContain(must);
  expect(raw).not.toMatch(/aggregationFns|buckets|split:/);
});

it("every json example in the skill passes parseArrangement", () => {
  const all = blocks();
  expect(all).toHaveLength(4);
  for (const b of all) expect(parseArrangement(b).errors).toEqual([]);
});

it("the first (worked) example builds a valid candidate on a table with the fields it names", () => {
  const columns = [{ id: "Sector", label: "Sector", dtype: "text" }, { id: "Volume", label: "Volume", dtype: "number" }] as DatasetColumn[];
  const r = buildCandidate({ table: {}, search: "" }, columns, blocks()[0] as Arrangement);
  expect(r.errors).toEqual([]);
});
