// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef } from "react";
import { useWidgetMessages, type WidgetMessaging } from "./useWidgetMessages";

/**
 * The sandbox for a `srcdoc` frame. `allow-same-origin` is deliberately ABSENT
 * and must stay absent: with `srcdoc` there is no URL to take an origin from,
 * so granting same-origin would put the frame in this app's own origin and
 * defeat the sandbox entirely.
 *
 * `allow-scripts` here is a DEV-ONLY truth, and has been since the v4 CSP.
 * `about:srcdoc` is a local scheme, so the frame inherits the embedding
 * document's policy; in a packaged build that policy is `script-src 'self'`
 * (src-tauri/tauri.conf.json), and this frame's origin is opaque because of
 * the missing `allow-same-origin` above -- so `'self'` can never match it and
 * every script in a backend's html payload is refused. The dev server sends
 * the narrow header (`frame-ancestors 'none'` alone, design D6), which is the
 * only reason such scripts run under `pnpm dev` and in the e2e suite.
 *
 * Accepted deliberately in PR #37, with the reasoning and the follow-up there:
 * serve html payloads from a real origin (the Tauri asset protocol), which is
 * not a local scheme and so does not inherit the parent CSP -- scripts run
 * again inside this same sandbox. Loosening `script-src` is not the fix; it
 * would defeat the policy for one widget type.
 *
 * `allow-forms` is the SAME dev-only truth, for the same reason, and it is one
 * directive further than the script story: inheritance is not selective, so
 * this frame takes the packaged policy's `form-action 'none'` as well. A plain
 * `<form>` in a backend's payload therefore has its SUBMISSION refused too --
 * not only the scripts around it. Neither grant in this string survives a
 * packaged build; both stay because the sandbox must still be right the day
 * the payloads move to a real origin (below), and because they are live under
 * `pnpm dev` and in the e2e suite.
 *
 * Practical effect in a packaged build: `html` widgets stop participating in
 * parameter groups, stop being interactive, and cannot submit a form.
 * `iframe` widgets with a real `src` (SRC_FRAME_SANDBOX below) are unaffected
 * -- a real URL is not a local scheme and carries its own policy.
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
