// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { openUrl } from "@tauri-apps/plugin-opener";
import { isRecord } from "../../lib/isRecord";
import { safeUrl } from "../../lib/safeUrl";

/** Reduces a Rita citation to a label and an openable url (null when the source has none). */
export function citationLink(c: unknown): { name: string; url: string | null } | null {
  if (!isRecord(c)) return null;
  const info = isRecord(c.source_info) ? c.source_info : {};
  const name = typeof info.name === "string" ? info.name : typeof c.id === "string" ? c.id : "Source";
  const raw = typeof info.url === "string" ? info.url : typeof c.url === "string" ? c.url : null;
  if (raw === null) return { name, url: null };
  const url = safeUrl(raw);
  return url === null ? null : { name, url };
}

export function Sources({ citations }: { citations: Record<string, unknown>[] }) {
  const links = citations.map(citationLink).filter((l): l is NonNullable<typeof l> => l !== null);
  if (links.length === 0) return null;
  return (
    <p className="chat-sources">
      Sources:{" "}
      {links.map((l, i) =>
        l.url === null ? (
          <span key={i}>{l.name}</span>
        ) : (
          <button key={i} type="button" onClick={() => void openUrl(l.url as string)}>
            {l.name}
          </button>
        ),
      )}
    </p>
  );
}
