// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWidgetData, putProviderKey, testProviderKey } from "../../lib/dataClient";
import { logError } from "../../lib/logger";
import { clampLogName } from "../../lib/logNames";
import { seedParams } from "../../lib/params";
import { deriveProvider, type View } from "../../lib/providerAvailability";
import { findKeyMaintWidget } from "../../lib/providerKeys";
import type { KeyCheck } from "../../lib/providerKeys";
import { useBackendsStore } from "../../stores/backendsStore";
import { useProviderKeysStore } from "../../stores/providerKeysStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { ProviderDashboard } from "../keys/ProviderDashboard";
import { ProviderDetailsDialog } from "../keys/ProviderDetailsDialog";
import { ErrorState } from "../renderers/ErrorState";
import { isKeysPayload, keysRows, type DiagnosticCode } from "../renderers/KeysRenderer";

type Status = "loading" | "ready" | "error";

/**
 * Provider-key management as a Settings section. Discovers the key-maint
 * backend through findKeyMaintWidget — the ONE rule providerKeysStore uses
 * too, so the panel and the Library's badges can never be looking at
 * different key-maint widgets, or at a key-maint only one of them can see.
 * Fetches status cheaply on mount, and only contacts vendors
 * (`run_tests=true`) on an explicit Refresh or after a successful key submit
 * — each of which also hands the rows it got back to providerKeysStore, whose
 * probe map colours the Library's badges.
 *
 * Since v3.0.3 the panel is bound to ONE backend, chosen by the Settings
 * dialog (serviceSettingsEntries in src/lib/settingsSections.ts): a settings
 * widget with `ui: { app: "keys" }`, or on an older stack the key-maint
 * widget itself, names the backend, and this panel applies findKeyMaintWidget
 * to that backend's widgets only. Several key-maint backends therefore give
 * one panel each, where the panel used to show only the first one found.
 * With no key-maint backend there is no Keys section at all.
 */
export function KeysPanel({ backendId }: { backendId: string }) {
  const widget = useWidgetRegistryStore((s) =>
    findKeyMaintWidget(s.widgets.filter((w) => w.backendId === backendId)),
  );
  const backend = useBackendsStore((s) => s.backends.find((b) => b.id === backendId));

  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [view, setView] = useState<View>({ filter: "all", sort: "name-asc" });
  const [detailsId, setDetailsId] = useState<string | null>(null); // Provider.id, not env_var

  // Guards against a stale response landing after a newer request (e.g. the
  // backend was swapped while a fetch was in flight). Bumped once per call.
  const requestGeneration = useRef(0);
  // Whether ANY load has ever reached "ready". Only the first load has
  // nothing to fall back to — see the catch branch below.
  const hasLoaded = useRef(false);

  const load = useCallback(
    async (runTests: boolean) => {
      if (!widget || !backend) return;
      const params = { ...seedParams(widget), run_tests: runTests ? "true" : "false" };
      const generation = ++requestGeneration.current;
      try {
        const payload = await fetchWidgetData(backend, widget, params);
        if (generation !== requestGeneration.current) return; // a newer request superseded this one
        setData(payload);
        setStatus("ready");
        setError(null);
        setRefreshFailed(false);
        hasLoaded.current = true;
        // The Library's provider badges take their colour from
        // providerKeysStore's probe map (design D4), so a probe run from here
        // has to reach it too -- otherwise the badges keep showing whatever
        // the last app start found. The rows just fetched ARE the probe
        // results, so they are handed over directly: asking the store to
        // refresh instead would send every vendor through a second fan-out
        // for an answer already on this screen. Only on a run that contacted
        // the vendors -- the plain status fetch has no probe result to pass
        // on -- and only for a payload that really is the keys shape. Rows
        // are re-mapped to the five safe fields here, not passed through: a
        // tier-3 row carries a plaintext `value` that must never reach the
        // store, structurally and not just by type declaration.
        // keysRows, not payload.rows: `rows` being an array says nothing
        // about what is in it, and destructuring a null element threw a
        // TypeError into the catch below — turning a probe that WORKED into
        // "keys status fetch failed", with the badges never updated. One bad
        // row is skipped; the rest still colour the Library.
        const rows = runTests ? keysRows(payload) : null;
        if (rows) {
          useProviderKeysStore.getState().applyKeyMaintRows(
            rows.map(({ provider, env_var, status, demo, test }) => ({
              provider,
              env_var,
              status,
              demo,
              test,
            })),
          );
        }
      } catch (err) {
        await logError(
          `keys status fetch failed for ${clampLogName(widget.id)} on ${clampLogName(backend.name)}: ${err}`,
        );
        if (generation !== requestGeneration.current) return;
        // Only the FIRST load has nothing to fall back to. A refresh/re-probe
        // that fails leaves the last-good rows on screen: tearing the panel
        // down after a successful PUT would hide the restart notice for a
        // key that WAS written.
        if (!hasLoaded.current) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        } else {
          setRefreshFailed(true);
        }
      }
    },
    [widget, backend],
  );

  // Plain GET /keys: key-maint reads its own environment, no vendor is
  // contacted. Re-runs (fresh) if the key-maint backend changes while open.
  useEffect(() => {
    hasLoaded.current = false;
    setStatus("loading");
    void load(false);
  }, [load]);

  // Re-tests exactly one row (GET {endpoint}/{envVar}/test) and merges only
  // that row's test result in place, so Test this service never fans out to
  // every other vendor the way a full probe does.
  async function testKey(envVar: string) {
    if (!widget || !backend) return;
    try {
      const reply = (await testProviderKey(backend, widget, envVar)) as {
        result?: string;
        detail?: string;
        kind?: "credential" | "connectivity";
        code?: string;
        checked_at?: string;
        test?: unknown;
        checks?: unknown;
      };
      // key-maint answers {checks, test}; an older backend answered one flat
      // check. Either way only this row changes.
      const flat = typeof reply.test === "object" && reply.test !== null ? (reply.test as typeof reply) : reply;
      const checks = Array.isArray(reply.checks)
        ? (reply.checks.filter((c) => typeof c === "object" && c !== null) as KeyCheck[])
        : undefined;
      setData((prev: unknown) => {
        if (!isKeysPayload(prev)) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row) =>
            row.env_var === envVar
              ? {
                  ...row,
                  test: {
                    result: flat.result ?? "",
                    detail: flat.detail ?? "",
                    kind: flat.kind,
                    // An unrecognised code is dropped by deriveProvider's guard, so
                    // this cast never widens a bad value onto the screen.
                    code: flat.code as DiagnosticCode | undefined,
                    checked_at: flat.checked_at,
                  },
                  // A flat reply carries no checks: keep the row's, as before.
                  ...(checks !== undefined ? { checks } : {}),
                }
              : row,
          ),
        };
      });
    } catch (err) {
      await logError(`key test failed for ${clampLogName(envVar)}: ${err}`);
    }
  }

  // PUT {endpoint}/{envVar} with the value in the body (never a query
  // param, never logged), then re-probes so the row reflects the new key.
  // The submitted value itself never appears in any log line here — only
  // envVar (a variable name, not a secret) and the caught error, whose
  // message dataClient already builds solely from the server's own response.
  async function submitKey(envVar: string, value: string): Promise<{ restart_required?: boolean }> {
    if (!widget || !backend) throw new Error("key-maint backend is not connected");
    try {
      const result = (await putProviderKey(backend, widget, envVar, value)) as {
        restart_required?: boolean;
      };
      await load(true);
      return result;
    } catch (err) {
      await logError(`key submit failed for ${clampLogName(envVar)}: ${err}`);
      throw err;
    }
  }

  // Cheap and safe on null data: keysRows(null) returns null → []. Computed here, before the early
  // returns below, because hooks must never run after a conditional return.
  const rows = useMemo(() => keysRows(data) ?? [], [data]);
  const tier = isKeysPayload(data) ? data.tier : 0;
  const detailsProvider = useMemo(
    () => (detailsId === null ? null : rows.map(deriveProvider).find((p) => p.id === detailsId) ?? null),
    [rows, detailsId],
  );

  // The dialog only builds a Keys section for a configured backend that
  // serves a keys widget (serviceSettingsEntries), so this is reachable only
  // for the one render between a discovery change and the dialog dropping
  // the section -- there is nothing to say, so nothing is drawn.
  if (!widget || !backend) return null;
  if (status === "loading") return <p className="empty-state">Loading…</p>;
  if (status === "error") {
    return <ErrorState message={error ?? "Request failed"} onRetry={() => void load(false)} />;
  }
  return (
    <>
      {refreshFailed ? (
        <p className="bd-notice" role="status">
          Refresh failed. Showing the last known key status.
        </p>
      ) : null}
      <ProviderDashboard
        rows={rows}
        view={view}
        onViewChange={setView}
        onProbe={() => void load(true)}
        onOpenDetails={(p) => setDetailsId(p.id)}
      />
      {detailsProvider !== null ? (
        <ProviderDetailsDialog
          provider={detailsProvider}
          tier={tier}
          backendName={backend.name}
          onClose={() => setDetailsId(null)}
          onTest={(envVar) => void testKey(envVar)}
          onSubmit={submitKey}
        />
      ) : null}
    </>
  );
}
