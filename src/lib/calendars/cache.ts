// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { verifyBundle } from "./artifact";
import { CalendarError, type CalendarBundle } from "./contracts";

/** How long a refusal stands: a Retry a minute later asks the backend again, and `forget` clears it at once. */
export const REFUSAL_MS = 60_000;
// ponytail: an entry cap, not a byte cap; a 20-year bundle is about 2 MB, so 32 entries stay near 64 MB.
const MAX_ENTRIES = 32;

/**
 * Whether asking again would get the same answer (ruling R10a): a 4xx contract refusal from the provider (HttpError's
 * `status`; 408 and 429 excepted) or a bundle the client refuses. A network error, a 5xx, an abort and a scope change
 * are transient and never remembered.
 */
function deterministic(e: unknown): boolean {
  if (e instanceof CalendarError) return e.code !== "CALENDAR_SCOPE_CHANGED";
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Verified bundles by key, shared by every card (review I3). One fetch per key is in flight and every caller joins it;
 * the fetch is never aborted, since another card may be waiting on it -- a caller's signal only stops that caller
 * waiting. `clear()` moves the epoch, so a response in flight for the old scope never lands in the new one. A
 * deterministic refusal is kept for REFUSAL_MS with its message, which is what the card shows.
 */
export class CalendarCache {
  private epoch = 0;
  private entries = new Map<string, CalendarBundle>();
  private refusals = new Map<string, { message: string; at: number }>();
  private inFlight = new Map<string, Promise<CalendarBundle>>();

  /** How many verified bundles are held. */
  get size(): number {
    return this.entries.size;
  }

  /** What a render can use now: the bundle, a standing refusal, or neither (not asked, or in flight). */
  peek(key: string, now = Date.now()): { bundle?: CalendarBundle; refusal?: string } {
    const bundle = this.entries.get(key);
    if (bundle) return { bundle };
    const refused = this.refusals.get(key);
    return refused && now - refused.at < REFUSAL_MS ? { refusal: refused.message } : {};
  }

  /** Forgets `key`'s refusal, so the next load asks again: what a card's Retry calls. */
  forget(key: string): void {
    this.refusals.delete(key);
  }

  /** Forgets every bundle and refusal, and moves the epoch so nothing in flight can land. */
  clear(): void {
    this.epoch += 1;
    this.entries.clear();
    this.refusals.clear();
    this.inFlight.clear();
  }

  /** The bundle for `key`: from the cache, by joining the fetch in flight, or by starting one. */
  async load(key: string, fetcher: () => Promise<unknown>, signal: AbortSignal): Promise<CalendarBundle> {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const { bundle, refusal } = this.peek(key);
    if (bundle) return bundle;
    if (refusal) throw new CalendarError("CALENDAR_UNAVAILABLE", refusal);
    let pending = this.inFlight.get(key);
    if (!pending) {
      const epoch = this.epoch;
      pending = (async () => {
        try {
          const value = await verifyBundle(await fetcher());
          if (epoch !== this.epoch) throw new CalendarError("CALENDAR_SCOPE_CHANGED");
          if (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
          this.entries.set(key, value);
          return value;
        } catch (e) {
          if (epoch === this.epoch && deterministic(e)) {
            this.refusals.set(key, { message: e instanceof Error ? e.message : String(e), at: Date.now() });
          }
          throw e;
        } finally {
          if (epoch === this.epoch) this.inFlight.delete(key);
        }
      })();
      this.inFlight.set(key, pending);
    }
    const value = await pending;
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return value;
  }
}
