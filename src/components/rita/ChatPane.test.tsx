// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { __resetAgentDiscoveryForTests } from "../../stores/agentDiscoveryStore";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ChatPane } from "./ChatPane";

const fetchAgentsJson = vi.fn();
const exportChat = vi.fn();
const sendToTarget = vi.fn();
vi.mock("../../lib/agent/agents-json", () => ({ fetchAgentsJson: (...a: unknown[]) => fetchAgentsJson(...a) }));
vi.mock("../../lib/chatExportFile", () => ({ exportChat: (...a: unknown[]) => exportChat(...a) }));
vi.mock("../../lib/shareSend", () => ({ sendToTarget: (...a: unknown[]) => sendToTarget(...a) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../lib/plotly", () => ({
  renderPlot: () => Promise.resolve(),
  purgePlot: () => {},
  resizePlot: () => {},
  REGISTERED_TRACE_TYPES: new Set(["scatter"]),
}));

const send = vi.fn(async () => {});
const abort = vi.fn();
const clear = vi.fn(async () => {});
const resolveTool = vi.fn();

beforeEach(() => {
  __resetAgentDiscoveryForTests();
  fetchAgentsJson.mockReset().mockResolvedValue({
    rita: {
      id: "rita",
      name: "Rita",
      description: "",
      queryPath: "/v1/query",
      features: { model: { kind: "select", label: "Model", default: "openai:nemotron-3.5-lightning", options: [] } },
    },
  });
  exportChat.mockReset().mockResolvedValue("/tmp/x.md");
  sendToTarget.mockReset().mockResolvedValue(undefined);
  send.mockClear();
  abort.mockClear();
  clear.mockClear();
  resolveTool.mockClear();
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      ritaUrl: "https://rita.example",
      shareTargets: [{ id: "n", name: "Notes", kind: "file", url: "/vault", template: "{}" }],
    },
  });
  useChatStore.setState({
    messages: [{ role: "human", content: "hi" }, { role: "ai", content: "hello" }],
    calls: [],
    trail: [],
    citations: [],
    suggestions: ["Tell me more"],
    running: false,
    error: null,
    hasUnread: false,
    paneOpen: false,
    pinned: false,
    send,
    abort,
    clear,
    pendingTool: null,
    resolveTool,
  });
});

describe("ChatPane", () => {
  // Back-port of dev b1e6612 (#91): an external MCP tool call waits for the user.
  it("asks before an external tool runs, naming server, tool and arguments, with Run and Deny", async () => {
    useChatStore.setState({
      running: true,
      pendingTool: { label: "Notes", url: "https://mcp.example/notes", tool: "create_note", args: { title: "Buy" } },
    });
    render(<ChatPane onInputFocus={() => {}} />);
    const box = screen.getByRole("group", { name: "Confirm tool call" });
    expect(box).toHaveTextContent("create_note");
    expect(box).toHaveTextContent("Notes");
    expect(box).toHaveTextContent("https://mcp.example/notes");
    expect(box).toHaveTextContent('"title": "Buy"');
    await userEvent.click(within(box).getByRole("button", { name: "Run" }));
    expect(resolveTool).toHaveBeenLastCalledWith(true);
    await userEvent.click(within(box).getByRole("button", { name: "Deny" }));
    expect(resolveTool).toHaveBeenLastCalledWith(false);
  });

  it("puts a sendToAgent row in the draft and sends only when the user does (review U3)", async () => {
    useChatStore.setState({ pendingMessage: "Analyze ACME" });
    render(<ChatPane onInputFocus={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Message Rita" }) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("Analyze ACME"));
    expect(useChatStore.getState().pendingMessage).toBeNull();
    expect(send).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    expect(send).toHaveBeenCalledWith("Analyze ACME");
  });

  it("shows no confirmation when nothing is pending", () => {
    render(<ChatPane onInputFocus={() => {}} />);
    expect(screen.queryByRole("group", { name: "Confirm tool call" })).toBeNull();
  });

  it("marks the pane open while mounted and shows the online dot", async () => {
    const { unmount } = render(<ChatPane onInputFocus={() => {}} />);
    expect(useChatStore.getState().paneOpen).toBe(true);
    await waitFor(() => expect(screen.getByRole("img", { name: "Rita online" })).toBeInTheDocument());
    expect(fetchAgentsJson).toHaveBeenCalledWith("https://rita.example");
    expect(screen.getByRole("heading", { name: /openai:nemotron/ })).toBeInTheDocument();
    unmount();
    expect(useChatStore.getState().paneOpen).toBe(false);
  });

  it("shows offline when discovery fails", async () => {
    fetchAgentsJson.mockRejectedValue(new TypeError("fetch failed"));
    render(<ChatPane onInputFocus={() => {}} />);
    await waitFor(() => expect(screen.getByRole("img", { name: "Rita offline" })).toBeInTheDocument());
  });

  it("sends on Enter, keeps Shift+Enter as a newline, and reports focus", async () => {
    const onInputFocus = vi.fn();
    render(<ChatPane onInputFocus={onInputFocus} />);
    const box = screen.getByRole("textbox", { name: "Message Rita" });
    await userEvent.click(box);
    expect(onInputFocus).toHaveBeenCalledWith(true);
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(send).not.toHaveBeenCalled();
    await userEvent.type(box, "{Enter}");
    expect(send).toHaveBeenCalledWith("line one\nline two");
    expect((box as HTMLTextAreaElement).value).toBe("");
    await userEvent.tab();
    expect(onInputFocus).toHaveBeenCalledWith(false);
  });

  it("offers Stop while running and Send otherwise", async () => {
    useChatStore.setState({ running: true });
    render(<ChatPane onInputFocus={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(abort).toHaveBeenCalled();
    act(() => useChatStore.setState({ running: false }));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("ignores Enter during IME composition", async () => {
    render(<ChatPane onInputFocus={() => {}} />);
    await waitFor(() => expect(fetchAgentsJson).toHaveBeenCalled());
    const box = screen.getByRole("textbox", { name: "Message Rita" });
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a suggestion chip on click", async () => {
    render(<ChatPane onInputFocus={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Tell me more" }));
    expect(send).toHaveBeenCalledWith("Tell me more");
  });

  it("hides the suggestions row when agentPromptSuggestions is off, even with suggestions in the store", async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, agentPromptSuggestions: false } }));
    render(<ChatPane onInputFocus={() => {}} />);
    await waitFor(() => expect(fetchAgentsJson).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Tell me more" })).not.toBeInTheDocument();
  });

  it("exports, sends to a target with a notice, and clears from the menu", async () => {
    render(<ChatPane onInputFocus={() => {}} />);
    await userEvent.click(screen.getByLabelText("Chat menu"));
    await userEvent.click(screen.getByRole("button", { name: "Export…" }));
    expect(exportChat).toHaveBeenCalledTimes(1);
    expect(String(exportChat.mock.calls[0][0])).toContain("# hi");
    await userEvent.click(screen.getByRole("button", { name: "Send to Notes" }));
    expect(sendToTarget).toHaveBeenCalledTimes(1);
    expect(sendToTarget.mock.calls[0][0]).toMatchObject({ name: "Notes" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent to Notes"));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(clear).toHaveBeenCalled();
  });

  it("renders the error line and pins", async () => {
    useChatStore.setState({ error: "Rita offline. fetch failed (https://rita.example)" });
    render(<ChatPane onInputFocus={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Rita offline.");
    await userEvent.click(screen.getByRole("button", { name: "Lock" }));
    expect(useChatStore.getState().pinned).toBe(true);
    expect(screen.getByRole("button", { name: "Lock" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Lock keeps the pane open and the icon shows the opposite action", async () => {
    render(<ChatPane onInputFocus={() => {}} />);
    const lock = screen.getByRole("button", { name: "Lock" });
    expect(lock).toHaveAttribute("aria-pressed", "false");
    expect(lock).toHaveAttribute("title", "Lock");
    expect(lock.querySelector("svg")?.getAttribute("data-glyph")).toBe("lock-closed");
    await userEvent.click(lock);
    expect(lock).toHaveAttribute("aria-pressed", "true");
    expect(lock).toHaveAttribute("title", "Unlock");
    expect(lock.querySelector("svg")?.getAttribute("data-glyph")).toBe("lock-open");
  });
});
