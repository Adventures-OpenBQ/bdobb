// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
type Schema = {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: string;
  anyOf?: Schema[];
  allOf?: Schema[];
  not?: Schema;
  if?: Schema;
  then?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  contains?: Schema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
};
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.test(v);
function valid(v: unknown, s: Schema, definitions: Record<string, Schema> = {}): boolean {
  if (s.$ref) return valid(v, definitions[s.$ref.split("/").at(-1)!], definitions);
  if (s.const !== undefined && v !== s.const) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.anyOf && !s.anyOf.some((x) => valid(v, x, definitions))) return false;
  if (s.allOf && !s.allOf.every((x) => valid(v, x, definitions))) return false;
  if (s.not && valid(v, s.not, definitions)) return false;
  if (s.if && valid(v, s.if, definitions) && s.then && !valid(v, s.then, definitions)) return false;
  if (s.type === "null" && v !== null) return false;
  if (s.type === "boolean" && typeof v !== "boolean") return false;
  if (s.type === "integer" && !Number.isSafeInteger(v)) return false;
  if (s.type === "number" && (typeof v !== "number" || !Number.isFinite(v))) return false;
  if (s.type === "string" && typeof v !== "string") return false;
  if (
    typeof v === "number" &&
    ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))
  )
    return false;
  if (typeof v === "string") {
    if (
      (s.minLength !== undefined && v.length < s.minLength) ||
      (s.maxLength !== undefined && v.length > s.maxLength) ||
      (s.pattern && !new RegExp(s.pattern).test(v))
    )
      return false;
    // arrow-json-v1 emits canonical decimal strings only beyond the safe JSON
    // integer range. Compare digits lexically; never coerce a snapshot identity.
    if (s.format === "large-snapshot-id" && (v.length < 16 || (v.length === 16 && v <= "9007199254740991")))
      return false;
    if (s.format === "uuid" && !isUuid(v)) return false;
    if (s.format === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v).toISOString().slice(0, 10) !== v))
      return false;
    if (
      s.format === "date-time" &&
      (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v)))
    )
      return false;
  }
  if (s.type === "array" && !Array.isArray(v)) return false;
  if (Array.isArray(v)) {
    if (s.items && !v.every((x) => valid(x, s.items!, definitions))) return false;
    if (s.contains && !v.some((x) => valid(x, s.contains!, definitions))) return false;
  }
  if (s.type === "object" && !isRecord(v)) return false;
  if (isRecord(v)) {
    if (s.required?.some((k) => !Object.hasOwn(v, k))) return false;
    for (const [k, x] of Object.entries(v)) {
      if (s.properties && Object.hasOwn(s.properties, k)) {
        if (!valid(x, s.properties[k], definitions)) return false;
      } else if (s.additionalProperties === false) return false;
      else if (typeof s.additionalProperties === "object" && !valid(x, s.additionalProperties, definitions))
        return false;
    }
  }
  return true;
}

/** The subset of JSON Schema the vendored calendar schema uses; false on any mismatch or malformed schema. */
export function matchesJsonSchema(value: unknown, schema: unknown, definitions?: Record<string, unknown>): boolean {
  try {
    const s = schema as Schema & { $defs?: Record<string, Schema> };
    return valid(value, s, (definitions ?? s.$defs ?? {}) as Record<string, Schema>);
  } catch {
    return false;
  }
}
