// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { highchartsToPlotly } from "./highcharts";

const chains = {
  userOptions: {
    chart: { type: "column", backgroundColor: "transparent" },
    title: { text: "Top chains by TVL" },
    xAxis: { categories: ["Ethereum", "Solana", "Base"] },
    yAxis: { title: { text: "TVL" } },
    series: [{ type: "column", name: "Chain", data: [{ y: 53.66 }, { y: 6.63 }, { y: 6.26 }] }],
  },
};

describe("highchartsToPlotly", () => {
  it("maps a column series against xAxis categories to a bar trace", () => {
    const fig = highchartsToPlotly(chains, "dark")!;
    expect(fig.data).toHaveLength(1);
    const t = fig.data[0] as Record<string, unknown>;
    expect(t.type).toBe("bar");
    expect(t.x).toEqual(["Ethereum", "Solana", "Base"]);
    expect(t.y).toEqual([53.66, 6.63, 6.26]);
    expect(t.name).toBe("Chain");
  });

  it("carries the title and y-axis title and applies the app theme", () => {
    const fig = highchartsToPlotly(chains, "dark")!;
    expect((fig.layout.title as Record<string, unknown>).text).toBe("Top chains by TVL");
    expect((fig.layout.yaxis as Record<string, unknown>).title).toBe("TVL");
    expect(fig.layout.paper_bgcolor).toBe("#1e242e");
  });

  it("maps a line series of bare numbers and multiple series (with a legend)", () => {
    const spec = { userOptions: { chart: { type: "line" }, series: [
      { name: "A", data: [1, 2, 3] },
      { name: "B", data: [3, 2, 1] },
    ] } };
    const fig = highchartsToPlotly(spec, "dark")!;
    expect(fig.data).toHaveLength(2);
    const a = fig.data[0] as Record<string, unknown>;
    expect(a.type).toBe("scatter");
    expect(a.mode).toBe("lines");
    expect(a.y).toEqual([1, 2, 3]);
    expect(fig.layout.showlegend).toBe(true);
  });

  it("accepts an unwrapped options object (no userOptions envelope)", () => {
    const spec = { chart: { type: "column" }, series: [{ data: [{ y: 5 }] }] };
    expect(highchartsToPlotly(spec, "dark")!.data).toHaveLength(1);
  });

  it("returns null when it cannot map the payload", () => {
    expect(highchartsToPlotly(null, "dark")).toBeNull();
    expect(highchartsToPlotly({ userOptions: { chart: { type: "column" } } }, "dark")).toBeNull(); // no series
    expect(highchartsToPlotly({ userOptions: { chart: { type: "pie" }, series: [{ data: [1] }] } }, "dark")).toBeNull(); // unknown type
  });
});
