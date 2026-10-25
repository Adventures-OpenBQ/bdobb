// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { logError } from "../../lib/logger";
import { useAgentEditsStore } from "../../stores/agentEditsStore";

export function AgentEditBar() {
  const entries = useAgentEditsStore((s) => s.entries);
  const undoLast = useAgentEditsStore((s) => s.undoLast);
  const clear = useAgentEditsStore((s) => s.clear);
  const undoError = useAgentEditsStore((s) => s.undoError);
  const last = entries[entries.length - 1];
  if (!last && !undoError) return null;
  return (
    <div className="agent-edit-bar">
      {undoError && <span role="alert">{undoError}</span>}
      {last && (
        <>
          <span role="status">{last.summary}</span>
          <span className="agent-edit-count">
            {entries.length} {entries.length === 1 ? "change" : "changes"}
          </span>
          <button
            type="button"
            onClick={() => {
              undoLast().catch((err) => void logError(`agent undo failed: ${err instanceof Error ? err.message : String(err)}`));
            }}
          >
            Undo
          </button>
        </>
      )}
      <button type="button" aria-label="Dismiss" onClick={clear}>
        ✕
      </button>
    </div>
  );
}
