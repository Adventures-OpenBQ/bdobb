// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { fetchWidgetData } from "../lib/dataClient";
import { logError } from "../lib/logger";
import { seedParams } from "../lib/params";
import {
  classifyProbe,
  findKeyMaintWidget,
  needsKey,
  normalizeProvider,
  pickProbeWidget,
  probeResult,
  probeTone,
  worstTone,
  type KeyStatus,
  type ProbeTone,
} from "../lib/providerKeys";
import type { WidgetDef } from "../lib/types";
import { useBackendsStore } from "./backendsStore";
import { useWidgetRegistryStore } from "./widgetRegistryStore";

/**
 * Re-exported, not redefined: the id and the rule that reads it live in
 * src/lib/providerKeys.ts, which is where KeysPanel takes them from too.
 */
export { KEY_MAINT_WIDGET_ID } from "../lib/providerKeys";

export type KeysSource = "key-maint" | "probe" | "none";

/**
 * One row of key-maint's `GET /keys`. Names and statuses only — a row's
 * credential `value` (tier 3) is deliberately not part of this type, because
 * nothing in this store may read, keep or log one.
 */
export type KeyMaintRow = {
  provider: string;
  env_var: string;
  status: string;
  demo?: boolean;
  test?: { result: string };
  // Explicitly absent, not just undeclared: a tier-3 row's plaintext
  // credential must fail to type-check here rather than silently widen in,
  // which `value` merely being unlisted would allow.
  value?: never;
};

/** Small cap: startup must not fan out to every vendor at once. */
const PROBE_CONCURRENCY = 4;

type State = {
  status: Record<string, KeyStatus>;
  /**
   * Each provider's latest probe as a colour, for surfaces that show how the
   * vendor answered rather than whether a credential exists. A provider
   * absent from this map has not been probed, which reads grey.
   */
  probe: Record<string, ProbeTone>;
  source: KeysSource;
  refresh: () => Promise<void>;
  /**
   * Publish rows a caller ALREADY has (KeysPanel's own `run_tests` load), so
   * one Key Maintenance probe colours the Library without a second fan-out.
   */
  applyKeyMaintRows: (rows: KeyMaintRow[]) => void;
};

function fromKeyMaint(rows: KeyMaintRow[]): {
  status: Record<string, KeyStatus>;
  probe: Record<string, ProbeTone>;
} {
  // Alpaca is one provider across two registry rows, so its parts are
  // collected before being reduced: keyed only if BOTH are set, and toned by
  // the worse of the two probes for the same reason.
  const parts = new Map<string, { status: string; tone: ProbeTone }[]>();
  for (const row of rows) {
    const key = normalizeProvider(row.provider);
    if (!key) continue;
    const part = { status: row.status, tone: probeTone(row.test?.result) };
    parts.set(key, [...(parts.get(key) ?? []), part]);
  }

  const status: Record<string, KeyStatus> = {};
  const probe: Record<string, ProbeTone> = {};
  for (const [provider, rowParts] of parts) {
    const states = rowParts.map((p) => p.status);
    if (states.every((s) => s === "set")) status[provider] = "keyed";
    else if (states.some((s) => s === "empty" || s === "missing")) status[provider] = "unkeyed";
    else status[provider] = "unknown";
    probe[provider] = worstTone(rowParts.map((p) => p.tone));
  }
  return { status, probe };
}

async function runCapped(tasks: Array<() => Promise<void>>): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await next();
  });
  await Promise.all(workers);
}

/**
 * The refresh in flight, if any. React 18 StrictMode mounts App twice, so
 * bootstrap runs twice and would otherwise fan out to every vendor twice
 * over; a second caller joins the first run instead of starting another.
 * Module scope because the store is a singleton, and cleared when the run
 * settles either way, so a failed refresh cannot wedge the next one.
 */
let inFlight: Promise<void> | null = null;
let rerun: Promise<void> | null = null;
let inFlightInputs: unknown[] = [];

/**
 * Bumped by every applyKeyMaintRows. A refresh captures it before it starts
 * and compares afterwards: a key-maint push that landed while the probes were
 * in flight is the NEWER answer -- it asked every vendor at once,
 * server-side -- so the run must merge under it rather than overwrite it.
 *
 * Module scope for the same reason `inFlight` is: the store is a singleton,
 * and only the comparison matters, so there is nothing to reset.
 */
let keyMaintGeneration = 0;

export const useProviderKeysStore = create<State>((set, get) => ({
  status: {},
  probe: {},
  source: "none",

  applyKeyMaintRows: (rows) => {
    keyMaintGeneration += 1;
    set({ ...fromKeyMaint(rows), source: "key-maint" });
  },

  refresh: () => {
    const inputs = [useWidgetRegistryStore.getState().widgets, useBackendsStore.getState().backends];
    if (inFlight) {
      if (inputs.every((x, i) => x === inFlightInputs[i])) return inFlight;
      // The widgets or backends changed under the run (a key-maint backend
      // that just appeared), so it runs once more after it settles.
      const settled = () => { rerun = null; return get().refresh(); };
      return (rerun ??= inFlight.then(settled, settled));
    }
    inFlightInputs = inputs;
    const run = refreshOnce(set, get).finally(() => {
      inFlight = null;
    });
    inFlight = run;
    return run;
  },
}));

type SetState = (partial: Partial<State>) => void;
type GetState = () => State;

/** One pass of the refresh above; the single-flight guard is its caller's. */
async function refreshOnce(set: SetState, get: GetState): Promise<void> {
  // Captured before anything is awaited: see keyMaintGeneration.
  const startedAt = keyMaintGeneration;
  const widgets = useWidgetRegistryStore.getState().widgets;
  const backends = useBackendsStore.getState().backends;

  // The same selector KeysPanel uses, so the two surfaces can never end up
  // pointed at different widgets -- or, as before this, at a key-maint only
  // one of them could see. Since v3.0.3 KeysPanel applies it to one
  // backend's widgets at a time (a panel per key-maint backend); this store
  // still reads the first key-maint found across all of them.
  const keyMaint = findKeyMaintWidget(widgets);
  if (keyMaint) {
    const backend = backends.find((b) => b.id === keyMaint.backendId);
    if (backend) {
      try {
        // run_tests=true, on top of the widget's own defaults: key-maint's
        // handler defaults it to False and then contacts no vendor at all,
        // so without it every row comes back with no `test` field and every
        // tone this store publishes is grey. The fan-out happens once,
        // server-side, instead of this app probing each vendor itself.
        const params = { ...seedParams(keyMaint), run_tests: "true" };
        // key-maint's widgets.json declares data.dataKey: "rows" on this
        // table widget, so fetchWidgetData usually hands back the bare
        // array; a server without the dataKey hands back the envelope.
        const payload = (await fetchWidgetData(backend, keyMaint, params)) as
          | KeyMaintRow[]
          | { rows?: KeyMaintRow[] }
          | null;
        const rows = Array.isArray(payload) ? payload : (payload?.rows ?? []);
        // A push that landed while this fetch was in flight is key-maint's
        // LATER answer to the same question: keep it, drop this one.
        if (keyMaintGeneration !== startedAt) return;
        set({ ...fromKeyMaint(rows), source: "key-maint" });
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
  // Every provider starts grey and stays grey unless a probe actually runs
  // and answers — including the keyless ones, which are keyed by definition
  // but were never put to a vendor.
  const probe: Record<string, ProbeTone> = {};
  const tasks: Array<() => Promise<void>> = [];

  for (const [provider, own] of byProvider) {
    probe[provider] = "grey";
    // Absent from key-maint's registry means no credential is required.
    if (!needsKey(provider)) {
      status[provider] = "keyed";
      continue;
    }
    const widget = pickProbeWidget(own);
    if (!widget) {
      status[provider] = "unknown";
      continue;
    }
    const backend = backends.find((b) => b.id === widget.backendId);
    if (!backend) {
      status[provider] = "unknown";
      continue;
    }
    tasks.push(async () => {
      try {
        // pickProbeWidget chose `widget` precisely because every one of its
        // params carries a default; passing {} would drop them and turn a
        // well-formed request into a validation error, misclassifying a
        // keyed provider as unknown.
        await fetchWidgetData(backend, widget, seedParams(widget));
        status[provider] = classifyProbe(true, "");
        probe[provider] = probeTone(probeResult(true, ""));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        status[provider] = classifyProbe(false, message);
        probe[provider] = probeTone(probeResult(false, message));
      }
    });
  }

  await runCapped(tasks);

  // A key-maint push arrived while the probes were running: it is newer and
  // it asked every vendor at once, so it wins per provider. Merged rather
  // than deferred to entirely, because this run may have learned about
  // providers key-maint's registry does not carry at all.
  const superseded = keyMaintGeneration !== startedAt;
  // No task ran, so nothing was asked of any vendor: the all-grey map above
  // records which providers exist, not what any of them answered. It is
  // published UNDER whatever is already there rather than over it, so a
  // provider newly seen still reads grey while key-maint's tones survive.
  const probed = tasks.length > 0;
  const current = get();
  const keepCurrentTones = superseded || !probed;

  set({
    status: superseded ? { ...status, ...current.status } : status,
    probe: keepCurrentTones ? { ...probe, ...current.probe } : probe,
    // Whoever spoke last is what the surfaces are showing.
    source: superseded ? "key-maint" : probed ? "probe" : current.source,
  });
}
