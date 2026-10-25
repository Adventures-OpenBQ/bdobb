// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The chat transcript, in its OWN file rather than alongside settings.
 *
 * It is append-heavy user content, not configuration, and a corrupt transcript
 * must not be able to take the app's settings down with it — the persistence
 * layer quarantines rather than clobbers, and quarantining one file should
 * cost one feature.
 */
import { ABSENT, loadJson, removeJson, saveJson } from "./jsonStore";
import type { ChatTranscript } from "./agent/types";

export const CHAT_PATH = "chat.json";

/**
 * Deliberately loose: only `messages` must be an array. `calls` is tolerated
 * as missing. A stricter check turns a recoverable transcript into a
 * quarantined one, and the cost of a slightly wrong message is far lower here
 * than the cost of losing the conversation.
 */
export function isChatTranscript(value: unknown): value is ChatTranscript {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as { messages?: unknown }).messages);
}

export async function loadChat(): Promise<ChatTranscript> {
  const loaded = await loadJson(CHAT_PATH, isChatTranscript);
  // An absent or quarantined file starts empty and is NOT seeded: an empty
  // transcript is not worth writing.
  if (loaded === ABSENT) return { messages: [] };
  return loaded;
}

export async function saveChat(transcript: ChatTranscript): Promise<void> {
  await saveJson(CHAT_PATH, transcript);
}

export async function clearChat(): Promise<void> {
  await removeJson(CHAT_PATH);
}
