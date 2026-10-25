// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stands in for @tauri-apps/api/core. The app invokes no Rust commands, so
 * every command rejects BY NAME: a future native call added to the app fails
 * loudly in browser mode instead of silently resolving undefined.
 *
 * The first such call is the YouTube card's `video_wrapper_port` (YouTube
 * loopback spec, 2026-10-01). Its rejection here is the designed answer: the
 * card reads it as "no loopback" and frames youtube.com, as a browser can.
 */
export async function invoke<T>(cmd: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error(`browser-shim: no handler for invoke("${cmd}")`);
}
