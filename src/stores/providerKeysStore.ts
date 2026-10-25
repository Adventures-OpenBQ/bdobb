// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { fetchWidgetData } from "../lib/dataClient";
import { logError } from "../lib/logger";
import { seedParams } from "../lib/params";
import {
  classifyProbe,
  needsKey,
  normalizeProvider,
  pickProbeWidget,
  type KeyStatus,
} from "../lib/providerKeys";
import type { WidgetDef } from "../lib/types";
import { useBackendsStore } from "./backendsStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

/** A backend serving this widget id is a key-maint instance. */
export const KEY_MAINT_WIDGET_ID = "provider_api_keys";

export type KeysSource = "key-maint" | "probe" | "none";

type KeysRow = { provider: string; env_var: string; status: string; demo?: boolean };

/** Small cap: startup must not fan out to every vendor at once. */
const PROBE_CONCURRENCY = 4;

type State = {
  status: Record<string, KeyStatus>;
  source: KeysSource;
  refresh: () => Promise<void>;
};

function fromKeyMaint(rows: KeysRow[]): Record<string, KeyStatus> {
  // Alpaca is one provider across two registry rows, so its parts are
  // collected before being reduced: keyed only if BOTH are set.
  const parts = new Map<string, string[]>();
  for (const row of rows) {
    const key = normalizeProvider(row.provider);
    if (!key) continue;
    parts.set(key, [...(parts.get(key) ?? []), row.status]);
  }

  const status: Record<string, KeyStatus> = {};
  for (const [provider, states] of parts) {
    if (states.every((s) => s === "set")) status[provider] = "keyed";
    else if (states.some((s) => s === "empty" || s === "missing")) status[provider] = "unkeyed";
    else status[provider] = "unknown";
  }
  return status;
}

async function runCapped(tasks: Array<() => Promise<void>>): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await next();
  });
  await Promise.all(workers);
}

export const useProviderKeysStore = create<State>((set, get) => ({
  status: {},
  source: "none",

  refresh: async () => {
    const widgets = useWidgetRegistryStore.getState().widgets;
    const backends = useBackendsStore.getState().backends;

    const keyMaint = widgets.find((w) => w.id === KEY_MAINT_WIDGET_ID);
    if (keyMaint) {
      const backend = backends.find((b) => b.id === keyMaint.backendId);
      if (backend) {
        try {
          // key-maint's widgets.json declares data.dataKey: "rows" on this
          // table widget, so fetchWidgetData usually hands back the bare
          // array; a server without the dataKey hands back the envelope.
          const payload = (await fetchWidgetData(backend, keyMaint, {})) as
            | KeysRow[]
            | { rows?: KeysRow[] }
            | null;
          const rows = Array.isArray(payload) ? payload : (payload?.rows ?? []);
          set({ status: fromKeyMaint(rows), source: "key-maint" });
          return;
        } catch (err) {
          // Fall through to probes: a key-maint that cannot answer is no
          // better than one that is absent.
          await logError(`key-maint status fetch failed: ${err}`);
        }
      }
    }

    // Group each provider's own widgets, so a probe fires against something
    // that provider actually serves.
    const byProvider = new Map<string, WidgetDef[]>();
    for (const widget of widgets) {
      for (const source of widget.source) {
        const key = normalizeProvider(source);
        if (!key) continue;
        byProvider.set(key, [...(byProvider.get(key) ?? []), widget]);
      }
    }

    const status: Record<string, KeyStatus> = {};
    const tasks: Array<() => Promise<void>> = [];

    for (const [provider, own] of byProvider) {
      // Absent from key-maint's registry means no credential is required.
      if (!needsKey(provider)) {
        status[provider] = "keyed";
        continue;
      }
      const probe = pickProbeWidget(own);
      if (!probe) {
        status[provider] = "unknown";
        continue;
      }
      const backend = backends.find((b) => b.id === probe.backendId);
      if (!backend) {
        status[provider] = "unknown";
        continue;
      }
      tasks.push(async () => {
        try {
          // pickProbeWidget chose `probe` precisely because every one of its
          // params carries a default; passing {} would drop them and turn a
          // well-formed request into a validation error, misclassifying a
          // keyed provider as unknown.
          await fetchWidgetData(backend, probe, seedParams(probe));
          status[provider] = classifyProbe(true, "");
        } catch (err) {
          status[provider] = classifyProbe(false, err instanceof Error ? err.message : String(err));
        }
      });
    }

    await runCapped(tasks);
    set({ status, source: tasks.length > 0 ? "probe" : get().source });
  },
}));
