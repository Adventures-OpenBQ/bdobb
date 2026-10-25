// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { logError, logInfo } from "./logger";
import { findKeyMaintWidget } from "./providerKeys";
import { pickLaunchWorkspace, readLaunchScreen } from "./screenFit";
import { startDashboardAutoUpload } from "../components/runDashboardSync";
import { runStartupPrompt } from "../components/runWorkspaceSync";
import { useBackendsStore } from "../stores/backendsStore";
import { useChatStore } from "../stores/chatStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useMcpTokensStore } from "../stores/mcpTokensStore";
import { useProviderKeysStore } from "../stores/providerKeysStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSkillsStore } from "../stores/skillsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
import { useWorkspacesStore } from "../stores/workspacesStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useWorkspaceSyncStore } from "../stores/workspaceSyncStore";

/**
 * The dashboard id the "Open in new window" viewer was opened for, or null in
 * the main window. `?viewer=<id>` is the whole protocol: the second window is
 * the same bundle on the same route, which is why it works identically under
 * `vite --mode browser` and is what the e2e viewer spec drives.
 */
export function viewerIdFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get("viewer");
}

/**
 * Opens the launch workspace for this screen, if any (spec
 * docs/superpowers/specs/2026-10-12-resolution-default-workspace-design.md
 * §5): of the workspaces marked Open at launch that fit, the largest
 * minimum. Main window only, once, after the workspaces have loaded. Never
 * rejects and adds no banner label: a launch with nothing to open is not a
 * failure, and a read that fails costs the choice and nothing else.
 */
async function openLaunchWorkspace(): Promise<void> {
  try {
    const screen = await readLaunchScreen();
    if (screen === null) {
      await logInfo("launch screen unknown → single dashboard");
      return;
    }
    const size = `${Math.round(screen.width)}×${Math.round(screen.height)} logical (${screen.source})`;
    const workspace = pickLaunchWorkspace(useWorkspacesStore.getState().workspaces, screen);
    if (workspace === undefined) {
      await logInfo(`launch screen ${size} → no workspace fits`);
      return;
    }
    // Only from single-dashboard mode: nothing at launch should have chosen
    // one already, and if something has, it was the user.
    if (useWorkspacesStore.getState().activeWorkspaceId !== null) return;
    useWorkspacesStore.getState().setActiveWorkspace(workspace.id);
    await logInfo(`launch screen ${size} → workspace "${workspace.name}"`);
  } catch (err) {
    await logError(`failed to choose the launch workspace: ${err}`);
  }
}

/**
 * The message for a failure that belongs to no single loader -- the outer
 * catch's own. The parallel loaders used to borrow it verbatim, which
 * left the log unable to say WHICH of them was unreadable; each names itself
 * now (see `attempt`), so this wording is the outer catch's alone.
 */
const APP_STATE = "failed to load app state";

/**
 * The banner's label for a failure that is not any one loader's -- the step
 * around them (seeding the registry, the viewer's setActive, an unreadable
 * data directory). Prose, like the sentence it lands in: "Failed to load on
 * startup: the app itself."
 */
const SELF = "the app itself";

/**
 * One loader, run to a verdict instead of to a rejection: it logs its own
 * failure and answers with the label the startup banner names, or null when
 * it worked. Without this a single unreadable file took every loader beside
 * it down, and nothing but the log could say which one it was.
 *
 * The label serves both: the banner's word on screen, and the log line's --
 * `failed to load dashboards: ...`. The log is what a user sends in, so it
 * has to carry the same "which one" the banner does.
 */
async function attempt(label: string, load: () => Promise<void>): Promise<string | null> {
  try {
    await load();
    return null;
  } catch (err) {
    await logError(`failed to load ${label}: ${err}`);
    return label;
  }
}

/** Stops the key-maint watch the previous bootstrap installed, if any. */
let stopKeyMaintWatch: (() => void) | null = null;

/**
 * Refreshes provider keys again when a key-maint backend shows up in the
 * widget registry after startup: one flagged Ask for credentials on startup,
 * or added in Connections, is discovered after bootstrap's own refresh, and
 * bootstrap is the only other caller. Only on a key-maint arriving or
 * changing: it answers for every vendor at once, server-side, so this is one
 * request; other backends never re-run the per-vendor probes.
 */
function watchKeyMaint(): void {
  let seen = findKeyMaintWidget(useWidgetRegistryStore.getState().widgets)?.backendId;
  stopKeyMaintWatch = useWidgetRegistryStore.subscribe((state) => {
    const id = findKeyMaintWidget(state.widgets)?.backendId;
    const arrived = id !== undefined && id !== seen;
    seen = id;
    if (arrived) void useProviderKeysStore.getState().refresh().catch(() => {});
  });
}

/**
 * Everything the app reads at startup, in the one order it can be read in.
 * Lifted out of App's mount effect, which calls it exactly once per mount.
 * Resolves even when the load failed — the failure goes to the log as it
 * always has, and the labels of the loaders that failed come back to the
 * caller, which is what App puts on screen in the startup banner.
 */
export async function bootstrap(): Promise<string[]> {
  const viewerId = viewerIdFromLocation();
  // Set BEFORE the async load below, so the guard is already in place by
  // the time any action could fire. (The ONE write it cannot stop is
  // dashboardsFile.readOrSeed's fresh-install seed, which calls saveJson
  // directly rather than through the store — unreachable here in practice,
  // since a viewer window is only ever opened from a main window that
  // already has the dashboard it names.)
  useDashboardStore.setState({ viewer: viewerId !== null });
  stopKeyMaintWatch?.();
  stopKeyMaintWatch = null;
  // Filled in before the first step that could throw past the loaders, so a
  // later failure still reports what it already knows.
  const failed: string[] = [];
  try {
    useWidgetRegistryStore.getState().seedBuiltins();
    // Dashboard order can't be known until settings has loaded, so
    // settings loads first; backends stays parallel to both.
    const settings = await attempt("settings", () => useSettingsStore.getState().load());
    // Each of them catches its own rejection now, so one unreadable
    // file costs that loader and nothing else — not the others, and not
    // the discovery below, which is what keeps the app usable enough for a
    // banner to be worth showing. Their labels are collected BY POSITION
    // rather than as they settle, so the banner names them in load order
    // however slowly the disk answers.
    const parallel = await Promise.all([
      attempt("backends", () => useBackendsStore.getState().load()),
      attempt("dashboards", () =>
        useDashboardStore.getState().load(useSettingsStore.getState().settings.dashboardOrder),
      ),
      // Independent of both: the tree is derived from the dashboards it
      // finds, and a dashboard absent from `placement` is simply top
      // level, so neither load has to wait for the other.
      attempt("folders", () => useFoldersStore.getState().load()),
      attempt("chat", () => useChatStore.getState().load()),
      attempt("mcp tokens", () => useMcpTokensStore.getState().load()),
      // Independent of both, like folders: a slot naming a dashboard that has
      // not loaded (yet, or ever) simply renders as an empty tile rather than
      // failing.
      attempt("workspaces", () =>
        useWorkspacesStore.getState().load(useSettingsStore.getState().settings.workspaceOrder),
      ),
      // Skills are files under skills/, independent of everything else here.
      attempt("skills", () => useSkillsStore.getState().load()),
      // Saved layouts are their own directory, independent of the workspaces
      // that may have been given one (applying copies), so an unreadable
      // layouts/ costs the layouts and nothing else.
      attempt("layouts", () => useWorkspacesStore.getState().loadLayouts()),
      // workspace.json: the Workspace connections and remembered usernames
      // the startup prompt needs. A broken file is no reason to skip
      // activating the viewer's dashboard below.
      attempt("workspace connections", () => useWorkspaceStore.getState().load()),
      // workspaceSync.json: dashboard links and pending server deletes.
      attempt("workspace sync links", () => useWorkspaceSyncStore.getState().load()),
    ]);
    for (const label of [settings, ...parallel]) {
      if (label !== null) failed.push(label);
    }
    // The viewer window shows one dashboard, whichever the URL named.
    if (viewerId !== null) useDashboardStore.getState().setActive(viewerId);
    // Awaited, but bounded: readLaunchScreen gives up after 1 s.
    if (viewerId === null) await openLaunchWorkspace();
    // Fired, never awaited, and after discovery: the store needs the widget
    // registry populated to know whether a key-maint backend is present and
    // can answer for every provider at once, instead of the vendors being
    // probed one by one. Not awaited because those probes are real,
    // rate-limited vendor calls: the shell must render without them, and a
    // total failure must not take the boot down with it — which is what the
    // Library's provider badges consume, grey until the first result lands.
    //
    // In the main window, refresh() leaves a backend flagged Ask for
    // credentials on startup and still without a value waiting: its startup
    // step starts its discovery (Continue, or Skip without a credential).
    // A viewer window never prompts -- it is read-only, and the main window
    // already asks -- so it discovers every backend now, flagged ones with
    // whatever value backends.json remembered.
    const everyBackend = viewerId !== null ? useBackendsStore.getState().backends.map((b) => b.id) : undefined;
    void useBackendsStore
      .getState()
      .refresh(everyBackend)
      // ONLY in the main window. The viewer is the same bundle in a second
      // window: it would repeat the whole fan-out against the same
      // rate-limited vendors, and it renders no Library for the tones to
      // colour. Discovery above still runs there -- its cards cannot render
      // without the widget registry it populates.
      .then(() => {
        if (viewerId !== null) return undefined;
        watchKeyMaint();
        return useProviderKeysStore.getState().refresh();
      })
      .catch(() => {});
    // The launch sequence: with Server on, connect to the settings server
    // first (by key, or through the sign-in dialog), then walk the other
    // flagged connections. Fired, never awaited: settings.json is already
    // loaded and in use, so the app never waits on the network or on the
    // user, and a Cancel or failure just leaves settings local for the run.
    if (viewerId === null) startDashboardAutoUpload();
    if (viewerId === null) void runStartupPrompt().catch((err: unknown) => logError(`startup prompt failed: ${err}`));
  } catch (err) {
    // An unwritable/unreadable data directory would otherwise reject
    // silently here (this function does not reject) and render an empty shell
    // with nothing reaching the log, even though the log directory is
    // usually still writable.
    await logError(`${APP_STATE}: ${err}`);
    // ...and it contributes a label too, or the banner would stay silent for
    // the ONE failure that is worse than any single loader's: with the
    // loaders each catching their own rejection, an empty list now MEANS
    // "everything loaded", so a startup that died out here would read as a
    // clean boot. Named for what actually failed -- not one file, but the
    // step around them.
    failed.push(SELF);
  }
  return failed;
}
