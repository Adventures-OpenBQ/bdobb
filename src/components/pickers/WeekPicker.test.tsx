// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WeekPicker } from "./WeekPicker";

describe("WeekPicker", () => {
  it("shows the week and its span, and highlights all seven days in the calendar", async () => {
    render(<WeekPicker label="Week" value="2026-W37" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Week" });
    expect(trigger).toHaveTextContent("W37 2026 · Sep 7–13");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await userEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Week" });
    const highlighted = document.querySelectorAll(".react-aria-CalendarCell.week-selected");
    expect(highlighted).toHaveLength(7);
    expect(screen.getByRole("button", { name: /September 7, 2026/ })).toHaveClass("week-selected");
    expect(screen.getByRole("button", { name: /September 13, 2026/ })).toHaveClass("week-selected");
    expect(screen.getByRole("button", { name: /September 14, 2026/ })).not.toHaveClass("week-selected");
  });

  it("snaps any picked day to its whole ISO week, commits at once and closes", async () => {
    const onChange = vi.fn();
    render(<WeekPicker label="Week" value="2026-W37" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("dialog", { name: "Week" });
    // A Sunday: still week 39, Monday Sep 21 to Sunday Sep 27.
    await userEvent.click(screen.getByRole("button", { name: /September 27, 2026/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-W39");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("commits and closes on a re-pick of the stored week's own Monday", async () => {
    // The Calendar's value IS that Monday, so this pins that RAC still
    // reports the pick rather than swallowing it as "no change".
    const onChange = vi.fn();
    render(<WeekPicker label="Week" value="2026-W37" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("dialog", { name: "Week" });
    await userEvent.click(screen.getByRole("button", { name: /September 7, 2026/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-W37");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves by a week with Up/Down and by a day with Left/Right, selecting the whole week on Enter", async () => {
    const onChange = vi.fn();
    render(<WeekPicker label="Week" value="2026-W37" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("dialog", { name: "Week" });
    // Focusing a cell moves RAC's focused date, a state update: inside act.
    const monday = screen.getByRole("button", { name: /September 7, 2026/ });
    act(() => monday.focus());
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{Enter}");
    // Sep 15 (Tuesday) is in week 38.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-W38");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape without writing", async () => {
    const onChange = vi.fn();
    render(<WeekPicker label="Week" value="2026-W37" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("dialog", { name: "Week" });
    act(() => screen.getByRole("button", { name: /September 7, 2026/ }).focus());
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
