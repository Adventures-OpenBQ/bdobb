// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Settings } from "../lib/types";
import { logError } from "../lib/logger";
import { KEY_REFUSED, readSessionSettings, type SettingsConnection } from "../lib/workspaceAccount";
import { useBackendsStore } from "../stores/backendsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { keyRefusedMessage, storageConnection, toSettingsConnections, useWorkspaceStore } from "../stores/workspaceStore";
import { askBackendCredential, askWorkspaceSignIn, decideWorkspaceConflict } from "./dialogs/WorkspaceDialogs";
import { syncDashboards } from "./runDashboardSync";

/** The connection settings are stored on, read fresh -- a credential step may have just changed its backend. */
function serverConnection(): SettingsConnection | null {
  return storageConnection(
    useSettingsStore.getState().settings,
    toSettingsConnections(useWorkspaceStore.getState().connections, useBackendsStore.getState().backends),
  );
}

/**
 * The sign-in sync for one connection: diff the session's display settings
 * (no request -- bug #9; key mode read them when it connected) against local
 * over the synced keys, and ask which side wins when they differ. The diff is
 * readSessionSettings' `review` (planSettingsImport's change lines), so it
 * exists once. Returns false when there is no session or the settings were
 * refused -- the session state then carries the reason and nothing local
 * changed -- so User Settings knows not to switch on top of a failure.
 *
 * `alsoSave` rides along with the server's values in the one save of "Use
 * <server>" (User Settings passes settingsStorage), so those values are never
 * uploaded to the previous settings server.
 *
 * Keep local goes to queueUpload directly rather than through a save: when
 * User Settings switches, settingsStorage does not name this connection yet,
 * and settingsStore.save uploads only when it does.
 */
export async function syncAfterSignIn(id: string, alsoSave: Partial<Settings> = {}): Promise<boolean> {
  const synced = await syncSettings(id, alsoSave);
  // Dashboards follow a successful settings step (spec: On sign-in); their own failures show on the connection.
  if (synced) await syncDashboards(id);
  return synced;
}

async function syncSettings(id: string, alsoSave: Partial<Settings>): Promise<boolean> {
  const session = useWorkspaceStore.getState().sessions[id];
  if (session === undefined) return false;
  const result = readSessionSettings(session, useSettingsStore.getState().settings);
  if (!result.ok) {
    useWorkspaceStore.getState().fail(id, result);
    return false;
  }
  const { patch, notes, review } = result.value;
  if (review.length === 0) return true;
  useWorkspaceStore.setState((s) => ({ deciding: [...s.deciding, id] }));
  let choice: "server" | "local";
  try {
    choice = await decideWorkspaceConflict(session.connection.name, review, notes);
  } finally {
    useWorkspaceStore.setState((s) => ({ deciding: s.deciding.filter((x) => x !== id) }));
  }
  if (choice === "server") {
    await useSettingsStore.getState().save({ ...patch, ...alsoSave });
    return true;
  }
  await useWorkspaceStore.getState().queueUpload(id, useSettingsStore.getState().settings);
  // A key refused on that upload leaves the session not-synced: not a sync.
  return useWorkspaceStore.getState().sessions[id]?.state === "signed-in";
}

export { keyRefusedMessage };

/**
 * Connect to a settings server by its mode, then run the sign-in sync
 * (spec §3 and §4). A live session is reused. Otherwise the server is
 * probed: key mode connects with the connection's own credential and no
 * prompt; login mode opens the sign-in dialog, prefilled with the remembered
 * username; no settings API connects nothing. Any failure or Cancel resolves
 * false and leaves local settings alone -- nothing uploads until a later
 * connect succeeds. A refused key (the probe's "key-refused", or a 401 from
 * the key connect) creates no session; its reason is logged AND left as the
 * connection's notice, which User Settings shows (ruling R1), until the next
 * connect clears it.
 *
 * A session this call just created is dropped again when its sync fails: a
 * login lands signed-in before its display settings are read, and one the
 * sync refuses (readSessionSettings) must not stay signed-in and able to
 * upload. A session that already existed is left as syncAfterSignIn marked it.
 */
export async function connectServer(connection: SettingsConnection, alsoSave?: Partial<Settings>): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  store.clearNotice(connection.id);
  const refused = async () => {
    useWorkspaceStore.getState().setNotice(connection.id, keyRefusedMessage(connection.name));
    await logError(`settings server ${connection.name}: ${KEY_REFUSED}`);
    return false;
  };
  const existing = store.sessions[connection.id];
  // A session whose key was refused on upload stays not-synced, but it holds
  // a copy of the old credential: reconnect rather than reuse it.
  const fresh = existing === undefined || existing.state === "expired" || (existing.state === "not-synced" && existing.reason === KEY_REFUSED);
  if (fresh) {
    const mode = await store.probe(connection);
    if (mode === "key-refused") return refused();
    if (mode === "key") {
      const message = await useWorkspaceStore.getState().connectByKey(connection);
      if (message === KEY_REFUSED) return refused();
      if (message !== null) {
        await logError(`settings server ${connection.name}: ${message}`);
        return false;
      }
    } else if (mode === "login") {
      if (!(await askWorkspaceSignIn(connection))) return false;
    } else {
      await logError(`settings server ${connection.name}: probe answered "${mode}"`);
      return false;
    }
  }
  const synced = await syncAfterSignIn(connection.id, alsoSave);
  if (!synced && fresh) {
    // The reason lives on the session, which is about to go: keep it as the
    // connection's notice and in the log so the refusal is not silent.
    const reason = useWorkspaceStore.getState().sessions[connection.id]?.reason;
    useWorkspaceStore.getState().signOut(connection.id); // clears the notice, so set it after
    if (reason === KEY_REFUSED) await refused();
    else if (reason !== undefined) {
      useWorkspaceStore.getState().setNotice(connection.id, `Not synced: ${reason}`);
      await logError(`settings server ${connection.name}: not synced: ${reason}`);
    }
  }
  return synced;
}

/**
 * A Workspace card's Sign in, and User Settings' Sign in: the connection
 * holding settings connects by its mode and syncs; any other connection only
 * signs in -- local is the authority there.
 */
export async function promptSignIn(connection: SettingsConnection): Promise<void> {
  if (useSettingsStore.getState().settings.settingsStorage === connection.id) await connectServer(connection);
  else await askWorkspaceSignIn(connection);
}

/**
 * The launch sequence (spec §4, Launch). With Server on, the settings server
 * comes first and is always connected, flagged or not: a flagged backend
 * without a value gets its Key/Value step first (Skip: settings stay local
 * for this run and it is discovered without a credential), then
 * connectServer. Then one step per OTHER flagged connection, Workspace
 * connections first, then data backends -- signing in to a Workspace
 * connection there syncs nothing, since it does not hold settings. A skipped
 * backend is discovered without its credential; a Continue starts discovery
 * inside setCredential. Steps are counted, the server's sign-in is not.
 */
export async function runStartupPrompt(): Promise<void> {
  const server = serverConnection();
  const needsCredential = server?.backend?.askOnStartup === true && !server.backend.headerValue;
  const workspaces = useWorkspaceStore.getState().connections.filter((c) => c.askOnStartup && c.id !== server?.id);
  const backends = useBackendsStore.getState().backends.filter((b) => b.askOnStartup === true && b.id !== server?.id);
  const total = (needsCredential ? 1 : 0) + workspaces.length + backends.length;
  let n = 0;
  if (server !== null) {
    let connect = true;
    if (needsCredential && server.backend) {
      if ((await askBackendCredential(server.backend, `Step ${++n} of ${total}`)) === "skipped") {
        void useBackendsStore.getState().refresh([server.id]).catch(() => {});
        connect = false;
      }
    }
    const current = connect ? serverConnection() : null;
    if (current !== null) await connectServer(current);
  }
  for (const c of workspaces) {
    const [connection] = toSettingsConnections([c], []);
    await askWorkspaceSignIn(connection, `Step ${++n} of ${total}`);
  }
  for (const b of backends) {
    if ((await askBackendCredential(b, `Step ${++n} of ${total}`)) === "skipped") {
      void useBackendsStore.getState().refresh([b.id]).catch(() => {});
    }
  }
}
