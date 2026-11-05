// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { configureArtsCharts } from "../../vendor/arts-charts/src/host";
import { bodyFromCard, cardFromBody, type ChartBody, type Stamp } from "../../vendor/arts-charts/src/lib/chartDocument";
import { resolveInstant, resolveRange } from "../../vendor/arts-charts/src/lib/chart/rangeExpr";
import { bundledCalendar } from "../../vendor/arts-charts/src/lib/tradingCalendar";
import * as grammar from "./dateExpressions";
import { buildHost } from "./artsChartsHost";

const lookup = () => undefined;
const NOW = new Date("2026-06-03T20:00:00Z");
const CAL = bundledCalendar("XNYS")!;
const iso = (s: number) => new Date(s * 1000).toISOString().replace(".000Z", "Z");
// The card's own stamp (ArtsChartsRenderer): vendored resolveInstant/resolveRange, which resolve through the host's dates.
// The card's exchange calendar is the bundled NYSE one, as on a US-equity card.
const stamp: Stamp = {
  at: (e) => { const s = resolveInstant(e, NOW, CAL); return s === null ? null : iso(s); },
  range: (r) => { const w = resolveRange(r, NOW, CAL); return w && { from: iso(w.from), to: iso(w.to) }; },
};

afterEach(() => configureArtsCharts(undefined as never));

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
  it("stamps through bdobb's grammar: the instant is what resolveExpression gives", () => {
    configureArtsCharts(buildHost({ viewer: false }));
    const legacy: ChartBody = { schema: "chart/1", symbol: "AAPL", interval: "1d",
      range: { from: "now-1mo", to: "now" }, anchors: ["T-1bd@open"] };
    const { state } = cardFromBody(legacy, lookup);
    const saved = bodyFromCard({ symbol: "AAPL" }, { ...state, interval: "1d" }, lookup, stamp);
    const at = (e: string) => iso(Math.floor(grammar.resolveExpression(e, NOW, CAL.timezone, { calendar: CAL })!.toDate().getTime() / 1000));
    expect(saved.range).toEqual({
      from: { expr: "now-1mo", at: at("now-1mo") },
      to: { expr: "now", at: "2026-06-03T20:00:00Z" },
    });
    // An exchange-calendar anchor: the instant is bdobb's resolution of it, expression kept.
    expect(saved.anchors).toEqual([{ expr: "T-1bd@open", at: at("T-1bd@open") }]);
    expect(at("T-1bd@open")).toBe("2026-06-02T13:30:00Z");
  });
});
