// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { APPS_ISSUE_ID, type App, parseAppsJson } from "./appsJson";
import { fetchAppsJson, fetchServiceName, fetchWidgetsJson } from "./dataClient";
import { logError } from "./logger";
import { clampLogName } from "./logNames";
import type { BackendConfig, BackendStatus, WidgetDef } from "./types";
import { normalizeWidgets, type WidgetIssue } from "./widgetsJson";

export type DiscoveryResult = {
  backendId: string;
  widgets: WidgetDef[];
  apps?: App[];
  /** The backend's `GET /` service name, online results only; see fetchServiceName. */
  service?: string;
  status: BackendStatus;
  issues: WidgetIssue[];
  error?: string;
};

/**
 * apps.json's failure is contained here: widgets.json alone decides
 * online/offline, so a backend that serves widgets and a broken apps.json is
 * online with no apps and one thing to say about why.
 *
 * The thrown message can carry the backend's own words — a `{detail}` body,
 * or a JSON parse error quoting the response verbatim — so it is returned as
 * `failure` for the caller to LOG (where discovery's widget failures already
 * go, query-stripped by dataClient) and never put into the issue.
 *
 * It is returned rather than logged here because this fetch now runs
 * alongside widgets.json rather than after it: a backend that is simply down
 * fails both, and only the widgets failure is worth a log line. The caller
 * logs this one on the online path only, which is the same log the sequential
 * version produced.
 */
async function discoverApps(
  backend: BackendConfig,
): Promise<{ apps: App[]; issue?: WidgetIssue; failure?: string }> {
  try {
    const { raw, bytes } = await fetchAppsJson(backend);
    return parseAppsJson(raw, backend.name, bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      apps: [],
      issue: { id: APPS_ISSUE_ID, reason: `apps.json from ${backend.name} could not be read` },
      failure: message,
    };
  }
}

/** One backend's failure is contained here and never rethrown. */
export async function discoverBackend(backend: BackendConfig): Promise<DiscoveryResult> {
  // Started BEFORE widgets.json is awaited, so the two run concurrently. They
  // share no state, and awaiting one before asking for the other made their
  // latencies additive on every backend — inside discoverAll's Promise.all,
  // which meant the whole registry waited for the sum. apps.json carries its
  // own deadline (dataClient's APPS_TIMEOUT_MS), so this promise always
  // settles; discoverApps contains its own failure, so it never rejects and
  // can never preempt the real widgets.json error below.
  const apps = discoverApps(backend);
  // Started alongside apps.json for the same reason; fetchServiceName never rejects.
  const service = fetchServiceName(backend);
  try {
    const raw = await fetchWidgetsJson(backend);
    const { widgets, issues } = normalizeWidgets(raw, backend.id);
    const { apps: appList, issue, failure } = await apps;
    if (failure !== undefined) {
      await logError(`apps.json failed for backend ${clampLogName(backend.name)}: ${failure}`);
    }
    const name = await service;
    return {
      backendId: backend.id,
      widgets,
      apps: appList,
      status: "online",
      issues: issue ? [...issues, issue] : issues,
      ...(name !== undefined ? { service: name } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Awaited, not abandoned: the request is already in flight, and letting
    // this function return while it runs unwatched is what the deadline on it
    // exists to prevent. Its answer is discarded — an offline backend has no
    // apps whatever apps.json said, and its own failure is not the story.
    await apps;
    await service;
    // Reporting the failure must not become the failure; discoverBackend's
    // contract is that it never rejects. logError itself now guarantees
    // this — it swallows its own write failures.
    await logError(`discovery failed for backend ${clampLogName(backend.name)}: ${message}`);
    return {
      backendId: backend.id,
      widgets: [],
      apps: [],
      status: "offline",
      issues: [],
      error: message,
    };
  }
}

/**
 * Isolation is structural: `discoverBackend` contains its own failure and
 * cannot reject, so one unreachable backend can never empty the library.
 */
export async function discoverAll(backends: BackendConfig[]): Promise<DiscoveryResult[]> {
  return Promise.all(backends.map(discoverBackend));
}
