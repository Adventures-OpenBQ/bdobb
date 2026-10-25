// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ChatMessage } from "../stores/chatStore";
import { isArtifactMessage } from "../stores/chatStore";
import type { AgentCall, ClientArtifact } from "./agent/types";
import { exportFilename } from "./export";
import { isRecord } from "./isRecord";

const MAX_TITLE = 80;

export function chatTitle(messages: ChatMessage[]): string {
  const first = messages.find(
    (m): m is { role: "human" | "ai"; content: unknown } => m.role === "human" && typeof m.content === "string",
  );
  const line = first ? String(first.content).split("\n")[0].trim() : "";
  if (line === "") return "Rita chat";
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

export function chatFilename(title: string, exportedAt: string): string {
  return exportFilename(title, {}, "md", new Date(exportedAt));
}

const cell = (v: unknown): string => {
  const text = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
};

function tableMarkdown(rows: unknown[]): string {
  const first = rows.find(isRecord);
  if (!first) return "```json\n" + JSON.stringify(rows, null, 2) + "\n```\n";
  const columns = Object.keys(first);
  const header = `| ${columns.map(cell).join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |\n`;
  const body = rows
    .map((r) => `| ${columns.map((c) => (isRecord(r) ? cell(r[c]) : "")).join(" | ")} |`)
    .join("\n");
  return `${header}${body}\n`;
}

function artifactMarkdown(a: ClientArtifact): string {
  const heading = `### ${a.name ?? a.type}\n\n`;
  if ((a.type === "markdown" || a.type === "text") && typeof a.content === "string") return `${heading}${a.content}\n`;
  if (a.type === "table" && Array.isArray(a.content)) return heading + tableMarkdown(a.content);
  return `${heading}\`\`\`json\n${JSON.stringify(a.content, null, 2)}\n\`\`\`\n`;
}

function callLine(c: AgentCall): string {
  if (c.kind === "agent_tool") {
    const name = c.display ?? `${c.server_id}/${c.tool}`; // the effective name for call_tool / run_pipeline
    return c.ok === false ? `- ${name}: failed — ${c.error ?? ""}` : `- ${name}: ${c.narrated}`;
  }
  const tail = c.ok ? "" : ` — ${c.error ?? "failed"}`;
  return `- ${c.ok ? "ok" : "failed"} ${c.url} ${JSON.stringify(c.params)} (${c.rows} rows, ${c.durationMs} ms)${tail}`;
}

/** The whole conversation as Markdown: headed turns, artifacts inline, the call ledger last. */
export function chatToMarkdown(messages: ChatMessage[], calls: AgentCall[], exportedAt: string): string {
  const parts = [`# ${chatTitle(messages)}\n\n_Exported ${exportedAt}_\n`];
  for (const m of messages) {
    if (m.role === "human") parts.push(`## You\n\n${String(m.content)}\n`);
    else if (isArtifactMessage(m)) parts.push(...m.content.map(artifactMarkdown));
    else if (m.role === "ai" && typeof m.content === "string") parts.push(`## Rita\n\n${m.content}\n`);
    // ai function-call echoes and tool results are not prose; skip them.
  }
  if (calls.length > 0) parts.push(`## API calls made on your behalf\n\n${calls.map(callLine).join("\n")}\n`);
  return parts.join("\n");
}
