// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RangePicker } from "./RangePicker";

describe("RangePicker", () => {
  it("is a trigger named by its label showing both ends", async () => {
    render(<RangePicker label="Range" value="2026-01-01/2026-03-31" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Range" });
    expect(trigger).toHaveTextContent("2026-01-01 – 2026-03-31");
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Range" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Range start" })).toHaveTextContent("2026-01-01");
    expect(screen.getByRole("group", { name: "Range end" })).toHaveTextContent("2026-03-31");
  });

  it("commits a completed calendar range at once and closes", async () => {
    const onChange = vi.fn();
    render(<RangePicker label="Range" value="2026-01-01/2026-03-31" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Range" }));
    await screen.findByRole("dialog", { name: "Range" });
    await userEvent.click(screen.getByRole("button", { name: /January 5, 2026/ }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /January 9, 2026/ }));
    expect(onChange).toHaveBeenCalledWith("2026-01-05/2026-01-09");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits an edited end field on Enter, and refuses an end before the start", async () => {
    const onChange = vi.fn();
    render(<RangePicker label="Range" value="2026-01-01/2026-03-31" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Range" }));
    await screen.findByRole("dialog", { name: "Range" });
    const endDay = screen.getAllByRole("spinbutton", { name: /day/i })[1];
    await userEvent.click(endDay);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("2026-01-01/2026-03-30");
    // That Enter closed the popover; reopen it on the (unchanged) value.
    await userEvent.click(screen.getByRole("button", { name: "Range" }));
    const dialog = await screen.findByRole("dialog", { name: "Range" });
    const startYear = screen.getAllByRole("spinbutton", { name: /year/i })[0];
    await userEvent.click(startYear);
    await userEvent.keyboard("{ArrowUp}{Enter}");
    // 2027-01-01 / 2026-03-31 is not a range; nothing more is written, and
    // the popover stays open on the draft.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
  });

  it("Enter in a field commits once and closes the popover", async () => {
    const onChange = vi.fn();
    render(<RangePicker label="Range" value="2026-01-01/2026-03-31" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Range" }));
    const dialog = await screen.findByRole("dialog", { name: "Range" });
    await userEvent.click(screen.getAllByRole("spinbutton", { name: /day/i })[1]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-01-01/2026-03-30");
    expect(dialog).not.toBeInTheDocument();
  });

  it("shows dashes for an empty value", () => {
    render(<RangePicker label="Range" value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Range" })).toHaveTextContent("— – —");
  });
});
