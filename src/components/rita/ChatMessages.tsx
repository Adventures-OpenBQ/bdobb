// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import { isArtifactMessage, type ChatMessage } from "../../stores/chatStore";
import { MarkdownRenderer } from "../renderers/MarkdownRenderer";
import { ArtifactView } from "./ArtifactView";
import { FeedbackBar } from "./FeedbackBar";

export function ChatMessages({ messages, feedbackUrl = null, running = false }: { messages: ChatMessage[]; feedbackUrl?: string | null; running?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // jsdom has no scrollIntoView.
    if (typeof end.current?.scrollIntoView === "function") end.current.scrollIntoView({ block: "end" });
  }, [messages]);
  let prompt = "";
  // While a turn runs, only its own messages (after the last human one) are unrated;
  // earlier replies keep their mounted bar so a sent vote is not forgotten.
  const lastHuman = messages.map((m) => m.role).lastIndexOf("human");
  return (
    <div className="chat-messages">
      {messages.map((m, i) => {
        if (m.role === "human") {
          prompt = String(m.content);
          return (
            <div key={i} className="chat-bubble chat-human">
              {String(m.content)}
            </div>
          );
        }
        if (isArtifactMessage(m)) {
          return m.content.map((a) => <ArtifactView key={a.uuid} artifact={a} />);
        }
        if (m.role === "ai" && typeof m.content === "string") {
          // The store reorders a turn's messages when it finishes, which would
          // remount a bar rated mid-turn and send a second vote.
          const rateable = feedbackUrl !== null && !(running && i > lastHuman);
          return (
            <div key={i} className="chat-bubble chat-ai">
              <MarkdownRenderer data={m.content} />
              {rateable && feedbackUrl !== null ? <FeedbackBar agentUrl={feedbackUrl} prompt={prompt} response={m.content} /> : null}
            </div>
          );
        }
        return null; // function-call echoes and tool results are not prose
      })}
      <div ref={end} />
    </div>
  );
}
