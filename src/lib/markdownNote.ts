// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { sizeRefusal } from "./importLimits";

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

/** The line to show, or null when the file is within the limit. */
export function markdownFileRefusal(name: string, bytes: number): string | null {
  return sizeRefusal(name, bytes, MARKDOWN_FILE_MAX_BYTES);
}
