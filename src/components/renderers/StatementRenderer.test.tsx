// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatementRenderer } from "./StatementRenderer";
import { formatCell } from "../../lib/format";
import type { StatementRows } from "../../lib/statementRows";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";

const statement: StatementRows = {
  statement: "income",
  headers: ["FY2026-Q3", "FY2026-Q2"],
  columns: ["Section", "Line item", "FY2026-Q3", "FY2026-Q2"],
  sections: [
    { name: "Income", items: [{ field: "revenue", label: "Revenue", values: [109417000000, 95359000000] }] },
    {
      name: "Expenses",
      items: [
        { field: "cost_of_revenue", label: "Cost Of Revenue", values: [54647000000, 50492000000] },
        { field: "interest_expense", label: "Interest Expense", format: { formatterFn: "int" }, values: [1234.5, undefined] },
      ],
    },
  ],
  rows: [],
};

describe("StatementRenderer", () => {
  it('renders authoritative cell errors and per-period formats without displaying a false numeric result', () => {
    const presented: StatementRows = { ...statement, headers: ['FY2026', 'FY2025', 'FY2024'], sections: [{ id: 'section/stable', name: 'Results', items: [{
      field: 'margin', label: 'Margin', values: [0.4, 0.4, 40], formats: [{ formatterFn: 'normalizedPercent' }, { formatterFn: 'none' }, undefined],
      errors: [undefined, undefined, { code: 'scope', message: 'Incompatible currency contexts' }],
    }] }] };
    render(<StatementRenderer statement={presented} collapsed={new Set()} onToggle={vi.fn()} />);
    expect(screen.getByRole('cell', { name: formatCell(0.4, 'margin', DEFAULT_SETTINGS.maxDecimalPlaces, undefined, { formatterFn: 'normalizedPercent' }) })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: formatCell(0.4, 'margin', DEFAULT_SETTINGS.maxDecimalPlaces, undefined, { formatterFn: 'none' }) })).toBeInTheDocument();
    expect(screen.getByText('#ERROR')).toHaveAttribute('title', 'Incompatible currency contexts');
    expect(screen.queryByRole('cell', { name: '40' })).not.toBeInTheDocument();
  });

  it('keeps a template section folded across label changes using its stable ID', async () => {
    const onToggle = vi.fn();
    render(<StatementRenderer statement={{ ...statement, sections: [{ ...statement.sections[0], id: 'section/income', name: 'Renamed Income' }] }} collapsed={new Set(['section/income'])} onToggle={onToggle} />);
    expect(screen.queryByRole('cell', { name: 'Revenue' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Renamed Income (1)' }));
    expect(onToggle).toHaveBeenCalledWith('section/income');
  });

  it("draws the label column, the period headers and every item under an open section", () => {
    render(<StatementRenderer statement={statement} collapsed={new Set()} onToggle={vi.fn()} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Line item", "FY2026-Q3", "FY2026-Q2"]);
    expect(screen.getByRole("cell", { name: "Revenue" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Cost Of Revenue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Income" })).toHaveAttribute("aria-expanded", "true");
  });

  it("formats each cell as the table view would, through the item's own format", () => {
    render(<StatementRenderer statement={statement} collapsed={new Set()} onToggle={vi.fn()} />);
    const max = DEFAULT_SETTINGS.maxDecimalPlaces;
    expect(screen.getByRole("cell", { name: formatCell(109417000000, "revenue", max) })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: formatCell(1234.5, "interest_expense", max, undefined, { formatterFn: "int" }) })).toBeInTheDocument();
    // An absent period shows the em dash formatCell gives null.
    expect(screen.getAllByRole("cell", { name: "—" })).toHaveLength(1);
  });

  it("hides a collapsed section's items, shows its count, and reports a toggle", async () => {
    const onToggle = vi.fn();
    render(<StatementRenderer statement={statement} collapsed={new Set(["Expenses"])} onToggle={onToggle} />);
    expect(screen.queryByRole("cell", { name: "Cost Of Revenue" })).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Expenses (2)" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith("Expenses");
  });
});
