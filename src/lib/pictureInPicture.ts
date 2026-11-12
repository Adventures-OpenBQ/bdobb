// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The Picture in Picture card's side of the native controller (spec
 * docs/superpowers/specs/2026-11-12-picture-in-picture-card-design.md; Rust in
 * src-tauri/src/picture_in_picture/). Command names, argument keys and answer
 * shapes match the Rust exactly.
 */
export const DEFAULT_SOURCE = "";
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
  | { state: "fitted" | "parked" | "no_permission" | "no_player" | "in_use" | "too_small" | "viewer_window" | "not_supported" }
  | { state: "failed"; reason: string };

export type MuteState = { state: "sound" | "muted" } | { state: "unavailable"; reason: string };

/** The card's two settings, with the defaults for a blank or missing value. */
export function pipSettings(params: Record<string, string>): { source: string; label: string } {
  return {
    source: params.source?.trim() || DEFAULT_SOURCE,
    label: params.volumeLabel?.trim() || DEFAULT_VOLUME_LABEL,
  };
}

/** The "Mute while hidden" setting: an on/off choice, off unless the card says "on". */
export const muteWhileHidden = (params: Record<string, string>): boolean => params.muteWhileHidden === "on";

/** Whole-pixel equality: sub-pixel jitter is no reason to move the player. */
export function sameRect(a: CssRect, b: CssRect): boolean {
  return (
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

/** Where the page's volume slider is, sent only when "Mute while hidden" is on. */
export type MuteTarget = { source: string; label: string };

export const fitPlayer = (card: string, rect: CssRect, mute?: MuteTarget) =>
  invoke<PipStatus>("picture_in_picture_fit", { card, rect, mute });
/** The card is hidden (`menu` false) or its own menu is open (`menu` true): the player moves off screen, still held. */
export const parkPlayer = (card: string, menu: boolean) => invoke<PipStatus>("picture_in_picture_park", { card, menu });
export const releasePlayer = (card: string) => invoke<void>("picture_in_picture_release", { card });
export const setPlayerMuted = (source: string, label: string, muted: boolean) =>
  invoke<MuteState>("picture_in_picture_set_muted", { source, label, muted });
export const readMuteState = (source: string, label: string) =>
  invoke<MuteState>("picture_in_picture_mute_state", { source, label });
export const openAccessibilitySettings = () => invoke<void>("picture_in_picture_open_settings");

/**
 * A card that unmounts and remounts at once (pin, unpin, a layout re-render)
 * must not let go of the player. What happens to it waits this long, and a
 * mount of the same card cancels it.
 */
export const RELEASE_GRACE_MS = 250;

/** What the card's owner knows: whether a card still exists in the dashboard data, and when that data changes. */
export type CardData = { has: (card: string) => boolean; subscribe: (listener: () => void) => () => void };

// Per card and across mounts, so an old mount's release can never land after
// the next mount's fit.
const queues = new Map<string, Promise<unknown>>();
const pendingReleases = new Map<string, ReturnType<typeof setTimeout>>();
const watches = new Map<string, () => void>();

/** Runs `op` after every earlier call for this card has settled. */
export function enqueuePlayerOp(card: string, op: () => Promise<unknown>) {
  queues.set(card, (queues.get(card) ?? Promise.resolve()).then(op, op));
}

export function releaseNow(card: string) {
  enqueuePlayerOp(card, () => releasePlayer(card).catch(() => undefined));
}

export function parkNow(card: string, menu = false) {
  enqueuePlayerOp(card, () => parkPlayer(card, menu).catch(() => undefined));
}

function stopWatching(card: string) {
  watches.get(card)?.();
  watches.delete(card);
}

export function cancelScheduledRelease(card: string) {
  clearTimeout(pendingReleases.get(card));
  pendingReleases.delete(card);
  stopWatching(card);
}

/**
 * When the card has unmounted and does not come back within the grace period:
 * a card that still exists (the user switched dashboard or tab) only parks the
 * player, and the player is released if that card is later removed; a card
 * that no longer exists releases it at once.
 */
export function scheduleLeave(card: string, data: CardData) {
  cancelScheduledRelease(card);
  pendingReleases.set(
    card,
    setTimeout(() => {
      pendingReleases.delete(card);
      if (!data.has(card)) return releaseNow(card);
      parkNow(card);
      watches.set(
        card,
        data.subscribe(() => {
          if (data.has(card)) return;
          stopWatching(card);
          releaseNow(card);
        }),
      );
    }, RELEASE_GRACE_MS),
  );
}
