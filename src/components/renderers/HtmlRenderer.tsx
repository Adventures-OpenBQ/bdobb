// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef } from "react";
import { useWidgetMessages, type WidgetMessaging } from "./useWidgetMessages";

/**
 * The sandbox for a `srcdoc` frame. `allow-same-origin` is deliberately ABSENT
 * and must stay absent: with `srcdoc` there is no URL to take an origin from,
 * so granting same-origin would put the frame in this app's own origin and
 * defeat the sandbox entirely.
 */
export const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups";

/**
 * The sandbox for a frame that has a real CROSS-ORIGIN `src`, used by
 * IframeRenderer and by nothing else. Here `allow-same-origin` is deliberately
 * PRESENT, and it is not the same grant it would be above: a cross-origin
 * `src` frame given same-origin keeps its OWN origin, not this app's
 * (measured in Chromium; see the plan's note (c)). That is what lets the page
 * name an origin bdobb can match, which is the whole precondition of the
 * `openbb-auth` rule — reply only to the exact `src` origin. A page framed
 * this way can reach its own origin's cookies and storage, which is what a
 * page loaded from that origin could do in a tab anyway; it still cannot
 * touch this app's origin.
 *
 * Cross-origin is a premise, and IframeRenderer ENFORCES it rather than
 * assuming it: this constant is never applied to a `src` on this app's own
 * origin.
 */
export const SRC_FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-same-origin";

/**
 * Server-generated HTML, rendered inside the card in a sandboxed frame.
 *
 * `messaging` opts the frame into the widget postMessage protocol. No `src`
 * is passed to the hook, which is exactly how it knows this is a srcdoc
 * frame: such a frame has no origin of its own, so it is never sent
 * `openbb-auth` — there is nothing for the auth rule to match, and the
 * sandbox exists to keep this document from acting as the app.
 */
export function HtmlRenderer({ data, messaging }: { data: unknown; messaging?: WidgetMessaging }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  useWidgetMessages(frame, messaging);

  if (typeof data !== "string") {
    return <p className="empty-state">This payload is not HTML.</p>;
  }
  return (
    <iframe
      ref={frame}
      className="widget-frame"
      title="Widget content"
      sandbox={FRAME_SANDBOX}
      srcDoc={data}
    />
  );
}
