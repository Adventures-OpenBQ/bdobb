// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { BackendConfig } from "../types";
import { artsChartsConnections, isArtsCharts } from "./connection";

const b = (id: string, kind?: "arts-charts"): BackendConfig => ({
  id, name: id, baseUrl: `https://${id}.example.com`, authLocation: "header", validateWidgets: true, ...(kind ? { kind } : {}),
});

describe("Art's Charts connections", () => {
  it("knows the kind", () => {
    expect(isArtsCharts(b("a", "arts-charts"))).toBe(true);
    expect(isArtsCharts(b("a"))).toBe(false);
  });
  it("artsChartsConnections picks the first and reports the rest", () => {
    expect(artsChartsConnections([b("x"), b("a", "arts-charts"), b("c", "arts-charts")])).toEqual({
      active: b("a", "arts-charts"), ignored: [b("c", "arts-charts")],
    });
    expect(artsChartsConnections([b("x")])).toEqual({ active: null, ignored: [] });
  });
});
