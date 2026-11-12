// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The Picture in Picture card's side of the native controller (spec
 * docs/superpowers/specs/2026-11-12-picture-in-picture-card-design.md; Rust in
 * src-tauri/src/picture_in_picture/). Command names, argument keys and answer
 * shapes match the Rust exactly.
 */
export const DEFAULT_SOURCE = "CNBC";
export const DEFAULT_VOLUME_LABEL = "Volume Level";

export type PipPlatform = "macos" | "ipad" | "other";

/** The macOS desktop app, the iPad app, or anything else (Windows, Linux, the web preview). */
export function pipPlatform(): PipPlatform {
  if (!isTauri()) return "other";
  const platform = import.meta.env.TAURI_ENV_PLATFORM;
  if (platform === "darwin") return "macos";
  if (platform === "ios") return "ipad";
  return "other";
}

export type CssRect = { x: number; y: number; width: number; height: number };

export type PipStatus =
  | { state: "fitted" | "no_permission" | "no_player" | "in_use" | "too_small" | "viewer_window" | "not_supported" }
  | { state: "failed"; reason: string };

export type MuteState = { state: "sound" | "muted" } | { state: "unavailable"; reason: string };

/** The card's two settings, with the defaults for a blank or missing value. */
export function pipSettings(params: Record<string, string>): { source: string; label: string } {
  return {
    source: params.source?.trim() || DEFAULT_SOURCE,
    label: params.volumeLabel?.trim() || DEFAULT_VOLUME_LABEL,
  };
}

/** Whole-pixel equality: sub-pixel jitter is no reason to move the player. */
export function sameRect(a: CssRect, b: CssRect): boolean {
  return (
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

export const fitPlayer = (card: string, rect: CssRect) => invoke<PipStatus>("picture_in_picture_fit", { card, rect });
export const releasePlayer = (card: string) => invoke<void>("picture_in_picture_release", { card });
export const setPlayerMuted = (source: string, label: string, muted: boolean) =>
  invoke<MuteState>("picture_in_picture_set_muted", { source, label, muted });
export const readMuteState = (source: string, label: string) =>
  invoke<MuteState>("picture_in_picture_mute_state", { source, label });
export const openAccessibilitySettings = () => invoke<void>("picture_in_picture_open_settings");

/**
 * A card that unmounts and remounts at once (pin, unpin, a layout re-render)
 * must not hand the player back. Its release waits this long, and a mount of
 * the same card cancels it.
 */
export const RELEASE_GRACE_MS = 250;

// Per card and across mounts, so an old mount's release can never land after
// the next mount's fit.
const queues = new Map<string, Promise<unknown>>();
const pendingReleases = new Map<string, ReturnType<typeof setTimeout>>();

/** Runs `op` after every earlier call for this card has settled. */
export function enqueuePlayerOp(card: string, op: () => Promise<unknown>) {
  queues.set(card, (queues.get(card) ?? Promise.resolve()).then(op, op));
}

export function releaseNow(card: string) {
  enqueuePlayerOp(card, () => releasePlayer(card).catch(() => undefined));
}

export function cancelScheduledRelease(card: string) {
  clearTimeout(pendingReleases.get(card));
  pendingReleases.delete(card);
}

/** Releases after the grace period unless the card mounts again first. */
export function scheduleRelease(card: string) {
  cancelScheduledRelease(card);
  pendingReleases.set(
    card,
    setTimeout(() => {
      pendingReleases.delete(card);
      releaseNow(card);
    }, RELEASE_GRACE_MS),
  );
}
