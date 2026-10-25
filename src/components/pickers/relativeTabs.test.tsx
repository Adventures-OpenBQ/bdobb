// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { parseExpression, serializeExpression } from "../../lib/dateExpressions";
import type { Preview } from "../../lib/dateExpressions";
import { DatetimePicker } from "./DatetimePicker";
import { DayPicker } from "./DayPicker";
import { FiscalYearPicker } from "./FiscalYearPicker";
import { QuarterPicker } from "./QuarterPicker";
import { RangePicker } from "./RangePicker";
import type { RelativeContext } from "./RelativeTab";
import { WeekPicker } from "./WeekPicker";

const context = (): RelativeContext => ({
  preview: (expr: string): Preview | null => (expr.startsWith("20") ? null : { text: `<${expr}>`, fallback: false }),
  presets: [],
  onSavePreset: vi.fn(),
  onDeletePreset: vi.fn(),
});

/**
 * Every popover picker, with a literal display value, a stored expression
 * the tab can express, and how its popover is opened. The day picker opens
 * from its calendar button and commits an expression through onExpression;
 * the others open from their trigger and commit through onChange.
 */
const pickers = [
  { name: "DatetimePicker", type: "datetime", label: "As of", literal: "2026-09-14T09:30:15-04:00", expr: "now-1h", chip: "One hour ago", applied: "now-1h", open: "As of" },
  { name: "RangePicker", type: "date_range", label: "Range", literal: "2026-01-01/2026-03-31", expr: "T-7d/T", chip: "Last 30 days", applied: "$currentDate-30d/$currentDate", open: "Range" },
  { name: "QuarterPicker", type: "quarter", label: "Quarter", literal: "2026-Q3", expr: "Q-4", chip: "Last quarter", applied: "Q-1", open: "Quarter" },
  { name: "FiscalYearPicker", type: "fiscal_year", label: "Fiscal year", literal: "2026", expr: "FY-1", chip: "Current", applied: "FY0", open: "Fiscal year" },
  { name: "WeekPicker", type: "week", label: "Week", literal: "2026-W37", expr: "W-1", chip: "This week", applied: "W0", open: "Week" },
] as const;

function renderPicker(name: (typeof pickers)[number]["name"], props: { label: string; value: string; stored?: string; relative?: RelativeContext; onChange: (v: string) => void }) {
  switch (name) {
    case "DatetimePicker":
      return render(<DatetimePicker {...props} />);
    case "RangePicker":
      return render(<RangePicker {...props} />);
    case "QuarterPicker":
      return render(<QuarterPicker {...props} />);
    case "FiscalYearPicker":
      return render(<FiscalYearPicker {...props} />);
    case "WeekPicker":
      return render(<WeekPicker {...props} />);
  }
}

describe.each(pickers)("$name with a relative context", ({ name, label, literal, expr, chip, applied, open }) => {
  it("shows the tabs, lands on Absolute for a literal, and a chip + Apply commits the expression and closes", async () => {
    const onChange = vi.fn();
    renderPicker(name, { label, value: literal, stored: literal, relative: context(), onChange });
    await userEvent.click(screen.getByRole("button", { name: open }));
    const dialog = await screen.findByRole("dialog", { name: label });
    expect(screen.getByRole("tab", { name: "Absolute" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Relative" }));
    await userEvent.click(screen.getByRole("button", { name: chip }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(applied);
    expect(dialog).not.toBeInTheDocument();
  });

  it("lands on Relative for a stored expression, with its rows loaded", async () => {
    renderPicker(name, { label, value: literal, stored: expr, relative: context(), onChange: () => {} });
    await userEvent.click(screen.getByRole("button", { name: open }));
    await screen.findByRole("dialog", { name: label });
    expect(screen.getByRole("tab", { name: "Relative" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(`resolves now to <${serializeExpression(parseExpression(expr)!)}>`)).toBeInTheDocument();
  });

  it("has no tabs without a context", async () => {
    renderPicker(name, { label, value: literal, onChange: () => {} });
    await userEvent.click(screen.getByRole("button", { name: open }));
    await screen.findByRole("dialog", { name: label });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});

describe("focus in a tabbed popover", () => {
  it("lands inside on open, stays inside across a tab switch, and Escape still closes after Relative and back", async () => {
    const onChange = vi.fn();
    render(<QuarterPicker label="Quarter" value="2026-Q3" stored="2026-Q3" relative={context()} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Quarter" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Quarter" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.click(screen.getByRole("tab", { name: "Relative" }));
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.click(screen.getByRole("tab", { name: "Absolute" }));
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(dialog).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DayPicker with a relative context", () => {
  it("shows the tabs in its calendar popover and commits an expression through onExpression, closing", async () => {
    const onChange = vi.fn();
    const onExpression = vi.fn();
    const onBlur = vi.fn();
    render(<DayPicker label="Start" value="2026-08-23" stored="2026-08-23" relative={context()} onChange={onChange} onExpression={onExpression} onBlur={onBlur} />);
    await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
    const dialog = await screen.findByRole("dialog");
    expect(screen.getByRole("tab", { name: "Absolute" })).toHaveAttribute("aria-selected", "true");
    // The calendar is still the Absolute panel: a pick there still works.
    expect(screen.getByRole("button", { name: /August 20, 2026/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Relative" }));
    await userEvent.click(screen.getByRole("button", { name: "Last trading day" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onExpression).toHaveBeenCalledTimes(1);
    expect(onExpression).toHaveBeenCalledWith("trade_date");
    expect(onChange).not.toHaveBeenCalled();
    expect(dialog).not.toBeInTheDocument();
    expect(onBlur).toHaveBeenCalled();
  });

  it("lands on Relative for a stored expression", async () => {
    render(<DayPicker label="Start" value="2026-08-23" stored="T-1" relative={context()} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("tab", { name: "Relative" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Start offset 1 unit")).toHaveValue("d");
  });
});
