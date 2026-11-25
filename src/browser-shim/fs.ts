// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stands in for @tauri-apps/plugin-fs under `vite --mode browser`. memfs is
 * the same in-memory implementation the vitest suite uses; it has no vitest
 * dependency, so it runs in the page as-is. Seeded once, at module init,
 * from window.__bdobbSeed -- which the driver must set before any app module
 * evaluates (Playwright: page.addInitScript).
 */
import { STATE_WRITER, STATE_SEQUENCE, stateWriteVersion } from "../lib/stateWriteProtocol.mjs";
import * as mem from "../test/memfs";
import { __failRead, __list, __read, __seed } from "../test/memfs";
import { fetch, sessionLapsed } from "./http";
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
 * Ordinary saves are queued. Hide-time saves bypass that queue, so every mutation
 * carries a persisted writer/sequence fence that the account store enforces atomically.
 */
const STATE_FILE_RE = /^(?:(?:settings|backends|folders|chat|chart-presets)\.json|(?:dashboards|workspaces|layouts)\/[A-Za-z0-9_-]{1,80}\.json)$/;
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let mirrored = false;
let queue = Promise.resolve();
const pending = new Set<string>();
const acknowledged = new Map<string, number>();
const keepalivePending = new Map<string, number>();
const WRITE_STATE = 'bdobb-state-writes';
const observed = new Set<string>();
let writeState: {writer: string; sequences: Record<string, number>} | undefined;
function state(): NonNullable<typeof writeState> {
  if (!writeState) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(WRITE_STATE) ?? 'null');
      if (saved && typeof saved.sequences === 'object' && saved.sequences !== null && !Array.isArray(saved.sequences)
          && Object.entries(saved.sequences).every(([name, value]) => STATE_FILE_RE.test(name) && Number.isSafeInteger(value) && (value as number) > 0)
          && stateWriteVersion(saved.writer, '1')) writeState = saved;
    } catch { /* No usable tab sequence: start a new writer. */ }
    writeState ??= {writer: crypto.randomUUID(), sequences: {}};
  }
  return writeState;
}
function revision(name: string, changed = false): number {
  const saved = state();
  let n = saved.sequences[name] ?? 0;
  // A fresh bootstrap may hold another writer's body. Never reuse this tab's
  // prior-page version for that seed when the initial mirror includes it.
  if (changed || !observed.has(name)) {
    if (n >= Number.MAX_SAFE_INTEGER) throw new Error('State save sequence exhausted. Reopen the preview.');
    saved.sequences[name] = ++n;
    observed.add(name);
    try { sessionStorage.setItem(WRITE_STATE, JSON.stringify(saved)); } catch { /* Current-page fences still apply. */ }
  }
  return n;
}
function forgetIfSaved(): void {
  if (!pending.size && !dirty.size && !failed.size) forget();
}
function completed(name: string, result: {saved: boolean; version: number}, hide: boolean): void {
  if (result.saved) landed = true; // Any accepted version makes the initial mirror partial.
  if (revision(name) !== result.version || (acknowledged.get(name) ?? 0) >= result.version) return;
  if (result.saved) {
    acknowledged.set(name, result.version); pending.delete(name); failed.delete(name); dirty.delete(name); landed = true;
  } else if (hide) dirty.add(name);
  else failed.add(name);
}

function touched(path: string): void {
  const name = path.replace(/^\/+/, "");
  if (!window.__bdobbPersist || !STATE_FILE_RE.test(name)) return;
  revision(name, true);
  pending.add(name);
  dirty.add(name);
  try { if (sessionStorage.getItem(UNSAVED)) keep([name]); } catch { /* Recovery storage is optional. */ }
  timer ??= setTimeout(() => {
    timer = null;
    queue = queue.then(flush);
  }, 500);
}

let sending: string | null = null;

/** The next file to send, taken OUT of `dirty`, so a hide mid-flush (flushNow) still sees the rest. */
function next(): string | undefined {
  const [name] = [...dirty].sort();
  if (name !== undefined) dirty.delete(name);
  return name;
}

/** Refused this flush; outside `dirty` so next() cannot spin on a down store, but flushNow sends them. */
const failed = new Set<string>();
/** The store has taken a file: from then on it is partial unless the rest arrives. */
let landed = false;

async function flush(): Promise<void> {
  if (!mirrored) for (const name of __list()) if (STATE_FILE_RE.test(name)) dirty.add(name);
  mirrored = true;
  for (let name = next(); name !== undefined; name = next()) {
    sending = name;
    const result = await send(name);
    sending = null;
    // Kept for the next save rather than retried on a timer: a store that is down
    // stays down for a while, and the next change is never far away.
    completed(name, result, false);
  }
  forgetIfSaved(); // Obsolete completions cannot discard a newer recovery body.
  for (const name of failed) dirty.add(name);
  failed.clear();
  notice();
}

/**
 * Never silent (review 2026-09-20): a file the store refuses -- over its 256 KiB, or the
 * store is down -- is a change the next reload will not have. The bar is the preview's
 * (web/policy.mjs bootstrap); its first node is the text.
 */
function notice(): void {
  const text = document.querySelector(".web-preview-notice")?.firstChild;
  if (text) {
    text.textContent = `Private web preview · ${dirty.size ? "Some changes could NOT be saved" : pending.size ? "Saving changes to your account" : "Changes are saved to your account"} · `;
  }
}

/** One file to the store, as the page holds it now; resolves whether the store took it. */
function send(name: string, keepalive = false): Promise<{saved: boolean; version: number}> {
  const text = __read(name);
  const version = revision(name);
  const headers = {[STATE_WRITER]: state().writer, [STATE_SEQUENCE]: String(version)};
  pending.add(name);
  const init: RequestInit = text === undefined
    ? { method: "DELETE", headers }
    : { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: text };
  const go = (k: boolean) => fetch(`/state/${name}`, { ...init, keepalive: k });
  // A browser refuses keepalive past its body budget; the ordinary request may still make it.
  return (keepalive ? go(true).catch(() => go(false)) : go(false)).then(response => ({saved: response.ok, version}), () => ({saved: false, version}));
}

/**
 * What a hide sent, kept for this tab: a reload's own state read can reach the store before
 * the keepalive PUT does, so the page came back with the old copy and would save it back
 * (2026-10-19, live). The next load lays a recent copy over the seed and saves it again.
 */
const UNSAVED = "bdobb-unsaved";
const UNSAVED_MS = 60_000;
function keep(names: string[]): void {
  try {
    // Merged, not replaced: a reload fires visibilitychange and then pagehide, and the second
    // flushNow may hold only what the first left behind (review 2026-10-19).
    const files = (JSON.parse(sessionStorage.getItem(UNSAVED) ?? "null") as { files?: Record<string, string | null> } | null)?.files ?? {};
    for (const n of names) files[n] = __read(n) ?? null;
    sessionStorage.setItem(UNSAVED, JSON.stringify({ at: Date.now(), files }));
  } catch { /* storage refused (private mode, quota): the keepalive send still goes */ }
}
function forget(): void {
  try { sessionStorage.removeItem(UNSAVED); } catch { /* nothing kept */ }
}

const KEEPALIVE_BUDGET = 60 * 1024; // browsers allow ~64 KiB of keepalive bodies per page
const encoder = new TextEncoder();

/**
 * Hidden or unloading, what is pending goes out NOW, as keepalive requests the browser
 * finishes after the page is gone: a tab renamed and reloaded within the 500 ms debounce
 * was lost (2026-10-19). Every request starts in this tick, not queued behind an
 * in-flight flush -- a continuation after an await never runs once the page unloads.
 * ponytail: keepalive bodies share a ~64 KiB budget per page, and a hide during an
 * in-flight flush can overlap it for one file; the persisted per-file sequence ensures
 * the account store cannot commit an older body over a newer one. Past the budget the
 * fallback is an ordinary request the unload may cancel; the recovery copy remains until
 * the latest version is acknowledged.
 */
function flushNow(): void {
  // A lapsed session is leaving for sign-in (CI 2026-10-19): the store refuses every save
  // now, and a kept copy would lay an edit it refused back over the seed after signing in.
  // ponytail: a lapse first met by these very keepalive sends, after unload, is not seen,
  // so that copy still replays within the minute; a store-side revision check if it matters.
  if (sessionLapsed()) return;
  if (!timer && !dirty.size && !failed.size && sending === null) return;
  const batch = new Set([...dirty, ...failed]);
  if (sending !== null) batch.add(sending); // in flight as an ordinary request the unload cancels
  if (!mirrored) for (const name of __list()) if (STATE_FILE_RE.test(name)) batch.add(name);
  for (const name of batch) if (keepalivePending.get(name) === revision(name)) batch.delete(name);
  if (!batch.size) return;
  // While the store has taken nothing, part of this would replace the seed on the next
  // load, so past the keepalive budget send nothing and leave the timer and any running
  // flush be. Once it has taken a file it is partial already: send all the rest, as best
  // effort, since only finishing it saves the seed (reviews 2026-10-19).
  if (!landed && [...batch].reduce((n, name) => n + encoder.encode(__read(name) ?? "").length, 0) > KEEPALIVE_BUDGET) return;
  if (timer) clearTimeout(timer);
  timer = null;
  mirrored = true;
  dirty.clear();
  failed.clear();
  // Only once it is really re-sent (re-review 2026-10-19): a hide that sent nothing must
  // still count the in-flight file, or the next hide could land part of an empty store.
  keep([...batch]);
  for (const name of [...batch].sort()) {
    const version = revision(name);
    keepalivePending.set(name, version);
    void send(name, true).then(result => {
      if (keepalivePending.get(name) === version) keepalivePending.delete(name);
      completed(name, result, true); forgetIfSaved(); notice();
    });
  }
}
window.addEventListener("pagehide", flushNow);
document.addEventListener("visibilitychange", () => {
  // Back on screen, the page is the copy: later edits must not be undone by a stale one.
  if (document.visibilityState === "hidden") flushNow(); else forgetIfSaved();
});

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

// ponytail: a copy under a minute old wins over the seed even if another device saved in
// between; per-file revisions in the store if two devices editing at once ever matters.
try {
  const kept = JSON.parse(sessionStorage.getItem(UNSAVED) ?? "null") as { at: number; files: Record<string, string | null> } | null;
  forget();
  if (window.__bdobbPersist && kept && Date.now() - kept.at < UNSAVED_MS) {
    for (const [name, text] of Object.entries(kept.files)) {
      if (!STATE_FILE_RE.test(name)) continue;
      if (typeof text === "string") __seed(name, text);
      else void mem.remove(name).catch(() => {});
      touched(name);
    }
  }
} catch { /* no usable copy: the seed stands */ }

Object.assign(bdobb(), { read: __read, list: __list });
