// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DayPicker } from "./DayPicker";

describe("DayPicker", () => {
  it("is a group named by its label, showing the stored value verbatim", () => {
    // Was: the segmented DateInput in ISO order. The box now holds what is
    // stored, so a literal still reads as its ISO date -- and an expression
    // reads as itself instead of being resolved away.
    render(<DayPicker label="Start" value="2026-08-23" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("2026-08-23");
  });

  it("reports typing as it happens, and blur as leaving the whole control", async () => {
    // Was: an arrow-key edit of the day segment. Segments cannot coexist with
    // a box that has to hold `T-1bd`, so editing is typing now.
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<DayPicker label="Start" value="2026-08-23" onChange={onChange} onBlur={onBlur} />);
    const box = screen.getByRole("textbox", { name: "Start" });
    await userEvent.click(box);
    await userEvent.type(box, "4");
    expect(onChange).toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
    await userEvent.tab();
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalled();
  });

  it("opens a calendar from its button; a pick reports the date and closes it, which counts as leaving", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<DayPicker label="Start" value="2026-08-23" onChange={onChange} onBlur={onBlur} />);
    await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /August 20, 2026/ }));
    expect(onChange).toHaveBeenLastCalledWith("2026-08-20");
    expect(onBlur).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is empty for an empty value and inert when disabled", () => {
    // Was: segment placeholders. An empty box is simply empty now, and both
    // halves of the control refuse input when the param is pending.
    render(<DayPicker label="Start" value="" disabled onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Start" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Calendar" })).toBeDisabled();
  });

  it("does not throw on a stored expression: it is shown resolved by the caller, never handed here raw", () => {
    // ParamControls resolves before rendering; this only pins that junk is
    // survivable rather than thrown on.
    render(<DayPicker label="Start" value="T-1" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Start" })).toBeInTheDocument();
  });
});

/**
 * The expression-first field (v5.4.x): the box holds what is STORED, so an
 * expression stays readable and editable, and its resolution reads beneath.
 *
 * This replaces the segmented input. A box holding `T-1bd` cannot also be
 * three spinbuttons, so arrow-key editing of a literal's day or month is
 * gone; the picker chip is how a date is now chosen without typing.
 */
describe("DayPicker as an expression field", () => {
  it("shows the stored expression rather than its resolution", () => {
    render(<DayPicker label="Start" value="T-1bd" resolved="2026-09-11" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Start" })).toHaveValue("T-1bd");
  });

  it("reads the resolution underneath, and only for an expression", () => {
    const { rerender } = render(<DayPicker label="Start" value="T-1bd" resolved="2026-09-11" onChange={vi.fn()} />);
    expect(screen.getByTestId("param-resolved")).toHaveTextContent("2026-09-11");
    // A literal is already the answer; repeating it underneath is noise.
    rerender(<DayPicker label="Start" value="2026-08-23" resolved="2026-08-23" onChange={vi.fn()} />);
    expect(screen.queryByTestId("param-resolved")).toBeNull();
  });

  it("lets a title-bar chip grow to hold the resolution, so it cannot overlap the next row", () => {
    // The resolution is a second line under the box. A title-bar chip with a
    // FIXED height kept only the box's 20px, so on a narrow card whose
    // controls wrap, the resolution spilled onto the next control (the v5
    // Treasury auctions card: `T` drawn over `2026-09-04`). styles.css is not
    // in the test build (`css: false`), so the rule is asserted on the file.
    const css = readFileSync("src/styles.css", "utf8");
    const chip = css.match(/\n\.card-chips \.param-field \{([^}]*)\}/)?.[1] ?? "";
    expect(chip).toMatch(/min-height:\s*20px/);
    expect(chip).not.toMatch(/(^|[^-])height:/);
  });

  it("types freely, so an expression can be edited in place", async () => {
    const onChange = vi.fn();
    render(<DayPicker label="Start" value="" resolved="" onChange={onChange} />);
    // Controlled and unchanged by the test, so each keystroke is reported
    // against the same empty value -- the first is the one that proves the
    // box is free text rather than a date mask.
    await userEvent.type(screen.getByRole("textbox", { name: "Start" }), "Q");
    expect(onChange).toHaveBeenCalledWith("Q");
  });

  it("opens the picker from a calendar chip, not from a bare caret", async () => {
    render(<DayPicker label="Start" value="T-1bd" resolved="2026-09-11" onChange={vi.fn()} />);
    const chip = screen.getByTestId("param-picker-chip");
    expect(chip).toHaveClass("param-chip");
    expect(chip).toHaveAttribute("aria-label", "Calendar");
    await userEvent.click(chip);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("a pick REPLACES the expression; leaving without picking keeps it", async () => {
    // The ruling: choosing a date is an explicit choice of a literal, and it
    // supersedes whatever expression was there. Cancelling must not.
    const onChange = vi.fn();
    render(<DayPicker label="Start" value="T-1bd" resolved="2026-09-11" onChange={onChange} />);
    await userEvent.click(screen.getByTestId("param-picker-chip"));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("param-picker-chip"));
    await screen.findByRole("dialog");
    // The calendar opens on the RESOLVED date, so the expression's own month
    // is what is shown and the pick below is a real day in it.
    await userEvent.click(screen.getByRole("button", { name: /September 9, 2026/ }));
    expect(onChange).toHaveBeenCalledWith("2026-09-09");
  });
});
