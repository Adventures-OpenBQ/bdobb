// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { useHoverPanel } from "../../hooks/useHoverPanel";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ChatPane } from "./ChatPane";

/** The right-edge Rita pane: a 28px tab that opens on hover, focus, or pin. */
export function RitaPane() {
  // The one panel with a configurable open delay: it lies along the edge
  // the pointer crosses to reach a card's right-hand controls.
  const panel = useHoverPanel(useSettingsStore((s) => s.settings.ritaHoverDelayMs));
  const pinned = useChatStore((s) => s.pinned);
  const hasUnread = useChatStore((s) => s.hasUnread);
  const [inputFocused, setInputFocused] = useState(false);
  const open = panel.open || pinned || inputFocused;
  return (
    <aside
      // ref, not just handlers: without it the outside-tap listener cannot tell
      // a tap inside the pane from one outside it.
      ref={panel.ref}
      aria-label="Rita AI pane"
      className="rita-pane"
      data-open={open}
      {...panel.handlers}
    >
      {open ? (
        <ChatPane onInputFocus={setInputFocused} />
      ) : (
        <div className="rita-tab">
          <span className="rita-tab-label">Rita</span>
          {hasUnread ? <span className="rita-unread" role="status" aria-label="New response from Rita" /> : null}
        </div>
      )}
    </aside>
  );
}
