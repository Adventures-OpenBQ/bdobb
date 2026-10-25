// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { privateMcpUrls, privateNetworkWarning, sanitizeImportedMcpServer } from "./agent/importedMcp";
import { isFoldersFile, type FoldersFile } from "./foldersFile";
import { importRefusal } from "./importLimits";
import { isRecord } from "./isRecord";
import { safeUrl } from "./safeUrl";
import { MAX_FUNCTION_ROUNDS, MIN_FUNCTION_ROUNDS } from "./agent/limits";
import { isShareTarget } from "./shareTargets";
import {
  BOOLEAN_FIELDS,
  isMcpServerConfig,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  RITA_HOVER_DELAY_MAX,
  RITA_HOVER_DELAY_MIN,
  VALID_AUTO_REFRESH,
  VALID_MAX_DECIMALS,
  WIDGET_GAP_MAX,
  WIDGET_GAP_MIN,
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
 * both real settings -- and withDefaults' own result cannot be used either,
 * because it spreads `...loaded` and would carry unknown keys through.
 * dashboardOrder is absent by design; it is never exported or imported.
 * This line DOES carry the AI Library's tabs, so its five settings are listed
 * below and validated like every other field -- see the note on them there.
 * settingsStorage is excluded too: it names a connection on THIS machine,
 * and on another machine it would name nothing.
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
  "widgetGap",
  "autoRefreshMinutes",
  "defaultTicker",
  // The AI Library's five, added in v6.0.0. They are here because the bundle
  // carries EVERY setting, which is a deliberate ruling and not an oversight:
  // a shareTargets row can carry request headers and an mcpServers row can
  // name a private address, so bdobb-settings.json is a file that may hold
  // credentials in the clear. Treat an exported bundle as a secret.
  "ritaUrl",
  "ritaHoverDelayMs",
  // Adaptation 5: a portable preference (1-40), carried like ritaHoverDelayMs.
  "ritaMaxFunctionRounds",
  "contextSharing",
  "mcpServers",
  "shareTargets",
  // v5.6.0 (Workspaces): a portable preference about how the keyboard behaves
  // -- unlike dashboardOrder/workspaceOrder it names no machine-local id, so it
  // is carried in the bundle exactly like theme and fontSize.
  "numberShortcutTarget",
  // v6.1.1's two, from the Workspace agent and MCP parity work: the user's
  // per-agent answers to agents.json features, and the per-server list of MCP
  // tools they switched off. Both are real settings a restore has to bring
  // back, and neither holds a secret of its own -- but mcpDisabledTools is
  // keyed by the server's NORMALIZED URL, so an export still names every MCP
  // address the user configured. The paragraph above applies unchanged.
  "agentOptions",
  "mcpDisabledTools",
  // The effective names seen behind call_tool / run_pipeline, so a restore
  // brings back the per-tool switches' list too. Same keys-are-URLs note as above.
  "mcpSeenProxiedTools",
] as const satisfies readonly (keyof Settings)[];

/**
 * Compile-time proof the list above is COMPLETE, not merely valid. `satisfies`
 * only checks the entries are real Settings keys; this fails the build if a
 * Settings field is added and not listed here (or deliberately excluded, as
 * dashboardOrder is). v6.0.0's AI Library added five keys and v6.1.1's agent
 * and MCP parity work two more — this is what stopped all seven being
 * forgotten when these commits were ported onto this line.
 * agentPromptSuggestions is deliberately excluded too: it is client
 * presentation only (it gates whether chatStore keeps a suggestions event),
 * never sent in a request and not part of the exchangeable file a restore has
 * to bring back. */
type UnlistedSettingsKey = Exclude<
  keyof Settings,
  (typeof BUNDLE_SETTINGS_KEYS)[number] | "dashboardOrder" | "workspaceOrder" | "agentPromptSuggestions" | "settingsStorage"
>;
const _allKeysListed: UnlistedSettingsKey extends never ? true : never = true;
void _allKeysListed;

const ALLOWED = new Set<string>(BUNDLE_SETTINGS_KEYS);

/**
 * Members are optional and additive: a reader takes the ones it understands
 * and ignores the rest, so a file written by a later version imports here
 * carrying only what this version knows about, and vice versa. The envelope
 * (kind/version) below is what lets a bad value in one of those members be
 * refused outright instead of silently downgraded -- see planSettingsImport.
 */
export type SettingsBundle = {
  settings?: Partial<Settings>;
  folders?: FoldersFile;
};

/**
 * The shape sniff, and the ONLY one: the drop handler needs the answer
 * before it commits to a path, and a second copy would eventually disagree
 * with what the import accepts. Same discipline as isAppsJson.
 *
 * An object carrying at least one member we recognise. `apps.json` and
 * `backends.json` are both arrays, so neither can be mistaken for this.
 */
export function isSettingsBundle(value: unknown): value is SettingsBundle {
  if (!isRecord(value)) return false;
  return isRecord(value.settings) || isRecord(value.folders);
}

/**
 * Filtered to BUNDLE_SETTINGS_KEYS rather than spread wholesale: `settings`
 * can carry keys this version has never heard of, and this is the format
 * that becomes a secret two versions from now -- it must not ship fields it
 * cannot name. dashboardOrder is dropped as a side effect of the allowlist,
 * rather than at the call site, so no exporter can forget it: importApps
 * mints a fresh crypto.randomUUID() for every imported dashboard, and an
 * exported order therefore names ids that exist nowhere on the destination.
 *
 * A versioned file. Absent defaultTicker/autoRefreshMinutes are written as
 * `null` rather than omitted, so the file is explicit about "off/cleared"
 * rather than leaving a reader to infer it from absence. An empty folder
 * tree is omitted so importing the file elsewhere leaves that machine's
 * tree alone.
 */
export function exportBundle(settings: Settings, folders: FoldersFile): string {
  const portable = Object.fromEntries(
    BUNDLE_SETTINGS_KEYS.map((key) => {
      const v = settings[key];
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

const THEMES = ["dark", "light", "system"] as const;
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
  widgetGap: "Dashboard widget spacing",
  numberShortcutTarget: "Option-number shortcuts",
  ritaUrl: "Rita URL",
  ritaHoverDelayMs: "Rita hover delay",
  ritaMaxFunctionRounds: "Rita tool-round limit",
  contextSharing: "Share dashboard context",
  mcpServers: "MCP servers",
  shareTargets: "Share targets",
  agentOptions: "Agent features",
  mcpDisabledTools: "Turned-off MCP tools",
  mcpSeenProxiedTools: "Proxied MCP tools seen",
};

/**
 * A review line's value. A record-valued setting (v6.1.1's agentOptions and
 * mcpDisabledTools are the only two) would otherwise read "[object Object]",
 * so it is summarised by how many entries it carries; every other kind is
 * unchanged.
 */
const fmt = (v: unknown): string => {
  if (v === undefined || v === null) return "off";
  if (isRecord(v)) {
    const n = Object.keys(v).length;
    return `${n} ${n === 1 ? "entry" : "entries"}`;
  }
  return String(v);
};

type FieldResult = { ok: true; value: unknown } | { ok: false; refusal: string };

const check = (pass: boolean, raw: unknown, refusal: string): FieldResult =>
  pass ? { ok: true, value: raw } : { ok: false, refusal };

const intIn = (raw: unknown, key: string, min: number, max: number): FieldResult =>
  check(typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max, raw, `${key} must be a whole number from ${min} to ${max}.`);

/**
 * Strict per-field validation: unlike the on-disk loader (withDefaults),
 * which downgrades a bad value to the default so a corrupt settings.json
 * never costs the user their other prefs, a bad value in a file the user
 * just chose to import is worth surfacing rather than silently dropping --
 * so this refuses the whole import instead. railWidth/widgetGap bounds are
 * the same RAIL_WIDTH_MIN/MAX and WIDGET_GAP_MIN/MAX the slider and the
 * on-disk clamp use, not restated numbers.
 */
function validateField(key: string, raw: unknown): FieldResult {
  const isNull = raw === null;
  switch (key) {
    case "theme":
      return check((THEMES as readonly string[]).includes(raw as string), raw, "theme must be dark, light or system.");
    case "fontSize":
      return check((FONT_SIZES as readonly string[]).includes(raw as string), raw, "fontSize must be medium or large.");
    case "autoRefreshMinutes":
      if (isNull) return { ok: true, value: undefined };
      return check((VALID_AUTO_REFRESH as readonly number[]).includes(raw as number), raw, "autoRefreshMinutes must be 1, 5, 15, 30 or 60.");
    case "defaultTicker":
      if (isNull) return { ok: true, value: undefined };
      return check(typeof raw === "string", raw, "defaultTicker must be text.");
    case "maxDecimalPlaces":
      return check((VALID_MAX_DECIMALS as readonly number[]).includes(raw as number), raw, "maxDecimalPlaces must be a whole number from 0 to 5.");
    case "railWidth":
      return intIn(raw, key, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX);
    case "widgetGap":
      return intIn(raw, key, WIDGET_GAP_MIN, WIDGET_GAP_MAX);
    case "numberShortcutTarget":
      // v5.6.0 (Workspaces): what ⌥ 1–⌥ 9 select. Two literal values only.
      return raw === "dashboards" || raw === "workspaces"
        ? { ok: true, value: raw }
        : { ok: false, refusal: "numberShortcutTarget must be dashboards or workspaces." };
    case "ritaUrl":
      // "" is Rita off, and is how the field ships -- so it is a value, not a
      // missing one. Anything else must survive safeUrl, the same gate the
      // on-disk loader applies.
      return typeof raw === "string" && (raw === "" || safeUrl(raw) !== null)
        ? { ok: true, value: raw }
        : { ok: false, refusal: "ritaUrl must be empty or an http(s) URL." };
    case "ritaHoverDelayMs":
      return intIn(raw, key, RITA_HOVER_DELAY_MIN, RITA_HOVER_DELAY_MAX);
    case "ritaMaxFunctionRounds":
      return intIn(raw, key, MIN_FUNCTION_ROUNDS, MAX_FUNCTION_ROUNDS);
    case "mcpServers":
      // Every row, not merely the array: the on-disk loader FILTERS bad rows
      // out, which is the lenient half. Here one bad row refuses the import,
      // so the user is told rather than quietly losing a server.
      //
      // Then the consent gate every MCP import path shares (Task C1): a
      // settings file is one the user picked, not necessarily one the user
      // wrote, and before C1 this path installed servers exactly as the file
      // said -- a backend-sourced "token" server arriving enabled with
      // allowCrossHost set would forward that backend's credential to the
      // file's host with no click. sanitizeImportedMcpServer applies the AI
      // Library import's own rules (switched off, allowCrossHost stripped);
      // every row has passed isMcpServerConfig, so none is dropped. The
      // address is kept, so the file is still a full backup.
      return Array.isArray(raw) && raw.every(isMcpServerConfig)
        ? {
            ok: true,
            value: raw.map(sanitizeImportedMcpServer).filter((s) => s !== null),
          }
        : { ok: false, refusal: "mcpServers must be a list of MCP server entries." };
    case "shareTargets":
      return Array.isArray(raw) && raw.every(isShareTarget)
        ? { ok: true, value: raw }
        : { ok: false, refusal: "shareTargets must be a list of share targets." };
    case "agentOptions":
      // v6.1.1: the user's per-agent answers to agents.json features. The
      // accepted shape is coerceAgentOptions' own -- a record of records of
      // boolean|string -- so the lenient and strict paths cannot drift. Strict
      // where the loader is lenient: coerceAgentOptions drops a bad feature
      // value and keeps its neighbours, while a file the user just chose to
      // import is refused whole so they are told.
      return isRecord(raw) &&
        Object.values(raw).every(
          (o) => isRecord(o) && Object.values(o).every((v) => typeof v === "boolean" || typeof v === "string"),
        )
        ? { ok: true, value: raw }
        : { ok: false, refusal: "agentOptions must map each agent id to its feature values." };
    case "mcpSeenProxiedTools":
    case "mcpDisabledTools":
      // v6.1.1: the tools the user switched off, keyed by the server's
      // NORMALIZED url. coerceDisabledTools' shape, for the same reason.
      return isRecord(raw) &&
        Object.values(raw).every((list) => Array.isArray(list) && list.every((t) => typeof t === "string"))
        ? { ok: true, value: raw }
        : { ok: false, refusal: `${key} must map each MCP server URL to a list of tool names.` };
    default:
      // A boolean field.
      if ((BOOLEAN_FIELDS as readonly string[]).includes(key)) {
        return check(typeof raw === "boolean", raw, `${key} must be true or false.`);
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
 * now, and a value it cannot honour is worth surfacing rather than
 * downgrading out from under them.
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
        return {
          ok: false,
          refusal: `That settings file is version ${record.version}; this app understands version ${BUNDLE_VERSION}.`,
        };
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
  // MCP servers on this computer or a private network are named, never
  // refused -- the same warning, from the same helper, as the AI Library and
  // apps.json imports (main ac2d3475's rule, ported down by user ruling).
  if (patch.mcpServers !== undefined) {
    const local = privateMcpUrls(patch.mcpServers);
    if (local.length > 0) warnings.push(privateNetworkWarning(local));
  }

  // A corrupt or unrecognised folders member costs the user only that
  // member. The same validator the file on disk is read with, since it IS
  // that file.
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
