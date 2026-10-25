// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParamEchoRenderer } from "./ParamEchoRenderer";

describe("ParamEchoRenderer", () => {
  it("lists every param it is handed as a term and the value the widget would send", () => {
    render(<ParamEchoRenderer params={{ ticker: "MSFT", year: "2024" }} />);
    expect(screen.getByRole("term", { name: "ticker" })).toBeInTheDocument();
    expect(screen.getByRole("definition", { name: "ticker" })).toHaveTextContent("MSFT");
    expect(screen.getByRole("definition", { name: "year" })).toHaveTextContent("2024");
  });

  it("shows a $currentDate token resolved, as the request would", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
    try {
      render(<ParamEchoRenderer params={{ date: "$currentDate" }} />);
      expect(screen.getByRole("definition", { name: "date" })).toHaveTextContent("2026-09-14");
    } finally {
      vi.useRealTimers();
    }
  });
});
