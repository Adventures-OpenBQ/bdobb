// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import type { AgentsJson } from "../../lib/agent/types";
import { chatFilename, chatTitle, chatToMarkdown } from "../../lib/chatExport";
import { exportChat } from "../../lib/chatExportFile";
import { logError } from "../../lib/logger";
import { sendToTarget } from "../../lib/shareSend";
import type { ShareTarget } from "../../lib/shareTargets";
import { useAgentDiscovery } from "../../stores/agentDiscoveryStore";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { LockGlyph } from "../LockGlyph";
import { ChatMessages } from "./ChatMessages";
import { Sources } from "./Sources";
import { StatusTrail } from "./StatusTrail";

type Presence = "unknown" | "online" | "offline";
/**
 * The model Rita will answer with: the app sends none, so it is the first
 * agent's advertised default (see AgentsTab's MODEL_NOTE). "" when the
 * descriptor has no model select.
 */
export function defaultModel(agents: AgentsJson): string {
  for (const agent of Object.values(agents)) {
    const model = agent.features.model;
    if (model?.kind === "select") return model.default;
  }
  return "";
}

const PRESENCE_LABEL: Record<Presence, string> = { unknown: "Checking Rita", online: "Rita online", offline: "Rita offline" };

export function ChatPane({ onInputFocus }: { onInputFocus: (focused: boolean) => void }) {
  const ritaUrl = useSettingsStore((s) => s.settings.ritaUrl);
  const shareTargets = useSettingsStore((s) => s.settings.shareTargets);
  const promptSuggestions = useSettingsStore((s) => s.settings.agentPromptSuggestions);
  const { messages, calls, trail, citations, suggestions, running, error, pinned, pendingTool, pendingMessage } = useChatStore();
  const { send, abort, clear, setPaneOpen, togglePinned, resolveTool } = useChatStore.getState();
  const [draft, setDraft] = useState("");
  const discovery = useAgentDiscovery(ritaUrl);
  const presence: Presence = discovery.state === "online" ? "online" : discovery.state === "offline" ? "offline" : "unknown";
  const model = discovery.state === "online" ? defaultModel(discovery.agents) : "";
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPaneOpen(true);
    return () => setPaneOpen(false);
  }, [setPaneOpen]);

  // A sendToAgent click lands in the draft; the user reads it and presses send.
  useEffect(() => {
    if (pendingMessage === null) return;
    setDraft(pendingMessage);
    useChatStore.setState({ pendingMessage: null });
  }, [pendingMessage]);

  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const submit = () => {
    const text = draft.trim();
    if (text === "" || running) return;
    setDraft("");
    void send(text);
  };

  const exportVars = () => {
    const exportedAt = new Date().toISOString();
    const title = chatTitle(messages);
    return { markdown: chatToMarkdown(messages, calls, exportedAt), title, filename: chatFilename(title, exportedAt), exportedAt };
  };

  const doExport = async () => {
    const vars = exportVars();
    try {
      const path = await exportChat(vars.markdown, vars.filename);
      if (path !== null) setNotice(`Exported to ${path}`);
    } catch (err) {
      setNotice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const doSend = async (target: ShareTarget) => {
    try {
      await sendToTarget(target, exportVars());
      setNotice(`Sent to ${target.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`Could not send to ${target.name}: ${message}`);
      void logError(`share target ${target.name}: ${message}`);
    }
  };

  return (
    <div className="chat-pane">
      <header className="chat-header">
        <span className={`chat-presence chat-presence-${presence}`} role="img" aria-label={PRESENCE_LABEL[presence]} />
        <h3>
          Rita
          {model !== "" ? (
            <span className="chat-model" title="Model Rita answers with">
              {model}
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          className="card-action chat-pin"
          aria-label="Lock"
          aria-pressed={pinned}
          title={pinned ? "Unlock" : "Lock"}
          onClick={togglePinned}
        >
          <LockGlyph locked={pinned} />
        </button>
        <details className="chat-menu">
          <summary aria-label="Chat menu">⋯</summary>
          <button type="button" onClick={() => void doExport()}>
            Export…
          </button>
          {shareTargets.map((t) => (
            <button key={t.id} type="button" onClick={() => void doSend(t)}>
              Send to {t.name}
            </button>
          ))}
          <button type="button" onClick={() => void clear()}>
            Clear
          </button>
        </details>
      </header>
      {notice !== null ? (
        <p className="chat-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="chat-body">
        <ChatMessages messages={messages} />
        <StatusTrail trail={trail} running={running} />
        {pendingTool !== null ? (
          <div className="chat-bubble chat-confirm" role="group" aria-label="Confirm tool call">
            <p>
              Run <code>{pendingTool.tool}</code> on <strong>{pendingTool.label}</strong> ({pendingTool.url})?
            </p>
            <pre>{JSON.stringify(pendingTool.args, null, 2)}</pre>
            <button type="button" onClick={() => resolveTool(true)}>
              Run
            </button>
            <button type="button" onClick={() => resolveTool(false)}>
              Deny
            </button>
          </div>
        ) : null}
        <Sources citations={citations} />
        {promptSuggestions && suggestions.length > 0 ? (
          <div className="chat-suggestions">
            {suggestions.map((s) => (
              <button key={s} type="button" disabled={running} onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <footer className="chat-footer">
        {error !== null ? (
          <p className="chat-error" role="alert">
            {error}
          </p>
        ) : null}
        <textarea
          aria-label="Message Rita"
          placeholder="Ask Rita…"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => onInputFocus(true)}
          onBlur={() => onInputFocus(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {running ? (
          <button type="button" onClick={abort}>
            Stop
          </button>
        ) : (
          <button type="button" disabled={draft.trim() === ""} onClick={submit}>
            Send
          </button>
        )}
      </footer>
    </div>
  );
}
