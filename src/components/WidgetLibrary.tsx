// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { LinkedWidgetDialog } from "./LinkedWidgetDialog";
import { BUILTIN_BACKEND_ID, LINKED_TABLE_ID, LINKED_CHART_ID } from "../lib/builtins";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildTree, railDashboardsWithPath } from "../lib/folderTree";
import { buildPresenceIndex, presenceOf } from "../lib/libraryPresence";
import { logError } from "../lib/logger";
import { clampLogName } from "../lib/logNames";
import { resolveSymbolOverride } from "../lib/params";
import { needsKey, normalizeProvider, worstTone, type ProbeTone } from "../lib/providerKeys";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useProviderKeysStore } from "../stores/providerKeysStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import type { Dashboard, WidgetDef } from "../lib/types";
import {
  EMPTY_FILTER,
  LibraryFilters,
  backendLabel,
  matchesFilter,
  type LibraryFilter,
} from "./LibraryFilters";

const isLinkedBuiltin = (widget: WidgetDef) => widget.backendId === BUILTIN_BACKEND_ID && (widget.id === LINKED_TABLE_ID || widget.id === LINKED_CHART_ID);

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

/**
 * What each tone means, for the badge's `title`: colour alone never carries
 * the meaning, and the Library deliberately has no tone legend of its own.
 */
const TONE_MEANING: Record<ProbeTone, string> = {
  green: "key accepted",
  amber: "key rejected or errored",
  red: "no response",
  grey: "not probed",
};

/**
 * A provider outside key-maint's registry needs no credential, so there is
 * nothing to probe and nothing to colour — it stays the neutral badge.
 * Everything else is grey until a probe result for it lands.
 */
function toneOf(provider: string, probe: Record<string, ProbeTone>): ProbeTone | null {
  if (!needsKey(provider)) return null;
  const key = normalizeProvider(provider);
  return Object.hasOwn(probe, key) ? probe[key] : "grey";
}

/**
 * The spec badges a multi-source widget `Multisource` rather than listing every
 * provider. Its colour is the Key Maintenance probe dot's, so the two surfaces
 * answer the same question the same way; a multi-source widget takes the WORST
 * of its providers' tones, because it is only as good as its weakest one.
 */
function SourceBadge({ source }: { source: string[] }) {
  const probe = useProviderKeysStore((s) => s.probe);
  if (source.length === 0) return null;
  const multi = source.length > 1;
  const tones = source.map((s) => toneOf(s, probe));
  const toned = tones.filter((t): t is ProbeTone => t !== null);
  return (
    <span
      className="source-badge"
      data-testid="source-badge"
      data-tone={toned.length > 0 ? worstTone(toned) : undefined}
      title={source
        .map((s, i) => {
          const tone = tones[i];
          return tone === null ? s : `${s}: ${TONE_MEANING[tone]}`;
        })
        .join(", ")}
    >
      {multi ? "Multisource" : source[0]}
    </span>
  );
}

/** Beyond this many, the rest collapse into one `+N` pill. */
const MAX_PILLS = 3;

/**
 * One pill per dashboard the widget already sits on, in rail order. Distinct
 * from the card's own "already on this tab" outline, which is about the target
 * tab only (spec D5); these are the wider picture.
 */
function DashboardPills({ on, activeId }: { on: readonly Dashboard[]; activeId: string | null }) {
  if (on.length === 0) return null;
  const shown = on.slice(0, MAX_PILLS);
  const rest = on.slice(MAX_PILLS);
  return (
    <span className="library-card-dashboards" data-testid="library-card-dashboards">
      {shown.map((d) => (
        <span
          key={d.id}
          className="dashboard-badge"
          title={`On ${d.name}`}
          // Marked so the pill and the target tab's outline agree about which
          // dashboard this add lands on.
          data-active={d.id === activeId ? "true" : undefined}
        >
          {d.name}
        </span>
      ))}
      {rest.length > 0 ? (
        <span className="dashboard-badge" title={`On ${rest.map((d) => d.name).join(", ")}`}>
          {`+${rest.length}`}
        </span>
      ) : null}
    </span>
  );
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

  const [linkedPresentation, setLinkedPresentation] = useState<"table" | "chart">();
  // Every dashboard, in the order the rail draws them -- the pills below read
  // as the rail does rather than as the flat dashboardOrder array.
  const dashboards = useDashboardStore((s) => s.dashboards);
  const folders = useFoldersStore((s) => s.folders);
  const folderOrder = useFoldersStore((s) => s.folderOrder);
  const placement = useFoldersStore((s) => s.placement);
  const rail = useMemo(
    () => railDashboardsWithPath(buildTree(folders, folderOrder, placement, dashboards)),
    [folders, folderOrder, placement, dashboards],
  );
  const ordered = useMemo(() => rail.map((entry) => entry.dashboard), [rail]);
  // The On-dashboard options come from the dashboards themselves, so one
  // carrying no listed widget stays selectable and answers with the no-match
  // state.
  const dashboardChoices = useMemo(
    () => rail.map(({ dashboard, path }) => ({ id: dashboard.id, name: dashboard.name, path })),
    [rail],
  );

  const backends = useBackendsStore((s) => s.backends);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER);

  // The overlay is a div, not a <dialog>, so nothing moves focus in on its
  // own: without this the search box the Option+0 note below counts on never
  // has focus, typing after ⌘K reaches nothing, and Tab walks the dashboard
  // behind. On close, focus goes back to whatever opened it, as
  // the real dialogs do — whose showModal() and
  // document-level Escape do not fit an overlay that stays under the rail.
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    search.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // A dashboard deleted from the rail while the library stayed open leaves the
  // filter naming an id nothing answers to: matchesFilter then hides every
  // widget, while the select -- whose value matches no option -- draws blank
  // and reads as "Any". Let go of it in the same pass that notices it is gone.
  //
  // The same trap for backends, reached a different way: a backend removed in
  // Connections takes its widgets out of the registry, so the selected id stops
  // being one of the options derived from them -- leaving the select blank
  // while it filters every remaining widget away. Builtins are never removable,
  // so they need no equivalent.
  //
  // The updater returns the SAME filter when there is nothing to clear, so
  // this settles in one render instead of looping.
  useEffect(() => {
    setFilter((f) => {
      const staleDashboard = f.dashboardId && !dashboardChoices.some((d) => d.id === f.dashboardId);
      const staleBackend = f.backendId && !widgets.some((w) => w.backendId === f.backendId);
      if (!staleDashboard && !staleBackend) return f;
      return { ...f, ...(staleDashboard ? { dashboardId: null } : {}), ...(staleBackend ? { backendId: null } : {}) };
    });
  }, [dashboardChoices, widgets]);

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
      if (linkedPresentation) return;
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
  }, [onClose, target.dashboardId, target.tabId, linkedPresentation]);

  // ONE inverted pass over the dashboards, kept until the widgets or the
  // dashboards themselves change. Everything that asks "where does this
  // widget already sit" reads it -- the pills below AND the On-dashboard
  // filter -- so the two cannot disagree, and neither rescans anything on a
  // keystroke in the search box (which is state in this component, so every
  // keystroke re-renders the whole grid).
  const presence = useMemo(() => buildPresenceIndex(widgets, ordered), [widgets, ordered]);

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
      if (!matchesFilter(w, filter, presence)) return false;
      if (!needle) return true;
      return (
        w.name.toLowerCase().includes(needle) || w.description.toLowerCase().includes(needle)
      );
    });
  }, [widgets, query, filter, presence]);

  // addCardTo reaches saveDashboard, which can reject on a failed disk write;
  // caught here (and logged) rather than left as an unhandled rejection. A
  // null return means the target tab no longer exists -- not an error, but
  // there is nothing left to add to, so log it and close rather than leave
  // the library open over dead UI.
  async function handleAdd(widget: WidgetDef) {
    if (isLinkedBuiltin(widget)) {
      setLinkedPresentation(widget.id === LINKED_CHART_ID ? 'chart' : 'table');
      return;
    }
    try {
      const override = resolveSymbolOverride(widget, targetCards, useSettingsStore.getState().settings);
      const result = await addCardTo(target.dashboardId, target.tabId, widget, override);
      if (result === null) {
        await logError(`widget library target tab ${target.tabId} no longer exists`);
        onClose();
      }
    } catch (err) {
      await logError(`failed to add card for widget ${clampLogName(widget.id)}: ${err}`);
    }
  }

  return (
    // No aria-modal: nothing traps Tab inside the overlay, so claiming modal
    // would tell a screen reader the rest of the app is unreachable when it
    // is not.
    <>
    {linkedPresentation && target.dashboardId && target.tabId ? <LinkedWidgetDialog dashboardId={target.dashboardId} tabId={target.tabId} presentation={linkedPresentation} onClose={() => setLinkedPresentation(undefined)} /> : null}
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

      <LibraryFilters
        widgets={widgets}
        backends={backends}
        dashboards={dashboardChoices}
        filter={filter}
        onChange={setFilter}
      />

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
            return (
              <button
                key={`${w.backendId}:${w.id}`}
                type="button"
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
                  if (e.detail === 2 && !isLinkedBuiltin(w)) {
                    returnToOrigin();
                    onClose();
                  }
                }}
                draggable={!isLinkedBuiltin(w)}
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
                <DashboardPills on={presenceOf(presence, w)} activeId={target.dashboardId} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
}
