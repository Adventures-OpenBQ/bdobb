// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuarterRangePicker } from "./QuarterRangePicker";
import type { RelativeContext } from "./RelativeTab";

const context = (): RelativeContext => ({
  preview: (expr) => ({ text: `<${expr}>`, fallback: false }),
  presets: [],
  onSavePreset: vi.fn(),
  onDeletePreset: vi.fn(),
});

describe("QuarterRangePicker", () => {
  it("shows both ends with FY and names the two grids apart", async () => {
    render(<QuarterRangePicker label="Span" value="2025-Q4/2026-Q4" fiscalYearEnd={9} onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Span" });
    expect(trigger).toHaveTextContent("FY2025-Q4 – FY2026-Q4");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Span" });
    const start = screen.getByRole("group", { name: "Span start" });
    const end = screen.getByRole("group", { name: "Span end" });
    expect(within(start).getByText("FY2025")).toBeInTheDocument();
    expect(within(end).getByText("FY2026")).toBeInTheDocument();
    expect(within(start).getByRole("button", { name: "FY2025-Q4 (Jul–Sep 2025)" })).toHaveAttribute("aria-pressed", "true");
    expect(within(end).getByRole("button", { name: "FY2026-Q4 (Jul–Sep 2026)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("commits start then end as one range and closes; an end before the start cannot be picked", async () => {
    const onChange = vi.fn();
    render(<QuarterRangePicker label="Span" value="2026-Q1/2026-Q2" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Span" }));
    await screen.findByRole("dialog", { name: "Span" });
    const start = screen.getByRole("group", { name: "Span start" });
    const end = screen.getByRole("group", { name: "Span end" });
    await userEvent.click(within(start).getByRole("button", { name: "FY2026-Q3 (Jul–Sep 2026)" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(end).getByRole("button", { name: "FY2026-Q2 (Apr–Jun 2026)" })).toBeDisabled();
    await userEvent.click(within(end).getByRole("button", { name: "FY2026-Q4 (Oct–Dec 2026)" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-Q3/2026-Q4");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("steps each grid's fiscal year on its own", async () => {
    render(<QuarterRangePicker label="Span" value="2026-Q1/2026-Q2" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Span" }));
    await screen.findByRole("dialog", { name: "Span" });
    const end = screen.getByRole("group", { name: "Span end" });
    await userEvent.click(within(end).getByRole("button", { name: "Next fiscal year" }));
    expect(within(end).getByText("FY2027")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Span start" })).getByText("FY2026")).toBeInTheDocument();
  });

  it("lands on Relative for a stored expression and applies a quarter-range preset", async () => {
    const onChange = vi.fn();
    render(<QuarterRangePicker label="Span" value="2025-Q4/2026-Q4" stored="FQ-4/FQ0" relative={context()} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Span" }));
    await screen.findByRole("dialog", { name: "Span" });
    expect(screen.getByRole("tab", { name: "Relative" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: "Fiscal year to date" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith("FY0/FQ0");
  });

  it("picks the same quarter for both start and end, commits exactly once, and keeps the end cell enabled", async () => {
    const onChange = vi.fn();
    render(<QuarterRangePicker label="Span" value="2026-Q1/2026-Q1" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Span" }));
    await screen.findByRole("dialog", { name: "Span" });
    const start = screen.getByRole("group", { name: "Span start" });
    const end = screen.getByRole("group", { name: "Span end" });
    await userEvent.click(within(start).getByRole("button", { name: "FY2026-Q2 (Apr–Jun 2026)" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(end).getByRole("button", { name: "FY2026-Q2 (Apr–Jun 2026)" })).not.toBeDisabled();
    await userEvent.click(within(end).getByRole("button", { name: "FY2026-Q2 (Apr–Jun 2026)" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-Q2/2026-Q2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape after picking a start but no end without writing", async () => {
    const onChange = vi.fn();
    render(<QuarterRangePicker label="Span" value="2026-Q1/2026-Q2" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Span" }));
    await screen.findByRole("dialog", { name: "Span" });
    const start = screen.getByRole("group", { name: "Span start" });
    await userEvent.click(within(start).getByRole("button", { name: "FY2026-Q3 (Jul–Sep 2026)" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the end grid disabled until a start is picked when the value is empty", async () => {
    render(<QuarterRangePicker label="Span" value="" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Span" }));
    await screen.findByRole("dialog", { name: "Span" });
    const start = screen.getByRole("group", { name: "Span start" });
    const end = screen.getByRole("group", { name: "Span end" });
    const quarterCells = (group: HTMLElement) => within(group).getAllByRole("button", { name: /^FY\d{4}-Q\d/ });
    expect(quarterCells(end)).toHaveLength(4);
    for (const cell of quarterCells(end)) expect(cell).toBeDisabled();
    await userEvent.click(quarterCells(start)[0]);
    for (const cell of quarterCells(end)) expect(cell).not.toBeDisabled();
  });
});
