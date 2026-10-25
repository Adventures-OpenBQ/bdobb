// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { AppsDialog } from "./components/dialogs/AppsDialog";
import { decideImportConflicts } from "./components/dialogs/ImportConflictDialog";
import { type App as AppManifest, applyImportDecisions, keepBothName, planAppsImport } from "./lib/appsJson";
import { logError } from "./lib/logger";
import { useWidgetRegistryStore } from "./stores/widgetRegistryStore";
import type { HelpSet } from "./help/index";
import { DashboardGrid } from "./components/DashboardGrid";
import { ConnectionsDialog } from "./components/dialogs/ConnectionsDialog";
import { DropZone } from "./components/DropZone";
import { HelpDialog } from "./components/dialogs/HelpDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { LeftRail } from "./components/LeftRail";
import { WidgetLibrary, type LibraryTarget } from "./components/WidgetLibrary";
import { useDashboardShortcuts } from "./hooks/useDashboardShortcuts";
import { bootstrap, viewerIdFromLocation } from "./lib/bootstrap";
import { useDashboardStore } from "./stores/dashboardStore";
import { selectEffective, useSettingsStore } from "./stores/settingsStore";

/** Stable identity, so the shortcut hook's ref never churns. */
const NOOP = () => {};

export default function App() {
  // Read once per mount rather than at module scope: the query string cannot
  // change without a navigation, and module scope would freeze it for the
  // whole test file.
  const [viewerId] = useState(viewerIdFromLocation);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState<LibraryTarget>({ dashboardId: null, tabId: null });
  const [appsOpen, setAppsOpen] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const openingApp = useRef(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState<HelpSet | null>(null);
  const theme = useSettingsStore((s) => selectEffective(s).theme);
  const fontSize = useSettingsStore((s) => selectEffective(s).fontSize);
  const railWidth = useSettingsStore((s) => selectEffective(s).railWidth);
  const dashboardArea = useRef<HTMLElement | null>(null);
  // Only for the effect below: the tab bar it measures does not exist until a
  // dashboard has loaded, and this going null -> id is that moment.
  const activeId = useDashboardStore((s) => s.activeId);

  // Captures which dashboard/tab was active at the moment the library was
  // opened, from both entry points (rail button, tab bar quick-add), so
  // switching dashboards in the rail while the library stays open can't
  // redirect where widgets get added.
  function openLibrary() {
    const s = useDashboardStore.getState();
    setLibraryTarget({ dashboardId: s.activeId, tabId: s.activeTabId });
    setLibraryOpen(true);
  }

  async function openApp(app: AppManifest) {
    if (openingApp.current) return;
    openingApp.current = true;
    setAppsError(null);
    try {
      // The app as a one-app apps.json, so it meets the same size and count
      // refusals a file does.
      const text = JSON.stringify([app]);
      const plan = planAppsImport(
        text,
        text.length,
        useWidgetRegistryStore.getState().widgets,
        // Checked against every existing name: a name already taken (opening
        // the same app twice, say) is a conflict, and the user is asked
        // through the dialog the rail's Import and a dropped file use --
        // Replace, Keep both, Skip or Cancel import -- rather than being
        // handed a silently renamed copy. The rail has nothing but the name
        // to tell two copies apart, so whether there should be two is the
        // user's call; Keep both still makes a plain dashboard named as the
        // importer names it ("Macro (2)").
        useDashboardStore.getState().dashboards,
      );
      if (!plan.ok) throw new Error(plan.refusal);
      const decisions = await decideImportConflicts(plan.conflicts, (index, prior) =>
        keepBothName(plan, prior, index),
      );
      // Cancel import and Skip write nothing, so the dialog stays up for
      // another pick and nothing below runs.
      if (decisions === "cancelled") return;
      const { added, replaced } = applyImportDecisions(plan, decisions);
      if (added.length === 0 && replaced.length === 0) return;
      if (added.length > 0) await useDashboardStore.getState().importDashboards(added);
      for (const { id, dashboard } of replaced) {
        await useDashboardStore.getState().replaceDashboardContents(id, dashboard);
        // A Replace keeps the dashboard's place in the rail; Open still
        // switches to what it opened, as it does for a new one.
        useDashboardStore.getState().setActive(id);
      }
    } catch (err) {
      // The thrown error's own message and nothing else. Not the app, and
      // not the document it came from: every field of both is a
      // backend-supplied string, so neither the log nor this line quotes
      // any of apps.json — the same discipline LeftRail's import follows.
      const message = err instanceof Error ? err.message : String(err);
      setAppsError(`Could not create the dashboard. ${message}`);
      // This window has no notice strip (the rail's import does, and owns
      // its own messages), so the dialog above carries the message; the log
      // keeps its own copy rather than an unhandled rejection.
      await logError(`failed to open an app as a dashboard: ${message}`);
      return;
    } finally {
      openingApp.current = false;
    }

    setAppsOpen(false);
    try {
      // Appended to the flat order, which stays the single source of it.
      await useSettingsStore
        .getState()
        .save({ dashboardOrder: useDashboardStore.getState().dashboards.map((d) => d.id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logError(
        `The dashboard was created but its position could not be saved. ${message}`,
      );
    }
  }

  // Below openLibrary rather than at the top of the component: the hook takes
  // it as an argument now (⌘K), and reading the two in that order is what
  // makes the wiring obvious. Hook order stays fixed across renders, which is
  // all React requires.
  //
  // The viewer window has no library to open, so ⌘K is inert there — but ⌘R
  // still refreshes, which is why the hook is called either way. ⌘? is passed
  // unconditionally: the viewer renders HelpDialog too, because help is
  // static bundled content with no store writes and there is nothing to gate.
  useDashboardShortcuts(viewerId === null ? openLibrary : NOOP, () => setHelpOpen("quick"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.fontSize = fontSize;
    // An inline custom property on :root, so it overrides the stylesheet's
    // own --rail-width. Nothing else reads the setting: the token already
    // drives .left-rail's collapsed width, .dashboard-area's left margin and
    // the library overlay's inset, so one write moves all of them.
    document.documentElement.style.setProperty("--rail-width", `${railWidth}px`);
  }, [theme, fontSize, railWidth]);

  /**
   * --dashboard-top: where the grid starts, in VIEWPORT coordinates — which
   * is what a maximized card needs, because it is `position: fixed` (see
   * .react-grid-item.card-maximized in styles.css) and a fixed box is laid
   * out against the viewport, not against .dashboard-area.
   *
   * The observed element is the TAB BAR, not .dashboard-area: the area is
   * `flex: 1 1 auto` in a 100vh row, so its own box never changes — not on a
   * vertical window resize, and not when the Font size setting makes the bar
   * taller. The bar's box changes on both (width on any window resize, height
   * on a font-size change), so one observer on it covers every way the edge
   * can move. jsdom implements no ResizeObserver, hence the guard — the same
   * one PdfView and ChartRenderer use — and lays nothing out anyway.
   */
  useEffect(() => {
    const area = dashboardArea.current;
    if (!area) return;
    // No bar means no dashboard yet (DashboardGrid renders an empty state
    // instead), and then nothing sits above the grid: the area's own top is
    // the top.
    const bar = area.querySelector<HTMLElement>(".tab-bar");
    const measure = () => {
      // The area's OWN top plus the bar's HEIGHT. The bar sits INSIDE
      // .dashboard-area's scroll box and is `position: sticky; top: 0` there
      // (styles.css), so it is pinned to the area's top edge and this sum is
      // the bar's actual viewport bottom in EVERY scroll state — a constant
      // this observer is right to publish only when the bar changes SIZE.
      // Reading the bar's own getBoundingClientRect().bottom would compute the
      // same number today and is deliberately not used: it would go stale the
      // moment the bar stopped being sticky, and this form cannot.
      const top = area.getBoundingClientRect().top + (bar ? bar.offsetHeight : 0);
      area.style.setProperty("--dashboard-top", `${Math.round(top)}px`);
    };
    // The FIRST measurement is the observer's, never a synchronous call here.
    // A ResizeObserver delivers an initial observation as soon as it observes,
    // so nothing is lost — and a getBoundingClientRect() at this point forces
    // a style/layout flush BETWEEN react-grid-layout's pre-mount render (which
    // positions items with left/top) and its mounted one (which switches them
    // to transform). That split turns the switch into a 200ms transition and
    // slides every card in from the grid's top-left corner on load, which also
    // leaves the corner resize handles moving under e2e's hit tests.
    // Environments with no ResizeObserver (jsdom) still get the one call they
    // would otherwise never get.
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(bar ?? area);
    return () => observer.disconnect();
  }, [activeId]);

  useEffect(() => {
    // The whole sequence, viewer flag included, lives in lib/bootstrap.ts:
    // startup order is a property of the stores, not of this component, and
    // it is testable there without mounting the app. It never rejects: a
    // failed load reaches the log from inside.
    void bootstrap();
    // viewerId comes from useState, so it is stable for the component's life
    // and this effect still runs exactly once.
  }, [viewerId]);

  // Read-only by construction, not by permission checks scattered through the
  // tree: the rail, the library and the dialogs are simply not rendered, and
  // the store refuses the writes the remaining surface could still attempt.
  if (viewerId !== null) {
    return (
      <div className="app-shell">
        {/* The zone renders the <main> and ignores every drop here, but its
            window-level guard still runs: LeftRail opens this window with
            dragDropEnabled: false, exactly as tauri.conf.json does the main
            one, so the webview -- and therefore the guard -- sees the drop.
            Without it a file dropped here would navigate the window away. */}
        <DropZone mainRef={dashboardArea} viewer>
          <DashboardGrid onOpenLibrary={NOOP} viewer />
          {/* The rail is not rendered here, so ⌘? is the only way in -- but
              the dialog itself is identical, per the design's D14. */}
          {helpOpen !== null ? <HelpDialog set={helpOpen} onClose={() => setHelpOpen(null)} /> : null}
        </DropZone>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <LeftRail
        onOpenLibrary={openLibrary}
        onOpenApps={() => { setAppsError(null); setAppsOpen(true); }}
        onOpenConnections={() => setConnectionsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={setHelpOpen}
      />
      <DropZone mainRef={dashboardArea}>
        <DashboardGrid onOpenLibrary={openLibrary} />
        {libraryOpen ? (
          <WidgetLibrary target={libraryTarget} onClose={() => setLibraryOpen(false)} />
        ) : null}
        {appsOpen ? <AppsDialog onClose={() => setAppsOpen(false)} onOpen={(app) => void openApp(app)} error={appsError ?? undefined} /> : null}
        {connectionsOpen ? <ConnectionsDialog onClose={() => setConnectionsOpen(false)} /> : null}
        {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
        {helpOpen !== null ? <HelpDialog set={helpOpen} onClose={() => setHelpOpen(null)} /> : null}
      </DropZone>
    </div>
  );
}
