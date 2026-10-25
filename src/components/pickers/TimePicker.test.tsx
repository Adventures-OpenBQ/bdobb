// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimePicker } from "./TimePicker";

describe("TimePicker", () => {
  it("is named by its label and shows hours, minutes and seconds on a 24-hour clock", () => {
    render(<TimePicker label="Session" value="09:30:00" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Session" })).toHaveTextContent("09:30:00");
    expect(screen.getByRole("spinbutton", { name: /second/i })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /AM/i })).not.toBeInTheDocument();
  });

  it("reports an edit as a wire time and blur as leaving the control", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<TimePicker label="Session" value="09:30:00" onChange={onChange} onBlur={onBlur} />);
    await userEvent.click(screen.getByRole("spinbutton", { name: /hour/i }));
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("10:30:00");
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalled();
  });
});
