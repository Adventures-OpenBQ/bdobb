// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The decisions MarkdownEditorRenderer makes, kept out of the component so
 * they are tested without mounting BlockNote (ProseMirror does not run under
 * jsdom; the renderer's own test mocks the editor).
 *
 * One string is the whole state: the markdown this editor last LOADED or
 * last EMITTED. The text prop round-trips through the dashboard store, so
 * without it a serialisation would come back as the prop, look like an
 * external change, be re-parsed, re-serialised, and emitted again.
 */
export type NoteSync = { lastKnown: string };

export function createNoteSync(): NoteSync {
  return { lastKnown: "" };
}

/** True when `text` is not what this editor last loaded or emitted. */
export function needsReload(sync: NoteSync, text: string): boolean {
  return text !== sync.lastKnown;
}

export function loaded(sync: NoteSync, text: string): void {
  sync.lastKnown = text;
}

/**
 * The string to hand to onChange, or null when nothing changed. Committing
 * an unchanged note would write the dashboard for nothing on every flush.
 */
export function emitIfChanged(sync: NoteSync, serialized: string): string | null {
  if (serialized === sync.lastKnown) return null;
  sync.lastKnown = serialized;
  return serialized;
}

/**
 * A trailing-edge debounce with an explicit flush, which is the half a
 * plain setTimeout lacks: blur and unmount must run a pending save NOW.
 */
export function debounced(fn: () => void, ms: number): { call(): void; flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    call() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    flush() {
      if (timer === null) return;
      cancel();
      fn();
    },
    cancel,
  };
}

/**
 * The ceiling Open file… refuses above, checked against `stat` BEFORE the
 * file is read -- reading it is the freeze this refuses. A note is prose;
 * a megabyte of it is already more than the editor is for.
 */
export const MARKDOWN_FILE_MAX_BYTES = 1024 * 1024;

const BYTES_PER_MB = 1024 * 1024;

/** The line to show, or null when the file is within the limit. */
export function markdownFileRefusal(name: string, bytes: number): string | null {
  if (bytes <= MARKDOWN_FILE_MAX_BYTES) return null;
  // Rounded UP, so a file one byte over the cap does not read as the limit.
  const mb = Math.ceil((bytes / BYTES_PER_MB) * 10) / 10;
  return `${name} is ${mb} MB; the limit is ${MARKDOWN_FILE_MAX_BYTES / BYTES_PER_MB} MB.`;
}
