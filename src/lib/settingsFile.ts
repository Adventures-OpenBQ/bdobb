// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { DEFAULT_FUNCTION_ROUNDS, normalizeFunctionRounds } from "./agent/limits";
import { normalizeMcpUrl } from "./agent/mcp";
import { mergeSeenTools } from "./agent/proxiedTools";
import type { McpServerConfig } from "./agent/types";
import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";
import { safeUrl } from "./safeUrl";
import { isShareTarget } from "./shareTargets";
import type { Settings } from "./types";

const PATH = "settings.json";

export const VALID_MAX_DECIMALS = [0, 1, 2, 3, 4, 5] as const;

/** Off is the absence of the key, so it is not in this list. */
export const VALID_AUTO_REFRESH = [1, 5, 15, 30, 60] as const;

export const BOOLEAN_FIELDS = [
  "matchDashboardSymbol",
  "minimizeButton",
  "collapseWidgetControls",
  "cornerDragHandles",
  "quickAddToolbar",
  // The AI Library's one boolean (v6.0.0).
  "contextSharing",
  "agentPromptSuggestions",
] as const;

/**
 * The collapsed rail's width bounds, in px. Exported so the Settings slider
 * and the load-time clamp read the same two numbers -- a dialog that offered
 * a value the loader would clamp away would be a silently broken control.
 */
export const RAIL_WIDTH_MIN = 24;
export const RAIL_WIDTH_MAX = 120;

/**
 * The dashboard grid gap's bounds, in px. Exported so the Settings slider and
 * the load-time clamp read the same two numbers, same reasoning as
 * RAIL_WIDTH_MIN/MAX above.
 */
export const WIDGET_GAP_MIN = 1;
export const WIDGET_GAP_MAX = 25;

/**
 * How long the Rita rail waits, in ms, before expanding under the pointer.
 * 0 is instant -- the behaviour every other hover panel still has. The cap is
 * deliberately short of a second and a half: past that the rail reads as
 * broken rather than deliberate, and Pin is the answer to wanting it open.
 */
export const RITA_HOVER_DELAY_MIN = 0;
export const RITA_HOVER_DELAY_MAX = 2000;

/** Rounded and clamped into [min, max]; `fallback` when not a finite number. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value as number))) : fallback;
}

/** The one clamp for ritaHoverDelayMs, on both paths, as clampWidgetGap is. */
export function clampRitaHoverDelay(value: unknown): number {
  return clampInt(value, RITA_HOVER_DELAY_MIN, RITA_HOVER_DELAY_MAX, DEFAULT_SETTINGS.ritaHoverDelayMs);
}

/**
 * The one clamp for widgetGap, shared by the load-time normalizer below and
 * settingsStore.save() -- so a value written through either path is rounded,
 * finite-guarded and bounds-clamped identically, and neither can persist a
 * gap the other would silently correct on next load.
 */
export function clampWidgetGap(value: unknown): number {
  return clampInt(value, WIDGET_GAP_MIN, WIDGET_GAP_MAX, DEFAULT_SETTINGS.widgetGap);
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontSize: "medium",
  matchDashboardSymbol: false,
  maxDecimalPlaces: 2,
  minimizeButton: false,
  collapseWidgetControls: false,
  cornerDragHandles: false,
  quickAddToolbar: true,
  railWidth: 48,
  // react-grid-layout's own default, so an untouched install renders
  // identically to before this setting existed.
  widgetGap: 10,
  ritaUrl: "",
  // Long enough that crossing the rail on the way to a card's right edge does
  // not open it, short enough to feel like a hover rather than a wait.
  ritaHoverDelayMs: 500,
  ritaMaxFunctionRounds: DEFAULT_FUNCTION_ROUNDS,
  contextSharing: false,
  agentOptions: {},
  agentPromptSuggestions: true,
  mcpServers: [],
  mcpDisabledTools: {},
  mcpSeenProxiedTools: {},
  shareTargets: [],
  numberShortcutTarget: "dashboards",
};

/**
 * A recognized-but-unrecognized-VALUE enum field (e.g. theme: "blue", or
 * maxDecimalPlaces: 9) is downgraded to the default rather than quarantining
 * the whole file — the file is otherwise well-formed, and one bad enum value
 * shouldn't cost the user every other setting they had. Unknown keys still
 * pass through via the spread, same as the isRecord load allows.
 */
function coerceBool(loaded: Partial<Settings>, key: (typeof BOOLEAN_FIELDS)[number]): boolean {
  return typeof loaded[key] === "boolean" ? loaded[key] : DEFAULT_SETTINGS[key];
}

/** Entry by entry: one bad agent or value is dropped, its neighbours kept. */
export function coerceAgentOptions(v: unknown): Settings["agentOptions"] {
  const out: Settings["agentOptions"] = {};
  if (!isRecord(v)) return out;
  for (const [agentId, options] of Object.entries(v)) {
    if (!isRecord(options)) continue;
    const kept: Record<string, boolean | string> = {};
    for (const [featureId, value] of Object.entries(options)) {
      if (typeof value === "boolean" || typeof value === "string") kept[featureId] = value;
    }
    out[agentId] = kept;
  }
  return out;
}

/** Entry by entry, never cast: one bad URL's list is dropped, its neighbours kept. */
export function coerceDisabledTools(v: unknown): Settings["mcpDisabledTools"] {
  const out: Settings["mcpDisabledTools"] = {};
  if (!isRecord(v)) return out;
  for (const [url, list] of Object.entries(v)) {
    if (Array.isArray(list)) out[url] = list.filter((t): t is string => typeof t === "string");
  }
  return out;
}

/** coerceDisabledTools' leniency, then normalized keys, de-duplicated, sorted and capped (proxiedTools.mergeSeenTools). */
export function coerceSeenProxiedTools(v: unknown): Settings["mcpSeenProxiedTools"] {
  const out: Settings["mcpSeenProxiedTools"] = {};
  for (const [url, list] of Object.entries(coerceDisabledTools(v))) {
    const key = normalizeMcpUrl(url);
    out[key] = mergeSeenTools(out[key] ?? [], list);
  }
  return out;
}

/** One MCP server row. Exported so the AI Library's add field agrees with the loader. */
export function isMcpServerConfig(v: unknown): v is McpServerConfig {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    v.id !== "" &&
    typeof v.url === "string" &&
    safeUrl(v.url) !== null &&
    typeof v.enabled === "boolean"
  );
}

/**
 * The loader's version of isMcpServerConfig: the three required fields decide
 * whether the entry survives; each optional field is kept only when it is
 * well-formed. A bad `name` must not cost the user a server they configured.
 */
export function toMcpServerConfig(v: unknown): McpServerConfig | null {
  if (!isMcpServerConfig(v)) return null;
  const r = v as McpServerConfig & Record<string, unknown>;
  const out: McpServerConfig = { id: r.id, url: r.url, enabled: r.enabled };
  if (typeof r.name === "string") out.name = r.name;
  if (typeof r.description === "string") out.description = r.description;
  if (r.authType === "oauth" || r.authType === "token") out.authType = r.authType;
  if (typeof r.allowCrossHost === "boolean") out.allowCrossHost = r.allowCrossHost;
  const s = r.source;
  if (isRecord(s) && s.kind === "file") out.source = { kind: "file" };
  else if (isRecord(s) && s.kind === "backend" && typeof s.backendId === "string" && s.backendId !== "")
    out.source = { kind: "backend", backendId: s.backendId };
  return out;
}

/** Build-time defaults apply only to a key the file lacks, so a user's later "" or [] is never reseeded. */
function seededServices(loaded: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  const rita = import.meta.env.VITE_DEFAULT_RITA_URL;
  if (!("ritaUrl" in loaded) && typeof rita === "string" && safeUrl(rita) !== null) out.ritaUrl = rita;
  const mcp = import.meta.env.VITE_DEFAULT_MCP_URL;
  if (!("mcpServers" in loaded) && typeof mcp === "string" && safeUrl(mcp) !== null) {
    out.mcpServers = [{ id: "openbq-mcp", name: "OpenBQ MCP", url: mcp, enabled: true }];
    out.mcpDisabledTools = { ...coerceDisabledTools(loaded.mcpDisabledTools), [normalizeMcpUrl(mcp)]: ["install_skill"] };
  }
  return out;
}

/**
 * Normalizes a partial settings object by validating types and enum values.
 * Used by both loadSettings (reading the on-disk file) and settingsBundle import
 * so an imported file is validated by exactly the same validator as the file on disk.
 * A recognized-but-unrecognized-VALUE enum field (e.g. theme: "blue", or
 * maxDecimalPlaces: 9) is downgraded to the default rather than quarantining
 * the whole file — the file is otherwise well-formed, and one bad enum value
 * shouldn't cost the user every other setting they had. Unknown keys still
 * pass through via the spread, same as the isRecord load allows.
 */
export function withDefaults(loaded: Partial<Settings>): Settings {
  const seeded = seededServices(loaded);
  const merged = { ...loaded, ...seeded };
  return {
    ...DEFAULT_SETTINGS,
    ...merged,
    theme:
      merged.theme === "dark" || merged.theme === "light" || merged.theme === "system"
        ? merged.theme
        : DEFAULT_SETTINGS.theme,
    fontSize:
      merged.fontSize === "medium" || merged.fontSize === "large"
        ? merged.fontSize
        : DEFAULT_SETTINGS.fontSize,
    numberShortcutTarget:
      merged.numberShortcutTarget === "dashboards" || merged.numberShortcutTarget === "workspaces"
        ? merged.numberShortcutTarget
        : DEFAULT_SETTINGS.numberShortcutTarget,
    maxDecimalPlaces: (VALID_MAX_DECIMALS as readonly number[]).includes(
      merged.maxDecimalPlaces as number,
    )
      ? (merged.maxDecimalPlaces as Settings["maxDecimalPlaces"])
      : DEFAULT_SETTINGS.maxDecimalPlaces,
    // Clamped, not downgraded: an out-of-range slider value is still the
    // user's intent, and the nearest legal width honours it. Non-finite
    // (which JSON cannot express, so only an in-process caller can supply)
    // and absent both fall back to the default. Rounded as well, since the
    // settings importer (settingsBundle.ts) refuses a fractional width.
    railWidth: clampInt(merged.railWidth, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX, DEFAULT_SETTINGS.railWidth),
    // Same clamp-not-downgrade reasoning as railWidth, plus a round: the
    // slider only ever produces integers, so a fractional value can only
    // come from a hand-edited file, and the nearest px still honours it.
    widgetGap: clampWidgetGap(merged.widgetGap),
    // Same clamp-not-downgrade reasoning again.
    ritaHoverDelayMs: clampRitaHoverDelay(merged.ritaHoverDelayMs),
    ritaMaxFunctionRounds: normalizeFunctionRounds(merged.ritaMaxFunctionRounds),
    // Off is `undefined`, which JSON.stringify drops on the way back out —
    // so an unrecognised value silently becomes Off rather than persisting.
    autoRefreshMinutes: (VALID_AUTO_REFRESH as readonly number[]).includes(
      merged.autoRefreshMinutes as number,
    )
      ? (merged.autoRefreshMinutes as Settings["autoRefreshMinutes"])
      : undefined,
    // Neither of these has an enum to fall back to, so a wrong-typed one is
    // simply dropped — still a downgrade, never a quarantine.
    defaultTicker: typeof merged.defaultTicker === "string" ? merged.defaultTicker : undefined,
    dashboardOrder:
      Array.isArray(merged.dashboardOrder) &&
      merged.dashboardOrder.every((x) => typeof x === "string")
        ? merged.dashboardOrder
        : undefined,
    workspaceOrder:
      Array.isArray(merged.workspaceOrder) &&
      merged.workspaceOrder.every((x) => typeof x === "string")
        ? merged.workspaceOrder
        : undefined,
    // Only the shape is checked here. Whether the id still names a
    // connection is decided once connections have loaded (storageConnection
    // in workspaceStore), because settings load before backends.json and
    // workspace.json do. Anything else is Local, i.e. absent.
    settingsStorage:
      typeof merged.settingsStorage === "string" && merged.settingsStorage !== "" ? merged.settingsStorage : undefined,
    ...(Object.fromEntries(BOOLEAN_FIELDS.map((k) => [k, coerceBool(merged, k)])) as
      Pick<Settings, (typeof BOOLEAN_FIELDS)[number]>),
    agentOptions: coerceAgentOptions(merged.agentOptions),
    // Rita is off until a URL is set; a stored URL that no longer parses
    // downgrades to off, the same way a bad theme downgrades to the default.
    ritaUrl:
      typeof merged.ritaUrl === "string" && (merged.ritaUrl === "" || safeUrl(merged.ritaUrl) !== null)
        ? merged.ritaUrl
        : DEFAULT_SETTINGS.ritaUrl,
    // A malformed list entry is dropped on its own; its neighbours survive.
    mcpServers: Array.isArray(merged.mcpServers)
      ? merged.mcpServers.map(toMcpServerConfig).filter((s) => s !== null)
      : [],
    mcpDisabledTools: coerceDisabledTools(merged.mcpDisabledTools),
    mcpSeenProxiedTools: coerceSeenProxiedTools(merged.mcpSeenProxiedTools),
    shareTargets: Array.isArray(loaded.shareTargets) ? loaded.shareTargets.filter(isShareTarget) : [],
  };
}

export async function loadSettings(): Promise<Settings> {
  // Forward-compatible, and deliberately shallow: anything JSON-object-shaped
  // loads. A field-level disagreement is NOT a reason to quarantine — that
  // would cost the user every other setting they had over one bad value, which
  // is exactly the data loss the downgrade discipline above exists to avoid.
  // withDefaults normalizes every known field (wrong TYPE and unrecognized
  // VALUE alike), and unrecognized keys pass through unchanged, so a
  // settings.json written by a newer release still loads.
  const loaded = await loadJson(PATH, isRecord);
  if (loaded === ABSENT) {
    await saveJson(PATH, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return withDefaults(loaded as Partial<Settings>);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await saveJson(PATH, settings);
}
