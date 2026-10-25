// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isFoldersFile, type FoldersFile } from "./foldersFile";
import { importRefusal } from "./importLimits";
import { isRecord } from "./isRecord";
import {
  BOOLEAN_FIELDS,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  VALID_AUTO_REFRESH,
  VALID_MAX_DECIMALS,
} from "./settingsFile";
import type { Settings } from "./types";

/** The name the export offers and the import's file filter names. */
export const BUNDLE_FILENAME = "bdobb-settings.json";
/** The tag the strict importer requires; an older, tagless file is still accepted. */
export const BUNDLE_KIND = "bdobb-settings";
/** The only version this build writes and the highest it reads. */
export const BUNDLE_VERSION = 1;

/**
 * Every Settings key the bundle carries. Explicit rather than derived:
 * DEFAULT_SETTINGS holds only the REQUIRED fields, so deriving from it
 * silently dropped autoRefreshMinutes and defaultTicker -- both optional,
 * both real settings. dashboardOrder is excluded as it always has been (see
 * foldersStore.replaceAll for why the folder tree is a separate member
 * instead) -- importApps mints a fresh crypto.randomUUID() for every
 * imported dashboard, and an exported order therefore names ids that exist
 * nowhere on the destination. v3 has no widgetGap (that field arrives at a
 * later version) -- it must not be listed here. settingsStorage is excluded
 * too: it names a connection on THIS machine, and on another machine it
 * would name nothing.
 */
export const BUNDLE_SETTINGS_KEYS = [
  "theme",
  "fontSize",
  "matchDashboardSymbol",
  "maxDecimalPlaces",
  "minimizeButton",
  "collapseWidgetControls",
  "cornerDragHandles",
  "quickAddToolbar",
  "railWidth",
  "autoRefreshMinutes",
  "defaultTicker",
] as const satisfies readonly (keyof Settings)[];

/**
 * Compile-time proof the list above is COMPLETE, not merely valid. `satisfies`
 * only checks the entries are real Settings keys; this fails the build if a
 * Settings field is added and not listed here (or deliberately excluded, as
 * dashboardOrder is).
 */
type UnlistedSettingsKey = Exclude<
  keyof Settings,
  (typeof BUNDLE_SETTINGS_KEYS)[number] | "dashboardOrder" | "settingsStorage"
>;
const _allKeysListed: UnlistedSettingsKey extends never ? true : never = true;
void _allKeysListed;

const ALLOWED = new Set<string>(BUNDLE_SETTINGS_KEYS);

/**
 * The shape sniff, and the ONLY one: the drop handler needs the answer
 * before it commits to a path, and a second copy would eventually disagree
 * with what the import accepts. Same discipline as isAppsJson.
 *
 * An object carrying at least one member we recognise. `apps.json` and
 * `backends.json` are both arrays, so neither can be mistaken for this.
 */
export function isSettingsBundle(value: unknown): value is { settings?: unknown; folders?: unknown } {
  if (!isRecord(value)) return false;
  return isRecord(value.settings) || isRecord(value.folders);
}

/**
 * A versioned file. Absent defaultTicker/autoRefreshMinutes are written as
 * `null` rather than omitted, so the file is explicit about "off/cleared"
 * rather than leaving a reader to infer it from absence. An empty folder tree
 * is omitted so importing the file elsewhere leaves that machine's tree alone.
 */
export function exportBundle(settings: Settings, folders: FoldersFile): string {
  const portable = Object.fromEntries(
    BUNDLE_SETTINGS_KEYS.map((key) => {
      const v = settings[key];
      // The two optionals become explicit null when absent.
      if ((key === "defaultTicker" || key === "autoRefreshMinutes") && v === undefined) return [key, null];
      return [key, v];
    }),
  );
  return `${JSON.stringify(
    {
      kind: BUNDLE_KIND,
      version: BUNDLE_VERSION,
      settings: portable,
      ...(folders.folders.length > 0 ? { folders } : {}),
    },
    null,
    2,
  )}\n`;
}

export type SettingsImportPlan =
  | { ok: false; refusal: string }
  | {
      ok: true;
      patch: Partial<Settings>;
      folders: FoldersFile | null;
      review: string[];
      folderReview: string | null;
      warnings: string[];
      notice: string;
    };

/** v3 has only two themes -- no "system" option exists on this line. */
const THEMES = ["dark", "light"] as const;
const FONT_SIZES = ["medium", "large"] as const;

/** A field-specific human label for the review lines. */
const LABELS: Record<string, string> = {
  theme: "Theme",
  fontSize: "Font size",
  autoRefreshMinutes: "Auto-refresh",
  defaultTicker: "Default ticker",
  matchDashboardSymbol: "Match dashboard symbol",
  maxDecimalPlaces: "Maximum decimal places",
  minimizeButton: "Minimize button",
  collapseWidgetControls: "Collapse widget controls",
  cornerDragHandles: "Corner drag handles",
  quickAddToolbar: "Quick add toolbar",
  railWidth: "Collapsed rail width",
};

const fmt = (v: unknown): string => (v === undefined || v === null ? "off" : String(v));

type FieldResult = { ok: true; value: unknown } | { ok: false; refusal: string };

/** Strict per-field validation: unlike the on-disk loader, a bad value refuses. */
function validateField(key: string, raw: unknown): FieldResult {
  const isNull = raw === null;
  switch (key) {
    case "theme":
      return (THEMES as readonly string[]).includes(raw as string)
        ? { ok: true, value: raw }
        : { ok: false, refusal: "theme must be dark or light." };
    case "fontSize":
      return (FONT_SIZES as readonly string[]).includes(raw as string)
        ? { ok: true, value: raw }
        : { ok: false, refusal: "fontSize must be medium or large." };
    case "autoRefreshMinutes":
      if (isNull) return { ok: true, value: undefined };
      return (VALID_AUTO_REFRESH as readonly number[]).includes(raw as number)
        ? { ok: true, value: raw }
        : { ok: false, refusal: "autoRefreshMinutes must be 1, 5, 15, 30 or 60." };
    case "defaultTicker":
      if (isNull) return { ok: true, value: undefined };
      return typeof raw === "string"
        ? { ok: true, value: raw }
        : { ok: false, refusal: "defaultTicker must be text." };
    case "maxDecimalPlaces":
      return (VALID_MAX_DECIMALS as readonly number[]).includes(raw as number)
        ? { ok: true, value: raw }
        : { ok: false, refusal: "maxDecimalPlaces must be a whole number from 0 to 5." };
    case "railWidth":
      return typeof raw === "number" && Number.isInteger(raw) && raw >= RAIL_WIDTH_MIN && raw <= RAIL_WIDTH_MAX
        ? { ok: true, value: raw }
        : { ok: false, refusal: `railWidth must be a whole number from ${RAIL_WIDTH_MIN} to ${RAIL_WIDTH_MAX}.` };
    default:
      // A boolean field.
      if ((BOOLEAN_FIELDS as readonly string[]).includes(key)) {
        return typeof raw === "boolean"
          ? { ok: true, value: raw }
          : { ok: false, refusal: `${key} must be true or false.` };
      }
      return { ok: false, refusal: `${key} is not a setting this app understands.` };
  }
}

/**
 * What importing a bundle would do, decided without touching a store: the
 * prefs patch, the folder tree (or null for "leave it alone"), the review
 * lines for a confirmation UI, and non-fatal warnings -- or the reason to
 * refuse outright. A field-specific refusal (an unrecognised enum value, a
 * wrong type) stops the whole import rather than silently dropping just that
 * field: unlike the on-disk loader, an import is a file the user chose just
 * now, and a value it cannot honour is worth surfacing rather than downgrading
 * out from under them.
 */
export function planSettingsImport(text: string, bytes: number, current: Settings): SettingsImportPlan {
  // Before the parse, as the apps.json import does: parsing a huge file is
  // the freeze this ceiling exists to prevent.
  const oversize = importRefusal(bytes);
  if (oversize !== null) return { ok: false, refusal: oversize };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, refusal: "That file is not JSON." };
  }
  if (!isSettingsBundle(parsed)) {
    return { ok: false, refusal: "That file is not a bdobb-settings file: expected a settings object." };
  }

  const record = parsed as { kind?: unknown; version?: unknown; settings?: unknown; folders?: unknown };
  // No kind/version at all is the pre-envelope shape; it is still accepted,
  // just under a notice, rather than refused outright.
  const olderFormat = record.kind === undefined && record.version === undefined;
  if (!olderFormat) {
    if (record.kind !== BUNDLE_KIND) return { ok: false, refusal: "That file is not a bdobb-settings file." };
    if (record.version !== undefined) {
      if (typeof record.version !== "number") {
        return { ok: false, refusal: "That settings file's version is not a number." };
      }
      if (record.version > BUNDLE_VERSION) {
        return { ok: false, refusal: `That settings file is version ${record.version}; this app understands version ${BUNDLE_VERSION}.` };
      }
    }
  }

  const rawSettings = isRecord(record.settings) ? record.settings : {};
  const patch: Partial<Settings> = {};
  const review: string[] = [];
  const warnings: string[] = [];
  const unknown: string[] = [];

  for (const [key, value] of Object.entries(rawSettings)) {
    if (!ALLOWED.has(key)) {
      unknown.push(key);
      continue;
    }
    const result = validateField(key, value);
    if (!result.ok) return { ok: false, refusal: result.refusal };
    (patch as Record<string, unknown>)[key] = result.value;
    if (result.value !== current[key as keyof Settings]) {
      review.push(`${LABELS[key]}: ${fmt(current[key as keyof Settings])} → ${fmt(result.value)}`);
    }
  }
  if (unknown.length > 0) warnings.push(`Ignored unknown fields: ${unknown.join(", ")}.`);

  let folders: FoldersFile | null = null;
  let folderReview: string | null = null;
  if (record.folders !== undefined) {
    if (isFoldersFile(record.folders)) {
      folders = record.folders;
      folderReview =
        folders.folders.length === 0
          ? "Folders: clear the folder tree"
          : `Folders: replace ${folders.folders.length} folder${folders.folders.length === 1 ? "" : "s"}`;
    } else {
      warnings.push("Ignored an invalid folder tree.");
    }
  }

  return {
    ok: true,
    patch,
    folders,
    review,
    folderReview,
    warnings,
    notice: olderFormat ? "Older settings file; imported the fields it names." : "",
  };
}
