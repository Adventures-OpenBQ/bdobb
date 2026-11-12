// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The Window Portal card's side of the native controller (spec
 * docs/superpowers/specs/2026-11-12-window-portal-card-design.md; Rust in
 * src-tauri/src/window_portal/). Command names, argument keys and answer
 * shapes match the Rust exactly.
 */
export const DEFAULT_SOURCE = "CNBC";
export const DEFAULT_VOLUME_LABEL = "Volume Level";

export type PortalPlatform = "macos" | "ipad" | "other";

/** The macOS desktop app, the iPad app, or anything else (Windows, Linux, the web preview). */
export function portalPlatform(): PortalPlatform {
  if (!isTauri()) return "other";
  const platform = import.meta.env.TAURI_ENV_PLATFORM;
  if (platform === "darwin") return "macos";
  if (platform === "ios") return "ipad";
  return "other";
}

export type CssRect = { x: number; y: number; width: number; height: number };

export type PortalStatus =
  | { state: "fitted" | "no_permission" | "no_player" | "in_use" | "too_small" | "viewer_window" | "not_supported" }
  | { state: "failed"; reason: string };

export type MuteState = { state: "sound" | "muted" } | { state: "unavailable"; reason: string };

/** The card's two settings, with the defaults for a blank or missing value. */
export function portalSettings(params: Record<string, string>): { source: string; label: string } {
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

export const fitPlayer = (card: string, rect: CssRect) => invoke<PortalStatus>("window_portal_fit", { card, rect });
export const releasePlayer = (card: string) => invoke<void>("window_portal_release", { card });
export const setPlayerMuted = (source: string, label: string, muted: boolean) =>
  invoke<MuteState>("window_portal_set_muted", { source, label, muted });
export const readMuteState = (source: string, label: string) =>
  invoke<MuteState>("window_portal_mute_state", { source, label });
export const openAccessibilitySettings = () => invoke<void>("window_portal_open_settings");
