// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";
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
 * The one clamp for widgetGap, shared by the load-time normalizer below and
 * settingsStore.save() -- so a value written through either path is rounded,
 * finite-guarded and bounds-clamped identically, and neither can persist a
 * gap the other would silently correct on next load.
 */
export function clampWidgetGap(value: unknown): number {
  return Number.isFinite(value)
    ? Math.min(WIDGET_GAP_MAX, Math.max(WIDGET_GAP_MIN, Math.round(value as number)))
    : DEFAULT_SETTINGS.widgetGap;
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
  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    theme:
      loaded.theme === "dark" || loaded.theme === "light" || loaded.theme === "system"
        ? loaded.theme
        : DEFAULT_SETTINGS.theme,
    fontSize:
      loaded.fontSize === "medium" || loaded.fontSize === "large"
        ? loaded.fontSize
        : DEFAULT_SETTINGS.fontSize,
    maxDecimalPlaces: (VALID_MAX_DECIMALS as readonly number[]).includes(
      loaded.maxDecimalPlaces as number,
    )
      ? (loaded.maxDecimalPlaces as Settings["maxDecimalPlaces"])
      : DEFAULT_SETTINGS.maxDecimalPlaces,
    // Clamped, not downgraded: an out-of-range slider value is still the
    // user's intent, and the nearest legal width honours it. Non-finite
    // (which JSON cannot express, so only an in-process caller can supply)
    // and absent both fall back to the default. Rounded as well, since the
    // settings importer (settingsBundle.ts) refuses a fractional width.
    railWidth: Number.isFinite(loaded.railWidth)
      ? Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.round(loaded.railWidth as number)))
      : DEFAULT_SETTINGS.railWidth,
    // Same clamp-not-downgrade reasoning as railWidth, plus a round: the
    // slider only ever produces integers, so a fractional value can only
    // come from a hand-edited file, and the nearest px still honours it.
    widgetGap: clampWidgetGap(loaded.widgetGap),
    // Off is `undefined`, which JSON.stringify drops on the way back out —
    // so an unrecognised value silently becomes Off rather than persisting.
    autoRefreshMinutes: (VALID_AUTO_REFRESH as readonly number[]).includes(
      loaded.autoRefreshMinutes as number,
    )
      ? (loaded.autoRefreshMinutes as Settings["autoRefreshMinutes"])
      : undefined,
    // Neither of these has an enum to fall back to, so a wrong-typed one is
    // simply dropped — still a downgrade, never a quarantine.
    defaultTicker: typeof loaded.defaultTicker === "string" ? loaded.defaultTicker : undefined,
    dashboardOrder:
      Array.isArray(loaded.dashboardOrder) &&
      loaded.dashboardOrder.every((x) => typeof x === "string")
        ? loaded.dashboardOrder
        : undefined,
    // Only the shape is checked here. Whether the id still names a
    // connection is decided once connections have loaded (storageConnection
    // in workspaceStore), because settings load before backends.json and
    // workspace.json do. Anything else is Local, i.e. absent.
    settingsStorage:
      typeof loaded.settingsStorage === "string" && loaded.settingsStorage !== "" ? loaded.settingsStorage : undefined,
    ...(Object.fromEntries(BOOLEAN_FIELDS.map((k) => [k, coerceBool(loaded, k)])) as
      Pick<Settings, (typeof BOOLEAN_FIELDS)[number]>),
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
