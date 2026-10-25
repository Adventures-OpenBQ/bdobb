// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from "@tauri-apps/api/path";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { callMcpTool } from "./agent/mcp";
import { describeHttpError } from "./dataClient";
import { type ShareTarget, type ShareVars, fillTemplate } from "./shareTargets";

/** Delivers an exported chat to one share target. Throws with a user-readable message on failure. */
export async function sendToTarget(target: ShareTarget, vars: ShareVars): Promise<void> {
  const filled = fillTemplate(target.template, vars);
  if (target.kind === "mcp") {
    await callMcpTool(target.url, target.tool ?? "", filled);
    return;
  }
  if (target.kind === "http") {
    const res = await httpFetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...target.headers },
      body: JSON.stringify(filled),
    });
    if (!res.ok) throw new Error(describeHttpError(res.status, await res.text().catch(() => "")));
    return;
  }
  const rel = typeof filled.path === "string" && filled.path !== "" ? filled.path : vars.filename;
  // `{{title}}` is unsanitized user/agent text and can reach `path` -- refuse
  // anything that could climb out of the target folder.
  if (rel.startsWith("/") || rel.startsWith("\\") || rel.split(/[/\\]/).includes("..")) {
    throw new Error("invalid path in template");
  }
  const path = await join(target.url, rel);
  // `join` returns a `\`-separated path on Windows, not `/`.
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  await mkdir(dir, { recursive: true });
  await writeTextFile(path, vars.markdown);
}
