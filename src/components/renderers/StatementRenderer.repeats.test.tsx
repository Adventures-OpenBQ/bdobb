// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { statementFixture } from "../../lib/statementModel/fixtures/load";
import { statementRows } from "../../lib/statementRows";
import { StatementRenderer } from "./StatementRenderer";

afterEach(cleanup);
const apple = () => statementRows(statementFixture("libre/aapl-yfinance-income-annual").rows)!;
const show = (statement = apple()) => render(<StatementRenderer statement={statement} collapsed={new Set()} onToggle={() => undefined} />);

describe("StatementRenderer over Libre Terminal's rows", () => {
  it("shows every line until asked, then hides the ones that repeat another's figures", () => {
    show();
    expect(screen.getByText("Interest Income Non Operating")).toBeVisible();
    const hide = screen.getByRole("button", { name: /^Hide \d+ repeated lines?$/ });
    expect(hide).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(hide);
    expect(screen.queryByText("Interest Income Non Operating")).toBeNull();
    expect(screen.getByText("Interest Income")).toBeVisible();
    // A total equal to another line is still the total.
    expect(screen.getByText("Total Revenue")).toBeVisible();
    expect(screen.getByText("Operating Revenue")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Show \d+ repeated lines?$/ }));
    expect(screen.getByText("Interest Income Non Operating")).toBeVisible();
  });

  it("draws totals and subtotals in bold and other lines plain", () => {
    show();
    expect(screen.getByText("Total Revenue").tagName).toBe("STRONG");
    expect(screen.getByText("Gross Profit").tagName).toBe("STRONG");
    expect(screen.getByText("Cost Of Revenue").tagName).toBe("TD");
  });

  it("offers nothing to hide when no line repeats another", () => {
    show(statementRows([{ period_ending: "2026-12-31", revenue: 10, net_income: 2 }])!);
    expect(screen.queryByRole("button", { name: /repeated/ })).toBeNull();
  });
});
