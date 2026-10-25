// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

const openMock = vi.fn();
const saveMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => openMock(...a),
  save: (...a: unknown[]) => saveMock(...a),
}));

// The tabs have their own tests; here they are stubs so the shell's
// behaviour is what is under test.
vi.mock("./AgentsTab", () => ({ AgentsTab: () => <div data-testid="agents-tab" /> }));
vi.mock("./McpServersTab", () => ({ McpServersTab: () => <div data-testid="mcp-tab" /> }));
vi.mock("./ShareTargetsTab", () => ({ ShareTargetsTab: () => <div data-testid="share-tab" /> }));
vi.mock("./SkillsTab", () => ({ SkillsTab: () => <div data-testid="skills-tab" /> }));
vi.mock("./AppearanceTab", () => ({ AppearanceTab: () => <div data-testid="appearance-tab" /> }));

import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { __resetLoggerForTests } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { __read, __reset, __seed } from "../../test/memfs";
import { useMcpTokensStore } from "../../stores/mcpTokensStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { AILibrary } from "./AILibrary";

function renderLibrary(props?: { onClose?: () => void }) {
  return render(<AILibrary onClose={props?.onClose ?? vi.fn()} />);
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
  openMock.mockReset().mockResolvedValue("/imports/ai-library.json");
  saveMock.mockReset().mockImplementation((opts?: { defaultPath?: string }) =>
    Promise.resolve(`/exports/${opts?.defaultPath ?? "ai-library.json"}`),
  );
});

describe("AILibrary", () => {
  it("is a dialog named AI Library with five tabs, Agents first and initially focused", () => {
    renderLibrary();
    const dialog = screen.getByRole("dialog", { name: "AI Library" });
    const tabs = within(dialog).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Agents",
      "MCP Servers",
      "Send chat to…",
      "Skills",
      "Appearance",
    ]);
    expect(within(dialog).getByRole("tab", { name: "Agents" })).toHaveFocus();
    expect(screen.getByTestId("agents-tab")).toBeInTheDocument();
  });

  it("shows the Skills tab when selected", async () => {
    renderLibrary();
    await userEvent.click(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByTestId("skills-tab")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches panels with the tab strip", async () => {
    renderLibrary();
    await userEvent.click(screen.getByRole("tab", { name: "MCP Servers" }));
    expect(screen.getByTestId("mcp-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-tab")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Send chat to…" }));
    expect(screen.getByTestId("share-tab")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(screen.getByTestId("appearance-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("share-tab")).not.toBeInTheDocument();
  });

  it("Cancel discards a staged draft and closes", async () => {
    const onClose = vi.fn();
    renderLibrary({ onClose });
    useSettingsStore.getState().stageDraft({ ritaUrl: "https://staged.example" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useSettingsStore.getState().draft).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Close discards a staged draft and closes", async () => {
    const onClose = vi.fn();
    renderLibrary({ onClose });
    useSettingsStore.getState().stageDraft({ ritaUrl: "https://staged.example" });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useSettingsStore.getState().draft).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Focus-return-to-opener on unmount is useModalDialog's own behaviour,
  // already covered by useModalDialog.test.tsx; here it is enough that
  // Escape (like Cancel and Close above) discards the draft and closes.
  it("Escape discards a staged draft and closes", async () => {
    const onClose = vi.fn();
    renderLibrary({ onClose });
    useSettingsStore.getState().stageDraft({ ritaUrl: "https://staged.example" });
    await userEvent.keyboard("{Escape}");
    expect(useSettingsStore.getState().draft).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Review U7: a server's token is forgotten only once its removal is
  // committed, and only when no remaining server uses the same URL.
  describe("MCP tokens follow the committed server list", () => {
    const a = { id: "a", url: "https://docs.example/mcp", enabled: true };
    const twin = { id: "b", url: "https://docs.example/mcp", enabled: true };
    const tokens = { "https://docs.example/mcp": { token: "secret" } };
    beforeEach(() => useMcpTokensStore.setState({ tokens }));

    it("Cancel after Remove keeps the token", async () => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [a] }, draft: null });
      renderLibrary();
      useSettingsStore.getState().stageDraft({ mcpServers: [] });
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(useMcpTokensStore.getState().tokens).toEqual(tokens);
    });

    it("Done after Remove forgets the token", async () => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [a] }, draft: null });
      const onClose = vi.fn();
      renderLibrary({ onClose });
      useSettingsStore.getState().stageDraft({ mcpServers: [] });
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      await waitFor(() => expect(useMcpTokensStore.getState().tokens).toEqual({}));
    });

    it("logs a failed forget and still closes", async () => {
      const realRemove = useMcpTokensStore.getState().removeToken;
      useMcpTokensStore.setState({ removeToken: vi.fn().mockRejectedValue(new Error("disk gone")) });
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [a] }, draft: null });
      const onClose = vi.fn();
      renderLibrary({ onClose });
      useSettingsStore.getState().stageDraft({ mcpServers: [] });
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("disk gone"));
      expect(__read("logs/bdobb.log")).not.toContain("secret");
      useMcpTokensStore.setState({ removeToken: realRemove });
    });

    it("removing one of two rows on the same URL keeps their token", async () => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [a, twin] }, draft: null });
      const onClose = vi.fn();
      renderLibrary({ onClose });
      useSettingsStore.getState().stageDraft({ mcpServers: [twin] });
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(useMcpTokensStore.getState().tokens).toEqual(tokens);
    });
  });

  it("Done writes once and closes; a no-op Done still closes", async () => {
    const onClose = vi.fn();
    const save = vi.spyOn(useSettingsStore.getState(), "save");
    renderLibrary({ onClose });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    // No staged change: commitDraft resolves ok without ever calling save.
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().draft).toBeNull();
  });

  it("import stages the parsed patch without saving; export writes the effective draft", async () => {
    const save = vi.spyOn(useSettingsStore.getState(), "save");
    __seed("/imports/ai-library.json", JSON.stringify({ agentPromptSuggestions: false }));
    renderLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Import…" }));
    await waitFor(() => expect(useSettingsStore.getState().draft?.patch.agentPromptSuggestions).toBe(false));
    expect(save).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(screen.getByText(/exported/i)).toBeInTheDocument());
    expect(saveMock).toHaveBeenCalled();
  });

  it("shows the conflict notice and Done again replaces", async () => {
    const onClose = vi.fn();
    const realSave = useSettingsStore.getState().save;
    const save = vi.fn(realSave);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ritaUrl: "https://one.example" }, save });
    renderLibrary({ onClose });
    useSettingsStore.getState().stageDraft({ ritaUrl: "https://two.example" });
    // Something else changes ritaUrl underneath the open dialog.
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, ritaUrl: "https://three.example" } });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText(/replace/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith({ ritaUrl: "https://two.example" });
  });
});
