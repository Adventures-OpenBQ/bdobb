// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { AgentStatus } from "../../lib/agent/types";
import { isRecord } from "../../lib/isRecord";

const GLYPH: Record<AgentStatus["eventType"], string> = { INFO: "•", WARNING: "⚠", ERROR: "✕" };

export function StatusTrail({ trail, running }: { trail: AgentStatus[]; running: boolean }) {
  const steps = trail.filter((s) => s.hidden !== true);
  if (steps.length === 0) return null;
  const errors = steps.filter((s) => s.eventType === "ERROR").length;
  return (
    <details className="status-trail" open={running}>
      <summary>
        {steps.length} {steps.length === 1 ? "step" : "steps"} · {errors} {errors === 1 ? "error" : "errors"}
      </summary>
      <ol>
        {steps.map((s, i) => {
          // chatStore adds `display` to a client-routed call: a proxied one
          // reads as what it runs ("server · name (via call_tool)").
          const call = isRecord(s.tool_call) ? s.tool_call : null;
          // A plain tool's name is chipped only when the message does not
          // already say it (Rita's own narration usually does).
          const tool =
            typeof call?.display === "string"
              ? call.display
              : typeof call?.tool_name === "string" && !s.message.includes(call.tool_name)
                ? call.tool_name
                : null;
          return (
            <li key={i} className={`trail-${s.eventType.toLowerCase()}`}>
              <span aria-hidden="true">{GLYPH[s.eventType]}</span> {s.message}
              {tool ? <> <code>{tool}</code></> : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
