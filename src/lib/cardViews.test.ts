// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { availableViews } from "./cardViews";
import type { WidgetDef } from "./types";
const def = (type: string) => ({ id: type, backendId: "b", name: type, type, params: [], endpoint: "/x", source: [] }) as unknown as WidgetDef;

it("offers clean's views for a CSV/XLS table: default, Statement, Raw-less, Transposed; never the donor's pivot", () => {
  const views = availableViews(def("local_table"), null, {}).map(v => v.value ?? "table");
  expect(views).toContain("table");
  expect(views).toContain("statement");
  expect(views).toContain("transposed");
  expect(views).not.toContain("pivot");
});
it("offers Chart and Calendar only when the data supports them", () => {
  const rows = [{ date: "2026-01-02", close: 1 }, { date: "2026-01-03", close: 2 }];
  const views = availableViews(def("table"), rows, {}).map(v => v.value);
  expect(views).toEqual(expect.arrayContaining(["chart", "calendar", "raw", "transposed"]));
});
it('offers Statement for explicit managed SSRM, while standard LIVE stays paged',()=>{
 const managed={...def('table_ssrm'),provider:'managed-native' as const,protocolVersion:1};
 expect(availableViews(managed,null,{}).map(v=>v.value)).toContain('statement');
 expect(availableViews(def('table_ssrm'),null,{}).map(v=>v.value)).toEqual([undefined]);
});
