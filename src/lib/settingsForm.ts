// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";

/** The contract version this app draws (docs/settings-widgets.md). */
export const SETTINGS_CONTRACT_VERSION = 1;

const KNOWN_TYPES = new Set(["text", "number", "boolean", "select"]);

export type SettingsOption = { value: string | number | boolean; label: string };

/**
 * One field of a form section. `known` is false for a `type` this app has
 * no control for; such a field is still drawn -- read-only, as text, with a
 * note -- because the contract says an unknown field type degrades rather
 * than failing the section.
 */
export type SettingsField = {
  id: string;
  label: string;
  type: string;
  known: boolean;
  value: unknown;
  help?: string;
  readOnly: boolean;
  readOnlyReason?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: SettingsOption[];
};

export type SettingsDescription = {
  title: string;
  description: string;
  fields: SettingsField[];
  /** Only on a PUT's 200: shown once after the save ("Takes effect on restart"). */
  notice?: string;
};

export type ParsedSettings =
  | { ok: true; section: SettingsDescription }
  | { ok: false; newer: true }
  | { ok: false; newer: false; error: string };

const bad = (error: string): ParsedSettings => ({ ok: false, newer: false, error });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function toOption(value: unknown): SettingsOption | null {
  if (!isRecord(value) || typeof value.label !== "string") return null;
  const v = value.value;
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? { value: v, label: value.label } : null;
}

/**
 * One field, or null when a KNOWN type's field is malformed (no id, a value
 * of the wrong type, a select value that is not one of its options). An
 * unknown type is not malformed: it is kept with `known: false`.
 */
function toField(value: unknown): SettingsField | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "" || typeof value.type !== "string") return null;
  const field: SettingsField = {
    id: value.id,
    label: typeof value.label === "string" ? value.label : value.id,
    type: value.type,
    known: KNOWN_TYPES.has(value.type),
    value: value.value,
    readOnly: value.readOnly === true,
  };
  if (typeof value.help === "string") field.help = value.help;
  if (typeof value.readOnlyReason === "string") field.readOnlyReason = value.readOnlyReason;
  switch (value.type) {
    case "text":
      return typeof value.value === "string" ? field : null;
    case "boolean":
      return typeof value.value === "boolean" ? field : null;
    case "number":
      if (num(value.value) === undefined) return null;
      field.min = num(value.min);
      field.max = num(value.max);
      field.step = num(value.step);
      if (typeof value.unit === "string") field.unit = value.unit;
      return field;
    case "select": {
      if (!Array.isArray(value.options)) return null;
      const options = value.options.map(toOption);
      if (options.length === 0 || options.some((o) => o === null)) return null;
      field.options = options as SettingsOption[];
      return field.options.some((o) => o.value === value.value) ? field : null;
    }
    default:
      return field;
  }
}

/**
 * Validates what `GET {endpoint}` (or a PUT's 200) returned. The body is
 * untrusted JSON from a service: anything malformed is a section error the
 * dialog shows with a Retry -- never a throw, never a crash of the dialog.
 */
export function parseSettingsDescription(raw: unknown): ParsedSettings {
  if (!isRecord(raw)) return bad("The service's settings description is not a JSON object.");
  if (typeof raw.version !== "number") return bad("The service's settings description has no version.");
  if (raw.version > SETTINGS_CONTRACT_VERSION) return { ok: false, newer: true };
  if (!Array.isArray(raw.fields)) return bad("The service's settings description has no fields list.");
  const fields: SettingsField[] = [];
  const seen = new Set<string>();
  for (const f of raw.fields) {
    const field = toField(f);
    if (!field || seen.has(field.id)) return bad("A field in the service's settings description is malformed.");
    seen.add(field.id);
    fields.push(field);
  }
  const section: SettingsDescription = {
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
    fields,
  };
  if (typeof raw.notice === "string" && raw.notice !== "") section.notice = raw.notice;
  return { ok: true, section };
}
