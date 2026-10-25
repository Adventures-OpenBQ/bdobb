// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ServiceSettingsEntry } from "../../../lib/settingsSections";
import { KeysPanel } from "../KeysPanel";
import { SettingsForm } from "./SettingsForm";

/**
 * The panel for one settings widget a backend advertises
 * (docs/settings-widgets.md). `form` is drawn from the service's own
 * description; `keys` is the app-shipped Keys panel bound to that backend;
 * the reserved `page` mode and any app UI this version does not ship are a
 * fixed message, never a guess. SettingsDialog places it between Layout and
 * Logs and keeps it mounted once visited.
 */
export function ServiceSection({ entry }: { entry: ServiceSettingsEntry }) {
  switch (entry.kind) {
    case "keys":
      return <KeysPanel backendId={entry.backendId} />;
    case "form":
      return <SettingsForm backend={entry.backend} widget={entry.widget} />;
    case "unsupported":
      return <p className="empty-state">Not supported in this version.</p>;
    case "newer":
      return <p className="empty-state">Needs a newer app version.</p>;
  }
}
