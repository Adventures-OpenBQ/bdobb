// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import type { PanelDef } from "./chart/panels";
import { isSeries } from "./chartPresetsFile";
import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";
import type { Series } from "./types";

/**
 * The saved layout library (spec 2026-09-24, D1). A layout is a NAME, a NOTE,
 * the PANELS and the SERIES -- not the symbol, interval, range or session, so
 * one layout works on any symbol and any timeframe (D2). Applying a layout
 * mints fresh series identifiers (chart/layouts.ts, D4), which is why an
 * entry's stored ids do not matter here.
 *
 * A SEPARATE versioned file, deliberately not a fourth `kind` in
 * chart-presets.json (D1). chartPresetsFile's own comment spells out why: its
 * validator DROPS an entry whose kind it does not know and writes the filtered
 * list back, so an older build's first save would delete a newer build's
 * layouts -- and episodes are restored against this same application-data
 * directory often enough here for that to be a real loss. This file inverts
 * that rule: the validator KEEPS entries it does not fully understand, and a
 * genuinely malformed file is refused WHOLE (quarantined by jsonStore, read as
 * empty) rather than filtered to the subset this build happens to parse --
 * because filtering to the subset is exactly the data loss D1 exists to
 * prevent.
 */
export const CHART_LAYOUTS_PATH = "chart-layouts.json";

/** The current on-disk envelope version. Bumped only by a migration; a higher
 * number in a file on disk is NOT rejected (see isLayoutsFile) -- a newer
 * build's file must still yield its layouts to an older one. */
const CURRENT_VERSION = 1;

export type ChartLayout = {
  name: string;
  note: string;
  panels: PanelDef[];
  series: Series[];
  // At runtime an entry may also carry fields a newer build wrote; they are
  // kept verbatim through a load and a save (the property D1 exists for), so
  // this type is the fields THIS build reads, not the fields an entry has.
};

type ChartLayoutsFile = { version: number; layouts: ChartLayout[] };

/**
 * A panel object as the codec produces it (chart/panels.ts): the six head
 * numbers are what every consumer (encodePanels, scaleOrder, panelRect) reads,
 * so those are checked and the optional references/extras ride through
 * untouched -- lenient on fields, like every other validator in this app.
 */
function isPanelDef(value: unknown): value is PanelDef {
  return (
    isRecord(value) &&
    ["top", "left", "width", "height", "xmargin", "ymargin"].every((k) => Number.isFinite(value[k]))
  );
}

/**
 * A layout entry. Lenient on FIELDS (an unknown one is not looked at, so it
 * survives), strict on the three the chart cannot draw without: a name, a list
 * of panels it can lay out, and a list of series it can place. `note` is
 * optional here (an externally authored file may omit it; consumers read
 * `note ?? ""`) so its absence never sinks the whole file.
 */
function isChartLayout(value: unknown): value is ChartLayout {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.note === undefined || typeof value.note === "string") &&
    Array.isArray(value.panels) && value.panels.every(isPanelDef) &&
    Array.isArray(value.series) && value.series.every(isSeries)
  );
}

/**
 * The whole envelope: a version number and a list where EVERY entry validates.
 * One bad entry fails the whole predicate, so jsonStore quarantines the file
 * and load reads empty -- "refused whole, not partly" (D1). `version` is only
 * required to be a number: a future build may write a higher one, and refusing
 * it would quarantine (delete) a file this build could otherwise read the
 * layouts out of.
 */
function isLayoutsFile(value: unknown): value is ChartLayoutsFile {
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    Array.isArray(value.layouts) &&
    value.layouts.every(isChartLayout)
  );
}

export async function loadChartLayouts(): Promise<ChartLayout[]> {
  const loaded = await loadJson(CHART_LAYOUTS_PATH, isLayoutsFile);
  if (loaded === ABSENT) return [];
  // The entries are returned as parsed -- forward fields intact -- so a save of
  // what load returned round-trips them (D1).
  return loaded.layouts;
}

export async function saveChartLayouts(layouts: ChartLayout[]): Promise<void> {
  await saveJson(CHART_LAYOUTS_PATH, { version: CURRENT_VERSION, layouts });
}

/** Same name replaces in place (order kept); a new name appends. */
export function upsertLayout(list: ChartLayout[], layout: ChartLayout): ChartLayout[] {
  const i = list.findIndex((l) => l.name === layout.name);
  if (i === -1) return [...list, layout];
  return list.map((l, idx) => (idx === i ? layout : l));
}

export function removeLayout(list: ChartLayout[], name: string): ChartLayout[] {
  return list.filter((l) => l.name !== name);
}
