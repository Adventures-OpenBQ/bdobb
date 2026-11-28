// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Document lifetime model for shim tests; real ownership is exercised in Chromium. */
export function webLocks() {
  const held = new Map<string, object>();
  const locks = {
    request(name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown) {
      return Promise.resolve().then(async () => {
        if (held.has(name)) return callback(null);
        const owner = {};
        held.set(name, owner);
        try { return await callback({name, mode: 'exclusive'}); }
        finally { if (held.get(name) === owner) held.delete(name); }
      });
    },
  } as unknown as LockManager;
  return {locks, terminateDocument: () => held.clear()};
}
