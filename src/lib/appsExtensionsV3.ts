// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import type { CardView, TableCardState, DashboardCard } from "./types";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ExtensionIssue = {
  code: "UNSUPPORTED_EXTENSION" | "INVALID_EXTENSION" | "VIEW_CONFLICT" | "UNSUPPORTED_V3_STATE" | "MISSING_LOCAL_ASSET";
  path: string;
  message: string;
};
export type ExtensionResult<T> = { ok: true; value: T } | { ok: false; issue: ExtensionIssue };
export type V3AppExtension = { schemaVersion: 1; profile: "v3"; tabOrder: string[]; groupsDisabled?: boolean; groupNames?: Record<string, string> };
export type V3CardExtension = { schemaVersion: 1; profile: "v3"; title?: string; view?: CardView; minimized?: boolean; table?: TableCardState };
export class AppExtensionError extends Error {
  constructor(readonly issue: ExtensionIssue) {
    super(`${issue.code} at ${issue.path}: ${issue.message}`);
  }
}
export function extensionError(path: string, message: string, code: ExtensionIssue["code"] = "INVALID_EXTENSION"): never {
  throw new AppExtensionError({ code, path, message });
}
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) extensionError(path, "Expected an object.");
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) extensionError(path, "Expected a plain JSON object.");
  for (const key of Object.keys(value)) if (unsafe.has(key)) extensionError(path, "Unsafe object key.");
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) extensionError(path, "Unknown extension field.");
}
function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || Array.from(value).some((x) => typeof x !== "string")) extensionError(path, "Expected string array.");
  return [...value];
}
function json(value: unknown, path: string, seen = new Set<object>(), depth = 0): JsonValue {
  if (depth > 64) extensionError(path, "Filter nesting exceeds 64 levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null || seen.has(value)) extensionError(path, "Expected finite, acyclic JSON value.");
  seen.add(value);
  let result: JsonValue;
  if (Array.isArray(value)) result = Array.from(value, (x) => json(x, path, seen, depth + 1));
  else result = Object.fromEntries(Object.entries(record(value, path)).map(([k, v]) => [k, json(v, path, seen, depth + 1)]));
  seen.delete(value);
  return result;
}
function header(value: unknown, allowed: string[], path: string): Record<string, unknown> {
  const r = record(value, path);
  if (r.schemaVersion !== 1 || r.profile !== "v3") extensionError(path, "Expected schemaVersion 1 and profile v3.", "UNSUPPORTED_EXTENSION");
  keys(r, ["schemaVersion", "profile", ...allowed], path);
  return r;
}
function result<T>(parse: () => T): ExtensionResult<T> {
  try { return { ok: true, value: parse() }; }
  catch (err) { if (err instanceof AppExtensionError) return { ok: false, issue: err.issue }; throw err; }
}
export function decodeV3AppExtension(value: unknown, path: string): ExtensionResult<V3AppExtension | undefined> {
  return result(() => {
    if (value === undefined) return undefined;
    const r = header(value, ["tabOrder", "groupsDisabled", "groupNames"], path);
    const out: V3AppExtension = { schemaVersion: 1, profile: "v3", tabOrder: strings(r.tabOrder, `${path}.tabOrder`) };
    if (Object.hasOwn(r, "groupsDisabled")) {
      if (typeof r.groupsDisabled !== "boolean") extensionError(path, "groupsDisabled must be boolean.");
      out.groupsDisabled = r.groupsDisabled;
    }
    if (Object.hasOwn(r, "groupNames")) {
      const names = record(r.groupNames, `${path}.groupNames`);
      if (Object.values(names).some((x) => typeof x !== "string")) extensionError(path, "Group display names must be strings.");
      out.groupNames = Object.fromEntries(Object.entries(names)) as Record<string, string>;
    }
    return out;
  });
}
export function decodeV3CardExtension(value: unknown, path: string): ExtensionResult<V3CardExtension | undefined> {
  return result(() => {
    if (value === undefined) return undefined;
    const r = header(value, ["title", "view", "minimized", "table"], path);
    const out: V3CardExtension = { schemaVersion: 1, profile: "v3" };
    if (Object.hasOwn(r, "title")) {
      if (typeof r.title !== "string") extensionError(path, "Title must be string.");
      out.title = r.title;
    }
    if (Object.hasOwn(r, "view")) {
      if (!["table", "chart", "raw", "transposed"].includes(r.view as string)) extensionError(path, "Unsupported v3 view.");
      out.view = r.view as CardView;
    }
    if (Object.hasOwn(r, "minimized")) {
      if (typeof r.minimized !== "boolean") extensionError(path, "Minimized must be boolean.");
      out.minimized = r.minimized;
    }
    if (Object.hasOwn(r, "table")) {
      const t = record(r.table, `${path}.table`);
      keys(t, ["sorting", "columnFilters", "columnOrder", "hidden", "widths", "pinned"], `${path}.table`);
      const table: TableCardState = {};
      for (const field of ["columnOrder", "hidden"] as const) if (Object.hasOwn(t, field)) table[field] = strings(t[field], `${path}.table.${field}`);
      if (Object.hasOwn(t, "sorting")) {
        if (!Array.isArray(t.sorting)) extensionError(path, "Sorting must be an array.");
        table.sorting = Array.from(t.sorting, (item) => {
          const s = record(item, path); keys(s, ["id", "desc"], path);
          if (typeof s.id !== "string" || typeof s.desc !== "boolean") extensionError(path, "Invalid sort.");
          return { id: s.id, desc: s.desc };
        });
      }
      if (Object.hasOwn(t, "columnFilters")) {
        if (!Array.isArray(t.columnFilters)) extensionError(path, "Filters must be an array.");
        table.columnFilters = Array.from(t.columnFilters, (item) => {
          const f = record(item, path); keys(f, ["id", "value"], path);
          if (typeof f.id !== "string") extensionError(path, "Filter id must be string.");
          return { id: f.id, value: json(f.value, `${path}.table.columnFilters`) };
        });
      }
      if (Object.hasOwn(t, "widths")) {
        const widths = record(t.widths, `${path}.table.widths`);
        if (Object.values(widths).some((x) => typeof x !== "number" || !Number.isFinite(x) || x <= 0)) extensionError(path, "Widths must be finite and positive.");
        table.widths = { ...widths } as Record<string, number>;
      }
      if (Object.hasOwn(t, "pinned")) {
        const pins = record(t.pinned, `${path}.table.pinned`);
        if (Object.values(pins).some((x) => x !== null && x !== "left" && x !== "right")) extensionError(path, "Pins must be left, right or null.");
        table.pinned = { ...pins } as TableCardState["pinned"];
      }
      out.table = table;
    }
    return out;
  });
}
export function bdobbNamespace(value: Record<string, unknown>, path: string): unknown {
  if (!Object.hasOwn(value, "extensions")) return undefined;
  const extensions = record(value.extensions, `${path}.extensions`);
  if (!Object.hasOwn(extensions, "bdobb")) return undefined;
  // Explicit undefined is invalid too; absence is the only legacy fallback.
  if (extensions.bdobb === undefined) extensionError(path, "Missing extension value.");
  return extensions.bdobb;
}
export function unwrapExtension<T>(decoded: ExtensionResult<T>): T {
  if (!decoded.ok) throw new AppExtensionError(decoded.issue);
  return decoded.value;
}

export function encodeV3CardExtension(card: DashboardCard, path: string): ExtensionResult<V3CardExtension | undefined> {
  const allowed = new Set(["id", "widgetId", "backendId", "params", "layout", "title", "view", "minimized", "bindings", "table", "groupIds", "extensions"]);
  for (const [key, value] of Object.entries(card)) if (value !== undefined && !allowed.has(key)) {
    return { ok: false, issue: { code: "UNSUPPORTED_V3_STATE", path, message: "Card has state outside the v3 profile." } };
  }
  const native: Record<string, unknown> = { schemaVersion: 1, profile: "v3" };
  for (const field of ["title", "view", "minimized", "table"] as const) if (card[field] !== undefined) native[field] = card[field];
  return Object.keys(native).length === 2 ? { ok: true, value: undefined } : decodeV3CardExtension(native, path);
}
