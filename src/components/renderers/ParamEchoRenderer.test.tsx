// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widget as makeWidget } from "../../test/fixtures";
import { ParamEchoRenderer } from "./ParamEchoRenderer";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ParamEchoRenderer", () => {
  it("lists every param it is handed as a term and the value the widget would send", () => {
    render(<ParamEchoRenderer params={{ ticker: "MSFT", year: "2024" }} />);
    expect(screen.getByRole("term", { name: "ticker" })).toBeInTheDocument();
    expect(screen.getByRole("definition", { name: "ticker" })).toHaveTextContent("MSFT");
    expect(screen.getByRole("definition", { name: "year" })).toHaveTextContent("2024");
  });

  it("shows why a value could not resolve instead of an empty value", () => {
    render(<ParamEchoRenderer widget={makeWidget({ params: [{ paramName: "d", type: "date" }] })} params={{ d: "T(XNYZ)" }} />);
    expect(screen.getByLabelText("d", { selector: "dd" })).toHaveTextContent("⚠ Unknown calendar XNYZ");
  });

  it("shows a $currentDate token resolved, as the request would", () => {
    render(<ParamEchoRenderer params={{ date: "$currentDate" }} />);
    expect(screen.getByRole("definition", { name: "date" })).toHaveTextContent("2026-09-14");
  });

  it("shows a range expanded into its two keys and a quarter under the resolved year end", () => {
    const widget = makeWidget({
      params: [
        { paramName: "start_date", type: "date_range", rangeEnd: "end_date" },
        { paramName: "quarter", type: "quarter" },
      ],
    });
    render(
      <ParamEchoRenderer
        widget={widget}
        params={{ start_date: "2026-01-01/T", quarter: "T" }}
        fiscalYearEnd={{ quarter: 9 }}
      />,
    );
    expect(screen.getByRole("definition", { name: "start_date" })).toHaveTextContent("2026-01-01");
    expect(screen.getByRole("definition", { name: "end_date" })).toHaveTextContent("2026-09-14");
    expect(screen.getByRole("definition", { name: "quarter" })).toHaveTextContent("2026-Q4");
  });
});
