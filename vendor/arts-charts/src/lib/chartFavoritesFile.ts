// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { isSeries } from "./chartPresetsFile";
import { isRecord } from "./isRecord";
import { ABSENT, loadJson, saveJson } from "./jsonStore";
import type { Series } from "./types";

/**
 * The Favorites library (spec 2026-09-26, PART C). A favorite is ONE
 * configured series -- a study with the parameters and appearance the user
 * just set -- turned into a one-click entry in every future card's picker.
 * Not a bundle (the whole card's series); that is `chart-presets.json`'s
 * `Saved series…`, left untouched here.
 *
 * Modelled line-for-line on chartLayoutsFile.ts, and for the same reason:
 * this is a SEPARATE versioned file, deliberately NOT a fourth `kind` in
 * chart-presets.json. chartPresetsFile's own comment spells out the trap --
 * its validator DROPS an entry whose `kind` it does not know and writes the
 * filtered list back, so an older build's first save would silently delete
 * every favorite a newer build wrote. This file inverts that rule: the
 * validator KEEPS entries it does not fully understand (an unknown field
 * rides a load and a save untouched), and a genuinely malformed file is
 * refused WHOLE (quarantined by jsonStore, read as empty) rather than
 * filtered to the subset this build happens to parse -- filtering to the
 * subset is exactly the data loss this arrangement exists to prevent.
 */
export const CHART_FAVORITES_PATH = "chart-favorites.json";

/** The current on-disk envelope version. Bumped only by a migration; a higher
 * number in a file on disk is NOT rejected (see isFavoritesFile) -- a newer
 * build's file must still yield its favorites to an older one. */
const CURRENT_VERSION = 1;

export type ChartFavorite = {
  name: string;
  series: Series;
  // At runtime an entry may also carry fields a newer build wrote; they are
  // kept verbatim through a load and a save, so this type is the fields THIS
  // build reads, not the fields an entry has.
};

type ChartFavoritesFile = { version: number; favorites: ChartFavorite[] };

/**
 * A favorite entry. Lenient on FIELDS (an unknown one is not looked at, so it
 * survives), strict on the two this build cannot work without: a display name
 * and the series it stands for (isSeries is the same series validator every
 * other chart file uses).
 */
function isChartFavorite(value: unknown): value is ChartFavorite {
  return isRecord(value) && typeof value.name === "string" && isSeries(value.series);
}

/**
 * The whole envelope: a version number and a list where EVERY entry validates.
 * One bad entry fails the whole predicate, so jsonStore quarantines the file
 * and load reads empty -- refused whole, not partly. `version` is only
 * required to be a number: a future build may write a higher one, and refusing
 * it would quarantine (delete) a file this build could otherwise read the
 * favorites out of.
 */
function isFavoritesFile(value: unknown): value is ChartFavoritesFile {
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    Array.isArray(value.favorites) &&
    value.favorites.every(isChartFavorite)
  );
}

export async function loadChartFavorites(): Promise<ChartFavorite[]> {
  const loaded = await loadJson(CHART_FAVORITES_PATH, isFavoritesFile);
  if (loaded === ABSENT) return [];
  // Returned as parsed -- unknown fields intact -- so a save of what load
  // returned round-trips them.
  return loaded.favorites;
}

export async function saveChartFavorites(favorites: ChartFavorite[]): Promise<void> {
  await saveJson(CHART_FAVORITES_PATH, { version: CURRENT_VERSION, favorites });
}

/** Same name replaces in place (order kept); a new name appends. */
export function upsertFavorite(list: ChartFavorite[], favorite: ChartFavorite): ChartFavorite[] {
  const i = list.findIndex((f) => f.name === favorite.name);
  if (i === -1) return [...list, favorite];
  return list.map((f, idx) => (idx === i ? favorite : f));
}

export function removeFavorite(list: ChartFavorite[], name: string): ChartFavorite[] {
  return list.filter((f) => f.name !== name);
}
