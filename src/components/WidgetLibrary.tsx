// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState } from "react";
import { logError } from "../lib/logger";
import { resolveSymbolOverride } from "../lib/params";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import type { WidgetDef } from "../lib/types";
import { EMPTY_FILTER, LibraryFilters, backendLabel, matchesFilter, type LibraryFilter } from "./LibraryFilters";

/** Custom type so a file or text drag cannot masquerade as a widget drop. */
export const WIDGET_DRAG_TYPE = "application/x-bdobb-widget";

/** The dashboard/tab the library adds into, captured when it was opened so switching dashboards in the rail while it stays open can't redirect the add. */
export type LibraryTarget = { dashboardId: string | null; tabId: string | null };

/**
 * A stable fallback for the targetCards selector below. A fresh `[]`
 * literal there would be a new reference on every store read once the
 * target dashboard/tab no longer exists (e.g. deleted while the library
 * stayed open), and useSyncExternalStore treats that as a changing
 * snapshot on every render -- forcing React into "Maximum update depth
 * exceeded".
 */
const EMPTY_CARDS: never[] = [];

/** The spec badges a multi-source widget `Multisource` rather than listing every provider. */
function SourceBadge({ source }: { source: string[] }) {
  if (source.length === 0) return null;
  const multi = source.length > 1;
  return (
    <span className="source-badge" data-testid="source-badge" title={source.join(", ")}>
      {multi ? "Multisource" : source[0]}
    </span>
  );
}

/**
 * The widget's `imgUrl`, shown while its row is hovered or focused. An image
 * that fails to load renders nothing rather than the browser's broken-image
 * icon; it is remounted on the next hover, which tries again.
 */
function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className="library-card-preview" src={src} alt={alt} onError={() => setFailed(true)} />;
}

export function WidgetLibrary({ onClose, target }: { onClose: () => void; target: LibraryTarget }) {
  const widgets = useWidgetRegistryStore((s) => s.widgets);
  const addCardTo = useDashboardStore((s) => s.addCardTo);
  // Read live so shading updates as cards are added without closing the library.
  const targetCards = useDashboardStore(
    (s) =>
      s.dashboards.find((d) => d.id === target.dashboardId)?.tabs.find((t) => t.id === target.tabId)
        ?.cards ?? EMPTY_CARDS,
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER);
  // Which row's imgUrl preview is showing: the hovered or focused one.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const backends = useBackendsStore((s) => s.backends);

  // A backend removed in Connections takes its widgets out of the registry, so
  // its id stops being an option: the select would go blank while filtering
  // every remaining widget away. Builtins are never removable.
  useEffect(() => {
    setFilter((f) =>
      f.backendId && !widgets.some((w) => w.backendId === f.backendId) ? { ...f, backendId: null } : f,
    );
  }, [widgets]);

  // The overlay is a div, not a <dialog>, so nothing moves focus in on its
  // own: without this typing after ⌘K reaches nothing and Tab walks the
  // dashboard behind. On close, focus goes back to whatever opened it, as
  // the real dialogs do — whose showModal() and document-level Escape do not
  // fit an overlay that stays under the rail.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    search.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Returns to the dashboard/tab the library was opened from, validating it
  // still exists first -- setActive/setActiveTab set blindly, so a stale id
  // for a dashboard or tab removed while the library was open must not reach
  // them (mirrors the guard in dashboardStore's goToPrevious).
  function returnToOrigin() {
    const { dashboards, setActive, setActiveTab } = useDashboardStore.getState();
    const d = dashboards.find((x) => x.id === target.dashboardId);
    if (d) {
      setActive(d.id);
      if (d.tabs.some((t) => t.id === target.tabId)) setActiveTab(target.tabId!);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // stopImmediatePropagation for the same reason RowContextMenu does it
        // (its capture-phase keydown listener): the library is the innermost thing open,
        // so one Escape must close it and nothing else. Without this, opening
        // the library over a maximized card and pressing Escape would close
        // the library AND restore the card — the card's own bubble-phase
        // window listener (WidgetCard.tsx) sees every Escape this capture
        // handler lets through.
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      // Option+0 normally returns to the previously active dashboard
      // (useDashboardShortcuts), but inside the library that shortcut is
      // dead: the search input has focus (a typing target useDashboardShortcuts
      // itself ignores) and the overlay would stay painted regardless. Here
      // it instead means "return to wherever the library was opened from
      // and close" -- capture phase + stopImmediatePropagation (the same
      // pattern RowContextMenu uses for Escape) so this fires before, and
      // suppresses, useDashboardShortcuts' own bubble-phase Option+0 handler.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "Digit0") {
        e.preventDefault();
        e.stopImmediatePropagation();
        returnToOrigin();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, target.dashboardId, target.tabId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return widgets.filter((w) => {
      // The keys surface lives in Settings; it is not a card a user adds.
      // Nor is any `settings`-type widget: each is a section of the Settings
      // dialog (docs/settings-widgets.md).
      if (w.type === "keys" || w.type === "settings") return false;
      // A local-file table is created by dropping a file on the dashboard,
      // which is what puts a file behind its `file` param. Added from here it
      // would be a card with nothing to read.
      if (w.type === "local_table") return false;
      if (!matchesFilter(w, filter)) return false;
      if (!needle) return true;
      return (
        w.name.toLowerCase().includes(needle) || w.description.toLowerCase().includes(needle)
      );
    });
  }, [widgets, query, filter]);

  // addCardTo reaches saveDashboard, which can reject on a failed disk write;
  // caught here (and logged) rather than left as an unhandled rejection. A
  // null return means the target tab no longer exists -- not an error, but
  // there is nothing left to add to, so log it and close rather than leave
  // the library open over dead UI.
  async function handleAdd(widget: WidgetDef) {
    try {
      const override = resolveSymbolOverride(widget, targetCards, useSettingsStore.getState().settings);
      const result = await addCardTo(target.dashboardId, target.tabId, widget, override);
      if (result === null) {
        await logError(`widget library target tab ${target.tabId} no longer exists`);
        onClose();
      }
    } catch (err) {
      await logError(`failed to add card for widget ${widget.id}: ${err}`);
    }
  }

  return (
    // No aria-modal: nothing traps Tab inside the overlay, so claiming modal
    // would tell a screen reader the rest of the app is unreachable when it
    // is not.
    <div className="library-overlay" role="dialog" aria-label="Widget library">
      <header className="library-header">
        <h2>Widget Library</h2>
        <input
          ref={search}
          type="search"
          aria-label="Search widgets"
          placeholder="Search widgets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      <LibraryFilters widgets={widgets} backends={backends} filter={filter} onChange={setFilter} />

      {widgets.length === 0 ? (
        <p className="empty-state">
          No widgets discovered. Add a backend in Connections to populate the library.
        </p>
      ) : visible.length === 0 ? (
        <p className="empty-state">Nothing matches your search or filters.</p>
      ) : null}

      <div className="library-scroll">
        <div className="library-grid">
          {visible.map((w) => {
            const present = targetCards.some((c) => c.widgetId === w.id && c.backendId === w.backendId);
            const key = `${w.backendId}:${w.id}`;
            return (
              <button
                key={key}
                type="button"
                onMouseEnter={() => setPreviewKey(key)}
                onMouseLeave={() => setPreviewKey((k) => (k === key ? null : k))}
                onFocus={() => setPreviewKey(key)}
                onBlur={() => setPreviewKey((k) => (k === key ? null : k))}
                className={present ? "library-card library-card-present" : "library-card"}
                aria-label={`Add ${w.name}${present ? " (already on this tab)" : ""}`}
                onClick={(e) => {
                  // The browser already counts the clicks: `detail` is 0 for
                  // keyboard activation (Enter/Space), 1 for a plain click, and
                  // 2 for the second click of a double click. So the first
                  // click adds -- immediately, no window to wait out -- and the
                  // second one only means "and take me back", because the add
                  // it would have triggered has already happened.
                  if (e.detail <= 1) {
                    void handleAdd(w);
                    return;
                  }
                  if (e.detail === 2) {
                    returnToOrigin();
                    onClose();
                  }
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(WIDGET_DRAG_TYPE, `${w.backendId}:${w.id}`);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <span className="library-card-title">{w.name}</span>
                <span className="library-card-badges">
                  <span className="backend-badge" data-testid="backend-badge">
                    {backendLabel(w.backendId, backends)}
                  </span>
                  <SourceBadge source={w.source} />
                  <span className="type-badge">{w.type}</span>
                </span>
                <span className="library-card-description">{w.description}</span>
                {previewKey === key && w.imgUrl ? <PreviewImage src={w.imgUrl} alt={w.name} /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
