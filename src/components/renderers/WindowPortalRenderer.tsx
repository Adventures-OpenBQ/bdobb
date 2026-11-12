// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import {
  cancelScheduledRelease,
  enqueuePortal,
  fitPlayer,
  openAccessibilitySettings,
  portalPlatform,
  portalSettings,
  readMuteState,
  releaseNow,
  sameRect,
  scheduleRelease,
  setPlayerMuted,
  type CssRect,
  type MuteState,
  type PortalStatus,
} from "../../lib/windowPortal";

/**
 * How often the card fits again (a player opened, closed or dragged away,
 * or another card let go of it) and how often the mute button re-reads the
 * slider. Spec, States: "rechecked every few seconds".
 */
const RECHECK_MS = 3000;

const MESSAGES = {
  no_player: "Pop the video out in Chrome",
  in_use: "The player is in use by another card",
  too_small: "Make this card at least 284 × 160 to park the player here",
  viewer_window: "Open this dashboard in the main window",
  not_supported: "Available in the macOS desktop app",
} as const;

/**
 * The Window Portal card's body (spec
 * docs/superpowers/specs/2026-11-12-window-portal-card-design.md). It is
 * blank on purpose: on the Mac, Chrome's floating player is moved over it.
 */
export function WindowPortalRenderer({ cardId }: { cardId: string }) {
  const platform = portalPlatform();
  if (platform === "ipad") return <p className="empty-state">Park a picture-in-picture video here</p>;
  if (platform === "other") return <p className="empty-state">{MESSAGES.not_supported}</p>;
  return <MacPortal cardId={cardId} />;
}

function MacPortal({ cardId }: { cardId: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PortalStatus | null>(null);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let alive = true;
    let visible = true;
    let busy = false;
    let sent: CssRect | null = null;
    // A remount of this card inside the grace period keeps the player.
    cancelScheduledRelease(cardId);
    const measure = (): CssRect => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const fit = (rect: CssRect) => {
      busy = true;
      sent = rect;
      enqueuePortal(cardId, () =>
        fitPlayer(cardId, rect)
          .then(
            (next) => alive && setStatus(next),
            (err: unknown) => alive && setStatus({ state: "failed", reason: String(err) }),
          )
          .finally(() => {
            busy = false;
          }),
      );
    };
    const release = () => {
      sent = null;
      releaseNow(cardId);
    };

    // Every frame, but a rectangle only goes out when it changed: this
    // catches a drag, a resize, a scroll and a maximize alike. BDOBB's own
    // window moving is the native side's to follow.
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);
      if (!visible || busy) return;
      const rect = measure();
      if (sent === null || !sameRect(sent, rect)) fit(rect);
    });
    const recheck = setInterval(() => {
      if (visible && !busy) fit(measure());
    }, RECHECK_MS);
    // Fully scrolled out, or on a hidden tab: hand the player back. A card
    // partly in view keeps it (spec, Fitting).
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (!visible) release();
          });
    observer?.observe(el);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      clearInterval(recheck);
      observer?.disconnect();
      scheduleRelease(cardId);
    };
  }, [cardId]);

  return (
    <div ref={body} className="window-portal" data-state={status?.state ?? "looking"} style={{ width: "100%", height: "100%" }}>
      <PortalMessage status={status} />
    </div>
  );
}

function PortalMessage({ status }: { status: PortalStatus | null }) {
  if (status === null) return <p className="empty-state">Looking for the floating player…</p>;
  if (status.state === "failed") return <p className="empty-state">Could not move the player: {status.reason}</p>;
  // A local, so each check below narrows it down to MESSAGES' keys.
  const { state } = status;
  if (state === "fitted") return null;
  if (state === "no_permission") {
    return (
      <div className="empty-state">
        <p>BDOBB needs Accessibility permission to move Chrome's floating player.</p>
        <button type="button" onClick={() => void openAccessibilitySettings().catch(() => undefined)}>
          Open Accessibility settings
        </button>
      </div>
    );
  }
  return <p className="empty-state">{MESSAGES[state]}</p>;
}

/** The header's mute toggle. macOS desktop only: iPadOS cannot reach another app's player. */
export function WindowPortalMute({ params }: { params: Record<string, string> }) {
  if (portalPlatform() !== "macos") return null;
  const { source, label } = portalSettings(params);
  return <MuteButton source={source} label={label} />;
}

function MuteButton({ source, label }: { source: string; label: string }) {
  const [mute, setMute] = useState<MuteState | null>(null);
  // A click is ignored until the native call answers: two in flight would step the slider twice.
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    const read = () =>
      void readMuteState(source, label).then(
        (next) => alive && setMute(next),
        (err: unknown) => alive && setMute({ state: "unavailable", reason: String(err) }),
      );
    read();
    const timer = setInterval(read, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [source, label]);

  const muted = mute?.state === "muted";
  const reason = mute === null ? "Reading the volume…" : mute.state === "unavailable" ? mute.reason : undefined;
  return (
    <button
      type="button"
      className="card-action"
      // One name with aria-pressed, as Maximize does.
      aria-label="Mute"
      aria-pressed={muted}
      // aria-disabled, not disabled: a disabled button shows no tooltip, and the reason is the point.
      aria-disabled={reason !== undefined}
      disabled={pending}
      title={reason ?? (muted ? "Unmute" : "Mute")}
      onClick={() => {
        if (reason !== undefined || inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        void setPlayerMuted(source, label, !muted)
          .then(setMute, (err: unknown) => setMute({ state: "unavailable", reason: String(err) }))
          .finally(() => {
            inFlight.current = false;
            setPending(false);
          });
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
