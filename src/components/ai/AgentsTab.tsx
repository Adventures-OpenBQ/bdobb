// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useId, useState } from "react";
import { DEFAULT_FUNCTION_ROUNDS, MIN_FUNCTION_ROUNDS, MAX_FUNCTION_ROUNDS } from "../../lib/agent/limits";
import type { AgentDescriptor, AgentFeature } from "../../lib/agent/types";
import { workspaceOptionsFor } from "../../lib/agent/workspaceOptions";
import { safeUrl } from "../../lib/safeUrl";
import { useAgentDiscovery } from "../../stores/agentDiscoveryStore";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { Switch } from "../dialogs/SettingsDialog";
import { PreferencePill } from "../services/PreferencePill";
import { ServiceCard } from "../services/ServiceCard";
import { ServiceStatus } from "../services/ServiceStatus";

const MODEL_NOTE =
  "Rita advertises the models its host could serve, not the ones it can reach right now, " +
  "and the default may not be among them. The app sends the default as-is.";

function featureText(key: string, feature: AgentFeature): string {
  switch (feature.kind) {
    case "boolean":
      return `${key}: ${feature.value ? "on" : "off"}`;
    case "toggle":
      return `${feature.label}: ${feature.default ? "on" : "off"}`;
    case "select":
    case "text":
      return `${feature.label}: ${feature.default}`;
  }
}

function TextOption({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="bd-field" htmlFor={id}>
      {label}
      {/* Committed on blur or Enter, not per keystroke: every Done rewrites settings.json. */}
      <input
        id={id}
        className="bd-input"
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft !== value) onCommit(draft);
        }}
      />
    </label>
  );
}

/**
 * The agent's own configurable features (agentOptions), split into their own
 * markup: plain booleans as capability badges, a typed select as the fixed-
 * model row (rendered as text, not a <select> -- the options agents.json
 * advertises are not a promise the host can serve them, and the default is
 * not always one of them), a typed text option as a committed field, and an
 * untyped toggle as a live switch that saves per agent.
 */
function AgentFeatures({ agent }: { agent: AgentDescriptor }) {
  const idBase = useId();
  const stored = useSettingsStore((s) => selectEffective(s).agentOptions[agent.id]);
  const stage = useSettingsStore((s) => s.stageDraft);
  const options = workspaceOptionsFor(agent, stored ?? {});

  const setOption = (featureId: string, value: boolean | string) => {
    const all = selectEffective(useSettingsStore.getState()).agentOptions;
    stage({ agentOptions: { ...all, [agent.id]: { ...(all[agent.id] ?? {}), [featureId]: value } } });
  };

  const entries = Object.entries(agent.features);
  const booleans = entries.filter((e): e is [string, Extract<AgentFeature, { kind: "boolean" }>] => e[1].kind === "boolean");
  const toggles = entries.filter((e): e is [string, Extract<AgentFeature, { kind: "toggle" }>] => e[1].kind === "toggle");
  const selects = entries.filter((e): e is [string, Extract<AgentFeature, { kind: "select" }>] => e[1].kind === "select");
  const texts = entries.filter((e): e is [string, Extract<AgentFeature, { kind: "text" }>] => e[1].kind === "text");

  return (
    <>
      {agent.description !== "" ? <p className="bd-muted">{agent.description}</p> : null}
      {booleans.length > 0 ? (
        <ul className="bd-capabilities">
          {booleans.map(([key, feature]) => (
            <li key={key} className="bd-badge" data-off={feature.value ? undefined : "true"}>
              {featureText(key, feature)}
            </li>
          ))}
        </ul>
      ) : null}
      {toggles.length > 0 || texts.length > 0 ? (
        <div className="bd-agent-preferences">
          {toggles.map(([key, feature]) => (
            <PreferencePill
              key={key}
              label={feature.label}
              checked={options[key] === true}
              onChange={(checked) => setOption(key, checked)}
              ariaLabel={feature.label}
            />
          ))}
          {texts.map(([key, feature]) => (
            <TextOption
              key={key}
              id={`${idBase}-${key}`}
              label={feature.label}
              value={String(options[key] ?? "")}
              onCommit={(v) => setOption(key, v)}
            />
          ))}
        </div>
      ) : null}
      {selects.map(([key, feature]) => (
        <div key={key} className="bd-model">
          <span className="bd-muted">{featureText(key, feature)}</span>
          <details>
            <summary>Why is the model fixed?</summary>
            {MODEL_NOTE}
          </details>
        </div>
      ))}
    </>
  );
}

export function AgentsTab() {
  const ritaUrl = useSettingsStore((s) => selectEffective(s).ritaUrl);
  const contextSharing = useSettingsStore((s) => selectEffective(s).contextSharing);
  const promptSuggestions = useSettingsStore((s) => selectEffective(s).agentPromptSuggestions);
  const maxFunctionRounds = useSettingsStore((s) => selectEffective(s).ritaMaxFunctionRounds);
  const roundsId = useId();
  const stage = useSettingsStore((s) => s.stageDraft);
  const [draft, setDraft] = useState(ritaUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const discovery = useAgentDiscovery(ritaUrl);
  const hintId = useId();

  // A commit elsewhere (or a load) wins over an uncommitted draft.
  useEffect(() => setDraft(ritaUrl), [ritaUrl]);

  function commit() {
    const trimmed = draft.trim().replace(/\/+$/, "");
    if (trimmed !== "" && safeUrl(trimmed) === null) {
      setUrlError("Enter an http(s) URL.");
      return;
    }
    setUrlError(null);
    if (trimmed !== ritaUrl) stage({ ritaUrl: trimmed });
  }

  // While the field holds something other than the committed URL, whatever
  // discovery last found belongs to that OLD URL and would mislead if shown
  // as this row's live status -- so an uncommitted edit always reads as
  // "Not checked", the same as a URL that has never been checked at all.
  const uncommitted = draft.trim().replace(/\/+$/, "") !== ritaUrl;
  const status =
    uncommitted || discovery.state === "idle" ? (
      <ServiceStatus state="unchecked" live />
    ) : discovery.state === "loading" ? (
      <ServiceStatus state="checking" live />
    ) : discovery.state === "online" ? (
      <ServiceStatus state="online" live />
    ) : (
      <ServiceStatus state="offline" text={`Offline: ${discovery.message}`} live />
    );

  // Rita advertises exactly one agent in practice; the card renders THE
  // discovered agent (not a list) so this stays a single element at this
  // JSX position across a checking -> online transition. Swapping between an
  // array (.map, key-matched) and a bare element here would make React
  // remount the card -- and the <input> inside it -- mid-edit, dropping the
  // user's focus and keystrokes the instant discovery resolves.
  const agent = discovery.state === "online" ? Object.values(discovery.agents)[0] : undefined;

  return (
    <>
      <div className="bd-service-list">
        <ServiceCard
          mark="AI"
          name={agent?.name ?? "Agent"}
          // Nothing discovered yet (no URL, still checking, or offline): a
          // standalone card so the URL field is always somewhere on screen.
          kind={agent !== undefined ? "AI agent" : "AI service"}
          ariaLabel={agent?.name ?? "Agent"}
          status={status}
          endpoint={{
            label: "Endpoint",
            value: (
              <input
                className="bd-input"
                type="url"
                aria-label="Rita URL"
                value={draft}
                placeholder="https://rita.example"
                onChange={(e) => {
                  setDraft(e.target.value);
                  setUrlError(null);
                }}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                }}
              />
            ),
          }}
          detail={
            <>
              {agent !== undefined ? <AgentFeatures agent={agent} /> : null}
              <div className="bd-agent-preferences">
                <PreferencePill
                  label="Follow-up suggestions"
                  checked={promptSuggestions}
                  onChange={(checked) => stage({ agentPromptSuggestions: checked })}
                  describedBy={hintId}
                />
                <p id={hintId} className="bd-muted">
                  Show suggested follow-up prompts in chat.
                </p>
              </div>
            </>
          }
        />
      </div>
      {urlError !== null ? (
        <p className="bd-notice bd-notice--error" role="alert">
          {urlError}
        </p>
      ) : null}

      <div className="bd-row">
        <div className="bd-row-copy">
          <label className="bd-row-title" htmlFor={roundsId}>Maximum tool rounds</label>
          <p id={`${roundsId}-hint`} className="bd-muted">
            Limit tool-execution rounds per Rita message. Higher limits allow longer workflows
            but may increase response time and model usage. Applies to the next message.
          </p>
        </div>
        <select
          id={roundsId}
          className="bd-input"
          style={{ width: "auto", flexShrink: 0 }}
          aria-describedby={`${roundsId}-hint`}
          value={maxFunctionRounds}
          onChange={(e) => stage({ ritaMaxFunctionRounds: Number(e.target.value) })}
        >
          {Array.from({ length: MAX_FUNCTION_ROUNDS - MIN_FUNCTION_ROUNDS + 1 }, (_, i) => i + MIN_FUNCTION_ROUNDS)
            .map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds}{rounds === DEFAULT_FUNCTION_ROUNDS ? " (default)" : ""}
              </option>
            ))}
        </select>
      </div>

      <div className="bd-row bd-row--switch">
        <div className="bd-row-copy">
          <div className="bd-row-title">Context sharing</div>
          <p className="bd-muted">Share dashboard widgets with Rita. Widgets you share from a card's menu are marked as added to context.</p>
        </div>
        <Switch label="Context sharing" checked={contextSharing} onChange={(c) => stage({ contextSharing: c })} />
      </div>
    </>
  );
}
