// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { isTauri } from "@tauri-apps/api/core";
import { availableMonitors, currentMonitor, primaryMonitor, type Monitor } from "@tauri-apps/api/window";
import { isRecord } from "./isRecord";

/**
 * Screen sizes, minimum resolutions and the launch choice (spec
 * docs/superpowers/specs/2026-10-12-resolution-default-workspace-design.md).
 * Every size here is in LOGICAL pixels -- physical size over scale factor --
 * so a 4K panel at 200% is 1920×1080, as the user chose.
 */
export type ScreenSize = { width: number; height: number };

/** A workspace's minimum resolution. Absent on a workspace means Any size. */
export type MinResolution = ScreenSize;

/** What the file accepts and the dialog's Custom inputs allow (spec §2). */
export const MIN_RES_LIMITS = { minWidth: 640, maxWidth: 15360, minHeight: 480, maxHeight: 8640 } as const;

/** The dialog's "Common sizes" group, in this order (spec §7). */
export const COMMON_SIZES: readonly MinResolution[] = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3440, height: 1440 },
  { width: 3840, height: 2160 },
  { width: 5120, height: 2160 },
];

export function isMinResolution(value: unknown): value is MinResolution {
  if (!isRecord(value)) return false;
  const { width, height } = value;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    (width as number) >= MIN_RES_LIMITS.minWidth &&
    (width as number) <= MIN_RES_LIMITS.maxWidth &&
    (height as number) >= MIN_RES_LIMITS.minHeight &&
    (height as number) <= MIN_RES_LIMITS.maxHeight
  );
}

export function describeMinResolution(min: MinResolution | undefined): string {
  return min === undefined ? "Any size" : `${min.width} × ${min.height}`;
}

/**
 * The uniform zoom a workspace needs on `screen` (spec §3): 1 when it fits,
 * else the tighter side's ratio. Whole logical pixels first, since
 * fractional scale factors leave fractions. Not orientation-free.
 */
export function zoomFor(screen: ScreenSize, min: MinResolution | undefined): number {
  if (min === undefined) return 1;
  const w = Math.round(screen.width);
  const h = Math.round(screen.height);
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min(1, w / min.width, h / min.height);
}

export function fits(screen: ScreenSize, min: MinResolution | undefined): boolean {
  return zoomFor(screen, min) === 1;
}

/** The fields the launch rule reads; Workspace has both. */
type LaunchCandidate = { minResolution?: MinResolution; openAtLaunch?: boolean };

/**
 * The workspace to open at launch on `screen` (spec §5): of those marked
 * openAtLaunch that fit, the largest minimum area (Any size is 0); a tie
 * goes to the closest aspect ratio, then to `workspaces` order -- rail
 * order. Undefined when none fits.
 */
export function pickLaunchWorkspace<W extends LaunchCandidate>(
  workspaces: readonly W[],
  screen: ScreenSize,
): W | undefined {
  const aspect = screen.width / screen.height;
  const area = (w: W) => (w.minResolution === undefined ? 0 : w.minResolution.width * w.minResolution.height);
  const skew = (w: W) =>
    w.minResolution === undefined ? 0 : Math.abs(Math.log(w.minResolution.width / w.minResolution.height / aspect));
  let best: W | undefined;
  for (const w of workspaces) {
    if (w.openAtLaunch !== true || !fits(screen, w.minResolution)) continue;
    if (best === undefined || area(w) > area(best) || (area(w) === area(best) && skew(w) < skew(best))) best = w;
  }
  return best;
}

/** One monitor as the dialog lists it (spec §6). */
export type ScreenInfo = ScreenSize & {
  name: string;
  /** The monitor the main window is on. */
  current: boolean;
};

/** One "Your screens" choice: monitors of the same logical size merged. */
export type ScreenChoice = ScreenSize & { names: string[]; current: boolean };

export function screenChoices(screens: readonly ScreenInfo[]): ScreenChoice[] {
  const out: ScreenChoice[] = [];
  for (const s of screens) {
    const width = Math.round(s.width);
    const height = Math.round(s.height);
    const same = out.find((c) => c.width === width && c.height === height);
    if (same) {
      same.names.push(s.name);
      same.current ||= s.current;
    } else {
      out.push({ width, height, names: [s.name], current: s.current });
    }
  }
  return out;
}

export function windowScreen(): ScreenSize | null {
  const s = typeof window === "undefined" ? undefined : window.screen;
  if (!s || !(s.width > 0) || !(s.height > 0)) return null;
  return { width: s.width, height: s.height };
}

/**
 * Whether the monitor IPC may be called at all. On iOS (and Android) Tauri's
 * current_monitor does not reject: it panics in the runtime (an out-of-bounds
 * index), and the panic aborts the app a few seconds after launch, so no
 * catch below can save it. Mobile has one screen, which window.screen
 * already describes.
 */
function nativeMonitors(): boolean {
  const platform = import.meta.env.TAURI_ENV_PLATFORM;
  return isTauri() && platform !== "ios" && platform !== "android";
}

function sameMonitor(a: Monitor, b: Monitor | null): boolean {
  return (
    b !== null &&
    a.name === b.name &&
    a.size.width === b.size.width &&
    a.size.height === b.size.height &&
    a.scaleFactor === b.scaleFactor
  );
}

/**
 * Every monitor, in logical pixels (spec §6). Outside Tauri, or when the
 * call fails or finds none, window.screen alone as "This screen". Never
 * rejects.
 */
export async function listScreens(): Promise<ScreenInfo[]> {
  if (nativeMonitors()) {
    try {
      const [all, here] = await Promise.all([availableMonitors(), currentMonitor().catch(() => null)]);
      const listed = all
        .filter((m) => m.scaleFactor > 0)
        .map((m, n) => {
          const { width, height } = m.size.toLogical(m.scaleFactor);
          return {
            name: m.name ?? `Display ${n + 1}`,
            width,
            height,
            current: sameMonitor(m, here),
          };
        });
      if (listed.length > 0) return listed;
    } catch {
      // Fall through to window.screen.
    }
  }
  const s = windowScreen();
  return s === null
    ? []
    : [{ name: "This screen", ...s, current: true }];
}

export type LaunchScreen = ScreenSize & { source: "monitor" | "screen" };

/** How long the launch waits on the monitor IPC before giving up (spec §5). */
const DEADLINE_MS = 1000;

function fromMonitor(m: Monitor | null): LaunchScreen | null {
  if (m === null || !(m.scaleFactor > 0)) return null;
  const { width, height } = m.size.toLogical(m.scaleFactor);
  return width > 0 && height > 0 ? { width, height, source: "monitor" } : null;
}

/**
 * The logical size of the monitor the window is on right now (spec §4.1), or
 * null: outside Tauri, when the monitor is unknown (Wayland) or the read
 * fails. No primary-monitor guess -- the caller falls back to window.screen,
 * which describes this window's screen better than another monitor would.
 * Never rejects.
 */
export async function readCurrentScreen(): Promise<ScreenSize | null> {
  if (!nativeMonitors()) return null;
  try {
    const m = fromMonitor(await currentMonitor());
    return m === null ? null : { width: m.width, height: m.height };
  } catch {
    return null;
  }
}

/** A webview reports window.screen in CSS pixels, which are logical pixels. */
function fromScreen(): LaunchScreen | null {
  const s = windowScreen();
  return s === null ? null : { ...s, source: "screen" };
}

async function read(): Promise<LaunchScreen | null> {
  if (nativeMonitors()) {
    try {
      // The monitor the main window opened on; Wayland may not say, and has
      // no primary monitor at all, which is what window.screen is for.
      const found = fromMonitor(await currentMonitor()) ?? fromMonitor(await primaryMonitor());
      if (found !== null) return found;
    } catch {
      // Fall through: a failed IPC read is no reason to skip the choice.
    }
  }
  return fromScreen();
}

/**
 * The launch screen's logical size, or null. Desktop only: on iOS/Android
 * it is null, since the iPad preset and device qualification are separate
 * gates. Never rejects and never takes longer than DEADLINE_MS.
 */
export function readLaunchScreen(): Promise<LaunchScreen | null> {
  const platform = import.meta.env.TAURI_ENV_PLATFORM;
  if (platform === "ios" || platform === "android") return Promise.resolve(null);
  return Promise.race([
    read().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DEADLINE_MS)),
  ]);
}
