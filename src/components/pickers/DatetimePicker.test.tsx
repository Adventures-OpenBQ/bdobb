// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DatetimePicker } from "./DatetimePicker";

// The stored value carries its own offset, so the label's date and time are
// what the runner's zone makes of that instant; only the shape is pinned
// here, and labels.test.ts pins the exact text under a named zone.
const VALUE = "2026-09-14T09:30:15-04:00";

describe("DatetimePicker", () => {
  it("is a trigger named by its label, showing the local date, time and zone, with a dialog behind it", async () => {
    render(<DatetimePicker label="As of" value={VALUE} granularity="second" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "As of" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveTextContent(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+$/);
    await userEvent.click(trigger);
    expect(await screen.findByRole("dialog", { name: "As of" })).toBeInTheDocument();
  });

  it("commits a calendar pick at once, keeping the time, and closes", async () => {
    const onChange = vi.fn();
    render(<DatetimePicker label="As of" value={VALUE} granularity="second" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "As of" }));
    const dialog = await screen.findByRole("dialog", { name: "As of" });
    await userEvent.click(screen.getByRole("button", { name: /September 3, 2026/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatch(/^2026-09-03T\d{2}:\d{2}:15[+-]\d{2}:\d{2}$/);
    expect(dialog).not.toBeInTheDocument();
  });

  it("commits a field edit on Enter and shows a zone segment", async () => {
    const onChange = vi.fn();
    render(<DatetimePicker label="As of" value={VALUE} granularity="minute" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "As of" }));
    await screen.findByRole("dialog", { name: "As of" });
    expect(screen.queryByRole("spinbutton", { name: /second/i })).not.toBeInTheDocument();
    // The minute as the runner's zone shows it: an offset that is not a whole
    // number of hours (India's +05:30) moves the local minute off :30, so the
    // expectation is "one more than it was", not a fixed :31.
    const minute = screen.getByRole("spinbutton", { name: /minute/i });
    const before = Number(minute.getAttribute("aria-valuenow"));
    await userEvent.click(minute);
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0][0] as string;
    expect(written).toMatch(/T\d{2}:\d{2}:15[+-]\d{2}:\d{2}$/);
    expect(Number(written.slice(14, 16))).toBe((before + 1) % 60);
  });

  it("Enter in the field commits once and closes the popover", async () => {
    const onChange = vi.fn();
    render(<DatetimePicker label="As of" value={VALUE} granularity="minute" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "As of" }));
    const dialog = await screen.findByRole("dialog", { name: "As of" });
    await userEvent.click(screen.getByRole("spinbutton", { name: /minute/i }));
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(dialog).not.toBeInTheDocument();
  });

  it("closes on Escape without writing", async () => {
    const onChange = vi.fn();
    render(<DatetimePicker label="As of" value={VALUE} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "As of" }));
    const minute = await screen.findByRole("spinbutton", { name: /minute/i });
    await userEvent.click(minute);
    await userEvent.keyboard("{ArrowUp}{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a dash for an empty value and opens on today", async () => {
    render(<DatetimePicker label="As of" value="" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "As of" })).toHaveTextContent("—");
    await userEvent.click(screen.getByRole("button", { name: "As of" }));
    expect(await screen.findByRole("dialog", { name: "As of" })).toBeInTheDocument();
  });

  it("shows a date-only field for year, month and day granularity, and commits a pick at local midnight (v5.4.0)", async () => {
    const onChange = vi.fn();
    render(<DatetimePicker label="As of" value={VALUE} granularity="day" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "As of" }));
    await screen.findByRole("dialog", { name: "As of" });
    expect(screen.queryByRole("spinbutton", { name: /hour/i })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /day/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /September 3, 2026/ }));
    expect(onChange.mock.calls[0][0]).toMatch(/^2026-09-03T00:00:00[+-]\d{2}:\d{2}$/);
  });
});
