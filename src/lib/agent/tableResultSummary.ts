// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { isRecord } from "../isRecord";
import { LOCAL_TOOL_SERVER_ID } from "./localToolServer";
import type { ClientTableResult } from "./types";

type TableCall = { tool: "describe_table" | "arrange_table"; cardId: string };
export function localTableCall(payload: Record<string, unknown>): TableCall | null {
  const args = payload.input_arguments;
  if (payload.function !== "execute_agent_tool" || !isRecord(args) || args.server_id !== LOCAL_TOOL_SERVER_ID) return null;
  const tool = args.tool_name ?? args.tool;
  const input = isRecord(args.parameters) ? args.parameters : isRecord(args.input) ? args.input : args.args;
  if ((tool !== "describe_table" && tool !== "arrange_table") || !isRecord(input) || typeof input.card_id !== "string" || !input.card_id) return null;
  return { tool, cardId: input.card_id };
}

// These are engine values, not model prose. Never interpret embedded Markdown/HTML.
function cell(value: unknown): string {
  const text = value == null ? "—" : typeof value === "number" && !Number.isFinite(value) ? "Unavailable" : ["string", "number", "boolean"].includes(typeof value) ? String(value) : "[complex value]";
  const clipped = text.length > 160 ? `${text.slice(0, 160)}…` : text;
  return clipped.replace(/\r?\n/g, " ").replace(/[\\`*_{}[\]()|<>]/g, "\\$&");
}

/** Computed from the uncapped local result; never forward this private metadata upstream. */
export function clientTableResult(call: TableCall, raw: unknown): ClientTableResult | undefined {
  if (!isRecord(raw)) return;
  const cardId = call.cardId;
  if (call.tool === "describe_table") {
    if (raw.status === "refused" || raw.status === "unavailable") return { kind: "result", cardId, text: `Table inspection ${raw.status}: ${cell(raw.message ?? raw.reason ?? raw.code ?? "Result unavailable")}`, ending: "" };
    if (raw.status !== "ok" || !isRecord(raw.card) || raw.card.id !== cardId) return;
    const c = isRecord(raw.completeness) ? raw.completeness : {};
    const sourceRows = c.totalRowCountKind === "exact" && typeof c.totalRowCount === "number" && Number.isSafeInteger(c.totalRowCount) && c.totalRowCount >= 0 ? c.totalRowCount : undefined;
    return { kind: "inspection", cardId, ...(sourceRows !== undefined ? { sourceRows } : {}) };
  }
  if (typeof raw.card_id === "string" && raw.card_id !== cardId) return;
  if (raw.status === "unchanged") return { kind: "result", cardId, text: "No table change was needed.", ending: "" };
  if (raw.status === "refused" || raw.status === "failed") {
    const errors = Array.isArray(raw.errors) ? raw.errors.filter(isRecord).slice(0, 8).filter(e => typeof e.message === "string").map(e => cell(e.message)) : [];
    return { kind: "result", cardId, text: [`Table arrangement ${raw.status}: ${cell(raw.message ?? raw.code ?? "Result unavailable")}`, ...errors].join("\n\n"), ending: "Nothing was changed by this call." };
  }
  if (raw.status !== "applied" && !(raw.status === "previewed" && raw.committed === false)) return;
  if (raw.card_id !== cardId) return;
  const lines = [raw.status === "applied" ? "Table arrangement applied." : "Table arrangement preview."];
  if (raw.recalculating === true) lines.push("The table was saved; recalculation is pending.");
  const preview = isRecord(raw.preview) ? raw.preview : {};
  const allColumns = Array.isArray(preview.columns) ? preview.columns.filter(isRecord).filter(c => typeof c.id === "string" && typeof c.label === "string") : [];
  const columns = allColumns.slice(0, 12);
  const rows = Array.isArray(preview.rows) ? preview.rows : [];
  let omitted = allColumns.length > columns.length || rows.length > 20 || preview.truncated === true;
  if (columns.length) {
    lines.push("", `| ${columns.map(c => cell(c.label)).join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`);
    for (const row of rows.slice(0, 20)) {
      if (!isRecord(row) || !isRecord(row.values)) { omitted = true; continue; }
      const values = row.values;
      const line = `| ${columns.map(c => cell(values[String(c.id)])).join(" | ")} |`;
      if (lines.join("\n").length + line.length > 8_000) { omitted = true; break; }
      lines.push(line);
    }
    if (!rows.length) lines.push("", "No rows in this preview.");
  } else lines.push("", "The engine preview is unavailable.");
  if (omitted) lines.push("", "Additional preview content omitted.");
  if (Array.isArray(raw.warnings)) {
    // The explicit provider-override warning must not disappear behind other diagnostics.
    const warnings = raw.warnings.filter(isRecord).sort((a, b) => Number(b.code === "provider-aggregation-hint") - Number(a.code === "provider-aggregation-hint"));
    for (const warning of warnings.slice(0, 8)) lines.push("", `Warning${typeof warning.code === "string" ? ` (${cell(warning.code)})` : ""}: ${cell(warning.message ?? "The engine reported a warning.")}`);
    if (warnings.length > 8) lines.push("", "Additional engine warnings omitted.");
  }
  return { kind: "result", cardId, text: lines.join("\n"), ending: raw.status === "previewed" ? "Nothing was changed." : raw.undo === "available" ? "Undo is available." : "" };
}
