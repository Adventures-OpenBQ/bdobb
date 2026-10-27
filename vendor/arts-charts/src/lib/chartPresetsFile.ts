// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";
import type { Series, StudyInstance } from "./types";

export const CHART_PRESETS_PATH = "chart-presets.json";

/**
 * A saved bundle (studies addendum §5.5, and the plan's "Deliberate
 * simplifications" table): "Save as..." names a SERIES bundle from v12.4.0
 * on -- the card's whole list, each series with the panel and the side it
 * draws on. `kind: "studies"` is what v12.3.x wrote and is still read (the
 * palette lists both, and the chart loads one by placing each study where a
 * new one would land); `kind: "chart"` is the shape a full chart preset
 * ("writes the whole spec") will use once slice 2's `{ }` Apply reads one.
 * All three live in the one file so that later work is additive rather
 * than a migration.
 */
export type ChartPreset =
  | { kind: "studies"; name: string; studies: StudyInstance[] }
  | { kind: "series"; name: string; series: Series[] }
  | { kind: "chart"; name: string; spec: unknown };

function isParams(value: unknown): value is Record<string, number | string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "number" || typeof v === "string");
}

/**
 * Lenient on purpose, like every other JSON-file validator in this app: a
 * study instance's `style` is presentation-only and unvalidated here, so a
 * newer release's extra style field still round-trips through an older
 * build rather than sinking the whole preset.
 *
 * Lenient on FIELDS, not on `kind`: isChartPreset below drops an entry
 * whose kind is none of the three, and savePreset writes the filtered list
 * back, so a newer build's fourth kind would be deleted by an older build's
 * first "Save as...". Unreachable while these three are all there are; if a
 * fourth is ever added, loadChartPresets has to keep the unknown entries
 * alongside and saveChartPresets write them back.
 */
function isStudyInstance(value: unknown): value is StudyInstance {
  return (
    isRecord(value) &&
    typeof value.expr === "string" &&
    typeof value.name === "string" &&
    typeof value.color === "string" &&
    (value.source === "local" || value.source === "eodhd") &&
    isParams(value.params)
  );
}

/**
 * A series, read as leniently as a study instance above: the fields the
 * chart cannot draw without (what it is, where it goes) are checked, and
 * `style`, `anchor` and a newer release's additions ride through
 * untouched. `type` is deliberately NOT checked against the seven names:
 * an unknown one draws nothing and is editable out of the card, which is a
 * kinder failure than a bundle that vanishes.
 *
 * Two fields are NOT lenient (the branch-end round, finding 4), because the
 * renderer calls methods on them: a hand-edited `chart-presets.json` whose
 * `symbol` is a number threw on `startsWith`, and a `panel` of `NaN` passed
 * `typeof === "number"` and clamped to `NaN`.
 */
export function isSeries(value: unknown): value is Series {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.expr === "string" &&
    typeof value.color === "string" &&
    (value.symbol === undefined || (typeof value.symbol === "string" && value.symbol !== "")) &&
    Number.isInteger(value.panel) && (value.panel as number) >= 1 &&
    (value.side === "left" || value.side === "right") &&
    isParams(value.params)
  );
}

function isChartPreset(value: unknown): value is ChartPreset {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  if (value.kind === "studies") return Array.isArray(value.studies) && value.studies.every(isStudyInstance);
  if (value.kind === "series") return Array.isArray(value.series) && value.series.every(isSeries);
  return value.kind === "chart";
}

/**
 * The file's own top-level shape is a bare list (jsonStore's ABSENT/quarantine
 * discipline still applies to THAT: a file that is not a list at all -- an
 * object, a bare string -- is corruption and is quarantined like any other
 * store). A malformed ENTRY inside an otherwise-list file is a different
 * failure: dropped alone by loadChartPresets below, never taking the file
 * or its well-formed neighbours down with it.
 */
function isPresetList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export async function loadChartPresets(): Promise<ChartPreset[]> {
  const loaded = await loadJson(CHART_PRESETS_PATH, isPresetList);
  if (loaded === ABSENT) return [];
  return loaded.filter(isChartPreset);
}

export async function saveChartPresets(list: ChartPreset[]): Promise<void> {
  await saveJson(CHART_PRESETS_PATH, list);
}

/** Same name replaces in place, regardless of `kind`; a new name appends. */
export function upsertPreset(list: ChartPreset[], preset: ChartPreset): ChartPreset[] {
  const i = list.findIndex((p) => p.name === preset.name);
  if (i === -1) return [...list, preset];
  return list.map((p, idx) => (idx === i ? preset : p));
}

export function removePreset(list: ChartPreset[], name: string): ChartPreset[] {
  return list.filter((p) => p.name !== name);
}
