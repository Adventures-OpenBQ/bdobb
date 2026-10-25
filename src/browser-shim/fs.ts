// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stands in for @tauri-apps/plugin-fs under `vite --mode browser`. memfs is
 * the same in-memory implementation the vitest suite uses; it has no vitest
 * dependency, so it runs in the page as-is. Seeded once, at module init,
 * from window.__bdobbSeed -- which the driver must set before any app module
 * evaluates (Playwright: page.addInitScript).
 */
import * as mem from "../test/memfs";
import { __failRead, __list, __read, __seed } from "../test/memfs";
import { fetch } from "./http";
import { bdobb } from "./registry";

export { BaseDirectory, exists, mkdir, readDir, readFile, readTextFile, stat, writeFile } from "../test/memfs";

/**
 * Web preview persistence. memfs is memory, so the preview forgot everything on
 * reload ("vercel is not saving the configuration", 2026-09-20). When the preview's
 * bootstrap says it READ the user's saved state (window.__bdobbPersist -- see
 * web/server.mjs savedState for why only then), the three calls that change a file are
 * mirrored to /state/<file>, which keeps them per GitHub user on the NAS.
 *
 * Only the app's own JSON stores, by the same allow-list the server enforces
 * (web/policy.mjs stateFile -- that module is Node-only, hence the copy; the server is
 * the authority and a name it refuses is simply not saved). The app writes atomically,
 * a temp then a rename, so it is the rename that carries the real name. The first save
 * sends every such file, not just the changed one: the store then mirrors the page, and
 * the seeded dashboard does not vanish the first time saved state replaces the seed.
 * Saves are debounced and strictly one at a time, so an older body can never land last.
 */
const STATE_FILE_RE = /^(?:(?:settings|backends|folders|chat|chart-presets)\.json|(?:dashboards|workspaces|layouts)\/[A-Za-z0-9_-]{1,80}\.json)$/;
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let mirrored = false;
let queue = Promise.resolve();

function touched(path: string): void {
  const name = path.replace(/^\/+/, "");
  if (!window.__bdobbPersist || !STATE_FILE_RE.test(name)) return;
  dirty.add(name);
  timer ??= setTimeout(() => {
    timer = null;
    queue = queue.then(flush);
  }, 500);
}

async function flush(): Promise<void> {
  if (!mirrored) for (const name of __list()) if (STATE_FILE_RE.test(name)) dirty.add(name);
  mirrored = true;
  const batch = [...dirty].sort();
  dirty.clear();
  for (const name of batch) {
    const text = __read(name);
    const saved = await fetch(
      `/state/${name}`,
      text === undefined
        ? { method: "DELETE" }
        : { method: "PUT", headers: { "Content-Type": "application/json" }, body: text },
    ).then(response => response.ok, () => false);
    // Kept for the next save rather than retried on a timer: a store that is down
    // stays down for a while, and the next change is never far away.
    if (!saved) dirty.add(name);
  }
  // Never silent (review 2026-09-20): a file the store refuses -- over its 256 KiB, or the
  // store is down -- is a change the next reload will not have. The bar is the preview's
  // (web/policy.mjs bootstrap); its first node is the text.
  const text = document.querySelector(".web-preview-notice")?.firstChild;
  if (text) {
    text.textContent = `Private web preview · ${dirty.size ? "Some changes could NOT be saved" : "Changes are saved to your account"} · `;
  }
}

export const writeTextFile: typeof mem.writeTextFile = async (path, ...rest) => {
  await mem.writeTextFile(path, ...rest);
  touched(path);
};
export const rename: typeof mem.rename = async (oldPath, newPath) => {
  await mem.rename(oldPath, newPath);
  touched(oldPath);
  touched(newPath);
};
export const remove: typeof mem.remove = async path => {
  await mem.remove(path);
  touched(path);
};

for (const [path, content] of Object.entries(window.__bdobbSeed ?? {})) {
  __seed(path, content);
}

// After the seed, so a spec can seed a file AND make reading it fail.
//
// A READ failure specifically, not a blanket one: `chmod 000` is what an
// unreadable settings file actually is, and such a file still exists and can
// still be renamed. A blanket failure would throw from `exists` instead, which
// makes the loader reject for a reason that never reaches the read at all --
// so the e2e would pass without ever exercising the path it is about.
for (const path of window.__bdobbFail ?? []) {
  __failRead(path);
}

Object.assign(bdobb(), { read: __read, list: __list });
