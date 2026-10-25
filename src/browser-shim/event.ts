// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stands in for @tauri-apps/api/event under `vite --mode browser`.
 *
 * BroadcastChannel is the browser's own cross-context bus, and the viewer
 * "window" here is a real second tab opened by the webviewWindow shim, so
 * this reproduces the property that matters: an emit in one tab arrives in
 * the other. That is what makes the viewer's live update testable in the e2e
 * suite rather than only on a device.
 *
 * Tauri's own emit is a broadcast that the emitting window also receives;
 * BroadcastChannel deliberately does NOT deliver to the sender, so the sender
 * is served by a second channel used only to post to itself. Callers that
 * emit and listen in the same context therefore see the same thing they
 * would under Tauri.
 */
export type UnlistenFn = () => void;
export type Event<T> = { event: string; payload: T };

const channels = new Map<string, BroadcastChannel>();

function channel(name: string): BroadcastChannel {
  const existing = channels.get(name);
  if (existing) return existing;
  const made = new BroadcastChannel(`bdobb:${name}`);
  channels.set(name, made);
  return made;
}

const local = new Map<string, Set<(payload: unknown) => void>>();

export function emit(event: string, payload?: unknown): Promise<void> {
  channel(event).postMessage(payload);
  // The sender's own listeners, which BroadcastChannel skips.
  for (const handler of local.get(event) ?? []) handler(payload);
  return Promise.resolve();
}

export function listen<T>(
  event: string,
  handler: (e: Event<T>) => void,
): Promise<UnlistenFn> {
  const onMessage = (e: MessageEvent) => handler({ event, payload: e.data as T });
  channel(event).addEventListener("message", onMessage);
  const own = (payload: unknown) => handler({ event, payload: payload as T });
  const set = local.get(event) ?? new Set();
  set.add(own);
  local.set(event, set);
  return Promise.resolve(() => {
    channel(event).removeEventListener("message", onMessage);
    local.get(event)?.delete(own);
  });
}
