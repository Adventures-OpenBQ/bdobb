// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNewsWire, type NewsRow, type WireStatus } from "../../hooks/useNewsWire";
import { ALL_TAB, daysAgo, headline, iconUrl, isHighlighted, isVideo, moveTab, rowTime, tabsOf, trimBase } from "../../lib/news";
import { safeUrl } from "../../lib/safeUrl";
import type { NewsFeed } from "../../lib/types";

type Props = {
  /** The card's `url` param, verbatim. */
  base: string;
  feeds: NewsFeed[];
  highlights: string[];
  /** Refresh and ⌘R: a bump reconnects and re-seeds. */
  refreshKey: number;
  /** Opens the feed manager; used by the empty state. Absent on a locked card or in a viewer window, which offer no edits. */
  onConfigure?: () => void;
  /** The card's saved tab order (never contains All). */
  tabOrder: string[];
  /** A tab was dropped elsewhere: the new order, without All, to persist. Absent (no tab drag) on a locked card or in a viewer window. */
  onReorderTabs?: (order: string[]) => void;
  /** Rows down the rail, or a strip of cards across it, newest at the left. */
  layout?: "vertical" | "horizontal";
  /** Horizontal only: the strip glides on its own, pausing under the pointer. */
  autoScroll?: NewsAutoScroll;
};

export type NewsAutoScroll = "off" | "slow" | "medium" | "fast";
/** Pixels per second the strip glides at. */
const AUTO_SCROLL_PX_S: Record<Exclude<NewsAutoScroll, "off">, number> = { slow: 20, medium: 45, fast: 90 };

const statusLabel = (status: WireStatus) => (status === "error" ? "reconnecting" : status);

/** The configured name, else the server's title, else the feed's host. */
function sourceOf(row: NewsRow): string {
  if (row.feed.name.trim() !== "") return row.feed.name;
  if (row.record.title !== null && row.record.title.trim() !== "") return row.record.title;
  try {
    return new URL(row.feed.url).host;
  } catch {
    return row.feed.url;
  }
}

function open(row: NewsRow) {
  const link = row.article.link === null ? null : safeUrl(row.article.link);
  if (link !== null) void openUrl(link);
}

/**
 * The News rail. Everything from the wire is a text node or an <img src>
 * that passed iconUrl; links go nowhere but openUrl, after safeUrl. A single
 * click or tap is a deliberate no-op — rows sit close together and a rail of
 * single-click landmines makes scrolling hazardous (v8 spec). A double-click,
 * a double-tap or Enter opens the story. On the iPad a finger scrolls both
 * layouts natively (touch-action pan-y on the list, pan-x on the strip);
 * `touch-action: manipulation` on the rows is what lets a double-tap reach us
 * as dblclick instead of zooming the page (amended 2026-09-14: the single tap
 * of 2026-09-03 fought finger scrolling).
 */
export function NewsRenderer({
  base,
  feeds,
  highlights,
  refreshKey,
  onConfigure,
  tabOrder,
  onReorderTabs,
  layout = "vertical",
  autoScroll = "off",
}: Props) {
  /** The tab under the pointer while one is being dragged, for the drop cue. */
  const [drag, setDrag] = useState<{ tab: string; over: string | null } | null>(null);
  const trimmed = trimBase(base);
  const { status, rows } = useNewsWire({ base: trimmed, feeds, refreshKey });
  const [tab, setTab] = useState(ALL_TAB);
  // State through a callback ref, not a ref object: the <ul> comes and goes
  // with the rows (the wire starts with none, an empty tab drops it), and an
  // effect keyed on a ref object never hears that it appeared or was replaced
  // — auto-scroll would never start on a fresh card, or glide a detached list.
  const [strip, setStrip] = useState<HTMLUListElement | null>(null);
  const horizontal = layout === "horizontal";
  /**
   * How many lines a card's headline may take: whatever fits under the top
   * line in the card's height, which follows the rail's. Measured from the
   * first card whenever the strip resizes or the rows change, and handed to
   * the stylesheet as --news-lines; a fixed clamp cut headlines short while
   * the card still had room.
   */
  const [lines, setLines] = useState<number | null>(null);
  useEffect(() => {
    const el = strip;
    if (!horizontal || el === null) return;
    const measure = () => {
      const card = el.querySelector<HTMLElement>(".news-card");
      const head = card?.querySelector<HTMLElement>(".news-card-head");
      const title = card?.querySelector<HTMLElement>(".news-card-title");
      if (!card || !head || !title) return;
      const cs = getComputedStyle(card);
      const lh = parseFloat(getComputedStyle(title).lineHeight);
      const room = card.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.rowGap || "0") - head.offsetHeight;
      if (!Number.isFinite(lh) || lh <= 0 || !Number.isFinite(room)) return;
      setLines(Math.max(1, Math.floor(room / lh)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [horizontal, strip, rows.length]);

  const tabs = tabsOf(feeds, tabOrder);
  // Component state, not persisted; a tab edited away falls back to All.
  const active = tabs.includes(tab) ? tab : ALL_TAB;
  const shown = active === ALL_TAB ? rows : rows.filter((r) => r.feed.tab.trim() === active);
  // The list (or strip) element only exists once there is something to show,
  // so the listeners below re-attach when it appears (shown.length === 0 flips).
  /**
   * The strip scrolls sideways, so a plain wheel (which is vertical on a
   * mouse and usually on a trackpad flick) is turned into horizontal travel.
   * A native listener, not React's onWheel: the default has to be prevented
   * and React registers wheel as passive.
   */
  useEffect(() => {
    const el = strip;
    if (!horizontal || el === null) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [horizontal, strip]);

  /**
   * Drag to scroll with the mouse: press anywhere on the list or the strip
   * and pull it — sideways on the strip, up and down on the list. A second
   * way beside the wheel on a desktop. Touch is left to the browser's own
   * panning (touch-action on the elements), so this ignores touch pointers.
   * A pull farther than a few pixels swallows the double-click that would
   * otherwise open the row it ends on.
   */
  const dragged = useRef(false);
  useEffect(() => {
    const el = strip;
    if (el === null) return;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let active = false;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      active = true;
      dragged.current = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
    };
    const onMove = (e: PointerEvent) => {
      if (!active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        dragged.current = true;
        // Capture only once it is a drag: a captured pointer retargets the
        // click and double-click to the list itself, so capturing on the
        // press would stop a plain double-click from reaching the row.
        el.setPointerCapture?.(e.pointerId);
      }
      if (horizontal) el.scrollLeft = startLeft - dx;
      else el.scrollTop = startTop - dy;
    };
    const onUp = () => {
      active = false;
    };
    const listeners = new AbortController();
    const { signal } = listeners;
    el.addEventListener("pointerdown", onDown, { signal });
    el.addEventListener("pointermove", onMove, { signal });
    el.addEventListener("pointerup", onUp, { signal });
    el.addEventListener("pointercancel", onUp, { signal });
    return () => listeners.abort();
  }, [horizontal, strip]);

  /**
   * The four navigation buttons at the right of the tab bar: a page back or
   * forward (nine tenths of what is in view, so a row at the edge carries
   * over), and a jump to the beginning or the end. Oriented per layout.
   */
  function nav(where: "first" | "back" | "forward" | "last") {
    const el = strip;
    if (el === null) return;
    const page = horizontal ? el.clientWidth * 0.9 : el.clientHeight * 0.9;
    const end = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
    const at = horizontal ? el.scrollLeft : el.scrollTop;
    let to = where === "first" ? 0 : where === "last" ? end : where === "back" ? at - page : at + page;
    if (horizontal && (where === "back" || where === "forward")) {
      // Land on a card's left edge, so the first card in view is whole: the
      // card cut by the right edge leads the next page, and paging back
      // stops at the first card that fits. A card wider than the page keeps
      // the plain page step.
      const base = el.getBoundingClientRect().left - at + parseFloat(getComputedStyle(el).paddingLeft || "0");
      const starts = Array.from(el.children, (c) => c.getBoundingClientRect().left - base);
      const edge =
        where === "forward"
          ? starts.filter((x) => x > at + 1 && x <= at + page).at(-1)
          : starts.find((x) => x >= to && x < at - 1);
      if (edge !== undefined) to = edge;
    }
    if (horizontal) el.scrollLeft = to;
    else el.scrollTop = to;
  }
  const NAV = horizontal
    ? ([["first", "Beginning", "|◂"], ["back", "Page back", "◂◂"], ["forward", "Page forward", "▸▸"], ["last", "End", "▸|"]] as const)
    : ([["first", "Top", "⤒"], ["back", "Page up", "▴▴"], ["forward", "Page down", "▾▾"], ["last", "Bottom", "⤓"]] as const);

  /**
   * Auto-scroll: a frame loop easing scrollLeft back by speed × elapsed time,
   * so the strip starts at its oldest end and the cards drift right until the
   * newest comes into view last; there it wraps back to the oldest end.
   * Paused while the pointer is over the strip or a card has focus, so a
   * reader is never scrolled away from what they are reading; a fresh row
   * arriving does not restart the glide. Only the glide's own arrival at the
   * start wraps: the reader putting the strip there (Beginning, the wheel, a
   * drag) holds it on the newest until they move it away, or Beginning would
   * be wrapped to the end a frame later -- the nav buttons are outside the
   * strip, so nothing pauses it.
   */
  useEffect(() => {
    const el = strip;
    if (!horizontal || autoScroll === "off" || el === null) return;
    const speed = AUTO_SCROLL_PX_S[autoScroll];
    let paused = false;
    let last = performance.now();
    let frame = 0;
    // Where the glide has the strip, kept as a float here rather than read
    // back from scrollLeft: WebKit truncates a fractional scrollLeft write to
    // a whole pixel, so a step under 1px a frame (Slow and Medium at 60 Hz,
    // Fast at 120 Hz) would read back unchanged and the strip never move.
    // A scrollLeft more than a pixel away from it was the reader.
    let pos = el.scrollLeft;
    let held = false;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!paused) {
        const max = el.scrollWidth - el.clientWidth;
        if (Math.abs(el.scrollLeft - pos) > 1) {
          pos = el.scrollLeft;
          held = pos <= 1;
        }
        if (!held && max > 1) {
          pos = pos <= 1 ? max : Math.max(0, pos - speed * dt);
          el.scrollLeft = pos;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const pause = () => { paused = true; };
    const resume = () => { paused = false; last = performance.now(); };
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", resume);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointerenter", pause);
      el.removeEventListener("pointerleave", resume);
      el.removeEventListener("focusin", pause);
      el.removeEventListener("focusout", resume);
    };
  }, [horizontal, autoScroll, strip]);

  if (trimmed === "") return <p className="empty-state">Enter the RSS Aggregator server in Parameters.</p>;
  if (safeUrl(trimmed) === null) return <p className="empty-state">Enter an http or https server URL.</p>;
  if (feeds.length === 0) {
    if (onConfigure === undefined) return <p className="empty-state">No feeds configured.</p>;
    return (
      <p className="empty-state">
        <button type="button" className="news-configure" onClick={onConfigure}>
          Configure feeds…
        </button>
      </p>
    );
  }


  /**
   * Drag a tab onto another to reorder. Pointer events with capture, so one
   * code path serves mouse and touch; the tab under the pointer is found by
   * hit-testing (a captured pointer never enters a sibling). All never moves
   * and is never a target (moveTab refuses both). Selection is still the
   * click, which follows the release either way.
   */
  function startTabDrag(e: React.PointerEvent<HTMLButtonElement>, t: string) {
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    let over: string | null = null;
    setDrag({ tab: t, over });
    const onMove = (ev: PointerEvent) => {
      const hit = document.elementFromPoint?.(ev.clientX, ev.clientY)?.closest<HTMLElement>('[role="tab"]');
      const name = hit?.dataset.tab ?? null;
      over = name !== null && name !== ALL_TAB && name !== t ? name : null;
      setDrag({ tab: t, over });
    };
    const listeners = new AbortController();
    const { signal } = listeners;
    const onUp = () => {
      listeners.abort();
      setDrag(null);
      if (over !== null) {
        const next = moveTab(tabs, t, over);
        if (next !== null) onReorderTabs?.(next);
      }
    };
    el.addEventListener("pointermove", onMove, { signal });
    el.addEventListener("pointerup", onUp, { signal });
    el.addEventListener("pointercancel", onUp, { signal });
  }

  return (
    <div className="news-rail">
      {shown.length === 0 ? (
        // Fills the rail (styles.css .news-empty) so the tab bar below stays
        // locked to the bottom of the card, list or no list.
        <p className="empty-state news-empty">Waiting for headlines…</p>
      ) : (
        <ul
          className={horizontal ? "news-strip" : "news-list"}
          ref={setStrip}
          style={horizontal && lines !== null ? ({ "--news-lines": lines } as React.CSSProperties) : undefined}
        >
          {shown.map((row) => {
            const icon = iconUrl(row.record.favicon);
            const hit = isHighlighted(row.article.title, highlights);
            const iconEl = icon === null ? <span className="news-icon" aria-hidden="true" /> : <img className="news-icon" alt="" src={icon} />;
            const timeEl = (
              <span className="news-time">
                {rowTime(row.article)}
                {daysAgo(row.article) > 0 ? (
                  <span className="news-age" title="Days before today">{`[-${daysAgo(row.article)}]`}</span>
                ) : null}
              </span>
            );
            const videoEl = isVideo(row.article) ? (
              <span className="news-video" role="img" aria-label="video" title="Video">
                ▶
              </span>
            ) : null;
            const onRow = {
              tabIndex: 0,
              // A pull that scrolled the strip is not a double-click on the card it ended on.
              onDoubleClick: () => { if (!dragged.current) open(row); },
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter") open(row);
              },
            };
            if (horizontal) {
              // A card: favicon · time · ▶ on the top line, the headline
              // beneath. The source rides on the tooltip, and stands in for
              // the icon on the top line when the publisher has none.
              return (
                <li key={row.article.id} className={hit ? "news-card news-hit" : "news-card"} title={sourceOf(row)} {...onRow}>
                  <span className="news-card-head">
                    {icon === null ? <span className="news-source">{sourceOf(row)}</span> : iconEl}
                    {timeEl}
                    {videoEl}
                  </span>
                  <span className="news-card-title">{headline(row.article)}</span>
                </li>
              );
            }
            return (
              <li key={row.article.id} className={hit ? "news-row news-hit" : "news-row"} {...onRow}>
                {timeEl}
                {iconEl}
                <span className="news-source">{sourceOf(row)}</span>
                <span className="news-title">
                  {headline(row.article)}
                  {videoEl}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="news-tabs">
        <span
          className={`status-dot news-dot-${status}`}
          role="img"
          aria-label={statusLabel(status)}
          title={statusLabel(status)}
        />
        <div role="tablist" className="news-tablist">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              data-tab={t}
              aria-selected={t === active}
              className={
                drag?.tab === t ? "news-tab-dragging" : drag?.over === t ? "news-tab-over" : undefined
              }
              onClick={() => setTab(t)}
              onPointerDown={t === ALL_TAB || onReorderTabs === undefined ? undefined : (e) => startTabDrag(e, t)}
            >
              {t}
            </button>
          ))}
        </div>
        {shown.length === 0 ? null : (
          <div className="news-nav" role="group" aria-label="Scroll">
            {NAV.map(([where, label, glyph]) => (
              <button key={where} type="button" aria-label={label} title={label} onClick={() => nav(where)}>
                {glyph}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
