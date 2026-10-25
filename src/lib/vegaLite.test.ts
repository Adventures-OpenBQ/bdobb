// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { vegaLiteToPlotly } from "./vegaLite";

const bar = {
  title: "Top chains",
  data: { values: [{ chain: "Ethereum", tvl: 68.4 }, { chain: "Tron", tvl: 29.1 }] },
  mark: { type: "bar", color: "#60a5fa" },
  encoding: { x: { field: "chain", title: "Chain" }, y: { field: "tvl", title: "TVL" } },
};

describe("vegaLiteToPlotly", () => {
  it("maps a bar spec to a single bar trace with x/y arrays", () => {
    const fig = vegaLiteToPlotly(bar, "dark");
    expect(fig).not.toBeNull();
    expect(fig!.data).toHaveLength(1);
    const t = fig!.data[0] as Record<string, unknown>;
    expect(t.type).toBe("bar");
    expect(t.x).toEqual(["Ethereum", "Tron"]);
    expect(t.y).toEqual([68.4, 29.1]);
  });

  it("carries title and axis titles, and applies the app theme", () => {
    const fig = vegaLiteToPlotly(bar, "dark")!;
    expect((fig.layout.title as Record<string, unknown>)?.text ?? fig.layout.title).toBe("Top chains");
    expect((fig.layout.xaxis as Record<string, unknown>).title).toBe("Chain");
    expect((fig.layout.yaxis as Record<string, unknown>).title).toBe("TVL");
    expect(fig.layout.paper_bgcolor).toBe("#1e242e"); // dark card bg
  });

  it("maps a line mark to a scatter trace in lines mode", () => {
    const spec = { data: { values: [{ d: "2024-01-01", p: 1 }, { d: "2024-01-02", p: 2 }] },
      mark: { type: "line" }, encoding: { x: { field: "d" }, y: { field: "p" } } };
    const t = vegaLiteToPlotly(spec, "dark")!.data[0] as Record<string, unknown>;
    expect(t.type).toBe("scatter");
    expect(t.mode).toBe("lines");
  });

  it("splits by encoding.color into one markers trace per group", () => {
    const spec = {
      data: { values: [
        { x: 1, y: 1, group: "A" }, { x: 2, y: 4, group: "B" }, { x: 3, y: 9, group: "A" },
      ] },
      mark: { type: "circle" },
      encoding: { x: { field: "x" }, y: { field: "y" }, color: { field: "group" } },
    };
    const fig = vegaLiteToPlotly(spec, "dark")!;
    expect(fig.data).toHaveLength(2);
    const a = fig.data.find((t) => (t as Record<string, unknown>).name === "A") as Record<string, unknown>;
    expect(a.mode).toBe("markers");
    expect(a.x).toEqual([1, 3]);
    expect(a.y).toEqual([1, 9]);
  });

  it("returns null for specs it cannot map", () => {
    expect(vegaLiteToPlotly(null, "dark")).toBeNull();
    expect(vegaLiteToPlotly({ mark: { type: "bar" } }, "dark")).toBeNull(); // no data
    expect(vegaLiteToPlotly({ data: { values: [] }, mark: { type: "bar" } }, "dark")).toBeNull(); // no encoding
    expect(vegaLiteToPlotly({ ...bar, mark: { type: "geoshape" } }, "dark")).toBeNull(); // unknown mark
  });

  // data.values comes off the wire: a null or number entry must not throw
  // (that would take the card to its error boundary instead of the raw view),
  // and a field is read only as the row's own key, never off its prototype.
  it("skips non-object values and reads fields as own keys only", () => {
    const spec = { ...bar, data: { values: [null, 3, { chain: "Tron", tvl: 29.1 }, {}] } };
    expect(vegaLiteToPlotly(spec, "dark")?.data[0]).toMatchObject({ x: ["Tron", undefined], y: [29.1, undefined] });
    const proto = { ...bar, encoding: { x: { field: "constructor" }, y: { field: "tvl" } } };
    expect((vegaLiteToPlotly(proto, "dark")?.data[0] as { x: unknown[] }).x).toEqual([undefined, undefined]);
    expect(vegaLiteToPlotly({ ...bar, data: { values: [null, 1] } }, "dark")).toBeNull();
  });
});
