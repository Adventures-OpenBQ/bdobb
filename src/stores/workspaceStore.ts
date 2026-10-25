// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { isRecord } from "../lib/isRecord";
import { ABSENT, loadJson, saveJson } from "../lib/jsonStore";
import { logError } from "../lib/logger";
import { serialize } from "../lib/serialize";
import type { BackendConfig, Settings } from "../lib/types";
import {
  KEY_REFUSED,
  connectByKey,
  probeSettingsApi,
  uploadWorkspaceSettings,
  workspaceSignIn,
  type SettingsApi,
  type SettingsConnection,
  type WorkspaceSession,
} from "../lib/workspaceAccount";
import { useBackendsStore } from "./backendsStore";

const PATH = "workspace.json";

/** One Workspace connection as workspace.json stores it. Never a password, never a token. */
export type WorkspaceConnection = { id: string; name: string; serverUrl: string; askOnStartup: boolean };
type WorkspaceFile = { connections: WorkspaceConnection[]; usernames: Record<string, string> };
/** One signed-in connection. No entry means signed out. */
export type SessionEntry = WorkspaceSession & { state: "signed-in" | "expired" | "not-synced"; reason?: string };

function isWorkspaceFile(value: unknown): value is WorkspaceFile {
  return (
    isRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.every(
      (c) =>
        isRecord(c) &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.serverUrl === "string" &&
        (c.askOnStartup === undefined || typeof c.askOnStartup === "boolean"),
    ) &&
    isRecord(value.usernames) &&
    Object.values(value.usernames).every((u) => typeof u === "string")
  );
}

/** What a refused key says, in User Settings and wherever else it is surfaced (ruling R1). */
export function keyRefusedMessage(name: string): string {
  return `Key refused by ${name}; fix the key in Connections.`;
}

/** Every connection settings could be stored on: Workspace connections first, then data backends -- the order the User Settings server dropdown lists them in. */
export function toSettingsConnections(connections: WorkspaceConnection[], backends: BackendConfig[]): SettingsConnection[] {
  return [
    ...connections.map((c) => ({ id: c.id, name: c.name, baseUrl: c.serverUrl })),
    ...backends.map((b) => ({ id: b.id, name: b.name, baseUrl: b.baseUrl, backend: b })),
  ];
}

/**
 * The connection settingsStorage names, or null for Local -- which includes
 * an id that names nothing any more (a backend removed elsewhere): storage on
 * a connection that does not exist is Local by definition, so nothing uploads.
 */
export function storageConnection(settings: Settings, list: SettingsConnection[]): SettingsConnection | null {
  return list.find((c) => c.id === settings.settingsStorage) ?? null;
}

type WorkspaceState = WorkspaceFile & {
  /** In memory only, one per signed-in connection id: quitting or signing out drops it. */
  sessions: Record<string, SessionEntry>;
  /** The last probe's answer per connection id; absent means not probed yet. */
  apis: Record<string, SettingsApi>;
  /** In memory only: a visible reason per connection id (a refused key), shown by User Settings until the next connect clears it. */
  notices: Record<string, string>;
  /** In memory only: connections whose sign-in sync is asking which side wins. Nothing uploads to them until it is answered. */
  deciding: string[];
  setNotice: (id: string, text: string) => void;
  clearNotice: (id: string) => void;
  load: () => Promise<void>;
  saveConnection: (input: { id?: string; name: string; serverUrl: string; askOnStartup: boolean }) => Promise<WorkspaceConnection>;
  removeConnection: (id: string) => Promise<void>;
  signIn: (connection: SettingsConnection, username: string, password: string, remember: boolean, signal?: AbortSignal) => Promise<string | null>;
  connectByKey: (connection: SettingsConnection, signal?: AbortSignal) => Promise<string | null>;
  probe: (connection: SettingsConnection) => Promise<SettingsApi>;
  signOut: (id: string) => void;
  fail: (id: string, failure: { message: string; expired: boolean }) => void;
  probeAll: () => Promise<void>;
  queueUpload: (id: string, settings: Settings) => Promise<void>;
};

/**
 * Per connection, the settings its next upload will send. Each queueUpload
 * overwrites its entry and queues a step; the first step to run takes it and
 * clears it, so the steps queued behind find nothing and return. A burst of
 * saves therefore costs one POST carrying the newest state.
 */
const latest = new Map<string, Settings>();

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  // Every workspace.json writer reads get() INSIDE the queued step, as
  // backendsStore's do, so two overlapping edits cannot both start from the
  // same stale arrays and silently revert each other. `null` writes nothing.
  const write = <T,>(step: (file: WorkspaceFile) => { file: WorkspaceFile; result: T } | null) =>
    serialize("store:workspace", async () => {
      const next = step({ connections: get().connections, usernames: get().usernames });
      if (next === null) return undefined;
      await saveJson(PATH, next.file);
      set(next.file);
      return next.result;
    });
  const withoutKey = <T,>(record: Record<string, T>, id: string) =>
    Object.fromEntries(Object.entries(record).filter(([k]) => k !== id));
  const dropSession = (id: string) => {
    get().clearNotice(id);
    if (get().sessions[id] !== undefined) set({ sessions: withoutKey(get().sessions, id) });
  };

  return {
    connections: [],
    usernames: {},
    sessions: {},
    apis: {},
    notices: {},
    deciding: [],

    setNotice: (id, text) => set({ notices: { ...get().notices, [id]: text } }),
    clearNotice: (id) => {
      if (get().notices[id] !== undefined) set({ notices: withoutKey(get().notices, id) });
    },

    load: async () => {
      const stored = await loadJson(PATH, isWorkspaceFile);
      // Copied field by field so an unknown key in the file is not carried
      // back out by the next write.
      set(
        stored === ABSENT
          ? { connections: [], usernames: {} }
          : {
              connections: stored.connections.map(({ id, name, serverUrl, askOnStartup }) => ({ id, name, serverUrl, askOnStartup: askOnStartup === true })),
              usernames: { ...stored.usernames },
            },
      );
    },

    // A changed address is a different server, so that connection's session
    // is dropped; a renamed or re-flagged connection keeps it.
    saveConnection: async (input) => {
      const connection = { id: input.id ?? crypto.randomUUID(), name: input.name, serverUrl: input.serverUrl, askOnStartup: input.askOnStartup };
      const before = get().connections.find((c) => c.id === connection.id);
      const saved = await write((file) => ({
        file: {
          connections: before ? file.connections.map((c) => (c.id === connection.id ? connection : c)) : [...file.connections, connection],
          usernames: file.usernames,
        },
        result: connection,
      }));
      if (before !== undefined && before.serverUrl !== connection.serverUrl) dropSession(connection.id);
      return saved ?? connection;
    },

    // For both kinds: a Workspace connection leaves `connections`, and any
    // id's remembered username goes. Nothing to change writes nothing, so
    // removing an ordinary backend does not create workspace.json.
    removeConnection: async (id) => {
      await write((file) =>
        file.connections.some((c) => c.id === id) || id in file.usernames
          ? { file: { connections: file.connections.filter((c) => c.id !== id), usernames: withoutKey(file.usernames, id) }, result: undefined }
          : null,
      );
      dropSession(id);
    },

    signIn: async (connection, username, password, remember, signal) => {
      const result = await workspaceSignIn({ connection, username, password }, signal);
      if (!result.ok) return result.message;
      // A Remove that landed while the request was in flight wins: this
      // session would belong to a connection that no longer exists.
      const exists = toSettingsConnections(get().connections, useBackendsStore.getState().backends).some((c) => c.id === connection.id);
      if (!exists) return "That connection was removed; nothing was signed in.";
      set({ sessions: { ...get().sessions, [connection.id]: { ...result.value, state: "signed-in" } } });
      // Remember me decides whether the username is on disk: ticked stores
      // it, unticked deletes any stored one. A failed write costs only the
      // next prefill, so it is logged rather than turned into a failed sign-in.
      const name = result.value.mode === "login" ? result.value.username : username.trim();
      const stored = get().usernames[connection.id];
      if (remember ? stored !== name : stored !== undefined) {
        // Re-checked inside the serialized step: a Remove queued ahead of this
        // write would otherwise leave a username for a connection that is gone.
        await write((file) =>
          toSettingsConnections(file.connections, useBackendsStore.getState().backends).some((c) => c.id === connection.id)
            ? { file: { ...file, usernames: remember ? { ...file.usernames, [connection.id]: name } : withoutKey(file.usernames, connection.id) }, result: undefined }
            : null,
        ).catch((err: unknown) => logError(`failed to update workspace.json usernames: ${err}`));
      }
      return null;
    },

    // Key mode: no dialog, no username, nothing to remember. A refusal
    // creates no session -- the caller keeps local settings for this run.
    connectByKey: async (connection, signal) => {
      const result = await connectByKey(connection, signal);
      if (!result.ok) return result.message;
      const exists = toSettingsConnections(get().connections, useBackendsStore.getState().backends).some((c) => c.id === connection.id);
      if (!exists) return "That connection was removed; nothing was connected.";
      set({ sessions: { ...get().sessions, [connection.id]: { ...result.value, state: "signed-in" } } });
      return null;
    },

    probe: async (connection) => {
      const answer = await probeSettingsApi(connection);
      set({ apis: { ...get().apis, [connection.id]: answer } });
      return answer;
    },

    signOut: (id) => dropSession(id),

    fail: (id, { message, expired }) => {
      const current = get().sessions[id];
      if (current === undefined) return;
      set({ sessions: { ...get().sessions, [id]: expired ? { ...current, state: "expired", reason: undefined } : { ...current, state: "not-synced", reason: message } } });
    },

    // Parallel, each with its own 5 s deadline (probeSettingsApi), so the
    // whole round takes as long as the slowest connection, not the sum.
    probeAll: async () => {
      const list = toSettingsConnections(get().connections, useBackendsStore.getState().backends);
      const answers = await Promise.all(list.map(async (c) => [c.id, await probeSettingsApi(c)] as const));
      set({ apis: Object.fromEntries(answers) });
    },

    queueUpload: (id, settings) => {
      // A save made while the conflict question is open must not decide it:
      // the answer sends (Keep local) or saves (Use <name>) the latest state.
      if (get().deciding.includes(id)) return Promise.resolve();
      latest.set(id, settings);
      return serialize(`workspace:upload:${id}`, async () => {
        const pending = latest.get(id);
        latest.delete(id);
        const session = get().sessions[id];
        if (pending === undefined || session === undefined || session.state === "expired") return;
        const result = await uploadWorkspaceSettings(session, pending);
        // Signed out, or connected again, while this was in flight: the
        // result describes a session that is gone and must not overwrite the
        // new one -- least of all its displaySettings. Compared by identity,
        // since a key-mode session has no token to compare.
        if (get().sessions[id] !== session) return;
        if (result.ok) {
          set({ sessions: { ...get().sessions, [id]: { ...session, displaySettings: result.value, state: "signed-in", reason: undefined } } });
        } else {
          get().fail(id, result);
          // A refused key must be seen, not only recorded on the session (R1).
          if (result.message === KEY_REFUSED) {
            get().setNotice(id, keyRefusedMessage(session.connection.name));
            await logError(`settings server ${session.connection.name}: ${KEY_REFUSED}`);
          }
        }
      });
    },
  };
});
