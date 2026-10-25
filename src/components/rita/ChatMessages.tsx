// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from "react";
import { isArtifactMessage, type ChatMessage } from "../../stores/chatStore";
import { MarkdownRenderer } from "../renderers/MarkdownRenderer";
import { ArtifactView } from "./ArtifactView";

export function ChatMessages({ messages }: { messages: ChatMessage[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // jsdom has no scrollIntoView.
    if (typeof end.current?.scrollIntoView === "function") end.current.scrollIntoView({ block: "end" });
  }, [messages]);
  return (
    <div className="chat-messages">
      {messages.map((m, i) => {
        if (m.role === "human") {
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
          return (
            <div key={i} className="chat-bubble chat-ai">
              <MarkdownRenderer data={m.content} />
            </div>
          );
        }
        return null; // function-call echoes and tool results are not prose
      })}
      <div ref={end} />
    </div>
  );
}
