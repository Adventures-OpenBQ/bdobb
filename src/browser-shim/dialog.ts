// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stands in for @tauri-apps/plugin-dialog under `vite --mode browser`. The
 * app asks its yes/no questions (the deletes, and replacing a note's file)
 * through confirm(); the browser's own confirm is the right stand-in for it — Playwright drives it with
 * page.on("dialog"). The native-only options (title, kind, button labels)
 * have no browser equivalent and are ignored.
 */
export const confirm = (message: string, _options?: unknown): Promise<boolean> =>
  Promise.resolve(window.confirm(message));

/**
 * Stands in for the native save panel. A browser has none, and nothing about
 * a file picker is under test in e2e — what is under test is the bytes the
 * app writes afterwards. So this always "accepts", answering a fixed
 * /exports/ path built from the caller's own suggested name; memfs stores it
 * under `exports/<basename>`, which window.__bdobb.read can then read back.
 */
export const save = (options?: { defaultPath?: string }): Promise<string | null> => {
  const suggested = options?.defaultPath ?? "export";
  const basename = suggested.slice(suggested.lastIndexOf("/") + 1);
  return Promise.resolve(`/exports/${basename}`);
};

/**
 * Stands in for the native open panel, on the same reasoning as save() above:
 * the picker is not what is under test, the bytes the app reads afterwards
 * are. It always "accepts". The apps.json import keeps its fixed path; any
 * other filter answers `/imports/pick.<first extension>`, which a spec seeds
 * through window.__bdobbSeed before the page loads.
 */
export const open = (options?: {
  multiple?: boolean;
  filters?: { extensions: string[] }[];
}): Promise<string | null> => {
  const ext = options?.filters?.[0]?.extensions?.[0];
  return Promise.resolve(ext === undefined || ext === "json" ? "/imports/apps.json" : `/imports/pick.${ext}`);
};
