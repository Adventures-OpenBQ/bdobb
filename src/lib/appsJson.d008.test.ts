// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";

import { importApps } from "./appsJson";
import { effectiveParams } from "./paramGroups";
import { widget } from "../test/fixtures";

// D-008: the groups and the Search Series card exactly as OPENBQ_API serves
// "U.S. Bureau of Labor Statistics" (regression run 2). Group 3's default is
// an array, the shape openbb-api emits for an endpoint param.
const series = widget({
  id: "bls_series_bls_obb",
  params: [
    { paramName: "symbol", type: "endpoint" },
    { paramName: "category", type: "text", value: "cpi" },
  ],
});
const app = {
  name: "U.S. Bureau of Labor Statistics",
  tabs: {
    "search-series": {
      name: "Search Series",
      layout: [{
        i: "bls_series_bls_obb", x: 0, y: 2, w: 40, h: 20,
        groups: ["BLS Survey Category", "Group 3"],
        state: { params: { category: "nfp", symbol: ["CES0500000023"] } },
      }],
    },
  },
  groups: [
    { name: "BLS Survey Category", type: "param", paramName: "category", defaultValue: "nfp" },
    { name: "BLS Symbol", type: "endpointParam", paramName: "symbol", defaultValue: "CES0500000023" },
    { name: "Group 3", type: "endpointParam", paramName: "symbol", defaultValue: ["CES0500000023"] },
  ],
};

it("D-008: an array group default imports as its joined value, and the member requests it", () => {
  const d = importApps([structuredClone(app)], [series]).dashboards[0];
  expect(d.groups?.find((g) => g.name === "Group 3")?.value).toBe("CES0500000023");
  const card = d.tabs[0].cards[0];
  expect(effectiveParams(card, d.groups, series, d.groupsDisabled).symbol).toBe("CES0500000023");
});

it("D-008: still drops the unjoined BLS Symbol group", () => {
  const d = importApps([structuredClone(app)], [series]).dashboards[0];
  expect(d.groups?.map((g) => g.name)).toEqual(["BLS Survey Category", "Group 3"]);
});

it("D-008: a default paramString cannot render still imports as empty, without throwing", () => {
  for (const defaultValue of [[], {}, [{ a: 1 }]]) {
    const odd = structuredClone(app);
    odd.groups[2] = { ...odd.groups[2], defaultValue: defaultValue as never };
    const d = importApps([odd], [series]).dashboards[0];
    expect(d.groups?.find((g) => g.name === "Group 3")?.value).toBe("");
  }
});
