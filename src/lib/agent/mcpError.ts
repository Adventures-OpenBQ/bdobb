// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * An MCP failure that knows what KIND of failure it is, so the agent and the
 * user can tell "the tool said no" from "the server timed out" from "the
 * server is not one we may call". Codes: timeout, http_<status>, tool_error,
 * auth, needs_token, unknown_server. (A call to a turned-off tool is refused as a typed
 * TOOL_DISABLED result, not thrown.) Anything that is not an
 * McpError (a network TypeError, a JSON-RPC error body) is classified as
 * transport.
 */
export class McpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export function toolErrorOf(err: unknown): { code: string; message: string } {
  if (err instanceof McpError) return { code: err.code, message: err.message };
  return { code: "transport", message: err instanceof Error ? err.message : String(err) };
}
