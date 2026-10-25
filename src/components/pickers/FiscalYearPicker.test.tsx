// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FiscalYearPicker } from "./FiscalYearPicker";

describe("FiscalYearPicker", () => {
  it("shows FY and a decade grid whose cells name their calendar span", async () => {
    render(<FiscalYearPicker label="Fiscal year" value="2027" fiscalYearEnd={9} onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Fiscal year" });
    expect(trigger).toHaveTextContent("FY2027");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Fiscal year" });
    expect(screen.getByText("2020–2029")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "FY2027 (Oct 2026–Sep 2027)" })).toHaveAttribute("aria-pressed", "true");
    // Twelve cells: the decade plus one on each side.
    expect(screen.getAllByRole("button", { name: /^FY\d{4} \(/ })).toHaveLength(12);
    expect(screen.getByRole("button", { name: "FY2019 (Oct 2018–Sep 2019)" })).toHaveClass("picker-outside");
  });

  it("steps the decade and commits a pick at once", async () => {
    const onChange = vi.fn();
    render(<FiscalYearPicker label="Fiscal year" value="2027" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Fiscal year" }));
    await screen.findByRole("dialog", { name: "Fiscal year" });
    await userEvent.click(screen.getByRole("button", { name: "Next decade" }));
    expect(screen.getByText("2030–2039")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "FY2031 (Jan–Dec 2031)" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2031");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits a keyboard pick once and closes", async () => {
    const onChange = vi.fn();
    render(<FiscalYearPicker label="Fiscal year" value="2027" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Fiscal year" }));
    await screen.findByRole("dialog", { name: "Fiscal year" });
    screen.getByRole("button", { name: "FY2024 (Jan–Dec 2024)" }).focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2024");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape without writing", async () => {
    const onChange = vi.fn();
    render(<FiscalYearPicker label="Fiscal year" value="2027" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Fiscal year" }));
    await screen.findByRole("dialog", { name: "Fiscal year" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
