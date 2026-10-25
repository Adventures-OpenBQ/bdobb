// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SparklineConfig } from "../../lib/sparkline";
import { SparklineCell } from "./SparklineCell";

const line: SparklineConfig = { type: "line", stroke: "#22c55e", tooltip: true };

describe("SparklineCell", () => {
  it("draws a stroked line path for a line sparkline", () => {
    const { container } = render(<SparklineCell values={[1, 2, 3]} config={line} />);
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("stroke")).toBe("#22c55e");
    expect(path?.getAttribute("d")).toMatch(/^M/);
  });

  it("draws one rect per value for a bar sparkline", () => {
    const { container } = render(<SparklineCell values={[1, 2, 3, 4]} config={{ type: "bar", tooltip: true }} />);
    expect(container.querySelectorAll("rect")).toHaveLength(4);
  });

  it("draws a filled area path for an area sparkline", () => {
    const { container } = render(
      <SparklineCell values={[1, 2, 3]} config={{ type: "area", fill: "rgba(0,0,0,0.1)", tooltip: true }} />,
    );
    const area = container.querySelector('path[fill="rgba(0,0,0,0.1)"]');
    expect(area).not.toBeNull();
    expect(area?.getAttribute("d")).toMatch(/Z$/); // closed
  });

  it("draws a marker per point only when markers are enabled", () => {
    const on = render(
      <SparklineCell values={[1, 2, 3]} config={{ type: "line", tooltip: true, markers: { enabled: true } }} />,
    );
    expect(on.container.querySelectorAll("circle").length).toBeGreaterThanOrEqual(3);
    const off = render(<SparklineCell values={[1, 2, 3]} config={line} />);
    expect(off.container.querySelectorAll("circle")).toHaveLength(0);
  });

  it("colors the min and max points of interest", () => {
    const { container } = render(
      <SparklineCell
        values={[5, 1, 9]}
        config={{ type: "line", tooltip: true, poi: { maximum: { fill: "#ffd700" }, minimum: { fill: "#ef4444" } } }}
      />,
    );
    expect(container.querySelector('circle[fill="#ffd700"]')).not.toBeNull();
    expect(container.querySelector('circle[fill="#ef4444"]')).not.toBeNull();
  });

  it("shows the nearest point's value on mouse move and hides it on leave", () => {
    const { container } = render(<SparklineCell values={[10, 20, 30]} config={line} />);
    const svg = container.querySelector("svg")!;
    // jsdom has no layout; give the svg a real box so x maps to a point.
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0, width: 96, top: 0, height: 24, right: 96, bottom: 24, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.mouseMove(svg, { clientX: 95, clientY: 5 });
    expect(document.body.textContent).toContain("30"); // rightmost point
    fireEvent.mouseLeave(svg);
    expect(document.body.textContent).not.toContain("30");
  });

  it("never shows a tooltip when tooltip is disabled", () => {
    const { container } = render(<SparklineCell values={[10, 20, 30]} config={{ type: "line", tooltip: false }} />);
    const svg = container.querySelector("svg")!;
    fireEvent.mouseMove(svg, { clientX: 50, clientY: 5 });
    expect(document.querySelector(".sparkline-tooltip")).toBeNull();
  });
});
