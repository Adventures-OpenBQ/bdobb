// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RailIcon, type RailIconName } from "./RailIcon";

/** Every name, in the order the rail renders them. */
const NAMES: RailIconName[] = ["add", "library", "connections", "settings", "help"];

/** The single <svg> a name renders. */
function icon(name: RailIconName): SVGSVGElement {
  const { container } = render(<RailIcon name={name} />);
  const svgs = container.querySelectorAll("svg");
  expect(svgs).toHaveLength(1);
  return svgs[0] as SVGSVGElement;
}

describe("RailIcon", () => {
  it.each(NAMES)("renders %s as one decorative 20x20 svg.rail-icon", (name) => {
    const svg = icon(name);
    expect(svg).toHaveClass("rail-icon");
    // Decorative: the row's own text (or aria-label) is the accessible name,
    // and a focusable svg would add a stop to the tab order in IE-era
    // engines and in WKWebView.
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
    // Something is actually drawn -- an empty svg would pass every check
    // above. `rect` as well as `path`, because library and apps are built
    // from rounded rects rather than hand-written path data.
    expect(svg.querySelectorAll("path, rect").length).toBeGreaterThan(0);
  });

  it("keeps each supplied glyph on its own viewBox", () => {
    expect(icon("connections")).toHaveAttribute("viewBox", "0 0 100 100");
    for (const name of ["add", "library", "settings", "help"] as RailIconName[]) {
      expect(icon(name)).toHaveAttribute("viewBox", "0 0 24 24");
    }
  });

  it("keeps the connections path on fill-rule evenodd, which is what leaves each node a ring", () => {
    expect(icon("connections").querySelector("path")).toHaveAttribute("fill-rule", "evenodd");
  });
});
