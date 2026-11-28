// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** API and reference connections can share one eight-slot gateway. Leave room
 * for document/managed requests; hold a slot until the body is consumed. */
const MAX_ACTIVE = 4;
type Waiting = { start: () => void; abort: () => void };
type Queue = { active: number; waiting: Waiting[] };
const queues = new Map<string, Queue>();

function acquire(origin: string, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const queue = queues.get(origin) ?? { active: 0, waiting: [] };
  queues.set(origin, queue);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (!queue.active && !queue.waiting.length) queues.delete(origin);
    };
    const entry: Waiting = {
      start() {
        signal?.removeEventListener('abort', entry.abort);
        queue.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          queue.active--;
          queue.waiting.shift()?.start();
          cleanup();
        });
      },
      abort() {
        const index = queue.waiting.indexOf(entry);
        if (index >= 0) queue.waiting.splice(index, 1);
        signal?.removeEventListener('abort', entry.abort);
        reject(signal?.reason);
        cleanup();
      },
    };
    if (queue.active < MAX_ACTIVE) entry.start();
    else {
      queue.waiting.push(entry);
      signal?.addEventListener('abort', entry.abort, { once: true });
    }
  });
}

export async function withRequestSlot<T>(url: string, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  const release = await acquire(new URL(url).origin, signal);
  let onAbort: (() => void) | undefined;
  try {
    if (!signal) return await run();
    signal.throwIfAborted();
    // The transport receives the signal too. Release the slot even if its
    // cancellation acknowledgement or an IPC body read stalls.
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      run().then(resolve, reject);
    });
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    release();
  }
}
