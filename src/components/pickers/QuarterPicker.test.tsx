// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuarterPicker } from "./QuarterPicker";

describe("QuarterPicker", () => {
  it("shows the stored quarter with FY, and a grid named with calendar months under the year end", async () => {
    render(<QuarterPicker label="Quarter" value="2027-Q1" fiscalYearEnd={9} onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Quarter" });
    expect(trigger).toHaveTextContent("FY2027-Q1");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Quarter" });
    expect(screen.getByText("FY2027")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "FY2027-Q1 (Oct–Dec 2026)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "FY2027-Q4 (Jul–Sep 2027)" })).toHaveAttribute("aria-pressed", "false");
  });

  it("steps the year and commits a pick at once, closing", async () => {
    const onChange = vi.fn();
    render(<QuarterPicker label="Quarter" value="2026-Q3" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await screen.findByRole("dialog", { name: "Quarter" });
    await userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
    expect(screen.getByText("FY2025")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "FY2025-Q2 (Apr–Jun 2025)" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2025-Q2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits a keyboard pick once and closes", async () => {
    const onChange = vi.fn();
    render(<QuarterPicker label="Quarter" value="2026-Q3" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await screen.findByRole("dialog", { name: "Quarter" });
    screen.getByRole("button", { name: "FY2026-Q4 (Oct–Dec 2026)" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-Q4");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape without writing", async () => {
    const onChange = vi.fn();
    render(<QuarterPicker label="Quarter" value="2026-Q3" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await screen.findByRole("dialog", { name: "Quarter" });
    await userEvent.click(screen.getByRole("button", { name: "Next fiscal year" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens on the current quarter for an empty or unparseable value", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 14, 12, 0, 0));
    try {
      render(<QuarterPicker label="Quarter" value="" fiscalYearEnd={6} onChange={() => {}} />);
      expect(screen.getByRole("button", { name: "Quarter" })).toHaveTextContent("—");
      await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
      await screen.findByRole("dialog", { name: "Quarter" });
      // 14 Sep 2026 under a June year end is FY2027-Q1.
      expect(screen.getByText("FY2027")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// A popover whose only exits are Escape and click-outside has no exit a user
// can SEE. Apply was the one visible action, so the popover read as a thing
// you had to commit to. Cancel is the other half, on both tabs, and it is the
// same dismissal Escape already performed -- close without writing.
describe("dismissing the popover", () => {
  const open = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    await screen.findByRole("dialog", { name: "Quarter" });
  };

  it("offers a Cancel that closes without committing", async () => {
    const onChange = vi.fn();
    render(<QuarterPicker label="Quarter" value="2026-Q3" onChange={onChange} />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sits outside the tab panels, so it is there whichever tab is showing", async () => {
    // Popover-level, not beside Apply: the Absolute panel has no action row
    // at all (it commits on pick), so a Cancel inside the tabs would leave
    // that tab with no visible exit. Asserted structurally because this
    // fixture has no relative context and so renders no tabs -- the Cancel
    // must be present anyway.
    render(<QuarterPicker label="Quarter" value="2026-Q3" onChange={vi.fn()} />);
    await open();
    const cancel = screen.getByRole("button", { name: "Close" });
    expect(cancel.closest("[role=\"tabpanel\"]")).toBeNull();
    expect(cancel.closest("[role=\"dialog\"]")).not.toBeNull();
  });

  it("reopens on the stored value, so a cancelled edit is really discarded", async () => {
    render(<QuarterPicker label="Quarter" value="2026-Q3" onChange={vi.fn()} />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Previous fiscal year" }));
    expect(screen.getByText("FY2025")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await open();
    expect(screen.getByText("FY2026")).toBeInTheDocument();
  });
});
