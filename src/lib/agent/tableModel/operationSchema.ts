// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { OPERATIONS, type Rule } from "./contract";

type Schema = Record<string, unknown>;
const reference: Schema = { anyOf: ["id", "alias"].map(key => ({
  type: "object", properties: { [key]: { type: "string" } }, required: [key], additionalProperties: false,
})) };

function fieldSchema(rule: Rule): Schema {
  if (typeof rule !== "string") return { type: "string", enum: [...rule] };
  switch (rule) {
    case "string": return { type: "string" };
    case "boolean": return { type: "boolean" };
    case "ref": return reference;
    case "refs": return { type: "array", items: reference };
    case "strings": return { type: "array", items: { type: "string" } };
    case "stringsOrNull": return { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] };
    case "scalar": return { type: ["string", "number", "boolean", "null"] };
    case "object": return { type: "object", additionalProperties: true };
    case "array": return { type: "array", items: {} };
  }
}

/** Advertise exactly the fields the engine parses, including the discriminator.
 * Listing only op causes constrained tool generation to omit the payload fields.
 * Semantic rules (field eligibility, revisions, aliases) remain the engine's job.
 */
export const TABLE_OPERATION_SCHEMA: Schema = {
  anyOf: Object.entries(OPERATIONS).map(([op, rules]) => ({
    type: "object",
    properties: {
      op: { type: "string", enum: [op] },
      ...Object.fromEntries(Object.entries({ ...rules.required, ...rules.optional }).map(([key, rule]) => [key, fieldSchema(rule)])),
    },
    required: ["op", ...Object.keys(rules.required)],
    additionalProperties: false,
  })),
};
