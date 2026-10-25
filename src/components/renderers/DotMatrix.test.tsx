// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { glyph } from "../../lib/dotFont";
import { DotMatrix } from "./DotMatrix";

const cells = (s: string) => [...s].reduce((n, ch) => n + glyph(ch).flat().length, 0);
const lit = (s: string) => [...s].reduce((n, ch) => n + glyph(ch).flat().filter(Boolean).length, 0);

describe("DotMatrix", () => {
  it("draws every cell for the dots face, dimming the off cells", () => {
    const { container } = render(<DotMatrix text="1:2" face="dots" />);
    expect(container.querySelectorAll("circle")).toHaveLength(cells("1:2"));
    expect(container.querySelectorAll("circle.dot--off")).toHaveLength(cells("1:2") - lit("1:2"));
  });

  it("draws only the lit cells for the solid face", () => {
    const { container } = render(<DotMatrix text="1:2" face="solid" />);
    expect(container.querySelectorAll("circle")).toHaveLength(lit("1:2"));
    expect(container.querySelectorAll("circle.dot--off")).toHaveLength(0);
  });

  it("exposes the text to assistive tech", () => {
    const { container } = render(<DotMatrix text="17:30" face="dots" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "17:30");
  });
});
