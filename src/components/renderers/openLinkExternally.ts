// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { openUrl } from "@tauri-apps/plugin-opener";
import { safeUrl } from "../../lib/safeUrl";

/**
 * A click handler for a container of rendered links (pdf.js's annotation
 * layer, the note editor). The app's own webview has no chrome and no back
 * button, so no link may navigate it -- the MarkdownRenderer rule: the
 * navigation is stopped and a link safeUrl accepts opens in the system
 * browser.
 *
 * getAttribute, not .href: the property resolves "#..." against the page's
 * own base URL, which would turn every internal destination into an
 * http://localhost/... link that safeUrl accepts and openUrl then opens.
 */
export function openLinkExternally(event: { target: EventTarget; preventDefault(): void }): void {
  const anchor = (event.target as Element).closest("a[href]");
  if (anchor === null) return;
  event.preventDefault();
  const safe = safeUrl(anchor.getAttribute("href") ?? "");
  if (safe !== null) void openUrl(safe);
}
