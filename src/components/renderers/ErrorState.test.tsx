// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("disables Retry and counts down while a wait is in force", () => {
    render(<ErrorState message="HTTP 502: … Retry after 12 s." onRetry={vi.fn()} secondsLeft={12} />);
    const button = screen.getByRole("button", { name: "Try again in 12 s" });
    expect(button).toBeDisabled();
  });

  it("keeps the counting button out of the alert, so the count is not announced every second", () => {
    render(<ErrorState message="HTTP 502: … Retry after 12 s." onRetry={vi.fn()} secondsLeft={12} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("HTTP 502");
    expect(alert).not.toContainElement(screen.getByRole("button"));
  });

  it("is an ordinary Retry without a wait", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="HTTP 500" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
