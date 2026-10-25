// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two ceilings an apps.json import refuses above. Both exist because the
 * import used to parse whatever it was handed: a multi-hundred-MB file or a
 * thousand dashboards froze the webview before any validation ran. The byte
 * limit is checked before the file is read, the count after it is parsed --
 * the first point either number exists.
 */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_DASHBOARDS = 500;

const BYTES_PER_MB = 1024 * 1024;

/**
 * "`label` is N MB; the limit is M MB.", or null when `bytes` is within `max`.
 * The megabyte figure is rounded UP to one decimal place, so a file that is
 * even one byte over the cap reads as over (e.g. "10.1 MB") rather than
 * rounding down to the same figure as the limit itself.
 */
export function sizeRefusal(label: string, bytes: number, max: number): string | null {
  if (bytes <= max) return null;
  return `${label} is ${Math.ceil((bytes / BYTES_PER_MB) * 10) / 10} MB; the limit is ${max / BYTES_PER_MB} MB.`;
}

/**
 * The line to show the user, or null when the file is within both limits.
 * `dashboards` is omitted by the pre-parse caller, which does not know the
 * count yet; the size is re-checked on the second call so one number can be
 * passed to both.
 */
export function importRefusal(bytes: number, dashboards?: number): string | null {
  const tooBig = sizeRefusal("File", bytes, IMPORT_MAX_BYTES);
  if (tooBig) return tooBig;
  if (dashboards !== undefined && dashboards > IMPORT_MAX_DASHBOARDS) {
    return `File holds ${dashboards} dashboards; the limit is ${IMPORT_MAX_DASHBOARDS}.`;
  }
  return null;
}
