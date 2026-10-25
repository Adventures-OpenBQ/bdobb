// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request in flight under `key`, started by `start()` only if there is
 * none, and forgotten once it settles. An identical request is joined, never
 * duplicated, so React StrictMode's double-invoked effect issues one HTTP
 * request.
 */
export function joinInFlight<T>(map: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  let pending = map.get(key);
  if (!pending) {
    pending = start();
    map.set(key, pending);
    const forget = () => void map.delete(key);
    void pending.then(forget, forget);
  }
  return pending;
}
