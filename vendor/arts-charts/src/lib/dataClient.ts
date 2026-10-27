// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/** The two calls the chart makes of bdobb-v2's dataClient, answered by the host. */
import { getHost } from "../host";
import type { BackendConfig, WidgetDef } from "./types";

export function fetchWidgetPath(backend: BackendConfig, path: string, params: Record<string, string>): Promise<unknown> {
  return getHost().fetchWidgetPath(backend, path, params);
}

export function buildWidgetWsUrl(backend: BackendConfig, widget: WidgetDef, params?: Record<string, string>): string | null {
  return getHost().buildWidgetWsUrl(backend, widget, params);
}
