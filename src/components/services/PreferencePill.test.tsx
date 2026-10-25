// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PreferencePill } from "./PreferencePill";

describe("PreferencePill", () => {
  it("is a switch showing On/Off and toggles on click", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<PreferencePill label="Follow-up suggestions" checked={true} onChange={onChange} />);
    const pill = screen.getByRole("switch", { name: "Follow-up suggestions" });
    expect(pill).toHaveAttribute("aria-checked", "true");
    expect(pill).toHaveTextContent("On");
    await userEvent.click(pill);
    expect(onChange).toHaveBeenCalledWith(false);
    rerender(<PreferencePill label="Follow-up suggestions" checked={false} onChange={onChange} />);
    expect(screen.getByRole("switch")).toHaveTextContent("Off");
  });

  it("honours ariaLabel, describedBy and disabled", async () => {
    const onChange = vi.fn();
    render(<PreferencePill label="Enabled" ariaLabel="Enabled equity-research" describedBy="hint" checked={false} disabled onChange={onChange} />);
    const pill = screen.getByRole("switch", { name: "Enabled equity-research" });
    expect(pill).toBeDisabled();
    expect(pill).toHaveAttribute("aria-describedby", "hint");
    await userEvent.click(pill);
    expect(onChange).not.toHaveBeenCalled();
  });
});
