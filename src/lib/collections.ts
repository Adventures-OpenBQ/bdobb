// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** A copy of `o` with `k` set to `v`, or with `k` deleted when `v` is undefined -- absent, never an undefined key. */
export function withOptional<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined): T {
  const next = { ...o };
  if (v === undefined) delete next[k];
  else next[k] = v;
  return next;
}

/** `items` in `order`'s order; an id the order does not name ranks after every named one, ties keeping their input order. */
export function sortByOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}
