// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One promise chain per key. Five modules had written the identical
 * chain-and-swallow by hand (the backends, folders and settings stores, the
 * logger, and jsonStore's per-path lock); this is that chain, once.
 *
 * The guarantee is ordering, not mutual exclusion by any other name: `fn`
 * starts only after every step previously queued under the same key has
 * settled, so a read-mutate-write step can never compute its next value from
 * a snapshot an earlier queued step is about to replace.
 *
 * Keys are namespaced by their caller (`store:backends`, `logger`,
 * `json:<path>`) because one map serves every caller — two domains sharing a
 * key would serialize against each other for no reason.
 *
 * Not re-entrant: anything already running inside a key's chain must not call
 * back in for that same key.
 */
const chains = new Map<string, Promise<unknown>>();

/**
 * Queues `fn` behind everything already queued under `key` and hands back a
 * promise for its own result. A rejected step must not poison the chain for
 * the next one, so the chain is advanced through a `catch`; the caller still
 * observes its own genuine rejection through the returned promise.
 */
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = chains.get(key) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(fn);

  chains.set(key, next);
  // The trailing catch is required: this cleanup chain is not the promise
  // returned to the caller, so a failed step would otherwise surface as an
  // unhandled rejection. The identity guard keeps a follow-up that chained
  // before this cleanup ran from being dropped.
  next
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    })
    .catch(() => {});
  return next;
}

/**
 * How many keys currently hold a chain. Test-only: it is the only way to see
 * that a settled key is REMOVED rather than left behind holding a resolved
 * promise, which is what keeps one entry per path from accumulating for the
 * life of the process. Nothing in the app reads it.
 */
export function __serializeChainCountForTests(): number {
  return chains.size;
}

/**
 * Drops the chains whose key starts with `keyPrefix`. Scoped rather than
 * wholesale so one module's test reset cannot cut another module's in-flight
 * ordering: `__resetJsonStoreForTests` must not release the logger's queue.
 */
export function __resetSerializeForTests(keyPrefix: string): void {
  for (const key of [...chains.keys()]) {
    if (key.startsWith(keyPrefix)) chains.delete(key);
  }
}
