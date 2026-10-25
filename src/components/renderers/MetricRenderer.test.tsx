// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricRenderer } from "./MetricRenderer";

describe("MetricRenderer", () => {
  it("renders the value alone", () => {
    render(<MetricRenderer data={{ value: 42 }} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders label and delta when the payload supplies them", () => {
    render(<MetricRenderer data={{ label: "Revenue", value: "1.2B", delta: "+3.4%" }} />);
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("1.2B")).toBeInTheDocument();
    expect(screen.getByText("+3.4%")).toBeInTheDocument();
  });

  it("unwraps a single-element array, which is how a metric endpoint often answers", () => {
    render(<MetricRenderer data={[{ label: "Rate", value: 5 }]} />);
    expect(screen.getByText("Rate")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("says so rather than throwing when there is no value", () => {
    render(<MetricRenderer data={{ nope: 1 }} />);
    expect(screen.getByText(/no metric value/i)).toBeInTheDocument();
  });
});
