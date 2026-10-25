// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

export type ServiceState = "online" | "offline" | "checking" | "unchecked" | "unavailable";

const DEFAULT_LABEL: Record<ServiceState, string> = {
  online: "Online",
  offline: "Offline",
  checking: "Checking…",
  unchecked: "Not checked",
  unavailable: "Unavailable",
};

/**
 * The dot-and-label a service card shows. `role="status"` is opt-in via `live`:
 * a label that changes asynchronously (a discovery result, an MCP check) is a
 * live region; a persistent Active/Inactive label is not, and announcing it on
 * every render would be noise.
 */
export function ServiceStatus({ state, text, live }: { state: ServiceState; text?: string; live?: boolean }) {
  return (
    <span className={`bd-status bd-status--${state}`} role={live ? "status" : undefined}>
      {text ?? DEFAULT_LABEL[state]}
    </span>
  );
}
