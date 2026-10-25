// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { logError } from "./logger";
import { startDashboardAutoUpload } from "../components/runDashboardSync";
import { runStartupPrompt } from "../components/runWorkspaceSync";
import { useBackendsStore } from "../stores/backendsStore";
import { useDashboardStore } from "../stores/dashboardStore";
import { useFoldersStore } from "../stores/foldersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useWidgetRegistryStore } from "../stores/widgetRegistryStore";
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
 * Everything the app reads at startup, in the one order it can be read in.
 * Lifted out of App's mount effect, which calls it exactly once per mount.
 * Resolves even when the load failed — the failure goes to the log, never to
 * the caller, because the call site voids the result.
 */
export async function bootstrap(): Promise<void> {
  const viewerId = viewerIdFromLocation();
  // Set BEFORE the async load below, so the guard is already in place by
  // the time any action could fire. (The ONE write it cannot stop is
  // dashboardsFile.readOrSeed's fresh-install seed, which calls saveJson
  // directly rather than through the store — unreachable here in practice,
  // since a viewer window is only ever opened from a main window that
  // already has the dashboard it names.)
  useDashboardStore.setState({ viewer: viewerId !== null });
  try {
    useWidgetRegistryStore.getState().seedBuiltins();
    // Dashboard order can't be known until settings has loaded, so
    // settings loads first; backends stays parallel to both.
    await useSettingsStore
      .getState()
      .load()
      .catch((err: unknown) => logError(`failed to load settings: ${err}`));
    await Promise.all([
      useBackendsStore.getState().load(),
      useDashboardStore.getState().load(useSettingsStore.getState().settings.dashboardOrder),
      // Independent of both: the tree is derived from the dashboards it
      // finds, and a dashboard absent from `placement` is simply top
      // level, so neither load has to wait for the other.
      useFoldersStore.getState().load(),
      // workspace.json: the Workspace connections and remembered usernames
      // the startup prompt needs. Its own catch, because a broken file is no
      // reason to skip activating the viewer's dashboard below.
      useWorkspaceStore
        .getState()
        .load()
        .catch((err: unknown) => logError(`failed to load workspace.json: ${err}`)),
      // workspaceSync.json: dashboard links and pending server deletes.
      useWorkspaceSyncStore
        .getState()
        .load()
        .catch((err: unknown) => logError(`failed to load workspaceSync.json: ${err}`)),
    ]);
    // The viewer window shows one dashboard, whichever the URL named.
    if (viewerId !== null) useDashboardStore.getState().setActive(viewerId);
    // Fired, never awaited. providerKeysStore.refresh() is deliberately
    // NOT chained here: at this version nothing reads that store (badge
    // colouring and the authorized-providers filter are both deferred),
    // so calling it would fan out a real probe request per keyed
    // provider — against billable, rate-limited vendor APIs — for a
    // result nothing consumes. refresh() itself stays intact and
    // tested; wire this back in once a real consumer exists.
    //
    // In the main window, refresh() leaves a backend flagged Ask for
    // credentials on startup and still without a value waiting: its startup
    // step starts its discovery (Continue, or Skip without a credential).
    // A viewer window never prompts -- it is read-only, and the main window
    // already asks -- so it discovers every backend now, flagged ones with
    // whatever value backends.json remembered.
    const everyBackend = viewerId !== null ? useBackendsStore.getState().backends.map((b) => b.id) : undefined;
    void useBackendsStore.getState().refresh(everyBackend).catch(() => {});
    // The launch sequence: with Server on, connect to the settings server
    // first (by key, or through the sign-in dialog), then walk the other
    // flagged connections. Fired, never awaited: settings.json is already
    // loaded and in use, so the app never waits on the network or on the
    // user, and a Cancel or failure just leaves settings local for the run.
    if (viewerId === null) startDashboardAutoUpload();
    if (viewerId === null) void runStartupPrompt().catch((err: unknown) => logError(`startup prompt failed: ${err}`));
  } catch (err) {
    // An unwritable/unreadable data directory would otherwise reject
    // silently here (the caller voids this) and render an empty shell
    // with nothing reaching the log, even though the log directory is
    // usually still writable.
    await logError(`failed to load app state: ${err}`);
  }
}
