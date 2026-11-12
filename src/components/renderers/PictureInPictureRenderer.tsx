// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelScheduledRelease,
  enqueuePlayerOp,
  fitPlayer,
  muteWhileHidden,
  openAccessibilitySettings,
  parkNow,
  pipPlatform,
  pipSettings,
  readMuteState,
  rowsForPlayer,
  sameRect,
  scheduleLeave,
  setPlayerMuted,
  type CardData,
  type CssRect,
  type MuteState,
  type PipStatus,
} from "../../lib/pictureInPicture";
import { DEFAULT_DOCK_ROWS, DOCKS_ID } from "../../lib/dashboardsFile";
import type { PinEdge } from "../../lib/types";
import { GRID_ROW_HEIGHT, ownerOfCard, useDashboardStore } from "../../stores/dashboardStore";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";

/**
 * How often the card fits again (a player opened, closed or dragged away,
 * or another card let go of it) and how often the mute button re-reads the
 * slider. Spec, States: "rechecked every few seconds".
 */
const RECHECK_MS = 3000;

/** How dim the Mute button looks while it cannot be used. */
const UNAVAILABLE_OPACITY = 0.45;

/** Whether a card is still in the dashboards or the docks: a card that left the screen only parks the player; a removed one releases it. */
const dashboardData: CardData = {
  has: (id) => ownerOfCard(useDashboardStore.getState(), id) !== undefined,
  subscribe: (listener) => useDashboardStore.subscribe(listener),
};

/** Cards that have been snapped this app session: a remount (every dashboard switch) does not snap again. */
const snapped = new Set<string>();

/** When the user last released the pointer in this window: a height change just after it is a local resize. */
let lastPointerRelease = -Infinity;
const LOCAL_RESIZE_MS = 1500;
if (typeof window !== "undefined") {
  for (const type of ["pointerup", "mouseup"]) window.addEventListener(type, () => (lastPointerRelease = Date.now()), true);
}

const cardIn = (s: Parameters<typeof ownerOfCard>[0], id: string) =>
  ownerOfCard(s, id)?.tabs.flatMap((t) => t.cards).find((c) => c.id === id);

const MESSAGES = {
  no_player: "Pop the video out in Chrome",
  in_use: "The player is in use by another card",
  too_small: "Make this card at least 284 × 160 to park the player here",
  viewer_window: "Open this dashboard in the main window",
  not_supported: "Available in the macOS desktop app",
} as const;

/**
 * The Picture in Picture card's body (spec
 * docs/superpowers/specs/2026-11-12-picture-in-picture-card-design.md). It is
 * blank on purpose: on the Mac, Chrome's floating player is moved over it.
 */
export function PictureInPictureRenderer({
  cardId,
  params = {},
  menuOpen = false,
  readOnly = false,
}: {
  cardId: string;
  params?: Record<string, string>;
  /** A viewer window: the card may not change its own height. */
  readOnly?: boolean;
  /** The card's own header menu is open: the player steps aside until it closes. */
  menuOpen?: boolean;
}) {
  const platform = pipPlatform();
  if (platform === "ipad") return <p className="empty-state">Park a picture-in-picture video here</p>;
  if (platform === "other") return <p className="empty-state">{MESSAGES.not_supported}</p>;
  const { source, label } = pipSettings(params);
  return <MacPlayer cardId={cardId} muteSource={muteWhileHidden(params) ? source : undefined} muteLabel={label} menuOpen={menuOpen} readOnly={readOnly} />;
}

/** `muteSource` is undefined unless "Mute while hidden" is on. */
function MacPlayer({
  cardId,
  muteSource,
  muteLabel,
  menuOpen,
  readOnly,
}: {
  cardId: string;
  muteSource?: string;
  muteLabel: string;
  menuOpen: boolean;
  readOnly: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PipStatus | null>(null);

  // The card's height follows its width: it takes the fewest rows that hold
  // the player when the card is first mounted this session, when its grid
  // width changes, and when its grid height changes just after the user
  // released the pointer in this window (a resize). A layout that arrives from
  // sync changes the height without a local release and is left alone, so two
  // Macs with different windows do not rewrite each other's heights. The rows
  // depend only on the width, so this settles.
  const gridW = useDashboardStore((s) => cardIn(s, cardId)?.layout.w);
  const gridH = useDashboardStore((s) => cardIn(s, cardId)?.layout.h);
  const seen = useRef<{ w: number; h: number } | null>(null);
  const snap = useCallback(() => {
    const el = body.current;
    const cardEl = el?.closest(".widget-card");
    const state = useDashboardStore.getState();
    const card = cardIn(state, cardId);
    // A maximized card is as wide as the screen, not as wide as its grid cell.
    if (!el || !cardEl || !card || state.maximizedCardId === cardId) return;
    // A card pinned to an edge keeps its stored slot for Unpin.
    if (card.pinned) return;
    // A zoomed workspace grid measures zoomed pixels against unzoomed rows.
    const zoom = cardEl.closest(".workspace-grid")?.getAttribute("data-zoom");
    if (zoom !== null && zoom !== undefined && zoom !== "100") return;
    const b = el.getBoundingClientRect();
    const rows = rowsForPlayer({
      bodyWidth: b.width,
      overhead: cardEl.getBoundingClientRect().height - b.height,
      rowHeight: GRID_ROW_HEIGHT,
      gap: selectEffective(useSettingsStore.getState()).widgetGap,
    });
    if (rows === null) return;
    snapped.add(cardId);
    // In a locked dock the card cannot be taller than its band (the dock's tab id is its edge).
    const owner = ownerOfCard(state, cardId);
    const band = owner?.id === DOCKS_ID ? (state.docks.dockRows ?? DEFAULT_DOCK_ROWS)[owner.tabs.find((t) => t.cards.some((c) => c.id === cardId))?.id as PinEdge] : Infinity;
    const h = Math.min(rows, band);
    if (h === card.layout.h) return;
    const { x, y, w } = card.layout;
    void state.updateLayouts([{ i: cardId, x, y: Math.min(y, band - h), w, h }]);
  }, [cardId]);
  useEffect(() => {
    if (gridW === undefined || gridH === undefined) return;
    const last = seen.current;
    const wanted = last === null ? !snapped.has(cardId) : gridW !== last.w || (gridH !== last.h && Date.now() - lastPointerRelease < LOCAL_RESIZE_MS);
    if (readOnly || !wanted) {
      seen.current = { w: gridW, h: gridH };
      return;
    }
    // Two frames on, so the grid has laid the new size out (and, on mount, measured its width).
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        // Recorded here, not above: a cleanup that cancels the frame (Strict Mode's second pass) must not lose the trigger.
        seen.current = { w: gridW, h: gridH };
        snap();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [cardId, gridW, gridH, readOnly, snap]);

  // The Parameters panel and the header's rows take their height out of the
  // body. When that overhead changes at an unchanged width -- the panel
  // opened or closed -- the rows are counted again, so the player keeps its
  // room. A window resize changes the width and is left alone, as above.
  useEffect(() => {
    const el = body.current;
    const cardEl = el?.closest(".widget-card");
    if (!el || !cardEl || readOnly || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      return { width: Math.round(b.width), overhead: Math.round(cardEl.getBoundingClientRect().height - b.height) };
    };
    let last = measure();
    const observer = new ResizeObserver(() => {
      const now = measure();
      const panelChanged = now.width === last.width && now.overhead !== last.overhead;
      last = now;
      if (panelChanged) snap();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [readOnly, snap]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let alive = true;
    let visible = true;
    let busy = false;
    let sent: CssRect | null = null;
    const mute = muteSource === undefined ? undefined : { source: muteSource, label: muteLabel };
    // A remount of this card inside the grace period keeps the player.
    cancelScheduledRelease(cardId);
    // The menu is drawn over the card, and the player would cover it: step aside, fit again on close.
    if (menuOpen) {
      parkNow(cardId, true);
      return () => scheduleLeave(cardId, dashboardData);
    }
    const measure = (): CssRect => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const fit = (rect: CssRect) => {
      busy = true;
      sent = rect;
      enqueuePlayerOp(cardId, () =>
        fitPlayer(cardId, rect, mute)
          .then(
            (next) => alive && setStatus(next),
            (err: unknown) => alive && setStatus({ state: "failed", reason: String(err) }),
          )
          .finally(() => {
            busy = false;
          }),
      );
    };
    // A park that failed leaves the player in view: the recheck below tries again.
    let parkFailed = false;
    const hide = () => {
      sent = null;
      parkNow(cardId, false, (parked) => {
        parkFailed = !parked;
      });
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
      if (!visible && parkFailed) hide();
      if (visible && !busy) fit(measure());
    }, RECHECK_MS);
    // Fully scrolled out: move the player off screen, still held. A card
    // partly in view keeps it over the card (spec, Fitting).
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (!visible) hide();
          });
    observer?.observe(el);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      clearInterval(recheck);
      observer?.disconnect();
      scheduleLeave(cardId, dashboardData);
    };
  }, [cardId, muteSource, muteLabel, menuOpen]);

  return (
    <div ref={body} className="picture-in-picture" data-state={status?.state ?? "looking"} style={{ width: "100%", height: "100%" }}>
      <PipMessage status={status} />
    </div>
  );
}

function PipMessage({ status }: { status: PipStatus | null }) {
  if (status === null) return <p className="empty-state">Looking for the floating player…</p>;
  if (status.state === "failed") return <p className="empty-state">Could not move the player: {status.reason}</p>;
  // A local, so each check below narrows it down to MESSAGES' keys.
  const { state } = status;
  if (state === "fitted" || state === "parked") return null;
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
export function PictureInPictureMute({ params }: { params: Record<string, string> }) {
  if (pipPlatform() !== "macos") return null;
  const { source, label } = pipSettings(params);
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
      // Also while a call is in flight, and never `disabled`: the button keeps keyboard focus.
      aria-disabled={reason !== undefined || pending}
      title={reason ?? (muted ? "Unmute" : "Mute")}
      // Dimmed from here: the card's stylesheet has no rule for aria-disabled.
      style={reason !== undefined ? { opacity: UNAVAILABLE_OPACITY } : undefined}
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
