// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServiceStatus } from "./ServiceStatus";

describe("ServiceStatus", () => {
  it("shows the default label for each state and the state class", () => {
    const { rerender } = render(<ServiceStatus state="online" />);
    expect(screen.getByText("Online")).toHaveClass("bd-status", "bd-status--online");
    rerender(<ServiceStatus state="offline" />);
    expect(screen.getByText("Offline")).toHaveClass("bd-status--offline");
    rerender(<ServiceStatus state="checking" />);
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    rerender(<ServiceStatus state="unchecked" />);
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    rerender(<ServiceStatus state="unavailable" />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("uses custom text and adds role=status only when live", () => {
    const { rerender } = render(<ServiceStatus state="online" text="Online · 3 tools" />);
    expect(screen.getByText("Online · 3 tools")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<ServiceStatus state="online" text="Online" live />);
    expect(screen.getByRole("status")).toHaveTextContent("Online");
  });
});
