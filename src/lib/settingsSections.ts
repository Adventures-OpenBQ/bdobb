// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { findKeyMaintWidget, isKeyMaintWidget } from "./providerKeys";
import type { BackendConfig, WidgetDef } from "./types";

/**
 * The Keys section's label when the widget that names it gave no name of its
 * own. Only the compatibility path can need it: normalizeWidgets turns a
 * missing `name` into the widget id, so an old `keys` widget without one
 * would otherwise be labelled "provider_api_keys_panel".
 */
export const KEYS_FALLBACK_LABEL = "Provider API Keys";

/**
 * One service section of the Settings dialog, resolved from the registry.
 * `kind` is what the dialog draws: the app-shipped Keys panel bound to
 * `backendId`, a declarative form, or one of the two fixed messages ("Needs
 * a newer app version" / "Not supported in this version").
 */
export type ServiceSettingsEntry =
  | { id: string; label: string; kind: "keys"; backendId: string }
  | { id: string; label: string; kind: "form"; backendId: string; backend: BackendConfig; widget: WidgetDef }
  | { id: string; label: string; kind: "newer" | "unsupported"; backendId: string };

function keysLabel(w: WidgetDef): string {
  return w.name.trim() === "" || w.name === w.id ? KEYS_FALLBACK_LABEL : w.name;
}

/**
 * Every service section the connected backends advertise, sorted by backend
 * name then widget name (docs/settings-widgets.md). Every section is
 * labelled with its widget's name, Keys included.
 *
 * Keys is bound per backend: a settings widget with `ui: { app: "keys" }`
 * binds the Keys panel to the `keys` widget on the SAME backend, and a
 * backend that serves only the old `type: "keys"` widget -- openbb-docker
 * v3.0.2, which an app v3.0.3 must not lose Keys on -- gets the same section
 * the old way, labelled with that widget's name. Either way it is one
 * section per backend. A keys settings widget whose backend serves no `keys`
 * widget has nothing to bind to and gives no section. No key-maint backend
 * at all means no Keys section at all.
 *
 * Where two sections would read the same (two key-maint backends both give
 * "Provider API Keys"), each is labelled with its backend's name.
 *
 * On this line "serves a `keys` widget" means serves a key-maint widget by
 * isKeyMaintWidget -- the `keys` type or the `provider_api_keys` table id --
 * the one rule KeysPanel and providerKeysStore already share, and the old-way
 * section takes its label from findKeyMaintWidget's pick on that backend.
 */
export function serviceSettingsEntries(
  widgets: WidgetDef[],
  backends: BackendConfig[],
): ServiceSettingsEntry[] {
  const byId = new Map(backends.map((b) => [b.id, b]));
  const servesKeys = new Set(widgets.filter(isKeyMaintWidget).map((w) => w.backendId));
  const drafts: Array<{ entry: ServiceSettingsEntry; backendName: string }> = [];
  const keysBackends = new Set<string>();

  // Settings widgets first, so a backend that serves both the settings entry
  // and the old keys widget is labelled from the settings entry, and the
  // second loop below finds it already bound.
  for (const w of widgets) {
    if (w.type !== "settings") continue;
    const backend = byId.get(w.backendId);
    if (!backend) continue;
    const ui = w.settingsUi ?? { kind: "unknown" };
    const id = `svc:${w.backendId}:${w.id}`;
    let entry: ServiceSettingsEntry;
    if (ui.kind === "app" && ui.name === "keys") {
      if (keysBackends.has(w.backendId) || !servesKeys.has(w.backendId)) continue;
      keysBackends.add(w.backendId);
      entry = { id: `keys:${w.backendId}`, label: keysLabel(w), kind: "keys", backendId: w.backendId };
    } else if (ui.kind === "form") {
      entry = { id, label: w.name, kind: "form", backendId: w.backendId, backend, widget: w };
    } else if (ui.kind === "page") {
      entry = { id, label: w.name, kind: "unsupported", backendId: w.backendId };
    } else {
      entry = { id, label: w.name, kind: "newer", backendId: w.backendId };
    }
    drafts.push({ entry, backendName: backend.name });
  }

  for (const backendId of servesKeys) {
    if (keysBackends.has(backendId)) continue;
    const backend = byId.get(backendId);
    if (!backend) continue;
    // Never undefined: servesKeys holds only backends with a key-maint widget.
    const w = findKeyMaintWidget(widgets.filter((x) => x.backendId === backendId))!;
    keysBackends.add(w.backendId);
    drafts.push({
      entry: { id: `keys:${w.backendId}`, label: keysLabel(w), kind: "keys", backendId: w.backendId },
      backendName: backend.name,
    });
  }

  // The label IS the widget name (or the Keys fallback), so sorting on it is
  // sorting by widget name.
  drafts.sort(
    (a, b) => a.backendName.localeCompare(b.backendName) || a.entry.label.localeCompare(b.entry.label),
  );
  const labelCount = new Map<string, number>();
  for (const { entry } of drafts) labelCount.set(entry.label, (labelCount.get(entry.label) ?? 0) + 1);
  return drafts.map(({ entry, backendName }) =>
    (labelCount.get(entry.label) ?? 0) > 1 ? { ...entry, label: `${entry.label} (${backendName})` } : entry,
  );
}
