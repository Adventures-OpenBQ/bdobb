// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** One parsed Server-Sent Event: its name and its joined data payload. */
export type SseEvent = { event: string; data: string };

/**
 * A tool as the agent sees it. `endpoint` is always "" for MCP tools — the
 * field exists because the agent protocol's tool shape carries it for
 * widget-backed tools, and one shape for both keeps the caller simple.
 */
export type AgentTool = {
  server_id: string;
  name: string;
  url: string;
  endpoint: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/** One line of the skills menu Rita reads before answering (agent-rita `SkillCatalogEntry`). */
export type SkillCatalogEntry = { slug: string; description: string; updatedAt: string };

/** A skill body sent up front — `/skill:<slug>` in the typed text (agent-rita `SkillPayload`). */
export type SkillPayload = {
  slug: string;
  description: string;
  contentMarkdown: string;
  source: "forced_slash" | "model_selected";
};

export type McpAuthType = "oauth" | "token";

/** Where an MCP server entry came from: an app served by a backend, or an apps.json file. Absent: added by hand. */
export type McpServerSource = { kind: "backend"; backendId: string } | { kind: "file" };

/** An MCP server as configured in Settings. */
export type McpServerConfig = {
  id: string;
  url: string;
  enabled: boolean;
  /** From apps.json `mcp_servers`; absent for a server added by URL. */
  name?: string;
  description?: string;
  /** apps.json's `authType`. Absent: no credential is ever sent. */
  authType?: McpAuthType;
  source?: McpServerSource;
  /**
   * When this MCP server's hostname differs from its source backend's, the
   * backend's credential is sent only when this is true (ports are ignored,
   * so a backend and a same-host MCP server on a different port still
   * match). Set only by the user in the MCP tab; absent/false is the safe
   * default, and an AI Library import always forces it off.
   */
  allowCrossHost?: boolean;
};

/** A server dropped whole because its tools would overflow the budget. */
export type McpBudgetExceeded = {
  serverId: string;
  url: string;
  toolCount: number;
  payloadChars: number;
  message: string;
};

/** A server whose discovery failed. Named, not silently absent. */
export type McpUnreachable = { serverId: string; url: string; message: string };

/** `tools` is null when no server contributed anything. */
export type AssembledTools = {
  tools: AgentTool[] | null;
  budgetExceeded: McpBudgetExceeded[];
  unreachable: McpUnreachable[];
};

/**
 * A feature flag from agents.json. Four shapes occur, and a client that
 * assumes one of them drops the others silently. The first three are in the
 * captured discovery document (src/test/fixtures/rita/agents.json); the text
 * option is not -- it comes from OpenBB's agents.json reference:
 *  - a plain boolean                       (streaming, mcp-tools, …)
 *  - a typed select                        (model)
 *  - an object toggle with NO `type` field (prompt-suggestions)
 *  - a typed text option                   (agent-name, …; reference only)
 */
export type AgentFeature =
  | { kind: "boolean"; value: boolean }
  | { kind: "toggle"; label: string; default: boolean; description: string }
  | {
      kind: "select";
      label: string;
      default: string;
      options: Array<{ label: string; value: string }>;
    }
  | { kind: "text"; label: string; default: string; description: string };

export type AgentDescriptor = {
  id: string;
  name: string;
  description: string;
  queryPath: string;
  features: Record<string, AgentFeature>;
};

export type AgentsJson = Record<string, AgentDescriptor>;

/** A status step. Spread first, then normalized — see toAgentEvent. */
export type AgentStatus = {
  eventType: "INFO" | "WARNING" | "ERROR";
  message: string;
  [key: string]: unknown;
};

export type AgentEvent =
  | { type: "chunk"; delta: string }
  | { type: "status"; status: AgentStatus }
  | { type: "functionCall"; payload: Record<string, unknown> }
  | { type: "artifact"; payload: Record<string, unknown> }
  | { type: "citations"; payload: Record<string, unknown> }
  | { type: "suggestions"; payload: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * A tool message carries its fields at the top level (function,
 * input_arguments, data, extra_state) rather than nested under `content` —
 * that is the shape agent-rita's `ToolMessage` type declares and what its
 * round-trip reads; a `content` wrapper is silently ignored. Human/ai
 * messages keep the `content` shape (agent-rita's `ChatMessage.content` is
 * `string | Record<string, unknown>`).
 */
export type AgentMessage =
  | { role: "human" | "ai"; content: unknown }
  | { role: "tool"; function: unknown; input_arguments: unknown; data: unknown; extra_state?: unknown };

/**
 * `sharedCardIds` is typed unknown for the same reason `calls` is loose: it is
 * validated where it is loaded, and a bad value costs the tags, never the
 * transcript.
 */
export type ChatTranscript = { messages: AgentMessage[]; calls?: unknown[]; sharedCardIds?: unknown };

/** An artifact Rita attaches to a message (table, chart, markdown, html…). */
export type ClientArtifact = {
  type: string;
  uuid: string;
  name?: string;
  description?: string;
  content: unknown;
  chart_params?: unknown;
};

/**
 * One highlighted line of a cited PDF quote, in PDF points from the page's
 * top-left corner (pdfplumber's convention, which openbb-ai and Rita use).
 */
export type BoundingBox = { text: string; page: number; x0: number; top: number; x1: number; bottom: number };

/** One entry of the "API calls made on your behalf" ledger persisted with the chat. */
export type AgentCall =
  | {
      kind: "widget_data";
      /** Backend URL without auth or theme query parameters. */
      url: string;
      params: Record<string, string>;
      ok: boolean;
      error?: string;
      durationMs: number;
      rows: number;
    }
  | { kind: "agent_tool"; server_id: string; tool: string; narrated: string; ok?: boolean; error?: string; display?: string };
