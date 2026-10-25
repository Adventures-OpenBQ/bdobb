// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * workspace_options as Workspace 5.0.0+ sends it: a keyed object, one entry
 * per CONFIGURABLE feature the agent declared (a label/default toggle, a
 * select, a text field). Plain capability booleans (streaming,
 * widget-dashboard-select, ...) describe the agent, not a user choice, and
 * are never sent -- OpenBB's custom-agent-features reference shows them
 * absent from the payload.
 */
import { queryUrl } from "./request";
import type { AgentDescriptor, AgentsJson } from "./types";

export type WorkspaceOptions = Record<string, boolean | string>;

export function workspaceOptionsFor(
  agent: AgentDescriptor | undefined,
  stored: Record<string, boolean | string> = {},
): WorkspaceOptions {
  const out: WorkspaceOptions = {};
  if (!agent) return out;
  for (const [id, feature] of Object.entries(agent.features)) {
    // Own keys only: a feature id like "constructor" must not read the
    // prototype of the stored object.
    const value = Object.hasOwn(stored, id) ? stored[id] : undefined;
    if (feature.kind === "toggle") out[id] = typeof value === "boolean" ? value : feature.default;
    else if (feature.kind === "select" || feature.kind === "text") out[id] = typeof value === "string" ? value : feature.default;
  }
  return out;
}

function resolvedQuery(queryPath: string, ritaUrl: string): string {
  try {
    return new URL(queryPath, `${ritaUrl.replace(/\/+$/, "")}/`).href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/**
 * The agent a turn talks to. The app always posts to <ritaUrl>/v1/query, so
 * the descriptor whose own query endpoint resolves there is the one whose
 * features apply; a document that names none of them that way falls back to
 * its first agent, which is every real Rita document.
 */
export function pickAgent(agents: AgentsJson, ritaUrl: string): AgentDescriptor | undefined {
  const target = queryUrl(ritaUrl);
  const list = Object.values(agents);
  return list.find((a) => a.queryPath !== "" && resolvedQuery(a.queryPath, ritaUrl) === target) ?? list[0];
}
