// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentEditsStore } from "../../stores/agentEditsStore";
import { AgentEditBar } from "./AgentEditBar";

beforeEach(() => useAgentEditsStore.setState({ entries: [], undoError: null }));

describe("AgentEditBar", () => {
  it("renders nothing without edits", () => {
    const { container } = render(<AgentEditBar />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the last edit and a count, undoes, and dismisses", async () => {
    const undo = vi.fn(async () => {});
    useAgentEditsStore.setState({
      entries: [
        { summary: "Rita created dashboard \"A\"", undo: async () => {} },
        { summary: "Rita added \"W\" to \"A\"", undo },
      ],
    });
    render(<AgentEditBar />);
    expect(screen.getByRole("status")).toHaveTextContent('Rita added "W" to "A"');
    expect(screen.getByText("2 changes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent('Rita created dashboard "A"');
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the failure message as an alert and keeps older edits undoable", async () => {
    useAgentEditsStore.setState({
      entries: [
        { summary: "older", undo: async () => {} },
        { summary: "stale", undo: async () => { throw new Error("can no longer be undone"); } },
      ],
    });
    render(<AgentEditBar />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("can no longer be undone");
    expect(screen.getByRole("status")).toHaveTextContent("older");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still shows the alert when the failed entry was the only one", async () => {
    useAgentEditsStore.setState({ entries: [{ summary: "stale", undo: async () => { throw new Error("gone"); } }] });
    render(<AgentEditBar />);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gone");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
