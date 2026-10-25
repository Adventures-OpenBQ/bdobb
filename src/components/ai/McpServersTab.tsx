// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useId, useState } from "react";
import { dashboardMcpUrls } from "../../lib/agent/dashboardMcp";
import { discoverMcpTools, normalizeMcpUrl, resetMcpCache, TOOL_PAYLOAD_BUDGET_CHARS } from "../../lib/agent/mcp";
import { hostnameOf, mcpAuthFor, withMcpAuth } from "../../lib/agent/mcpAuth";
import { mergeSeenTools } from "../../lib/agent/proxiedTools";
import type { AgentTool, McpServerConfig } from "../../lib/agent/types";
import { logError } from "../../lib/logger";
import { isPrivateHost } from "../../lib/privateHost";
import { keyMaintBackendIds } from "../../lib/providerKeys";
import { safeUrl } from "../../lib/safeUrl";
import type { BackendConfig } from "../../lib/types";
import { useBackendsStore } from "../../stores/backendsStore";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useMcpTokensStore } from "../../stores/mcpTokensStore";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { Switch } from "../dialogs/SettingsDialog";
import { ServiceCard } from "../services/ServiceCard";
import { ServiceStatus } from "../services/ServiceStatus";

/** Per-row Check result, keyed by server id (a Settings row) or URL (a widget-derived row). Absent means never checked. */
type Checks = Record<string, string>;

/**
 * final review T8c: a token save or forget that fails used to be silent. The
 * store's own error (a file write) is logged -- never the token itself.
 */
function logTokenFailure(err: unknown): void {
  void logError(`failed to save MCP tokens: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Change A: a backend-sourced "token" server whose host differs from its
 * backend's no longer sends that backend's credential by default (mcpAuth.ts
 * refuses it) -- this is the row's view of that same decision, so the user
 * can see it and, per server, allow it. Null when there is nothing to decide
 * (no credential configured on the backend, the backend gone, the hosts
 * already match, or the backend uses cookie auth which can never be forwarded).
 */
function crossHostInfo(server: McpServerConfig, allBackends: BackendConfig[]): { hostname: string; backendName: string; allowed: boolean } | null {
  const source = server.source;
  if (server.authType !== "token" || source?.kind !== "backend") return null;
  const b = allBackends.find((x) => x.id === source.backendId);
  if (!b || !b.headerName || !b.headerValue) return null;
  if (b.authLocation === "cookie") return null;
  const mcpHostname = hostnameOf(server.url);
  const backendHostname = hostnameOf(b.baseUrl);
  if (mcpHostname === null || backendHostname === null || mcpHostname === backendHostname) return null;
  return { hostname: mcpHostname, backendName: b.name, allowed: server.allowCrossHost === true };
}

/** Turns one of a server's tools off, or back on, in the settings draft. */
function toggleDisabled(url: string, name: string): void {
  const state = useSettingsStore.getState();
  const all = selectEffective(state).mcpDisabledTools;
  const current = all[url] ?? [];
  state.stageDraft({ mcpDisabledTools: { ...all, [url]: current.includes(name) ? current.filter((n) => n !== name) : [...current, name] } });
}

/** One server's tools, each a checkbox; unchecked means "not offered to Rita". */
function ToolList({ url, tools }: { url: string; tools: AgentTool[] }) {
  const disabled = useSettingsStore((s) => selectEffective(s).mcpDisabledTools[url]) ?? [];
  const size = (t: AgentTool) => JSON.stringify(t).length;
  const used = tools.filter((t) => !disabled.includes(t.name)).reduce((n, t) => n + size(t), 0);
  return (
    <div>
      <p className="bd-muted" role="status">
        {`${used.toLocaleString()} of ${TOOL_PAYLOAD_BUDGET_CHARS.toLocaleString()} characters`}
      </p>
      <ul>
        {tools.map((t) => (
          <li key={t.name}>
            <label>
              <input type="checkbox" checked={!disabled.includes(t.name)} onChange={() => toggleDisabled(url, t.name)} />
              {` ${t.name}`} <span className="bd-muted">{`${size(t).toLocaleString()} characters`}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The tool names this profile has called through the server's proxies
 * (call_tool, run_pipeline), each a checkbox like the advertised list above,
 * and a field for a name that has not been called yet. Unchecked means
 * refused before anything is sent; the switch is the same mcpDisabledTools
 * entry the advertised list writes.
 */
function ProxiedToolList({ url, label, hide }: { url: string; label: string; hide: ReadonlySet<string> }) {
  const seen = useSettingsStore((s) => selectEffective(s).mcpSeenProxiedTools[url]) ?? [];
  const disabled = useSettingsStore((s) => selectEffective(s).mcpDisabledTools[url]) ?? [];
  const stage = useSettingsStore((s) => s.stageDraft);
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const shown = seen.filter((n) => !hide.has(n));
  function add() {
    const name = typed.trim();
    if (name === "") return;
    const state = selectEffective(useSettingsStore.getState());
    const off = state.mcpDisabledTools[url] ?? [];
    // Listed (so it can be turned back on) and turned off.
    stage({
      mcpSeenProxiedTools: { ...state.mcpSeenProxiedTools, [url]: mergeSeenTools(state.mcpSeenProxiedTools[url] ?? [], [name]) },
      mcpDisabledTools: { ...state.mcpDisabledTools, [url]: off.includes(name) ? off : [...off, name] },
    });
    setTyped("");
  }
  return (
    <div>
      <h5>Tools called through proxies</h5>
      <p className="bd-muted">
        {"This server runs most tools through call_tool and run_pipeline. Uncheck one to refuse it before anything is sent."}
      </p>
      {shown.length === 0 ? <p className="bd-muted">None called yet. Type a name to turn one off ahead of time.</p> : null}
      <ul>
        {shown.map((name) => (
          <li key={name}>
            <label>
              <input type="checkbox" checked={!disabled.includes(name)} onChange={() => toggleDisabled(url, name)} />
              {` ${name}`}
            </label>
          </li>
        ))}
      </ul>
      <div className="bd-inline">
        <input
          id={inputId}
          className="bd-input"
          aria-label={`Proxied tool name for ${label}`}
          placeholder="tool name"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="bd-button bd-button--ghost" aria-label={`Add proxied tool for ${label}`} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * A "token" server with nowhere else to get its credential (a file import,
 * or a backend-sourced one whose backend is gone): the user pastes it here,
 * it lands in mcpTokens.json (never settings.json, never exported), and
 * withMcpAuth refuses to even connect until one exists.
 */
function TokenRow({ url }: { url: string }) {
  const stored = useMcpTokensStore((s) => s.tokens[normalizeMcpUrl(url)]);
  const [draft, setDraft] = useState("");
  const [replacing, setReplacing] = useState(false);

  function save() {
    const value = draft.trim();
    if (value === "") return;
    void useMcpTokensStore.getState().setToken(url, value).catch(logTokenFailure);
    setDraft("");
    setReplacing(false);
  }

  if (stored && !replacing) {
    return (
      <span className="bd-inline">
        <ServiceStatus state="unavailable" text="Token saved" />
        <button type="button" className="bd-button bd-button--ghost" aria-label={`Replace token for ${url}`} onClick={() => setReplacing(true)}>
          Replace
        </button>
        <button
          type="button"
          className="bd-button bd-button--danger"
          aria-label={`Forget token for ${url}`}
          onClick={() => void useMcpTokensStore.getState().removeToken(url).catch(logTokenFailure)}
        >
          Forget
        </button>
      </span>
    );
  }

  return (
    <span className="bd-inline">
      <ServiceStatus state="unavailable" text="Token required" />
      <input
        className="bd-input"
        type="password"
        aria-label={`Token for ${url}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
      />
      <button type="button" className="bd-button bd-button--primary" aria-label={`Save token for ${url}`} onClick={save}>
        Save
      </button>
    </span>
  );
}

export function McpServersTab() {
  // Read the settings this dialog session would apply -- the committed
  // settings with any staged patch laid over them -- so an edit staged
  // earlier in the same Done/Cancel transaction is reflected immediately.
  const servers = useSettingsStore((s) => selectEffective(s).mcpServers);
  const contextSharing = useSettingsStore((s) => selectEffective(s).contextSharing);
  const stage = useSettingsStore((s) => s.stageDraft);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Checks>({});
  // The id of the server just added, when it points at this computer or a
  // private network; its row carries the warning.
  const [localWarningId, setLocalWarningId] = useState<string | null>(null);
  // Both keyed by normalizeMcpUrl(url), so a Settings row and its
  // widget-derived counterpart (same server, reached from different groups)
  // share one Check result rather than each re-discovering it separately.
  const [tools, setTools] = useState<Record<string, AgentTool[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const addId = useId();
  const fromId = useId();

  // Selected as the store's own (referentially stable) fields, not via a
  // method call that would build a fresh array every render -- that would
  // make useSyncExternalStore see a "changed" snapshot on every render and
  // loop forever.
  const dashboards = useDashboardStore((s) => s.dashboards);
  const activeId = useDashboardStore((s) => s.activeId);
  const findWidget = useWidgetRegistryStore((s) => s.find);
  const backends = useBackendsStore((s) => s.backends);
  // Falls back to the id itself: a backend named here may since have been
  // removed from Connections, and the server row still has SOMETHING to show.
  const backendName = (backendId: string) => backends.find((b) => b.id === backendId)?.name ?? backendId;
  const activeCards = dashboards.find((d) => d.id === activeId)?.tabs.flatMap((t) => t.cards) ?? [];
  const widgets = useWidgetRegistryStore((s) => s.widgets);
  const dashboardUrls = dashboardMcpUrls(activeCards, findWidget, keyMaintBackendIds(widgets));

  // Stages the edit into the settings draft rather than saving it straight
  // to disk -- Cancel can still discard it, and Done writes every tab's
  // changes together.
  function update(next: McpServerConfig[]) {
    stage({ mcpServers: next });
  }

  // Read fresh rather than closing over the `servers` render snapshot: a
  // second edit fired before the first one's stage has landed in the store
  // (and re-rendered this component) must still see the first edit, the same
  // reason DropZone.tsx and LeftRail.tsx read getState() at call time.
  function currentServers(): McpServerConfig[] {
    return selectEffective(useSettingsStore.getState()).mcpServers;
  }

  function add() {
    const url = draft.trim();
    const safe = safeUrl(url);
    if (safe === null) {
      setError("Enter an http(s) URL.");
      return;
    }
    setError(null);
    setDraft("");
    const current = currentServers();
    // Silently ignored: a URL already in the list (after safeUrl
    // normalisation) is not an error, just a no-op.
    if (current.some((s) => safeUrl(s.url) === safe)) return;
    const id = crypto.randomUUID();
    // Warned, never refused: a server on this machine or the LAN is a
    // legitimate choice, but it reaches places a public one cannot. Only the
    // entry just added carries it; the existing list was already seen.
    setLocalWarningId(isPrivateHost(new URL(safe).hostname) ? id : null);
    update([...current, { id, url, enabled: true }]);
  }

  /**
   * Shared by a Settings row (id is the server's own id, server is its
   * Settings entry so a "token" server's Check carries its credential) and a
   * widget-derived row (id is its URL, since it has no Settings entry --
   * server is undefined, so withMcpAuth sends nothing).
   */
  async function check(id: string, url: string, server?: McpServerConfig) {
    // Guards re-entry: a Check already in flight for this id disables its
    // own button (below), so this only guards a re-entrant call.
    if (checks[id] === "Checking…") return;
    setChecks((c) => ({ ...c, [id]: "Checking…" }));
    // discoverMcpTools memoizes per URL; a Check exists to ask again.
    resetMcpCache();
    try {
      const list = await withMcpAuth(
        server,
        url,
        {
          backends,
          tokens: useMcpTokensStore.getState().tokens,
          onTokenRejected: (u) => void useMcpTokensStore.getState().removeToken(u).catch(logTokenFailure),
        },
        (t) => discoverMcpTools(id, t.url, t.fetchImpl, t.headers),
      );
      setChecks((c) => ({ ...c, [id]: `${list.length} tools` }));
      setTools((t) => ({ ...t, [normalizeMcpUrl(url)]: list }));
    } catch (err: unknown) {
      // An McpError (needs_token, auth, http_401, …) carries the same clear
      // message the chat path would show; it lands here as plain text too.
      const message = err instanceof Error ? err.message : String(err);
      setChecks((c) => ({ ...c, [id]: `Unreachable: ${message}` }));
    }
  }

  /**
   * The user's own per-server override for Change A's cross-host block. Same
   * stage path as the Enabled switch; a discovery cached under the old
   * decision is stale now, the same reason a token change resets it.
   */
  function toggleAllowCrossHost(serverId: string) {
    update(currentServers().map((s) => (s.id === serverId ? { ...s, allowCrossHost: !(s.allowCrossHost === true) } : s)));
    resetMcpCache();
  }

  /** The Tools toggle and its list, keyed by the normalized url; `label` names the server in the button's label. */
  function toolsToggle(url: string, label: string) {
    return (
      <>
        {tools[url] ? (
          <button
            type="button"
            className="bd-button bd-button--ghost"
            aria-label={`Tools of ${label}`}
            aria-expanded={open[url] === true}
            onClick={() => setOpen((o) => ({ ...o, [url]: !o[url] }))}
          >
            Tools
          </button>
        ) : null}
        {open[url] && tools[url] ? <ToolList url={url} tools={tools[url]} /> : null}
        <ProxiedToolList
          url={url}
          label={label}
          hide={new Set(open[url] && tools[url] ? tools[url].map((t) => t.name) : [])}
        />
      </>
    );
  }

  function statusFor(id: string): { state: "unchecked" | "checking" | "online" | "offline"; text?: string } {
    const result = checks[id];
    if (result === undefined) return { state: "unchecked" };
    if (result === "Checking…") return { state: "checking" };
    if (result.startsWith("Unreachable:")) return { state: "offline", text: result };
    return { state: "online", text: result };
  }

  return (
    <>
      <div className="bd-section-heading">
        <h3>MCP servers</h3>
        <p className="bd-muted">External tool services available to Rita.</p>
      </div>

      {servers.length === 0 ? (
        <div className="bd-empty">
          <h4>No MCP servers yet</h4>
          <p className="bd-muted">Add an endpoint to make its tools available to Rita.</p>
        </div>
      ) : (
        <div className="bd-service-list">
          {servers.map((server) => {
            const url = normalizeMcpUrl(server.url);
            const crossHost = crossHostInfo(server, backends);
            const status = statusFor(server.id);
            const provenance = [
              server.source?.kind === "file"
                ? "from a file"
                : server.source?.kind === "backend"
                  ? `from ${backendName(server.source.backendId)}`
                  : null,
              server.authType ?? null,
            ]
              .filter(Boolean)
              .join(" · ");

            // Every server in the list has already passed safeUrl once (on
            // add) or come from an import that validated it, so this can't
            // fail in practice.
            const host = new URL(safeUrl(server.url)!).host;
            return (
              <ServiceCard
                key={server.id}
                mark="MCP"
                name={server.name ?? host}
                kind="Tool service"
                ariaLabel={server.name ?? host}
                status={<ServiceStatus state={status.state} text={status.text} live />}
                endpoint={{ label: "Endpoint", value: <code>{server.url}</code> }}
                actions={
                  <>
                    <button
                      type="button"
                      className="bd-button bd-button--ghost"
                      aria-label={`Check ${server.url}`}
                      disabled={checks[server.id] === "Checking…"}
                      onClick={() => void check(server.id, server.url, server)}
                    >
                      Check
                    </button>
                    <button
                      type="button"
                      className="bd-button bd-button--danger"
                      aria-label={`Remove ${server.url}`}
                      // Staged only: AI Library's Done forgets the token once
                      // the removal is committed and no row keeps its URL.
                      onClick={() => update(currentServers().filter((s) => s.id !== server.id))}
                    >
                      Remove
                    </button>
                  </>
                }
                detail={
                  <>
                    {provenance !== "" ? <p className="bd-muted">{provenance}</p> : null}
                    <div className="bd-row bd-row--switch">
                      <div className="bd-row-copy">
                        <div className="bd-row-title">Enabled</div>
                      </div>
                      <Switch
                        label="Enabled"
                        checked={server.enabled}
                        onChange={() => update(currentServers().map((s) => (s.id === server.id ? { ...s, enabled: !s.enabled } : s)))}
                      />
                    </div>
                    {server.id === localWarningId ? (
                      <p className="bd-notice bd-notice--warning">
                        Warning: this server is on this computer or a private network.
                      </p>
                    ) : null}
                    {crossHost !== null ? (
                      <div className="bd-row bd-row--switch">
                        <div className="bd-row-copy">
                          <p className="bd-muted">
                            {crossHost.allowed
                              ? `sends ${crossHost.backendName}'s credential to ${crossHost.hostname}`
                              : `${crossHost.backendName}'s credential is not sent to ${crossHost.hostname}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="bd-switch"
                          role="switch"
                          aria-checked={crossHost.allowed}
                          aria-label={`Send ${crossHost.backendName}'s credential to ${crossHost.hostname}`}
                          onClick={() => toggleAllowCrossHost(server.id)}
                        >
                          Send credential anyway
                        </button>
                      </div>
                    ) : null}
                    {/* A "token" server the user must paste a credential for -- not one whose backend already supplies it. */}
                    {mcpAuthFor(server, backends, {}).kind === "needs-token" ? <TokenRow url={server.url} /> : null}
                    {toolsToggle(url, server.url)}
                  </>
                }
              />
            );
          })}
        </div>
      )}

      <label htmlFor={addId}>Add MCP server</label>
      <div className="bd-inline">
        <input
          id={addId}
          className="bd-input"
          type="url"
          value={draft}
          placeholder="https://mcp.example/mcp"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="bd-button bd-button--primary" onClick={add}>
          Add
        </button>
      </div>
      {error !== null ? (
        <p className="bd-notice bd-notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {contextSharing && dashboardUrls.length > 0 ? (
        <section aria-labelledby={fromId}>
          <h4 id={fromId}>From this dashboard</h4>
          <p className="bd-muted">Servers named by widgets on this dashboard. Offered to Rita while Context Sharing is on.</p>
          <div className="bd-service-list">
            {dashboardUrls.map((url) => {
              const status = statusFor(url);
              return (
                <ServiceCard
                  key={url}
                  mark="MCP"
                  name={url}
                  kind="Dashboard-derived"
                  ariaLabel={url}
                  status={<ServiceStatus state={status.state} text={status.text} live />}
                  actions={
                    <button
                      type="button"
                      className="bd-button bd-button--ghost"
                      aria-label={`Check ${url}`}
                      disabled={checks[url] === "Checking…"}
                      onClick={() => void check(url, url)}
                    >
                      Check
                    </button>
                  }
                  detail={
                    toolsToggle(url, url)
                  }
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}
