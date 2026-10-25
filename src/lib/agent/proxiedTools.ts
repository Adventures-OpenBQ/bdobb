// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "../isRecord";

/**
 * The OpenBQ MCP (openbb-mcp-server 2.0.1) advertises ten discovery tools; the
 * provider tools themselves run through these two. Their live schemas:
 * `call_tool` `{ name: string (required), arguments?: object | null }` and
 * `run_pipeline` `{ steps: [{ tool: string (required), arguments?, id?, inputs? }], outputs? }`.
 * Per-tool disable and the activity display therefore have to look inside
 * the arguments: the advertised name alone is always one of these two.
 */
export const PROXY_TOOLS = ["call_tool", "run_pipeline"] as const;

/** Names kept per server in mcpSeenProxiedTools (sorted, so the cap keeps the alphabetical head). */
export const SEEN_TOOLS_CAP = 500;

export type Effective = { ok: true; names: string[]; via?: string } | { ok: false; message: string };

const nameOk = (v: unknown): v is string => typeof v === "string" && v !== "";

/** What a call really runs: `call_tool` -> its `name` argument, `run_pipeline` -> every step's `tool`, anything else -> itself. */
export function effectiveToolNames(tool: string, args: unknown): Effective {
  if (tool === "call_tool") {
    if (!isRecord(args) || !nameOk(args.name)) return { ok: false, message: "call_tool needs a non-empty string `name` argument naming the tool to run." };
    // A nested proxy would hide its own name/steps from the disabled-tools check.
    if ((PROXY_TOOLS as readonly string[]).includes(args.name)) return { ok: false, message: `call_tool may not run ${args.name}; name the tool itself.` };
    if (args.arguments !== undefined && args.arguments !== null && !isRecord(args.arguments)) {
      return { ok: false, message: "call_tool's `arguments` must be an object or null." };
    }
    return { ok: true, names: [args.name], via: tool };
  }
  if (tool === "run_pipeline") {
    if (!isRecord(args) || !Array.isArray(args.steps) || args.steps.length === 0) {
      return { ok: false, message: "run_pipeline needs a non-empty `steps` array." };
    }
    const names: string[] = [];
    for (const [i, step] of args.steps.entries()) {
      if (!isRecord(step) || !nameOk(step.tool)) return { ok: false, message: `run_pipeline step ${i + 1} needs a non-empty string \`tool\`.` };
      // A nested proxy would hide its own name/steps from the disabled-tools check.
      if ((PROXY_TOOLS as readonly string[]).includes(step.tool)) return { ok: false, message: `run_pipeline step ${i + 1} may not run ${step.tool}; name the tool itself.` };
      names.push(step.tool);
    }
    return { ok: true, names, via: tool };
  }
  return { ok: true, names: [tool] };
}

/** "<server> · <name> (via call_tool)", "<server> · pipeline: a → b (via run_pipeline)", or "<server> · <tool>". */
export function displayToolName(server: string, tool: string, args: unknown): string {
  const r = effectiveToolNames(tool, args);
  if (!r.ok || r.via === undefined) return `${server} · ${tool}`;
  return r.via === "run_pipeline"
    ? `${server} · pipeline: ${r.names.join(" → ")} (via run_pipeline)`
    : `${server} · ${r.names[0]} (via ${r.via})`;
}

/**
 * Which of a call's names the user turned off for this server. `url` is the
 * NORMALIZED server URL (the key of mcpDisabledTools). The proxy itself being
 * off blocks every call through it. Null means the call may go ahead.
 */
export function disabledEffective(
  url: string,
  tool: string,
  args: unknown,
  disabled: Record<string, string[]> | undefined,
): { disabled: string[] } | { malformed: string } | null {
  const off = disabled?.[url] ?? [];
  if (off.includes(tool)) return { disabled: [tool] };
  const r = effectiveToolNames(tool, args);
  if (!r.ok) return { malformed: r.message };
  const hit = [...new Set(r.names.filter((n) => off.includes(n)))];
  return hit.length > 0 ? { disabled: hit } : null;
}

/** Union, de-duplicated and sorted, capped at SEEN_TOOLS_CAP. */
export function mergeSeenTools(existing: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...existing, ...added])].sort().slice(0, SEEN_TOOLS_CAP);
}
