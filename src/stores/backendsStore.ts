// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { loadBackends, saveBackends } from "../lib/backendsFile";
import { discoverAll } from "../lib/discovery";
import { serialize } from "../lib/serialize";
import type { BackendConfig, BackendStatus } from "../lib/types";
import type { WidgetIssue } from "../lib/widgetsJson";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

type BackendsState = {
  backends: BackendConfig[];
  statuses: Record<string, BackendStatus>;
  issues: Record<string, WidgetIssue[]>;
  /** Backend id → its `GET /` service name from the last discovery; see fetchServiceName. */
  services: Record<string, string | undefined>;
  /** Ids whose in-memory headerValue must never be written; see persistable. */
  runtimeCredentials: string[];
  setCredential: (id: string, headerName: string, headerValue: string, remember: boolean) => Promise<void>;
  load: () => Promise<void>;
  addBackend: (input: Omit<BackendConfig, "id">) => Promise<string>;
  updateBackend: (id: string, patch: Partial<Omit<BackendConfig, "id">>) => Promise<void>;
  removeBackend: (id: string) => Promise<void>;
  refresh: (only?: string[]) => Promise<void>;
};

/** Everything a discovery result depends on: a change to any of these makes it stale. */
const PROBED_FIELDS = ["baseUrl", "headerName", "headerValue", "authLocation", "validateWidgets"] as const;

/**
 * What may be written: a backend whose value was typed at the startup prompt
 * without Remember me keeps it in memory only. Every saveBackends call goes
 * through this, so no later edit of the same backend can write it by accident.
 */
function persistable(backends: BackendConfig[], runtime: string[]): BackendConfig[] {
  return backends.map((b) => (runtime.includes(b.id) ? { ...b, headerValue: undefined } : b));
}

/** Flagged and still without a value: discovery waits for its startup step. */
const waiting = (b: BackendConfig) => b.askOnStartup === true && !b.headerValue;

export const useBackendsStore = create<BackendsState>((set, get) => {
  // Chains every action that touches backends.json, mirroring foldersStore
  // and settingsStore: each action's read-mutate-write step runs only after
  // every previously queued step has both written to disk and published via
  // set(). Without this, two overlapping mutations (a quick add then an edit,
  // or the probe fan-out racing an edit) both computed their next array from
  // the same stale snapshot, and whichever wrote last silently reverted the
  // other -- on disk and in memory both.
  const enqueue = <T,>(step: () => Promise<T>) => serialize("store:backends", step);

  return {
    backends: [],
    statuses: {},
    issues: {},
    services: {},
    runtimeCredentials: [],

    /**
     * Reads from disk only. The caller decides when to run discovery.
     *
     * On the chain despite being a read: load() is a public store action with
     * no ordering contract of its own, so a caller can fire it at any moment
     * -- including while a Connections edit is mid-write -- and an unchained
     * read would then either see the file before the write or publish its
     * stale array over the writer's set(). It cannot deadlock: the task
     * awaits nothing that is itself queued behind it.
     */
    load: () =>
      enqueue(async () => {
        const backends = await loadBackends();
        set({
          backends,
          statuses: Object.fromEntries(backends.map((b) => [b.id, "unknown" as BackendStatus])),
        });
      }),

    // Deliberately OFF the chain, unlike load(): it never touches
    // backends.json, and queuing a network fan-out would stall every
    // subsequent write behind a probe round-trip. It is safe unchained
    // because it merges only per-backend statuses/issues, keyed by ids it
    // re-reads from the store at resolve time.
    refresh: async (only) => {
      // An explicit list is discovered as given -- a startup step's Continue or
      // Skip, or the viewer window. Otherwise a flagged backend still waiting
      // for its value is left alone: probing it without its credential would
      // only mark it offline before its prompt is answered.
      const probed = only ? get().backends.filter((b) => only.includes(b.id)) : get().backends.filter((b) => !waiting(b));
      const results = await discoverAll(probed);
      // addBackend/updateBackend fire this without awaiting it, so a backend
      // can be removed while its discovery is still in flight. Apply only
      // results for backends that still exist when discovery resolves —
      // otherwise a stale result reinstates the exact registry/statuses/issues
      // entries removeBackend just deleted.
      //
      // "Still exist" means the config that was probed, not just its id: an
      // older refresh still probing the OLD URL (up to its timeout) would
      // otherwise land after the fixed backend's own discovery and mark it
      // Offline again. Compared field by field, not by object identity:
      // load() re-reads the same config into fresh objects, and a refresh
      // overlapping that still describes the current backend.
      const current = new Map(get().backends.map((b) => [b.id, b]));
      const live = results.filter((r) => {
        const before = probed.find((b) => b.id === r.backendId);
        const now = current.get(r.backendId);
        return before !== undefined && now !== undefined && PROBED_FIELDS.every((k) => before[k] === now[k]);
      });
      useWidgetRegistryStore.getState().applyDiscovery(live);
      set((state) => ({
        statuses: {
          ...state.statuses,
          ...Object.fromEntries(live.map((r) => [r.backendId, r.status])),
        },
        issues: {
          ...state.issues,
          ...Object.fromEntries(live.map((r) => [r.backendId, r.issues])),
        },
        // Every live result overwrites its entry, undefined included: an
        // offline backend, or one whose root stopped naming a service, must
        // not keep the mark from a previous probe.
        services: {
          ...state.services,
          ...Object.fromEntries(live.map((r) => [r.backendId, r.service])),
        },
      }));
    },

    // The three writers below read get() INSIDE the enqueued task, never
    // before it, so each one starts from the state its predecessor published
    // rather than from a snapshot taken when the caller fired.
    addBackend: (input) =>
      enqueue(async () => {
        const backend: BackendConfig = { id: crypto.randomUUID(), ...input };
        const backends = [...get().backends, backend];
        await saveBackends(persistable(backends, get().runtimeCredentials));
        set({ backends });
        // Persisting and setting state is what must be ordered before this
        // resolves; discovery does not need to block the Save dialog. Guarded
        // so a discovery failure cannot surface as an unhandled rejection.
        // By id, so a backend added flagged (no value yet, no prompt coming
        // this run) is discovered now rather than left waiting for a relaunch.
        void get().refresh([backend.id]).catch(() => {});
        return backend.id;
      }),

    updateBackend: (id, patch) =>
      enqueue(async () => {
        // An id that is no longer (or never was) a backend is a no-op: without
        // this the unchanged array was rewritten and every backend re-probed.
        const before = get().backends.find((b) => b.id === id);
        if (before === undefined) return;
        // Ticking Ask for credentials on startup removes the stored value (the
        // form sends headerValue undefined), but the backend keeps working
        // this run: the value it had moves to memory, exactly as if typed at
        // the prompt without Remember me. Unticking it makes whatever the
        // form saved the stored value again. A changed Key keeps the value
        // too: the form hides Value while flagged, so dropping it would leave
        // the backend without a credential until the next launch.
        const keep = patch.askOnStartup === true && patch.headerValue === undefined && before.headerValue !== undefined;
        const backends = get().backends.map((b) => (b.id === id ? { ...b, ...patch, ...(keep ? { headerValue: before.headerValue } : {}) } : b));
        // A patch without the key (a rename) leaves the membership alone; the
        // form always sends it, undefined when unticked.
        const others = get().runtimeCredentials.filter((x) => x !== id);
        const runtimeCredentials = keep || (get().runtimeCredentials.includes(id) && (!("askOnStartup" in patch) || patch.askOnStartup === true)) ? [...others, id] : others;
        await saveBackends(persistable(backends, runtimeCredentials));
        set({ backends, runtimeCredentials });
        void get().refresh([id]).catch(() => {});
      }),

    removeBackend: (id) =>
      enqueue(async () => {
        const backends = get().backends.filter((b) => b.id !== id);
        const statuses = { ...get().statuses };
        delete statuses[id];
        const issues = { ...get().issues };
        delete issues[id];
        const services = { ...get().services };
        delete services[id];
        await saveBackends(persistable(backends, get().runtimeCredentials));
        set({ backends, statuses, issues, services, runtimeCredentials: get().runtimeCredentials.filter((x) => x !== id) });
        useWidgetRegistryStore.getState().dropBackend(id);
      }),

    // A startup step's Continue. The value is stored only with Remember me;
    // otherwise it is memory-only (and, if it was stored before, removed
    // from the file now). Then that backend's discovery runs.
    setCredential: (id, headerName, headerValue, remember) =>
      enqueue(async () => {
        if (!get().backends.some((b) => b.id === id)) return;
        const backends = get().backends.map((b) => (b.id === id ? { ...b, headerName, headerValue } : b));
        const others = get().runtimeCredentials.filter((x) => x !== id);
        const runtimeCredentials = remember ? others : [...others, id];
        await saveBackends(persistable(backends, runtimeCredentials));
        set({ backends, runtimeCredentials });
        void get().refresh([id]).catch(() => {});
      }),
  };
});
