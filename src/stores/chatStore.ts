// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { dashboardMcpUrls } from "../lib/agent/dashboardMcp";
import { buildWidgetRefs, executeFunction, makeWidgetDataFetcher, runAgentTool, type ToolRequest } from "../lib/agent/execute";
import { LOCAL_TOOLS, forgetRitaCards } from "../lib/agent/localTools";
import { assembleTools, callMcpTool, discoverMcpTools } from "../lib/agent/mcp";
import { withMcpAuth } from "../lib/agent/mcpAuth";
import { PROXY_TOOLS, displayToolName, mergeSeenTools } from "../lib/agent/proxiedTools";
import { runAgentQuery } from "../lib/agent/query";
import { dashboardContext } from "../lib/agent/request";
import { forcedSkills, skillsCatalog } from "../lib/agent/skills";
import type { AgentCall, AgentMessage, AgentStatus, ClientArtifact, McpServerConfig } from "../lib/agent/types";
import type { Dashboard } from "../lib/types";
import { pickAgent, workspaceOptionsFor } from "../lib/agent/workspaceOptions";
import { clearChat, loadChat, saveChat } from "../lib/chatFile";
import { cardRequestSync } from "../hooks/useCardRequest";
import { armedRequestOf } from "../hooks/useWidgetData";
import { isRecord } from "../lib/isRecord";
import { logError, logOnce } from "../lib/logger";
import { keyMaintBackendIds } from "../lib/providerKeys";
import { useAgentDiscoveryStore } from "./agentDiscoveryStore";
import { useBackendsStore } from "./backendsStore";
import { useDashboardStore } from "./dashboardStore";
import { useMcpTokensStore } from "./mcpTokensStore";
import { useSettingsStore } from "./settingsStore";
import { useSkillsStore } from "./skillsStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

/** Artifacts are kept as their own ai message so text and artifacts interleave in arrival order. */
export type ArtifactMessage = { role: "ai"; content: ClientArtifact[] };
export type ChatMessage = AgentMessage | ArtifactMessage;

export function isClientArtifact(v: unknown): v is ClientArtifact {
  return isRecord(v) && typeof v.type === "string" && typeof v.uuid === "string" && "content" in v;
}

export function isArtifactMessage(m: ChatMessage): m is ArtifactMessage {
  return m.role === "ai" && Array.isArray(m.content) && m.content.every(isClientArtifact);
}

export function isAgentCall(v: unknown): v is AgentCall {
  return isRecord(v) && (v.kind === "widget_data" || v.kind === "agent_tool");
}

/** A readable name for the tool-error line: the Settings entry's own `name` if it has one, else the server's host, from its Settings entry or its own URL id. */
export function mcpServerLabel(serverId: string, servers: McpServerConfig[]): string {
  const server = servers.find((s) => s.id === serverId);
  if (server?.name) return server.name;
  const url = server?.url ?? serverId;
  try {
    return new URL(url).host;
  } catch {
    return serverId;
  }
}

/**
 * A status step naming a tool call carries the call's effective label
 * (`display`), so a proxied call reads as what it runs, not as `call_tool`.
 */
function withDisplay(status: AgentStatus, servers: McpServerConfig[]): AgentStatus {
  const step = status.tool_call;
  if (!isRecord(step) || typeof step.server_id !== "string" || typeof step.tool_name !== "string") return status;
  if (!(PROXY_TOOLS as readonly string[]).includes(step.tool_name)) return status;
  return { ...status, tool_call: { ...step, display: displayToolName(mcpServerLabel(step.server_id, servers), step.tool_name, step.input) } };
}

/**
 * Live agent-rita (0011) sends a step's tool_call without its server_id; the
 * copilotFunctionCall right after it names the server. That call labels the
 * latest unlabelled step for the same proxy tool (#37), and returns it.
 */
function labelProxiedStep(trail: AgentStatus[], payload: Record<string, unknown>, servers: McpServerConfig[]): AgentStatus | undefined {
  const args = payload.input_arguments;
  if (payload.function !== "execute_agent_tool" || !isRecord(args) || typeof args.server_id !== "string") return;
  if (!(PROXY_TOOLS as readonly string[]).includes(String(args.tool_name))) return;
  for (let i = trail.length - 1; i >= 0; i--) {
    const step = trail[i].tool_call;
    if (!isRecord(step) || step.tool_name !== args.tool_name || step.server_id !== undefined || step.display !== undefined) continue;
    trail[i] = withDisplay({ ...trail[i], tool_call: { ...step, server_id: args.server_id } }, servers);
    return trail[i];
  }
}

// Writes are chained: two proxied calls finishing together must not both
// merge into the same stale snapshot and drop one name.
let seenWrites: Promise<void> = Promise.resolve();

/** Remembers the effective names a server was called with, for the AI Library's per-tool list. Writes only when a name is new. */
function recordSeenProxiedTools(url: string, names: string[]): void {
  seenWrites = seenWrites.then(async () => {
    const all = useSettingsStore.getState().settings.mcpSeenProxiedTools;
    const current = all[url] ?? [];
    const next = mergeSeenTools(current, names);
    if (next.length === current.length && next.every((n, i) => n === current[i])) return;
    await useSettingsStore.getState().save({ mcpSeenProxiedTools: { ...all, [url]: next } });
  }).catch((err: unknown) => void logError(`failed to record proxied tool names: ${err instanceof Error ? err.message : String(err)}`));
}

function suggestionText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (!isRecord(v)) return null;
  const text = v.prompt ?? v.text ?? v.label;
  return typeof text === "string" ? text : null;
}

/** An external MCP tool call waiting on the user's Run or Deny. */
export type PendingTool = ToolRequest;

type ChatState = {
  messages: ChatMessage[];
  calls: AgentCall[];
  trail: AgentStatus[];
  citations: Record<string, unknown>[];
  suggestions: string[];
  running: boolean;
  error: string | null;
  hasUnread: boolean;
  paneOpen: boolean;
  pinned: boolean;
  /**
   * Cards the user shared with Rita for this conversation, sent as
   * widgets.primary ("added to context"). Saved with the transcript; Clear
   * empties it.
   */
  sharedCardIds: string[];
  /**
   * A sendToAgent click's text, waiting for ChatPane to put it in the draft.
   * Never sent by itself: the row's values are the user's to read and send.
   */
  pendingMessage: string | null;
  /** An external MCP tool call waiting on Run or Deny in the Rita pane. */
  pendingTool: PendingTool | null;
  load: () => Promise<void>;
  send: (text: string) => Promise<void>;
  abort: () => void;
  /** Run (true) or Deny (false) the pending tool call; a no-op once settled. */
  resolveTool: (run: boolean) => void;
  clear: () => Promise<void>;
  setPaneOpen: (open: boolean) => void;
  togglePinned: () => void;
  toggleShared: (cardId: string) => void;
  pushUserMessage: (m: { text: string; agentId?: string }) => void;
};

let controller: AbortController | null = null;
let turnSeq = 0;
let settlePending: ((run: boolean) => void) | null = null;

const turnGroups = (d: Dashboard | undefined) => ({ groups: d?.groups, groupsDisabled: d?.groupsDisabled === true });

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  calls: [],
  trail: [],
  citations: [],
  suggestions: [],
  running: false,
  error: null,
  hasUnread: false,
  paneOpen: false,
  pinned: false,
  sharedCardIds: [],
  pendingMessage: null,
  pendingTool: null,

  load: async () => {
    const saved = await loadChat();
    const ids = saved.sharedCardIds;
    set({
      messages: saved.messages,
      calls: (saved.calls ?? []).filter(isAgentCall),
      sharedCardIds: Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : [],
    });
  },

  send: async (text) => {
    if (get().running) return;
    const myTurn = ++turnSeq;
    const live = () => myTurn === turnSeq;
    const settings = useSettingsStore.getState().settings;
    // Read once per turn: the catalogue Rita sees and the bodies the typed
    // text forced. Every function round of this turn re-POSTs the same two.
    const skills = useSkillsStore.getState().skills;
    const catalog = skillsCatalog(skills);
    const selectedSkills = forcedSkills(text, skills);
    const prior = get().messages;
    const human: AgentMessage = { role: "human", content: text };
    // Artifact messages are a client-side rendering; Rita never sent them as messages.
    const outgoing: AgentMessage[] = [...prior.filter((m): m is AgentMessage => !isArtifactMessage(m)), human];
    const turn: ChatMessage[] = [];
    const trail: AgentStatus[] = [];
    const calls: AgentCall[] = [];
    const seen = new Set<string>();
    const show = () => {
      if (!live()) return;
      set({ messages: [...prior, human, ...turn], trail: [...trail] });
    };
    const noticed = () => {
      if (!get().paneOpen) set({ hasUnread: true });
    };
    const addArtifacts = (items: unknown) => {
      const fresh = (Array.isArray(items) ? items : []).filter(isClientArtifact).filter((a) => !seen.has(a.uuid));
      if (fresh.length === 0) return;
      for (const a of fresh) seen.add(a.uuid);
      turn.push({ role: "ai", content: fresh });
      noticed();
    };

    // Nothing known (or only a failure) for this Rita URL: start agents.json
    // discovery now, WITHOUT awaiting it -- send never waits on it (B1). It
    // may still land while the tools are assembled below, in which case this
    // very message carries the options; if not, the next one does.
    if (settings.ritaUrl !== "") void useAgentDiscoveryStore.getState().discover(settings.ritaUrl);

    // This turn's own controller, kept locally too: the finally below asks
    // whether THIS turn was stopped, after the shared one is already null.
    const mine = new AbortController();
    controller = mine;
    set({ running: true, error: null, citations: [], suggestions: [], trail: [], messages: [...prior, human] });
    try {
      const turnDashboardId = useDashboardStore.getState().activeId;
      const cards = useDashboardStore.getState().activeDashboard()?.tabs.flatMap((t) => t.cards) ?? [];
      // The turn's dashboard as it is NOW: Rita's own edits this turn (and
      // cards she added) must reach the fetcher and the refreshed context.
      const liveDashboard = () => useDashboardStore.getState().dashboards.find((d) => d.id === turnDashboardId);
      const backends = useBackendsStore.getState().backends;
      const findWidget = useWidgetRegistryStore.getState().find;
      // Which backends serve key-maint: every widget on one is off limits to
      // the agent (isAgentOffLimits), so the refs, the fetcher and the MCP
      // union all read the same set for this turn. The fetcher alone reads it live (below).
      const keyMaintBackends = keyMaintBackendIds(useWidgetRegistryStore.getState().widgets);

      // v6's privacy rule: a card's MCP server is dashboard context just as
      // much as its widget ref is, so it is contacted only with sharing on.
      const dashboardMcp = settings.contextSharing ? dashboardMcpUrls(cards, findWidget, keyMaintBackends) : [];
      // What credential (if any) an MCP request carries, and how it travels --
      // shared by discovery below and by the tool-call wrapper further down,
      // so both go through the same withMcpAuth deps for this turn.
      const authDeps = {
        backends,
        // Read at each use, not once per turn (final review T8b): a token
        // forgotten after a 401 earlier in this turn -- discovery, or an
        // earlier call -- must not be sent again by a later call.
        get tokens() {
          return useMcpTokensStore.getState().tokens;
        },
        onTokenRejected: (url: string) => void useMcpTokensStore.getState().removeToken(url),
      };
      const assembled = await assembleTools(settings.mcpServers, dashboardMcp, {
        disabledTools: settings.mcpDisabledTools,
        discover: ({ serverId, url, server }) =>
          withMcpAuth(server, url, authDeps, (t) => discoverMcpTools(serverId, t.url, t.fetchImpl, t.headers)),
      });
      for (const b of assembled.budgetExceeded) trail.push({ eventType: "WARNING", message: b.message });
      for (const u of assembled.unreachable) trail.push({ eventType: "WARNING", message: u.message });
      show();
      const tools = [...LOCAL_TOOLS, ...(assembled.tools ?? [])];

      const fetchWidget = makeWidgetDataFetcher({
        // Live, and none with Context sharing off: Rita is shown no card
        // then, so a uuid she learned elsewhere must not read one either.
        get cards() {
          return settings.contextSharing ? (liveDashboard()?.tabs.flatMap((t) => t.cards) ?? []) : [];
        },
        backends,
        findWidget,
        // Read at each fetch, not once per turn: findWidget is live, so a
        // key-maint backend that finishes loading mid-turn must be off limits
        // the moment its widgets appear (the same reason as authDeps.tokens).
        get keyMaintBackends() {
          return keyMaintBackendIds(useWidgetRegistryStore.getState().widgets);
        },
        request: (card, widget, backend, overrides) =>
          cardRequestSync(card, widget, backend, liveDashboard(), armedRequestOf(card.id), new Date(), overrides),
      });
      const deps = {
        fetchWidget,
        // Enforcement of mcpDisabledTools (advertised names and the names
        // behind call_tool / run_pipeline) lives in runAgentTool, so it
        // applies to every route; the refusal comes back as a typed error
        // result and is counted by executeFunction's refusalOf path.
        // The turn's signal reaches the MCP request itself, so Stop cancels a
        // call that is already running rather than leaving it to its timeout.
        runAgentTool: (serverId: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) =>
          runAgentTool(
            serverId,
            tool,
            args,
            settings.mcpServers,
            dashboardMcp,
            (server, url, tool, args, signal) =>
              withMcpAuth(server, url, authDeps, (t) => callMcpTool(t.url, tool, args, t.fetchImpl, t.headers, signal)),
            {
              disabledTools: settings.mcpDisabledTools,
              onEffective: recordSeenProxiedTools,
              signal,
              // Parks the run loop until Run or Deny. Abort (Stop, or clear(),
              // which aborts too) settles it as denied, so a pending prompt
              // never outlives its turn and the awaiting round never hangs.
              confirm: (request) =>
                new Promise<boolean>((resolve) => {
                  if (signal?.aborted) return resolve(false);
                  const settle = (run: boolean) => {
                    signal?.removeEventListener("abort", onAbort);
                    settlePending = null;
                    set({ pendingTool: null });
                    resolve(run);
                  };
                  const onAbort = () => settle(false);
                  signal?.addEventListener("abort", onAbort);
                  settlePending = settle;
                  set({ pendingTool: request });
                  // The prompt lives in the pane: with it closed the turn
                  // would wait unseen, so flag it like a new reply.
                  noticed();
                }),
            },
          ),
        onCall: (c: AgentCall) => calls.push(c),
        onToolError: (e: { server: string; tool: string; code: string; message: string; input?: Record<string, unknown> }) => {
          // A proxied call is named by what it runs, not by call_tool.
          const shown = e.input === undefined ? {} : { display: displayToolName(mcpServerLabel(e.server, settings.mcpServers), e.tool, e.input) };
          // The user's own Deny is a not-completed call, shown as what it was.
          const denied = e.code === "user_declined";
          addArtifacts([
            {
              type: "tool-error",
              uuid: crypto.randomUUID(),
              name: denied ? "Tool call denied" : "Tool call failed",
              content: { server: mcpServerLabel(e.server, settings.mcpServers), tool: e.tool, ...shown, code: e.code, message: e.message },
            },
          ]);
          // Counted in the status trail's "N errors" too; Rita emits no ERROR
          // status of her own for a call the client refused.
          trail.push({ eventType: "ERROR", message: denied ? `${e.tool} — Denied` : `${e.tool} failed — ${e.code}`, tool_call: { server_id: e.server, tool_name: e.tool, ...shown } });
          show();
          calls.push({ kind: "agent_tool", server_id: e.server, tool: e.tool, narrated: denied ? "Denied" : "Tool call failed", ok: false, error: `${e.code}: ${e.message}`, ...shown });
        },
        // Stop mid-call (bdobb#43): a step that says so, not an error.
        onToolStopped: (e: { server: string; tool: string; input?: Record<string, unknown> }) => {
          const shown = e.input === undefined ? {} : { display: displayToolName(mcpServerLabel(e.server, settings.mcpServers), e.tool, e.input) };
          trail.push({ eventType: "INFO", message: `${e.tool} — Stopped`, tool_call: { server_id: e.server, tool_name: e.tool, ...shown } });
          show();
          calls.push({ kind: "agent_tool", server_id: e.server, tool: e.tool, narrated: "Stopped", ok: false, error: "stopped", ...shown });
        },
        readSkill: (slug: string) => useSkillsStore.getState().skills.find((s) => s.slug === slug && s.enabled),
      };

      // The agent's configurable features, as the document discovered for
      // THIS Rita URL declares them. Nothing discovered (or a different URL)
      // sends {} -- chat never waits on agents.json.
      const found = useAgentDiscoveryStore.getState();
      const agent =
        found.url === settings.ritaUrl && found.discovery.state === "online"
          ? pickAgent(found.discovery.agents, settings.ritaUrl)
          : undefined;
      const workspaceOptions = workspaceOptionsFor(agent, agent ? settings.agentOptions[agent.id] : undefined);
      // D-016a: BDOBB's own Follow-up suggestions off also asks the agent not
      // to write them, rather than only hiding the chips it sends.
      if (!settings.agentPromptSuggestions && typeof workspaceOptions["prompt-suggestions"] === "boolean") workspaceOptions["prompt-suggestions"] = false;
      if (agent && Object.keys(workspaceOptions).length > 0) {
        void logOnce(`workspace-options:${agent.id}`, "workspace_options: sending object shape (Workspace 5.0.0+)");
      }

      const gen = runAgentQuery({
        ritaUrl: settings.ritaUrl,
        maxFunctionRounds: settings.ritaMaxFunctionRounds,
        messages: outgoing,
        // Each round re-reads the dashboard: a card Rita just edited reaches
        // her with its new values, not the turn-start snapshot (#326).
        // The turn's own dashboard (the one the fetcher serves), and the
        // key-maint set read live like the fetcher's, so a backend whose
        // widgets load mid-turn is excluded the moment they appear.
        // Tagged cards are primary, the rest secondary; a tag for a card not
        // on this dashboard matches no ref and is simply not sent.
        refresh: () => {
          const dash = liveDashboard();
          const live = dash?.tabs.flatMap((t) => t.cards) ?? [];
          const now = settings.contextSharing
            ? buildWidgetRefs(live, findWidget, (id) => backends.find((b) => b.id === id)?.name, keyMaintBackendIds(useWidgetRegistryStore.getState().widgets), turnGroups(dash))
            : [];
          const tagged = new Set(get().sharedCardIds);
          return {
            primary: now.filter((r) => tagged.has(String(r.uuid))),
            secondary: now.filter((r) => !tagged.has(String(r.uuid))),
            context: [dashboardContext(dash, useDashboardStore.getState().dashboards)],
          };
        },
        tools,
        executeFunction: async (payload, signal) => {
          const labelled = labelProxiedStep(trail, payload, settings.mcpServers);
          show();
          const before = calls.length;
          const result = await executeFunction(payload, deps, signal);
          // A step labelled here had no server_id, so the status branch never
          // logged it; a failure was already logged by onToolError (#37).
          // Calls run one at a time, so entries since `before` are this call's.
          const step = labelled?.tool_call;
          if (labelled && isRecord(step) && !calls.slice(before).some((c) => c.kind === "agent_tool" && c.ok === false)) {
            calls.push({
              kind: "agent_tool",
              server_id: String(step.server_id),
              tool: String(step.tool_name),
              narrated: labelled.message,
              ...(typeof step.display === "string" ? { display: step.display } : {}),
            });
          }
          return result;
        },
        signal: controller.signal,
        workspaceOptions,
        skillsCatalog: catalog,
        selectedSkills,
      });
      for (;;) {
        const next = await gen.next();
        if (next.done) {
          // Rita's function-round messages (ai call + tool result) come back in the history.
          if (live()) set({ messages: [...prior, human, ...next.value.slice(outgoing.length), ...turn] });
          break;
        }
        const event = next.value;
        if (event.type === "chunk") {
          const last = turn[turn.length - 1];
          if (last && last.role === "ai" && typeof last.content === "string") {
            last.content += event.delta;
          } else {
            const delta = event.delta.replace(/^\s+/, "");
            if (delta === "") continue;
            turn.push({ role: "ai", content: delta });
          }
          show();
          noticed();
        } else if (event.type === "status") {
          const shownStatus = withDisplay(event.status, settings.mcpServers);
          trail.push(shownStatus);
          // Only a tool_call naming a real server_id is a client-routed
          // execute_agent_tool call for the ledger; Rita's own internal
          // narration (e.g. execute_sql against its own data) carries a
          // tool_call with no server_id and stays trail-only.
          const step = isRecord(event.status.tool_call) ? event.status.tool_call : null;
          if (step && typeof step.server_id === "string") {
            calls.push({
              kind: "agent_tool",
              server_id: step.server_id,
              tool: typeof step.tool_name === "string" ? step.tool_name : String(step.name ?? ""),
              narrated: event.status.message,
              ...(isRecord(shownStatus.tool_call) && typeof shownStatus.tool_call.display === "string" ? { display: shownStatus.tool_call.display } : {}),
            });
          }
          show();
        } else if (event.type === "artifact") {
          addArtifacts([event.payload]);
          show();
        } else if (event.type === "citations") {
          const list = event.payload.citations;
          set({ citations: Array.isArray(list) ? list.filter(isRecord) : [] });
        } else if (event.type === "suggestions") {
          // Read at arrival, not per turn: the user can turn the row off while a
          // turn is streaming, and a suggestion that lands after that must not
          // appear. This is presentation only; no request field changed.
          if (useSettingsStore.getState().settings.agentPromptSuggestions) {
            const list = event.payload.suggestions;
            set({ suggestions: (Array.isArray(list) ? list : []).map(suggestionText).filter((s): s is string => s !== null) });
          }
        } else if (event.type === "error") {
          set({ error: event.message });
          noticed();
        }
      }
    } catch (err) {
      // DOMException (the abort case) is not an instanceof Error in jsdom,
      // so the name check has to stand on its own rather than gate on that.
      if (isRecord(err) && err.name === "AbortError") {
        // Stop pressed: keep whatever streamed, no error.
      } else if (err instanceof TypeError) {
        set({ error: `Rita offline. ${err.message} (${settings.ritaUrl})` });
        noticed();
      } else {
        set({ error: err instanceof Error ? err.message : String(err) });
        noticed();
      }
    } finally {
      controller = null;
      set({ running: false });
      // clear() may have already emptied messages (or started a newer turn,
      // tracked via the turnSeq token) while this turn was still in flight
      // (its abort races this finally) -- guard the ledger merge the same
      // way the save below already does, or an aborted-and-cleared turn's
      // calls resurrect into a chat that has no messages and no file.
      if (live() && get().messages.length > 0) {
        set({ calls: [...get().calls, ...calls] });
        try {
          await saveChat({ messages: get().messages, calls: get().calls, sharedCardIds: get().sharedCardIds });
        } catch (err) {
          void logError(`chat: could not save chat.json: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  },

  // Stop ends the current answer; a message held for it is unaffected and
  // still goes out once this turn's finally runs (see the drain above).
  abort: () => {
    controller?.abort();
  },

  resolveTool: (run) => settlePending?.(run),

  clear: async () => {
    // A new conversation: the cards Rita's tools made are no longer hers to name (A8).
    forgetRitaCards();
    // Bump the turn token first so any in-flight send() (even one still
    // awaiting assembleTools, before it has a controller to abort) treats
    // itself as stale and stops touching state.
    turnSeq++;
    // Empty first so an aborted turn's finally sees no messages and skips its save.
    set({
      messages: [],
      calls: [],
      trail: [],
      citations: [],
      suggestions: [],
      error: null,
      hasUnread: false,
      sharedCardIds: [],
      pendingMessage: null,
    });
    controller?.abort();
    await clearChat();
  },

  setPaneOpen: (open) => set(open ? { paneOpen: true, hasUnread: false } : { paneOpen: false }),
  // Every caller (⌘⇧A, the pane's Lock, Window ▸ Keep Rita Open) comes
  // through here, so one guard keeps a URL-less build from holding a stale pin.
  togglePinned: () => {
    if (useSettingsStore.getState().settings.ritaUrl !== "") set({ pinned: !get().pinned });
  },
  toggleShared: (cardId) => {
    const ids = get().sharedCardIds;
    set({ sharedCardIds: ids.includes(cardId) ? ids.filter((id) => id !== cardId) : [...ids, cardId] });
    // send()'s finally is the normal save path, but it only runs on the NEXT
    // turn -- a tag flipped after the last turn (e.g. Stop sharing on the
    // final answer) would otherwise sit in memory only and reappear on
    // restart once load() re-reads the stale chat.json. Save right here
    // instead, but only when there's nothing else about to save it: a
    // running turn's own finally will save this state already, and an empty
    // transcript is never written (matching send, which skips the save when
    // there are no messages).
    if (!get().running && get().messages.length > 0) {
      void saveChat({ messages: get().messages, calls: get().calls, sharedCardIds: get().sharedCardIds }).catch((err) =>
        void logError(`chat: could not save chat.json: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  },

  pushUserMessage: ({ text, agentId }) => {
    // One agent per Rita URL in v6: an agentId naming it is honoured, any
    // other is noted once and the message still goes to Rita -- the row the
    // user clicked is the point, not the routing.
    if (agentId !== undefined) {
      const found = useAgentDiscoveryStore.getState().discovery;
      if (!(found.state === "online" && Object.hasOwn(found.agents, agentId))) {
        void logOnce(`send-to-agent:${agentId}`, `sendToAgent names agent ${agentId}, which this Rita URL does not serve; sending to Rita`);
      }
    }
    set({ pinned: true, pendingMessage: text });
  },
}));

// Turning the preference off clears whatever is already on screen; turning it
// back on waits for the next event rather than resurrecting the old list.
let lastSuggestionsPref = useSettingsStore.getState().settings.agentPromptSuggestions;
useSettingsStore.subscribe((state) => {
  const now = state.settings.agentPromptSuggestions;
  if (lastSuggestionsPref && !now) useChatStore.setState({ suggestions: [] });
  lastSuggestionsPref = now;
});
