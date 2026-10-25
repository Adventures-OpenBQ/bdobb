// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalogFace } from "./AnalogFace";

function face(hour: number, minute: number) {
  const { container } = render(<AnalogFace hour={hour} minute={minute} />);
  return container.querySelector("svg")!;
}

describe("AnalogFace", () => {
  it("points the hands correctly at 3:00", () => {
    const svg = face(3, 0);
    expect(svg.querySelector('[data-hand="hour"]')).toHaveAttribute(
      "transform",
      "rotate(90 50 50)",
    );
    expect(svg.querySelector('[data-hand="minute"]')).toHaveAttribute(
      "transform",
      "rotate(0 50 50)",
    );
  });

  it("advances the hour hand proportionally at 12:30", () => {
    const svg = face(12, 30);
    // (12 % 12 + 30/60) * 30 = 15
    expect(svg.querySelector('[data-hand="hour"]')).toHaveAttribute(
      "transform",
      "rotate(15 50 50)",
    );
    expect(svg.querySelector('[data-hand="minute"]')).toHaveAttribute(
      "transform",
      "rotate(180 50 50)",
    );
  });

  it("is inherently 12-hour, so 15:00 reads the same as 3:00", () => {
    expect(face(15, 0).querySelector('[data-hand="hour"]')?.getAttribute("transform")).toBe(
      face(3, 0).querySelector('[data-hand="hour"]')?.getAttribute("transform"),
    );
  });

  it("has no second hand", () => {
    const svg = face(10, 10);
    expect(svg.querySelector('[data-hand="second"]')).toBeNull();
    expect(svg.querySelectorAll("[data-hand]")).toHaveLength(2);
  });

  it("draws twelve batons and no numerals", () => {
    const svg = face(10, 10);
    expect(svg.querySelectorAll('[data-baton]')).toHaveLength(12);
    expect(svg.querySelector("text")).toBeNull();
  });

  it("is hidden from assistive technology, which reads the tile label instead", () => {
    expect(face(10, 10)).toHaveAttribute("aria-hidden", "true");
  });
});
