import {PivotGroupUndo} from './components/PivotGroupUndo';
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { HelpSet } from "./help/index";
import { CardRemovalUndo } from "./components/CardRemovalUndo";
import { TableExecutionRuntime } from "./components/TableExecutionRuntime";
import { DashboardGrid } from "./components/DashboardGrid";
import { AppsDialog } from "./components/dialogs/AppsDialog";
import { ConnectionsDialog } from "./components/dialogs/ConnectionsDialog";
import { DropZone } from "./components/DropZone";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { LeftRail } from "./components/LeftRail";
import { WidgetLibrary, type LibraryTarget } from "./components/WidgetLibrary";
import { useDashboardShortcuts } from "./hooks/useDashboardShortcuts";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import type { App as AppManifest } from "./lib/appsJson";
import { decideAppsImport } from "./components/runAppsImport";
import { bootstrap, viewerIdFromLocation } from "./lib/bootstrap";
import { onDashboardChanged } from "./lib/dashboardSync";
import { logError } from "./lib/logger";
import { useDashboardStore } from "./stores/dashboardStore";
import { selectEffective, useSettingsStore } from "./stores/settingsStore";

/** Stable identity, so the shortcut hook's ref never churns. */
const NOOP = () => {};

/**
 * What `HelpDialog` falls back to if its chunk never arrives (offline,
 * cleared cache, a bad deploy).
 *
 * A real `<dialog>` opened with `showModal()` — the same idiom as every other
 * dialog in the app, and here it is a correctness requirement rather than
 * consistency. This rendered as plain markup at `z-index: 70`, which loses to
 * ANY `showModal()` dialog: those sit in the UA's top layer, which is above
 * every z-index there is. So ⌘? over an open Settings dialog — exactly when a
 * user is most likely to reach for help — put this message behind it.
 *
 * `role="alert"` announces it without stealing focus. `onCancel` is
 * prevented, as elsewhere: the native Escape close request would close the
 * element without telling React, leaving the caller's ⌘? state stuck open.
 * Close reuses the same `onClose` prop, so that state resets the same way
 * whichever component the lazy import resolved to.
 *
 * Exported for its test: it is only ever reached through a failed dynamic
 * import, which nothing can provoke from inside a render.
 */
export function HelpLoadFailed({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-label="Help unavailable"
      onCancel={(e) => e.preventDefault()}
    >
      <div className="help-load-failed" role="alert">
        <p>Help could not be loaded. Restart the app to try again.</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/**
 * Deferred: HelpDialog's module graph pulls in every help topic and
 * screenshot via two `import.meta.glob(..., { eager: true })` calls (47
 * modules), which has no reason to run at boot for a surface most sessions
 * never open. `React.lazy` keeps that whole subtree out of the initial
 * bundle; `.then` adapts HelpDialog's named export to the default export
 * `lazy` requires.
 *
 * `.catch` covers a failed chunk load (offline, cleared cache, a bad deploy)
 * by resolving to `HelpLoadFailed` rather than rejecting. Each Suspense site
 * now sits inside a boundary of its own, so a rejection would no longer reach
 * the app-wide one -- but this still wins, and deliberately. Not for the
 * layer any more (a dismissible boundary's fallback is a showModal() dialog
 * too, see ErrorBoundary): because React.lazy caches a rejected loader
 * forever, so the fallback's Retry could never succeed on this path, while
 * HelpLoadFailed says what WOULD work -- restart the app. The boundary is
 * what catches the failures this cannot convert (see the Suspense sites
 * below).
 */
const HelpDialog = lazy(() =>
  import("./components/dialogs/HelpDialog")
    .then((m) => ({ default: m.HelpDialog }))
    .catch(() => ({ default: HelpLoadFailed })),
);

/**
 * Which of the startup loaders could not read their file, on screen rather
 * than only in the log. `bootstrap` hands back one label per failure, in load
 * order, and an empty list is the ordinary case: no banner at all, so a boot
 * that worked costs nothing but this early return.
 *
 * A `<p role="alert">` and not a dialog: the app IS usable — the loaders that
 * worked are behind it — so this reports, and never blocks. The sentence is
 * one template literal rather than JSX text nodes because it is specified
 * word for word (see the plan's Global Constraints), and no reflow of this
 * file can reword it.
 */
function StartupErrorBanner({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <p className="startup-error-banner" role="alert">
      {`Failed to load on startup: ${labels.join(", ")}. The app is still usable, but some data may be missing until this is fixed and the app restarted.`}
    </p>
  );
}

export default function App() {
  // Read once per mount rather than at module scope: the query string cannot
  // change without a navigation, and module scope would freeze it for the
  // whole test file.
  const [viewerId] = useState(viewerIdFromLocation);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTarget, setLibraryTarget] = useState<LibraryTarget>({ dashboardId: null, tabId: null });
  const [appsOpen, setAppsOpen] = useState(false);
  // Shown inside the Apps dialog, and cleared by the next attempt: a message
  // about an Open that failed has no meaning once another one is under way.
  const [appsError, setAppsError] = useState<string | null>(null);
  // Set while an Open from the Apps dialog is creating its dashboard; see openApp.
  const openingApp = useRef(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState<HelpSet | null>(null);
  // The labels bootstrap came back with — the loaders that failed, in load
  // order. Empty until the mount effect below resolves, which is also the
  // ordinary end state.
  const [startupErrors, setStartupErrors] = useState<string[]>([]);
  // The RESOLVED theme, never the raw setting: "system" is not a value the
  // stylesheet knows, and this hook is what turns it into dark/light and
  // re-renders when the OS appearance changes (D5).
  const theme = useResolvedTheme();
  // The RAW setting as well, which is what the native window gets: see the
  // effect below.
  const themeSetting = useSettingsStore((s) => s.settings.theme);
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

  /**
   * Open, from the Apps dialog: one app becomes one dashboard through the
   * SAME path Import apps.json takes — importApps builds it, the store
   * persists and publishes it, the caller appends it to the order (see
   * LeftRail.importAppsFile). Deliberately not a second creation path: the
   * name de-duplication, the unresolved-backend sentinel, the viewer guard
   * and the persist-before-set ordering are all properties of that path, and
   * a copy of it here would eventually disagree with it.
   *
   * The dialog is closed once the dashboard EXISTS, and the try covers only
   * the step that decides that. Closing it first left a failure with nowhere
   * to appear — no dashboard, no message, and the one surface that could have
   * said so already gone — so a failed creation keeps the dialog up and puts
   * the reason in it.
   *
   * Persisting the order is a SEPARATE outcome and gets its own handling. By
   * then the dashboard is written, published and active: holding the dialog
   * open under "Could not create the dashboard" would be a lie about what
   * happened, and would invite a second Open that created a duplicate. So the
   * dialog closes, and the order failure — which costs the dashboard its
   * place in the rail on the next load, and nothing more — goes to the log in
   * its own words.
   *
   * No folder placement is written, which is what "root" is — a dashboard
   * absent from the folders store's `placement` is top level.
   *
   * One Open at a time: the button stays clickable while the dashboard is
   * being written, and a double-click would otherwise import the app twice
   * (a "Name" beside a "Name (2)"). A ref, not state, so the second click sees
   * the first one's claim in the same frame.
   */
  async function openApp(app: AppManifest) {
    if (openingApp.current) return;
    openingApp.current = true;
    setAppsError(null);
    try {
      // The app as a one-app apps.json, so it meets the same size and count
      // refusals a file does, and the same conflict dialog: opening the same
      // app twice is a name conflict. The rail has nothing but the name to
      // tell two copies apart, so whether there should be two is the user's
      // call; Keep both still makes a plain dashboard named as the importer
      // names it ("Macro (2)").
      const text = JSON.stringify([app]);
      const decided = await decideAppsImport(text, text.length);
      // Cancel import and Skip write nothing, so the dialog stays up for
      // another pick and nothing below runs.
      if (decided === "cancelled") return;
      if ("refusal" in decided) throw new Error(decided.refusal);
      const { added, replaced } = decided;
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
    // The native window's appearance, so the title bar matches the page
    // rather than staying whatever it was. This is the ONE place that must
    // send the RAW setting and not `theme`: Tauri applies an explicit value
    // as the window's NSAppearance, and WKWebView then reports THAT for
    // `prefers-color-scheme` forever -- no `change` event when macOS flips,
    // so the resolved value would pin the window to its own first guess and
    // make "system" permanently inert. `null` un-pins it and hands the
    // window back to the OS, which is exactly what "system" means.
    //
    // Fire and forget. Not a permission question: the capability set grants
    // core:window:allow-set-theme to "main" and "dash-*" alike
    // (src-tauri/capabilities/default.json), so a viewer window has it too.
    // What can fail is the HOST — setTheme is a no-op or an error on a
    // platform with no per-window appearance, and on webview builds older
    // than the API — and a title bar that did not follow is not worth an
    // error, because the document is themed either way. The try covers the
    // one SYNCHRONOUS failure: getCurrentWindow() itself throws with no Tauri
    // host at all (a plain browser, which is what `pnpm smoke` runs).
    try {
      getCurrentWindow()
        .setTheme(themeSetting === "system" ? null : themeSetting)
        .catch(() => {});
    } catch {
      // No Tauri host: nothing to theme but the document, already done.
    }
  }, [theme, themeSetting, fontSize, railWidth]);

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
    // Never rejects: every loader logs its own failure from inside and the
    // labels come back as a value, which is what the banner above the
    // dashboard prints.
    void bootstrap().then(setStartupErrors);
    // viewerId comes from useState, so it is stable for the component's life
    // and this effect still runs exactly once.
  }, [viewerId]);

  // The viewer's only way to hear about the main window's writes. Without it
  // the window is a snapshot taken when it opened, so a parameter shared
  // through a group -- the whole point of which is that both cards agree --
  // could read one value here and another there.
  //
  // Only the dashboard this window was opened for: every other id on the bus
  // belongs to a dashboard it does not show.
  useEffect(() => {
    if (viewerId === null) return;
    let live = true;
    let unlisten: (() => void) | null = null;
    void onDashboardChanged((id) => {
      if (id === viewerId) void useDashboardStore.getState().syncDashboard(id);
    }).then((off) => {
      // Unsubscribing before the promise settles is a real ordering: keep the
      // fn only while the effect is still current, and tear down at once if
      // it is not.
      if (live) unlisten = off;
      else off();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [viewerId]);

  const helpDialog =
    helpOpen !== null ? (
      // OUTSIDE the Suspense, per D2. That placement is NOT what
      // makes the load itself catchable -- React unwinds a render
      // error past a Suspense either way, and moving this inside
      // leaves the whole boundary suite green (measured). What the
      // boundary really covers here is a throw in HelpDialog's own
      // render and a module that resolves to something that is not a
      // component.
      //
      // What it deliberately does NOT cover is an import that fails
      // to load, which the `.catch` above has already turned into
      // HelpLoadFailed -- and that division is the important one:
      // React.lazy caches a rejected loader FOREVER, so this
      // fallback's Retry could never succeed on that path, while
      // HelpLoadFailed says what would: restart the app. (Both are
      // showModal() dialogs now, so the layer is no longer what
      // separates them -- only the advice each can honestly give.)
      <ErrorBoundary label="the help dialog" resetKey={helpOpen} onDismiss={() => setHelpOpen(null)}>
        <Suspense fallback={null}>
          <HelpDialog set={helpOpen} onClose={() => setHelpOpen(null)} />
        </Suspense>
      </ErrorBoundary>
    ) : null;

  // Read-only by construction, not by permission checks scattered through the
  // tree: the rail, the library and the dialogs are simply not rendered, and
  // the store refuses the writes the remaining surface could still attempt.
  if (viewerId !== null) {
    return (
      // The catch-all: a throw anywhere under it leaves the window with a
      // message and a Retry instead of the blank one React unmounts to. Each
      // pane and dialog gets its own boundary as well, so this one is the
      // last resort and not the first -- see the ones inside.
      <ErrorBoundary label="the app">
        <div className="app-shell">
          <TableExecutionRuntime />
          {/* The zone renders the <main> and ignores every drop here, but its
              window-level guard still runs: LeftRail opens this window with
              dragDropEnabled: false, exactly as tauri.conf.json does the main
              one, so the webview -- and therefore the guard -- sees the drop.
              Without it a file dropped here would navigate the window away. */}
          <ErrorBoundary label="the dashboard area">
            <DropZone mainRef={dashboardArea} viewer>
              <StartupErrorBanner labels={startupErrors} />
              {/* This window has no rail, so the grid IS the window: without
                  its own boundary the catch-all above would be what a bad
                  card layout hit, and there would be nothing left to look
                  at. */}
              <ErrorBoundary label="the dashboard">
                <DashboardGrid onOpenLibrary={NOOP} viewer />
              </ErrorBoundary>
            </DropZone>
          </ErrorBoundary>
          {/* Outside the zone, as in the main window below and for the same
              reason. The rail is not rendered here, so ⌘? is the only way in
              -- but the dialog itself is identical, per the design's D14. */}
          {helpDialog}
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary label="the app">
      <div className="app-shell">
          <TableExecutionRuntime />
        {/* One boundary per top-level pane and dialog (D2), each named as it
            reads inside "Something went wrong in ___." A throw is then
            contained to the one region that threw: the rail keeps working
            while the grid is down, the grid keeps working while a dialog is
            down, and the catch-all above is reached only by something outside
            all of them.

            Every dialog's boundary sits INSIDE its `open ? ... : null`, so a
            dialog that is not open still mounts nothing at all. That also
            makes the reset structural -- closing unmounts the boundary along
            with the dialog. Only Help's needs `resetKey` (D3): it stays
            mounted while it switches between Quick Help and the manual. */}
        <ErrorBoundary label="the left rail">
          <LeftRail
            onOpenLibrary={openLibrary}
            onOpenApps={() => {
              // A stale failure must not greet the next opening of the dialog.
              setAppsError(null);
              setAppsOpen(true);
            }}
            onOpenConnections={() => setConnectionsOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenHelp={setHelpOpen}
          />
        </ErrorBoundary>
        {/* The zone renders the <main> itself, so this boundary is the only
            thing between a throw in it and a window with no dashboard area at
            all. What is under it is the banner and the grid, and nothing
            else: the dialogs are siblings below, not children. */}
        <ErrorBoundary label="the dashboard area">
          <DropZone mainRef={dashboardArea}>
            {/* Above the grid, inside the area that scrolls with it: the
                dashboards that DID load are the point of the window, and this
                is what a user reads past to reach them. */}
            <StartupErrorBanner labels={startupErrors} />
            <ErrorBoundary label="the dashboard">
              <DashboardGrid onOpenLibrary={openLibrary} />
            </ErrorBoundary>
          </DropZone>
        </ErrorBoundary>
        <CardRemovalUndo /><PivotGroupUndo />
        {/* The five dialogs are the zone's SIBLINGS, not its children.
            Written inside <DropZone> they were inside its boundary too, so a
            throw in the zone took every dialog with it and left a rail whose
            every button was dead -- each one only sets an open state, and the
            caught boundary would not render what it opened. Nothing about
            them needs the <main>: all five are `showModal()` dialogs in the
            UA's top layer (the library is `position: fixed`), and DropZone's
            own `coveredByOverlay()` asks the DOCUMENT for a `dialog[open]`
            rather than looking inside itself -- so a drop behind an open
            dialog is still refused from out here, which e2e/drop.spec.ts
            pins in a real engine. */}
        {libraryOpen ? (
          <ErrorBoundary label="the widget library" onDismiss={() => setLibraryOpen(false)}>
            <WidgetLibrary target={libraryTarget} onClose={() => setLibraryOpen(false)} />
          </ErrorBoundary>
        ) : null}
        {appsOpen ? (
          <ErrorBoundary label="the apps dialog" onDismiss={() => setAppsOpen(false)}>
            <AppsDialog
              onClose={() => setAppsOpen(false)}
              // The backendId the dialog also hands over is deliberately
              // unused: per the design's D3 a copy keeps no provenance, and a
              // card resolves against the whole registry rather than against
              // the backend the app came from.
              onOpen={(app) => void openApp(app)}
              error={appsError ?? undefined}
            />
          </ErrorBoundary>
        ) : null}
        {connectionsOpen ? (
          <ErrorBoundary label="the connections dialog" onDismiss={() => setConnectionsOpen(false)}>
            <ConnectionsDialog onClose={() => setConnectionsOpen(false)} />
          </ErrorBoundary>
        ) : null}
        {settingsOpen ? (
          <ErrorBoundary label="the settings dialog" onDismiss={() => setSettingsOpen(false)}>
            <SettingsDialog onClose={() => setSettingsOpen(false)} />
          </ErrorBoundary>
        ) : null}
        {helpDialog}
      </div>
    </ErrorBoundary>
  );
}
