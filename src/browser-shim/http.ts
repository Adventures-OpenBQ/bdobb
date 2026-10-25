// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stands in for @tauri-apps/plugin-http: the browser's own fetch, minus the
 * Tauri-only connectTimeout option — which is why a caller that needs a real
 * deadline passes `signal` (dataClient's apps.json fetch does). `signal` is
 * part of RequestInit and is forwarded untouched with the rest of it, so the
 * two runtimes abort the same way; only connectTimeout is dropped, because
 * the browser has nothing to map it onto.
 *
 * It also carries the preview's socket shim into the bundle: there is no
 * @tauri-apps module for sockets to alias, and this is the network stand-in the
 * app always loads. socket.ts imports `fetch` back from here; the cycle is benign
 * because `fetch` is a hoisted declaration that socket.ts only calls later.
 */
import "./socket";

export async function fetch(
  input: string | URL | Request,
  init?: RequestInit & { connectTimeout?: number },
): Promise<Response> {
  const { connectTimeout: _drop, ...rest } = init ?? {};
  const response = await window.fetch(input, rest);
  if (response.status === 401 && sameOrigin(input)) signedOut();
  return response;
}

/**
 * The web preview's session is a hard deadline (web/config.mjs SESSION_SECONDS).
 * Once it lapses, every request to the app's OWN origin answers 401, and the app
 * read that as "Backend is offline" on every card. web/server.mjs answers 401
 * only from its session gate -- an upstream failure is relayed as 502 -- so a
 * same-origin 401 can only mean "signed out": go to the sign-in page. Another
 * origin's 401 is a backend refusing a credential and is the caller's to report.
 */
let leaving = false;
/** The session has lapsed and the page is on its way to sign-in (fs.ts saves nothing then). */
export const sessionLapsed = (): boolean => leaving;
function signedOut(): void {
  // Once: discovery and every card fail together, and one navigation is enough.
  if (leaving) return;
  leaving = true;
  window.location.assign("/auth/signin");
}

function sameOrigin(input: string | URL | Request): boolean {
  try {
    const raw = typeof input === "string" || input instanceof URL ? input : input.url;
    return new URL(raw, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}
