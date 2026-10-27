// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * One module-level, session-lifetime memo of a fetch, shared by every hook
 * and card in the app.
 *
 * Four hooks kept their own copy of this pair of Maps -- useParamOptions,
 * useFiscalYearEnd (twice), useTaRegistry, useTradingCalendar -- with the
 * same reasoning behind each, which now lives here once:
 *
 * - Module level, so every consumer shares the answer and a card closed and
 *   reopened costs nothing. The KEY is the caller's business, and every
 *   caller builds one from the backend's id AND base URL: endpoint names are
 *   not unique across backends (two configured OpenBB instances both expose
 *   `chambers`), and a backend id can be re-pointed at a different host while
 *   keeping its id, which is the same collision wearing the same name. The
 *   credential is never part of a key.
 * - There is no automatic invalidation. A backend restart that changes an
 *   answer needs an app restart to be seen -- acceptable for choice lists,
 *   calendars and fiscal year ends. The one caller that asks otherwise is
 *   the indicator registry, whose picker offers a "Refresh studies" control
 *   for the operator who has just uploaded one (docs/custom-studies.md):
 *   `drop` forgets a single key on demand, and nothing else forgets anything.
 * - An identical request already in flight is JOINED, never duplicated: two
 *   cards mounting at once -- and React StrictMode double-invoking an effect
 *   -- issue exactly one HTTP request between them.
 *
 * Three outcomes, because the four callers need all three:
 *
 * - a resolved value is remembered and served to everyone after;
 * - a resolved `null` is remembered as a NEGATIVE hit -- "asked, and there is
 *   no answer" -- so a backend that serves no trading calendar (most of them)
 *   is asked once per year rather than once per card mount;
 * - a REJECTION is not remembered and propagates to every joined caller, so
 *   the next mount asks again and the caller can report the error. A caller
 *   that wants a failure remembered instead catches it itself and resolves
 *   `null`; a caller that wants an unusable body forgotten rejects on it.
 */
type SessionCache<T> = {
  /** The remembered value, `null` for a negative hit, `undefined` if unasked. */
  get: (key: string) => T | null | undefined;
  /** The remembered value, else the in-flight request, else a new one. */
  getOrFetch: (key: string, fetch: () => Promise<T | null>) => Promise<T | null>;
  /** Forget one key, landed or in flight, so the next getOrFetch asks again. */
  drop: (key: string) => void;
  /** The cache outlives any one test; every test starts from empty. */
  reset: () => void;
};

export function sessionCache<T>(): SessionCache<T> {
  const values = new Map<string, T | null>();
  const inFlight = new Map<string, Promise<T | null>>();

  return {
    get: (key) => values.get(key),
    getOrFetch: (key, fetch) => {
      if (values.has(key)) return Promise.resolve(values.get(key) as T | null);
      const joined = inFlight.get(key);
      if (joined) return joined;
      // Both bookkeeping steps check that THIS request still owns the key: a
      // `drop` while it was in flight hands the key to the refetch that
      // follows, and a stale answer landing after that would overwrite the
      // fresh one (or delete its in-flight entry). The dropped promise still
      // resolves for whoever joined it.
      const pending: Promise<T | null> = fetch().then((value) => {
        if (inFlight.get(key) === pending) values.set(key, value);
        return value;
      });
      inFlight.set(key, pending);
      // The `catch` is only so this bookkeeping chain is not an unhandled
      // rejection; the caller's own handler is what reports the failure.
      void pending.catch(() => {}).finally(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      });
      return pending;
    },
    drop: (key) => {
      values.delete(key);
      inFlight.delete(key);
    },
    reset: () => {
      values.clear();
      inFlight.clear();
    },
  };
}
