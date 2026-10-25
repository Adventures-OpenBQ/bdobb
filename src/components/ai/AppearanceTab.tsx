// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import {
  RITA_HOVER_DELAY_MAX,
  RITA_HOVER_DELAY_MIN,
} from "../../lib/settingsFile";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { RangeRow } from "../dialogs/RangeRow";

/**
 * How Rita's surfaces behave, as opposed to what Rita talks to. One control
 * so far; the tab exists because the open delay is the first of these and
 * would otherwise have to live under Agents, which is about endpoints.
 */
export function AppearanceTab() {
  const delay = useSettingsStore((s) => selectEffective(s).ritaHoverDelayMs);
  const stageDraft = useSettingsStore((s) => s.stageDraft);

  return (
    <>
      <div className="bd-section-heading">
        <h3>Appearance</h3>
        <p>How Rita's panel behaves in your workspace.</p>
      </div>
      <RangeRow
        label="Rita rail opens after"
        min={RITA_HOVER_DELAY_MIN}
        max={RITA_HOVER_DELAY_MAX}
        value={delay}
        unit="ms"
        // 50ms: fine enough to tune by feel, coarse enough that the slider
        // does not pretend to a precision the pointer cannot deliver.
        step={50}
        onCommit={(ms) => stageDraft({ ritaHoverDelayMs: ms })}
      />
      <p className="bd-notice settings-range-hint">
        How long the pointer must rest on the collapsed rail before it expands.
        0 opens it immediately. Pinning it ignores this entirely.
      </p>
    </>
  );
}
