// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { FEEDBACK_TAGS, sendFeedback, type FeedbackVote } from "../../lib/agent/feedback";

/**
 * Thumbs up / down on one finished AI message. One vote: after a success the
 * buttons go. A failure stays inline and the same vote, trace id included, can
 * be sent again. Only the rated prompt and reply are sent, and only on a click.
 */
export function FeedbackBar({ agentUrl, prompt, response }: { agentUrl: string; prompt: string; response: string }) {
  const [traceId] = useState(() => crypto.randomUUID());
  const [vote, setVote] = useState<FeedbackVote | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");

  const submit = async (v: FeedbackVote) => {
    setBusy(true);
    setError(null);
    try {
      const down = v === "thumbs_down";
      await sendFeedback(agentUrl, { vote: v, tags: down ? tags : [], user_comment: down ? comment : "", ai_response: response, user_prompt: prompt, trace_id: traceId });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <p className="chat-feedback" role="status">
        Thanks for the feedback.
      </p>
    );
  }
  return (
    <div className="chat-feedback">
      <button type="button" aria-label="Good response" aria-pressed={vote === "thumbs_up"} disabled={busy} onClick={() => { setVote("thumbs_up"); void submit("thumbs_up"); }}>
        👍
      </button>
      <button type="button" aria-label="Bad response" aria-pressed={vote === "thumbs_down"} disabled={busy} onClick={() => setVote("thumbs_down")}>
        👎
      </button>
      {vote === "thumbs_down" ? (
        <fieldset className="chat-feedback-details">
          {FEEDBACK_TAGS.map((t) => (
            <label key={t}>
              <input type="checkbox" checked={tags.includes(t)} onChange={() => setTags((now) => (now.includes(t) ? now.filter((x) => x !== t) : [...now, t]))} />
              {t}
            </label>
          ))}
          <textarea aria-label="Feedback comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void submit("thumbs_down")}>
            Send feedback
          </button>
        </fieldset>
      ) : null}
      {error !== null ? (
        <p className="chat-error" role="alert">
          Feedback not sent: {error}
        </p>
      ) : null}
    </div>
  );
}
