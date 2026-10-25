// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

const fetchAgentsJson = vi.fn();
vi.mock("../../lib/agent/agents-json", async () => {
  const actual = await vi.importActual<typeof import("../../lib/agent/agents-json")>(
    "../../lib/agent/agents-json",
  );
  return { ...actual, fetchAgentsJson: (...a: unknown[]) => fetchAgentsJson(...a) };
});

import { normalizeAgentsJson } from "../../lib/agent/agents-json";
import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { __resetLoggerForTests } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { __reset } from "../../test/memfs";
import { __resetAgentDiscoveryForTests } from "../../stores/agentDiscoveryStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { AgentsTab } from "./AgentsTab";

// The captured discovery document, normalized the way the real fetch would.
// process.cwd() rather than import.meta.url: under jsdom the latter is an
// http:// URL that readFileSync refuses (see agents-json.test.ts).
const AGENTS = normalizeAgentsJson(
  JSON.parse(readFileSync("src/test/fixtures/rita/agents.json", "utf8")) as Record<string, unknown>,
);

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  __resetAgentDiscoveryForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
  // A draft must already be open for stageDraft to do anything -- AILibrary's
  // beginDraft() on mount, reproduced here since this tab is also rendered
  // standalone in these tests.
  useSettingsStore.getState().beginDraft();
  // A default resolved value: tests that commit a URL but don't care about
  // discovery (e.g. blur/Enter commit) still trigger the discovery effect,
  // and an unconfigured vi.fn() returns undefined, not a promise — .then()
  // on that throws inside the effect. Tests that DO care override this.
  fetchAgentsJson.mockReset().mockResolvedValue({});
});

describe("AgentsTab — the Rita URL", () => {
  it("offers 1-40 tool rounds (40 default) offline and stages without saving until committed", async () => {
    render(<AgentsTab />);
    const field = screen.getByRole("combobox", { name: "Maximum tool rounds" }) as HTMLSelectElement;
    expect(field).toHaveValue("40");
    expect([...field.options].map((o) => o.value)).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)));
    expect(field.selectedOptions[0].textContent).toBe("40 (default)");
    await userEvent.selectOptions(field, "12");
    expect(useSettingsStore.getState().draft?.patch.ritaMaxFunctionRounds).toBe(12);
    expect(useSettingsStore.getState().settings.ritaMaxFunctionRounds).toBe(40);
    await useSettingsStore.getState().commitDraft();
    expect(useSettingsStore.getState().settings.ritaMaxFunctionRounds).toBe(12);
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings.ritaMaxFunctionRounds).toBe(12);
  });

  it("discards a changed tool-round limit on Cancel", async () => {
    const view = render(<AgentsTab />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Maximum tool rounds" }), "32");
    act(() => useSettingsStore.getState().discardDraft());
    view.unmount();
    useSettingsStore.getState().beginDraft();
    render(<AgentsTab />);
    expect(screen.getByRole("combobox", { name: "Maximum tool rounds" })).toHaveValue("40");
  });

  it("shows Not checked and runs no discovery when the URL is empty", () => {
    render(<AgentsTab />);
    expect(screen.getByRole("status")).toHaveTextContent("Not checked");
    expect(fetchAgentsJson).not.toHaveBeenCalled();
  });

  it("commits a valid URL on blur, without its trailing slash, into the draft", async () => {
    render(<AgentsTab />);
    await userEvent.type(screen.getByLabelText("Rita URL"), "https://rita.example/");
    await userEvent.tab();
    expect(useSettingsStore.getState().draft?.patch.ritaUrl).toBe("https://rita.example");
  });

  it("commits on Enter", async () => {
    render(<AgentsTab />);
    await userEvent.type(screen.getByLabelText("Rita URL"), "https://rita.example{Enter}");
    expect(useSettingsStore.getState().draft?.patch.ritaUrl).toBe("https://rita.example");
  });

  it("rejects a non-http URL inline and stages nothing", async () => {
    render(<AgentsTab />);
    await userEvent.type(screen.getByLabelText("Rita URL"), "ftp://rita.example");
    await userEvent.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an http(s) URL.");
    expect(useSettingsStore.getState().draft?.patch.ritaUrl).toBeUndefined();
  });

  it("clears the inline URL error as soon as the field changes, not only on the next commit", async () => {
    render(<AgentsTab />);
    await userEvent.type(screen.getByLabelText("Rita URL"), "ftp://rita.example");
    await userEvent.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an http(s) URL.");
    await userEvent.type(screen.getByLabelText("Rita URL"), "s");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clearing the field stages Rita off", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } });
    fetchAgentsJson.mockResolvedValue(AGENTS);
    render(<AgentsTab />);
    await userEvent.clear(screen.getByLabelText("Rita URL"));
    await userEvent.tab();
    expect(useSettingsStore.getState().draft?.patch.ritaUrl).toBe("");
  });
});

describe("AgentsTab — discovery", () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } });
  });

  it("renders the captured agent as a service card: name, description, features, status Online", async () => {
    fetchAgentsJson.mockResolvedValue(AGENTS);
    render(<AgentsTab />);
    expect(fetchAgentsJson).toHaveBeenCalledWith("https://rita.example");
    await screen.findByRole("heading", { name: "Agent Rita" });
    expect(screen.getByText("An open-source, model-agnostic agent for the OpenBB Workspace")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Online");
    expect(screen.getByText("streaming: on")).toBeInTheDocument();
    expect(screen.getByText(/Model:/)).toBeInTheDocument();
    // No control offers the eleven model options: the default is text, not a select.
    expect(screen.queryByRole("combobox", { name: /model/i })).not.toBeInTheDocument();
  });

  it("shows Offline with the error message when discovery fails", async () => {
    fetchAgentsJson.mockRejectedValue(new Error("agents.json failed: HTTP 502 bad gateway"));
    render(<AgentsTab />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Offline: agents.json failed: HTTP 502 bad gateway"),
    );
    expect(screen.queryByRole("heading", { name: "Agent Rita" })).not.toBeInTheDocument();
  });

  it("explains the fixed model behind a native disclosure", async () => {
    fetchAgentsJson.mockResolvedValue(AGENTS);
    render(<AgentsTab />);
    await screen.findByText("Why is the model fixed?");
    expect(screen.getByText(/sends the default as-is/)).toBeInTheDocument();
  });

  it("renders the agent's own toggle feature as a switch and stages the choice per agent", async () => {
    fetchAgentsJson.mockResolvedValue(AGENTS);
    render(<AgentsTab />);
    const sw = await screen.findByRole("switch", { name: "Follow-up Suggestions" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    await userEvent.click(sw);
    expect(useSettingsStore.getState().draft?.patch.agentOptions).toEqual({
      openbb_agent_rita: { "prompt-suggestions": false },
    });
    expect(sw).toHaveAttribute("aria-checked", "false");
  });
});

describe("AgentsTab — a text feature", () => {
  it("renders as a committed field and stages it on blur", async () => {
    const withText = normalizeAgentsJson({
      bot: {
        name: "Bot",
        endpoints: { query: "/v1/query" },
        features: { "agent-name": { type: "text", label: "Agent name", default: "My Bot", description: "" } },
      },
    });
    fetchAgentsJson.mockResolvedValue(withText);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://rita.example" } });
    render(<AgentsTab />);
    const field = await screen.findByRole("textbox", { name: "Agent name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Rita");
    fireEvent.blur(field);
    await waitFor(() =>
      expect(useSettingsStore.getState().draft?.patch.agentOptions).toEqual({ bot: { "agent-name": "Rita" } }),
    );
  });
});

describe("AgentsTab — the follow-up suggestions preference", () => {
  it("is a switch bound to agentPromptSuggestions, on by default, that stages the setting", async () => {
    render(<AgentsTab />);
    const pill = screen.getByRole("switch", { name: "Follow-up suggestions" });
    expect(pill).toHaveAttribute("aria-checked", "true");
    await userEvent.click(pill);
    expect(useSettingsStore.getState().draft?.patch.agentPromptSuggestions).toBe(false);
    expect(screen.getByRole("switch", { name: "Follow-up suggestions" })).toHaveAttribute("aria-checked", "false");
  });

  it("renders even when no agent is discovered", () => {
    render(<AgentsTab />);
    expect(screen.getByRole("switch", { name: "Follow-up suggestions" })).toBeInTheDocument();
  });
});

describe("AgentsTab — Context sharing", () => {
  it("is a switch, off by default, that stages the setting", async () => {
    render(<AgentsTab />);
    const sw = screen.getByRole("switch", { name: "Context sharing" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(useSettingsStore.getState().draft?.patch.contextSharing).toBe(true);
    expect(screen.getByRole("switch", { name: "Context sharing" })).toHaveAttribute("aria-checked", "true");
  });
});
