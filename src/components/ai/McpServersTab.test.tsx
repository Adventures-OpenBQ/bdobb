// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

const discoverMcpTools = vi.fn();
const resetMcpCache = vi.fn();
vi.mock("../../lib/agent/mcp", async () => {
  const actual = await vi.importActual<typeof import("../../lib/agent/mcp")>("../../lib/agent/mcp");
  return {
    ...actual,
    discoverMcpTools: (...a: unknown[]) => discoverMcpTools(...a),
    resetMcpCache: () => resetMcpCache(),
  };
});

import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { __resetLoggerForTests } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import { backend, card, widget } from "../../test/fixtures";
import { __read, __reset } from "../../test/memfs";
import { useBackendsStore } from "../../stores/backendsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useMcpTokensStore } from "../../stores/mcpTokensStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { McpServersTab } from "./McpServersTab";

const realSetToken = useMcpTokensStore.getState().setToken;
const realRemoveToken = useMcpTokensStore.getState().removeToken;
const s1 = { id: "s1", url: "https://mcp.example/mcp", enabled: true };
const s2 = { id: "s2", url: "https://other.example/mcp", enabled: false };
const s3 = {
  id: "s3",
  url: "https://docs.example/mcp",
  enabled: false,
  name: "OpenBB Docs",
  authType: "token" as const,
  source: { kind: "file" as const },
};

function draftServers() {
  return useSettingsStore.getState().draft?.patch.mcpServers;
}
function draftDisabledTools() {
  return useSettingsStore.getState().draft?.patch.mcpDisabledTools;
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s1, s2] }, draft: null });
  // A draft must already be open for stageDraft to do anything -- AILibrary's
  // beginDraft() on mount, reproduced here since this tab is also rendered
  // standalone in these tests.
  useSettingsStore.getState().beginDraft();
  useDashboardStore.setState({ dashboards: [], activeId: null, activeTabIds: {} });
  useWidgetRegistryStore.setState({ widgets: [], apps: [] });
  useMcpTokensStore.setState({ tokens: {}, setToken: realSetToken, removeToken: realRemoveToken });
  useBackendsStore.setState({ backends: [] });
  discoverMcpTools.mockReset();
  resetMcpCache.mockReset();
});

describe("McpServersTab", () => {
  it("lists every server with its enabled state", () => {
    render(<McpServersTab />);
    expect(screen.getByText(new URL(s1.url).host)).toBeInTheDocument();
    expect(screen.getByText(new URL(s2.url).host)).toBeInTheDocument();
    const switches = screen.getAllByRole("switch", { name: "Enabled" });
    expect(switches[0]).toHaveAttribute("aria-checked", "true");
    expect(switches[1]).toHaveAttribute("aria-checked", "false");
  });

  it("shows an imported server's name and provenance", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s3] } });
    render(<McpServersTab />);
    expect(screen.getByText("OpenBB Docs")).toBeInTheDocument();
    expect(screen.getByText("from a file · token")).toBeInTheDocument();
  });

  it("says so when there are none", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    render(<McpServersTab />);
    expect(screen.getByText("No MCP servers yet")).toBeInTheDocument();
  });

  it("adds a server with a fresh id, enabled, and clears the field", async () => {
    render(<McpServersTab />);
    await userEvent.type(screen.getByLabelText("Add MCP server"), " https://third.example/mcp {Enter}");
    await waitFor(() => expect(draftServers()).toHaveLength(3));
    const added = draftServers()![2];
    expect(added.url).toBe("https://third.example/mcp");
    expect(added.enabled).toBe(true);
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByLabelText("Add MCP server")).toHaveValue("");
  });

  // A warning, never a refusal: a loopback or LAN MCP server is legitimate,
  // it just should not arrive unremarked.
  it("warns beside a newly added server on this computer or a private network, and still adds it", async () => {
    render(<McpServersTab />);
    await userEvent.type(screen.getByLabelText("Add MCP server"), "http://127.0.0.1:9000/mcp{Enter}");
    await waitFor(() => expect(useSettingsStore.getState().draft?.patch.mcpServers).toHaveLength(3));
    const card = screen.getByText("http://127.0.0.1:9000/mcp").closest("article");
    expect(card?.querySelector(".bd-notice--warning")).not.toBeNull();
    expect(card).toHaveTextContent("Warning: this server is on this computer or a private network.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["a public server", "https://third.example/mcp"],
    ["a tailnet name", "https://mcp.example.ts.net/mcp"],
    ["a tailnet address", "http://100.100.1.2/mcp"], // scrub-allow: an example tailnet address
  ])("does not warn for %s", async (_, url) => {
    render(<McpServersTab />);
    await userEvent.type(screen.getByLabelText("Add MCP server"), `${url}{Enter}`);
    await waitFor(() => expect(useSettingsStore.getState().draft?.patch.mcpServers).toHaveLength(3));
    expect(screen.queryByText(/private network/)).not.toBeInTheDocument();
  });

  it("rejects a non-http URL inline and stages nothing", async () => {
    render(<McpServersTab />);
    await userEvent.type(screen.getByLabelText("Add MCP server"), "mcp.example");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an http(s) URL.");
    expect(draftServers()).toBeUndefined();
  });

  it("ignores adding a URL already in the list, silently, after safeUrl normalisation", async () => {
    render(<McpServersTab />);
    await userEvent.type(screen.getByLabelText("Add MCP server"), s1.url);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(draftServers()).toBeUndefined();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("toggles one server's enabled flag, leaving the other alone", async () => {
    render(<McpServersTab />);
    await userEvent.click(screen.getAllByRole("switch", { name: "Enabled" })[0]);
    await waitFor(() => expect(draftServers()).toEqual([{ ...s1, enabled: false }, s2]));
  });

  it("removes a server by id", async () => {
    render(<McpServersTab />);
    await userEvent.click(screen.getByRole("button", { name: `Remove ${s1.url}` }));
    await waitFor(() => expect(draftServers()).toEqual([s2]));
  });

  it("Check reports the tool count after asking the server afresh", async () => {
    discoverMcpTools.mockResolvedValue([{ name: "a" }, { name: "b" }, { name: "c" }]);
    render(<McpServersTab />);
    await userEvent.click(screen.getByRole("button", { name: `Check ${s1.url}` }));
    expect(resetMcpCache).toHaveBeenCalledTimes(1);
    // Check goes through withMcpAuth, which supplies a fetchImpl and
    // (empty, for this unauthenticated server) headers alongside the id/url.
    expect(discoverMcpTools).toHaveBeenCalledWith("s1", s1.url, expect.any(Function), {});
    expect(await screen.findByText("3 tools")).toBeInTheDocument();
  });

  it("disables Check while one is already in flight for that server", async () => {
    let resolveDiscovery: (tools: Array<{ name: string }>) => void = () => {};
    discoverMcpTools.mockReturnValue(new Promise((resolve) => (resolveDiscovery = resolve)));
    render(<McpServersTab />);
    const checkButton = screen.getByRole("button", { name: `Check ${s1.url}` });
    await userEvent.click(checkButton);
    expect(checkButton).toBeDisabled();
    await userEvent.click(checkButton);
    expect(discoverMcpTools).toHaveBeenCalledTimes(1);
    resolveDiscovery([{ name: "a" }]);
    await waitFor(() => expect(checkButton).not.toBeDisabled());
  });

  it("Check reports an unreachable server inline", async () => {
    discoverMcpTools.mockRejectedValue(new Error("MCP initialize failed: HTTP 404"));
    render(<McpServersTab />);
    await userEvent.click(screen.getByRole("button", { name: `Check ${s2.url}` }));
    expect(await screen.findByText("Unreachable: MCP initialize failed: HTTP 404")).toBeInTheDocument();
  });

  it("lists a checked server's tools with their size and stages a turned-off tool by normalized URL", async () => {
    discoverMcpTools.mockResolvedValue([
      { server_id: "s1", name: "quote", url: s1.url, endpoint: "", description: "d", input_schema: {} },
      { server_id: "s1", name: "news", url: s1.url, endpoint: "", description: "d", input_schema: {} },
    ]);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s1] } });
    render(<McpServersTab />);
    await userEvent.click(screen.getByRole("button", { name: `Check ${s1.url}` }));
    await userEvent.click(await screen.findByRole("button", { name: `Tools of ${s1.url}` }));
    const quote = screen.getByRole("checkbox", { name: /quote/ });
    expect(quote).toBeChecked();
    expect(screen.getByText(/of 128,000 characters/)).toBeInTheDocument();
    await userEvent.click(quote);
    await waitFor(() => expect(draftDisabledTools()).toEqual({ "https://mcp.example/mcp": ["quote"] }));
  });

  describe("tools called through proxies", () => {
    const seenFor = (names: string[]) =>
      useSettingsStore.setState({
        settings: { ...DEFAULT_SETTINGS, mcpServers: [s1], mcpSeenProxiedTools: { "https://mcp.example/mcp": names } },
      });

    it("lists the effective names seen for this server, each on, and stages an unchecked one in mcpDisabledTools", async () => {
      seenFor(["equity_price_historical", "equity_quote"]);
      render(<McpServersTab />);
      expect(screen.getByText("Tools called through proxies")).toBeInTheDocument();
      expect(screen.getAllByRole("checkbox", { name: /equity_price_historical/ })).toHaveLength(1);
      const box = screen.getByRole("checkbox", { name: /equity_price_historical/ });
      expect(box).toBeChecked();
      await userEvent.click(box);
      await waitFor(() => expect(draftDisabledTools()).toEqual({ "https://mcp.example/mcp": ["equity_price_historical"] }));
      expect(screen.getByRole("checkbox", { name: /equity_price_historical/ })).not.toBeChecked();
    });

    it("accepts a typed name, listing it turned off", async () => {
      render(<McpServersTab />);
      await userEvent.type(screen.getByLabelText(`Proxied tool name for ${s1.url}`), "equity_price_historical");
      await userEvent.click(screen.getByRole("button", { name: `Add proxied tool for ${s1.url}` }));
      await waitFor(() => expect(draftDisabledTools()).toEqual({ "https://mcp.example/mcp": ["equity_price_historical"] }));
      expect(screen.getByRole("checkbox", { name: /equity_price_historical/ })).not.toBeChecked();
      expect(useSettingsStore.getState().draft?.patch.mcpSeenProxiedTools).toEqual({ "https://mcp.example/mcp": ["equity_price_historical"] });
    });

    it("does not show a name twice when it is also advertised", async () => {
      discoverMcpTools.mockResolvedValue([{ server_id: "s1", name: "quote", url: s1.url, endpoint: "", description: "d", input_schema: {} }]);
      seenFor(["quote", "other"]);
      render(<McpServersTab />);
      await userEvent.click(screen.getByRole("button", { name: `Check ${s1.url}` }));
      await userEvent.click(await screen.findByRole("button", { name: `Tools of ${s1.url}` }));
      expect(screen.getAllByRole("checkbox", { name: /quote/ })).toHaveLength(1);
      expect(screen.getByRole("checkbox", { name: /other/ })).toBeInTheDocument();
    });

    it("Done persists the staged name and Cancel discards it", async () => {
      seenFor(["equity_quote"]);
      render(<McpServersTab />);
      await userEvent.click(screen.getByRole("checkbox", { name: /equity_quote/ }));
      await expect(useSettingsStore.getState().commitDraft()).resolves.toEqual({ ok: true });
      expect(useSettingsStore.getState().settings.mcpDisabledTools).toEqual({ "https://mcp.example/mcp": ["equity_quote"] });
      useSettingsStore.getState().beginDraft();
      await userEvent.click(screen.getByRole("checkbox", { name: /equity_quote/ }));
      useSettingsStore.getState().discardDraft();
      expect(useSettingsStore.getState().settings.mcpDisabledTools).toEqual({ "https://mcp.example/mcp": ["equity_quote"] });
    });
  });

  it("lists the active dashboard's widget-derived servers under From this dashboard, only with Context Sharing on", () => {
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "app", backendId: "b", type: "iframe", mcpUrl: "http://localhost:7769/mcp" })],
    });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [card({ id: "c1", backendId: "b", widgetId: "app" })] }],
        },
      ],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s1, s2], contextSharing: true } });
    const { unmount } = render(<McpServersTab />);
    expect(screen.getByRole("heading", { name: "From this dashboard" })).toBeInTheDocument();
    expect(screen.getByText("http://localhost:7769/mcp")).toBeInTheDocument();
    unmount();

    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s1, s2], contextSharing: false } });
    render(<McpServersTab />);
    expect(screen.queryByRole("heading", { name: "From this dashboard" })).toBeNull();
  });

  it("gives a widget-derived row a working Check, Tools expander, and ToolList that stages under its URL", async () => {
    const dashboardUrl = "http://localhost:7769/mcp";
    discoverMcpTools.mockResolvedValue([
      { server_id: dashboardUrl, name: "quote", url: dashboardUrl, endpoint: "", description: "d", input_schema: {} },
    ]);
    useWidgetRegistryStore.setState({
      widgets: [widget({ id: "app", backendId: "b", type: "iframe", mcpUrl: dashboardUrl })],
    });
    useDashboardStore.setState({
      dashboards: [
        {
          id: "d1",
          name: "D",
          tabs: [{ id: "t1", name: "Main", cards: [card({ id: "c1", backendId: "b", widgetId: "app" })] }],
        },
      ],
      activeId: "d1",
      activeTabIds: { d1: "t1" },
    });
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [], contextSharing: true } });
    render(<McpServersTab />);

    await userEvent.click(screen.getByRole("button", { name: `Check ${dashboardUrl}` }));
    expect(discoverMcpTools).toHaveBeenCalledWith(dashboardUrl, dashboardUrl, expect.any(Function), {});
    await userEvent.click(await screen.findByRole("button", { name: `Tools of ${dashboardUrl}` }));
    const quote = screen.getByRole("checkbox", { name: /quote/ });
    expect(quote).toBeChecked();
    await userEvent.click(quote);
    await waitFor(() => expect(draftDisabledTools()).toEqual({ [dashboardUrl]: ["quote"] }));
    // No enable switch or Remove for a widget-owned row.
    expect(screen.queryByRole("switch", { name: "Enabled" })).toBeNull();
    expect(screen.queryByRole("button", { name: `Remove ${dashboardUrl}` })).toBeNull();
  });

  it("asks for a token until one is saved, then offers Replace and Forget", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s3] } });
    render(<McpServersTab />);
    expect(screen.getByText("Token required")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(`Token for ${s3.url}`), "secret");
    await userEvent.click(screen.getByRole("button", { name: `Save token for ${s3.url}` }));
    await waitFor(() => expect(useMcpTokensStore.getState().tokens).toEqual({ "https://docs.example/mcp": { token: "secret" } }));
    expect(screen.getByText("Token saved")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `Forget token for ${s3.url}` }));
    await waitFor(() => expect(useMcpTokensStore.getState().tokens).toEqual({}));
  });

  it("Replace shows the token input again", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s3] } });
    useMcpTokensStore.setState({ tokens: { "https://docs.example/mcp": { token: "secret" } } });
    render(<McpServersTab />);
    expect(screen.queryByLabelText(`Token for ${s3.url}`)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: `Replace token for ${s3.url}` }));
    expect(screen.getByLabelText(`Token for ${s3.url}`)).toBeInTheDocument();
  });

  // final review T8c: a failed token save or forget was silent.
  it("logs a failed token save, never the token", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s3] } });
    useMcpTokensStore.setState({
      setToken: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    render(<McpServersTab />);
    await userEvent.type(screen.getByLabelText(`Token for ${s3.url}`), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: `Save token for ${s3.url}` }));
    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("disk full");
    });
    expect(__read("logs/bdobb.log")).not.toContain("hunter2");
  });

  // Change A: a backend's credential is withheld from a different host by
  // default -- a label used to be the only guard (final review M1); now the
  // MCP tab shows the withheld state and a per-server switch to allow it.
  it("shows a cross-host credential as withheld, with a switch to allow it", async () => {
    useBackendsStore.setState({
      backends: [backend({ id: "b1", name: "NAS", baseUrl: "https://nas.example:6900", headerName: "Authorization", headerValue: "Basic abc" })],
    });
    const away = { id: "a", url: "https://mcp.other.example/mcp", enabled: false, authType: "token" as const, source: { kind: "backend" as const, backendId: "b1" } };
    const home = { id: "h", url: "https://nas.example:6900/mcp", enabled: false, authType: "token" as const, source: { kind: "backend" as const, backendId: "b1" } };
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [away, home] } });
    render(<McpServersTab />);

    // Withheld by default; the same-hostname server ("home") gets no label at all.
    expect(screen.getByText("NAS's credential is not sent to mcp.other.example")).toBeInTheDocument();
    expect(screen.queryByText(/credential.*to nas\.example/)).toBeNull();
    expect(screen.getAllByText(/'s credential/)).toHaveLength(1);

    const toggle = screen.getByRole("switch", { name: "Send NAS's credential to mcp.other.example" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    await waitFor(() => expect(draftServers()?.find((s) => s.id === "a")?.allowCrossHost).toBe(true));
    expect(screen.getByText("sends NAS's credential to mcp.other.example")).toBeInTheDocument();
    // A credential decision changed: the next Check/turn must re-discover.
    expect(resetMcpCache).toHaveBeenCalled();
  });

  // Review U7: Remove is staged; AI Library's Done forgets the token (see
  // AILibrary.test.tsx), so Cancel restores the server with its token.
  it("removing a server stages the removal and leaves its token alone", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [s3] } });
    useMcpTokensStore.setState({ tokens: { "https://docs.example/mcp": { token: "secret" } } });
    render(<McpServersTab />);
    await userEvent.click(screen.getByRole("button", { name: `Remove ${s3.url}` }));
    await waitFor(() => expect(draftServers()).toEqual([]));
    expect(useMcpTokensStore.getState().tokens).toEqual({ "https://docs.example/mcp": { token: "secret" } });
  });

  // Change A: a backend's credential is withheld when it uses cookie auth --
  // cookies can never be forwarded to an MCP server (mcpAuthFor refuses them),
  // so a cross-host cookie backend shows neither the switch nor any text.
  it("hides cross-host decision for a cookie-auth backend", () => {
    useBackendsStore.setState({
      backends: [
        backend({
          id: "b1",
          name: "CookieBackend",
          baseUrl: "https://cookie.example",
          headerName: "Cookie",
          headerValue: "session=abc",
          authLocation: "cookie",
        }),
      ],
    });
    const cookieServer = {
      id: "c",
      url: "https://mcp.other.example/mcp",
      enabled: false,
      authType: "token" as const,
      source: { kind: "backend" as const, backendId: "b1" },
    };
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, mcpServers: [cookieServer] } });
    render(<McpServersTab />);

    // No credential message at all, and no switch, because the credential can never be sent.
    expect(screen.queryByText(/credential/)).toBeNull();
    expect(screen.queryByRole("switch", { name: /Send.*credential/ })).toBeNull();
  });
});
