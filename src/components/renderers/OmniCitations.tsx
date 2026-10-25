// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { openUrl } from "@tauri-apps/plugin-opener";
import type { NormalizedCitation } from "../../lib/omni";
import { safeUrl } from "../../lib/safeUrl";

/**
 * The "Sources" list under an omni response. The reference backend sends no
 * citations, so this is built to openbb-ai's Citation shape and unverified
 * against the demo. `details` (page numbers) and quote bounding boxes are out
 * of scope; we show the source's name and, for a web source, a link.
 */
export function OmniCitations({ citations }: { citations: NormalizedCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="omni-citations" style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Sources</div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {citations.map((c, i) => {
          const label = (c.name ?? c.description ?? c.origin ?? c.type) || "source";
          const web = c.origin !== undefined && safeUrl(c.origin) !== null ? c.origin : null;
          return (
            <li key={i}>
              {c.type ? (
                <span
                  className="omni-citation-type"
                  style={{ marginRight: 6, padding: "0 4px", borderRadius: 3, border: "1px solid var(--border, #444)" }}
                >
                  {c.type}
                </span>
              ) : null}
              {web !== null ? (
                <a
                  href={web}
                  onClick={(event) => {
                    // target="_blank" does nothing in the app's WKWebView, so
                    // the link opens in the system browser the way every other
                    // renderer's links do.
                    event.preventDefault();
                    void openUrl(web);
                  }}
                >
                  {label}
                </a>
              ) : (
                <span>{label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
