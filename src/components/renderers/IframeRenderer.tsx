// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { originOf } from "../../lib/iframeProtocol";
import { safeUrl } from "../../lib/safeUrl";
import { FRAME_SANDBOX, SRC_FRAME_SANDBOX } from "./HtmlRenderer";
import { useWidgetMessages, type WidgetMessaging } from "./useWidgetMessages";

/**
 * Takes the URL, not a payload: nothing is fetched for a framed widget. A
 * backend iframe widget passes its endpoint; the Website built-in passes its
 * `url` param.
 *
 * The footer is unconditional on purpose, and is the whole of the fallback. A
 * cross-origin frame that the site REFUSED to serve is indistinguishable from
 * one that simply rendered nothing, so the card cannot detect the case from
 * the webview and must always explain it — with the hint, and with the
 * "Open externally" escape hatch beside it.
 */
export function IframeRenderer({
  url,
  emptyHint,
  messaging,
}: {
  url: string;
  emptyHint?: string;
  /** Opts the frame into the widget postMessage protocol. */
  messaging?: WidgetMessaging;
}) {
  const safe = safeUrl(url);
  const frame = useRef<HTMLIFrameElement | null>(null);

  // The dangerous case is a `src` on THIS app's origin —
  // `window.location.origin` is localhost:1420 in dev and browser mode, and
  // tauri.localhost on Windows, both of which a widget definition or a
  // user-typed address can name. Granting such a frame `allow-same-origin`
  // does not give it "its own" origin; it gives it OURS, and the framed
  // document could then read this app's DOM, its stores and the credentials
  // in them. Only a genuinely FOREIGN origin gets SRC_FRAME_SANDBOX. (`safe`
  // is already http/https, so originOf never answers null for it.)
  const foreign = safe !== null && originOf(safe) !== window.location.origin;
  const sandbox = foreign ? SRC_FRAME_SANDBOX : FRAME_SANDBOX;

  // Above every early return below, as the rules of hooks require. `safe` is
  // handed over ONLY for a frame that genuinely keeps a foreign origin. A
  // frame refused that grant has no origin of its own to name, so it is a
  // candidate for neither `openbb-auth` nor an origin-addressed post, and
  // withholding its `src` here is what makes that structural rather than a
  // condition that merely happens not to hold.
  const authSrc = foreign ? safe : undefined;
  useWidgetMessages(frame, messaging && safe !== null ? { ...messaging, src: authSrc } : undefined);

  // Not-yet-entered is a NORMAL state, not an error: the Website built-in
  // starts with no address and must not open in red.
  if (url === "" && emptyHint) return <p className="empty-state">{emptyHint}</p>;

  if (safe === null) {
    return <p className="empty-state">This address is not a valid http or https URL.</p>;
  }

  return (
    <div className="iframe-wrap">
      <iframe
        ref={frame}
        className="widget-frame"
        title="Embedded page"
        sandbox={sandbox}
        src={safe}
      />
      <footer className="iframe-hint">
        <span>Blank? The site may refuse to be embedded.</span>
        <button type="button" onClick={() => void openUrl(safe)}>
          Open externally ↗
        </button>
      </footer>
    </div>
  );
}
