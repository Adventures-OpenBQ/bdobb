// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusTrail } from "./StatusTrail";

describe("StatusTrail", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<StatusTrail trail={[]} running={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists steps with a summary, hides hidden ones, and opens while running", () => {
    const trail = [
      { eventType: "INFO" as const, message: 'Loading "Historical Prices"', tool_call: { tool_name: "get_widget_data" } },
      { eventType: "ERROR" as const, message: "Model timed out" },
      { eventType: "INFO" as const, message: "secret", hidden: true },
    ];
    const { container, rerender } = render(<StatusTrail trail={trail} running={true} />);
    const details = () => container.querySelector("details") as HTMLDetailsElement;
    expect(details().open).toBe(true);
    expect(screen.getByText("2 steps · 1 error")).toBeInTheDocument();
    expect(screen.getByText(/Model timed out/).closest("li")).toHaveClass("trail-error");
    expect(screen.getByText("get_widget_data").tagName).toBe("CODE");
    expect(screen.queryByText("secret")).toBeNull();
    rerender(<StatusTrail trail={trail} running={false} />);
    expect(details().open).toBe(false);
  });

  // Ep6 shoot: Rita's step already reads "Calling move_widget", and the chip
  // repeated the name with no space ("Calling move_widgetmove_widget").
  it("names a plain tool once, and spaces the chip from the message", () => {
    const trail = [
      { eventType: "INFO" as const, message: "Calling move_widget", tool_call: { tool_name: "move_widget" } },
      { eventType: "INFO" as const, message: "Loading", tool_call: { tool_name: "get_widget_data" } },
    ];
    const { container } = render(<StatusTrail trail={trail} running={true} />);
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["• Calling move_widget", "• Loading get_widget_data"]);
  });

  it("shows a proxied call's effective name, not the advertised proxy", () => {
    const trail = [
      {
        eventType: "INFO" as const,
        message: "Calling",
        tool_call: { tool_name: "call_tool", display: "openbq-mcp · equity_price_historical (via call_tool)" },
      },
      { eventType: "INFO" as const, message: "Piping", tool_call: { tool_name: "run_pipeline", display: "openbq-mcp · pipeline: a → b → c (via run_pipeline)" } },
    ];
    render(<StatusTrail trail={trail} running={true} />);
    expect(screen.getByText("openbq-mcp · equity_price_historical (via call_tool)").tagName).toBe("CODE");
    expect(screen.getByText("openbq-mcp · pipeline: a → b → c (via run_pipeline)")).toBeInTheDocument();
    expect(screen.queryByText("call_tool")).toBeNull();
  });
});
