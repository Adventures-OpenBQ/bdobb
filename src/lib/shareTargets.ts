// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import { safeUrl } from "./safeUrl";

/**
 * Where a chat transcript can be sent. This file owns the shape and its
 * validation and fillTemplate; sendToTarget lives in shareSend.ts so that
 * settingsFile (which needs only isShareTarget) never pulls in dataClient,
 * whose theme import reaches back into settingsStore -- a cycle that left the
 * store's DEFAULT_SETTINGS uninitialized when this file was entered first.
 *
 * `template` is JSON text of an object whose string leaves may carry
 * {{markdown}}, {{title}}, {{filename}} and {{exportedAt}}. For `file`, `url`
 * is a folder path rather than a URL -- one field, because a target has
 * exactly one destination whatever its kind.
 */
export type ShareTargetKind = "mcp" | "http" | "file";
export const SHARE_TARGET_KINDS: readonly ShareTargetKind[] = ["mcp", "http", "file"];

export type ShareTarget = {
  id: string;
  name: string;
  kind: ShareTargetKind;
  url: string;
  /** The MCP tool to call. Required when kind is "mcp". */
  tool?: string;
  template: string;
  /** Extra request headers for "http". */
  headers?: Record<string, string>;
};

export function isShareTargetKind(v: unknown): v is ShareTargetKind {
  return typeof v === "string" && (SHARE_TARGET_KINDS as readonly string[]).includes(v);
}

/** True when `text` parses as a JSON object -- not an array, not a scalar. */
export function isJsonObjectText(text: string): boolean {
  try {
    return isRecord(JSON.parse(text));
  } catch {
    return false;
  }
}

export function isStringRecord(v: unknown): v is Record<string, string> {
  // Object.values, not for..in: own enumerable keys only, so nothing
  // inherited from Object.prototype is validated or carried. Same discipline
  // as foldersFile's `placement` check.
  return isRecord(v) && Object.values(v).every((x) => typeof x === "string");
}

/** A folder path for "file"; an http(s) URL otherwise. */
export function isShareTargetUrl(kind: ShareTargetKind, url: string): boolean {
  return kind === "file" ? url.trim() !== "" : safeUrl(url) !== null;
}

export function isShareTarget(v: unknown): v is ShareTarget {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || v.id === "") return false;
  if (typeof v.name !== "string" || v.name === "") return false;
  if (!isShareTargetKind(v.kind)) return false;
  if (typeof v.url !== "string" || !isShareTargetUrl(v.kind, v.url)) return false;
  if (typeof v.template !== "string" || !isJsonObjectText(v.template)) return false;
  if (v.tool !== undefined && typeof v.tool !== "string") return false;
  if (v.kind === "mcp" && (v.tool === undefined || v.tool === "")) return false;
  if (v.headers !== undefined && !isStringRecord(v.headers)) return false;
  return true;
}

/**
 * One `Key: value` per line, for the headers textarea. Blank lines are
 * skipped; a non-blank line with no colon (or nothing before it) makes the
 * whole text invalid (null) rather than silently dropping that line.
 */
export function parseHeaderLines(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return null;
    out[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return out;
}

export function formatHeaderLines(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export type ShareVars = { markdown: string; title: string; filename: string; exportedAt: string };

const PLACEHOLDER = /\{\{(markdown|title|filename|exportedAt)\}\}/g;

function fill(value: unknown, vars: ShareVars): unknown {
  if (typeof value === "string") return value.replace(PLACEHOLDER, (_, key: keyof ShareVars) => vars[key]);
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

/** Parses the target's JSON template and substitutes the placeholders into every string leaf. */
export function fillTemplate(templateText: string, vars: ShareVars): Record<string, unknown> {
  const parsed: unknown = JSON.parse(templateText);
  if (!isRecord(parsed)) throw new Error("Template must be a JSON object");
  return fill(parsed, vars) as Record<string, unknown>;
}
