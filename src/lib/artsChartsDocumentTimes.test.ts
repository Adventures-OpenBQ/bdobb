// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { configureArtsCharts } from "../../vendor/arts-charts/src/host";
import { bodyFromCard, cardFromBody, type ChartBody } from "../../vendor/arts-charts/src/lib/chartDocument";
import { buildHost } from "./artsChartsHost";

const lookup = () => undefined;

describe("chart documents in BDOBB (spec 2026-11-04 S14)", () => {
  it("shows and edits the stored expression, not its instant", () => {
    configureArtsCharts(buildHost({ viewer: false }));
    const body: ChartBody = { schema: "chart/1", symbol: "AAPL", interval: "1d",
      range: { from: { expr: "now-1mo", at: "2026-05-03T00:00:00Z" }, to: { expr: "now", at: "2026-06-03T20:00:00Z" } },
      anchors: [{ expr: "T-1bd@open", at: "2026-06-02T13:30:00Z" }] };
    const { state, notes } = cardFromBody(body, lookup);
    expect(state.range).toEqual({ from: "now-1mo", to: "now" });
    expect(state.anchors).toEqual(["T-1bd@open"]);
    expect(notes).toEqual([]);
  });
  it("keeps a legacy expression-only entry, and the next save stamps it", () => {
    configureArtsCharts(buildHost({ viewer: false }));
    const legacy: ChartBody = { schema: "chart/1", symbol: "AAPL", interval: "1d", anchors: ["T-1bd@open"] };
    const { state, notes } = cardFromBody(legacy, lookup);
    expect(state.anchors).toEqual(["T-1bd@open"]);
    expect(notes).toEqual([]);
    const saved = bodyFromCard({ symbol: "AAPL" }, { ...state, interval: "1d" }, lookup,
      { at: (e) => (e === "T-1bd@open" ? "2026-06-02T13:30:00Z" : null), range: () => null });
    expect(saved.anchors).toEqual([{ expr: "T-1bd@open", at: "2026-06-02T13:30:00Z" }]);
  });
});
