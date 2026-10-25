// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockRenderer } from "./ClockRenderer";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T17:30:00Z"));
});
afterEach(() => vi.useRealTimers());

/**
 * The digital time is a dot-matrix SVG (DotMatrix); it carries the time string
 * as its aria-label rather than as text, so assert on the label.
 */
function times(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".clock-row-time")).map(
    (n) => n.getAttribute("aria-label") ?? "",
  );
}

describe("ClockRenderer", () => {
  it("renders one digital row per zone by default", () => {
    const { container } = render(<ClockRenderer params={{ zones: "Europe/London,Asia/Tokyo" }} />);
    expect(screen.getByText("London")).toBeInTheDocument();
    expect(screen.getByText("Tokyo")).toBeInTheDocument();
    expect(times(container)).toContain("17:30");
  });

  it("uses the default zone list when none is given", () => {
    render(<ClockRenderer params={{}} />);
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("Sydney")).toBeInTheDocument();
  });

  it("lists an unknown zone in a notice and still renders the good ones", () => {
    render(<ClockRenderer params={{ zones: "Europe/Lundon,Asia/Tokyo" }} />);
    expect(screen.getByText(/Unknown time zone: Europe\/Lundon/)).toBeInTheDocument();
    expect(screen.getByText("Tokyo")).toBeInTheDocument();
  });

  it("renders analog tiles under the horizontal layout", () => {
    const { container } = render(
      <ClockRenderer params={{ zones: "Europe/London", layout: "horizontal" }} />,
    );
    expect(container.querySelector(".clock-gallery")).not.toBeNull();
    expect(container.querySelector(".analog-face")).not.toBeNull();
  });

  it("gives each tile a spoken label carrying city, time, region and offset", () => {
    render(<ClockRenderer params={{ zones: "America/New_York", layout: "horizontal" }} />);
    // The tile carries role="img" so its aria-label becomes its accessible
    // name (a bare div has role generic, on which ARIA prohibits a name —
    // every browser ignores aria-label there). Asserted via
    // toHaveAccessibleName rather than the raw attribute so this test fails
    // again if the role is ever dropped.
    const tile = screen.getByRole("img", { name: "New York, 12:30, US/Eastern, GMT-5" });
    expect(tile).toHaveAccessibleName("New York, 12:30, US/Eastern, GMT-5");
  });

  it("appends a bare A or P under the 12-hour cycle", () => {
    const { container } = render(<ClockRenderer params={{ zones: "Europe/London", hourCycle: "12" }} />);
    expect(times(container)).toContain("05:30");
    expect(screen.getByText("P")).toBeInTheDocument();
    expect(screen.queryByText("PM")).not.toBeInTheDocument();
  });

  it("reads the legacy single-zone param when `zones` is absent", () => {
    render(<ClockRenderer params={{ timezone: "Asia/Tokyo" }} />);
    expect(screen.getByText("Tokyo")).toBeInTheDocument();
    expect(screen.queryByText("New York")).not.toBeInTheDocument();
  });

  it("reads the legacy hour12 param when `hourCycle` is absent", () => {
    const { container } = render(<ClockRenderer params={{ zones: "Europe/London", hour12: "true" }} />);
    expect(times(container)).toContain("05:30");
  });

  it("prefers the modern param when both are present", () => {
    render(<ClockRenderer params={{ zones: "Asia/Tokyo", timezone: "Europe/London" }} />);
    expect(screen.getByText("Tokyo")).toBeInTheDocument();
    expect(screen.queryByText("London")).not.toBeInTheDocument();
  });

  it("applies the dot-matrix face by default and the solid one on request", () => {
    const { container: dots } = render(<ClockRenderer params={{ zones: "Europe/London" }} />);
    expect(dots.querySelector(".clock-list")).toHaveAttribute("data-face", "dots");
    const { container: solid } = render(
      <ClockRenderer params={{ zones: "Europe/London", face: "solid" }} />,
    );
    expect(solid.querySelector(".clock-list")).toHaveAttribute("data-face", "solid");
  });

  it("treats an empty zones string as absent and uses the default list", () => {
    render(<ClockRenderer params={{ zones: "" }} />);
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("Sydney")).toBeInTheDocument();
  });

  it("treats whitespace-only zones as absent and uses the default list", () => {
    render(<ClockRenderer params={{ zones: "   " }} />);
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("Sydney")).toBeInTheDocument();
  });

  it("treats an empty zones string as absent and falls back to timezone", () => {
    render(<ClockRenderer params={{ zones: "", timezone: "Europe/London" }} />);
    expect(screen.getByText("London")).toBeInTheDocument();
    expect(screen.queryByText("New York")).not.toBeInTheDocument();
  });

  it("treats an empty timezone string as absent and uses the default list", () => {
    render(<ClockRenderer params={{ timezone: "" }} />);
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("Sydney")).toBeInTheDocument();
  });

  it("treats whitespace-only timezone as absent and uses the default list", () => {
    render(<ClockRenderer params={{ timezone: "   " }} />);
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("Sydney")).toBeInTheDocument();
  });
});

describe("the vertical row's ordering", () => {
  it("places region and offset between the city and the time", () => {
    const { container } = render(<ClockRenderer params={{ zones: "America/New_York" }} />);
    const row = container.querySelector(".clock-row")!;
    const order = Array.from(row.children).map((n) => n.getAttribute("class"));
    expect(order).toEqual([
      "clock-row-city",
      "clock-row-where",
      "clock-row-time",
    ]);
  });

  it("renders the time as a dot-matrix svg carrying the time as its label", () => {
    const { container } = render(<ClockRenderer params={{ zones: "Europe/London" }} />);
    const time = container.querySelector(".clock-row-time");
    expect(time?.tagName.toLowerCase()).toBe("svg");
    expect(time).toHaveAttribute("aria-label", "17:30");
    expect(time!.querySelectorAll("circle").length).toBeGreaterThan(0);
  });
});
