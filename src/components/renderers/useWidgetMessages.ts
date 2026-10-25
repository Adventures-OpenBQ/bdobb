// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, type RefObject } from "react";
import {
  originOf,
  paramsFromUpdate,
  parseInbound,
  type Outbound,
} from "../../lib/iframeProtocol";
import { paramsKey } from "../../lib/params";

/**
 * What a card supplies for the postMessage protocol. The renderer adds the
 * frame's `src` — it is the only one that knows whether there is one.
 */
export type WidgetMessaging = {
  /**
   * `authHeaders(backend)` — the very map fetchWidgetData sends. Empty for a
   * backend with no credential, for one that places its credential in the
   * query string, and for a built-in with no backend at all. An empty map is
   * one of the two conditions that stop `openbb-auth` being sent.
   */
  headers: Record<string, string>;
  /** The card's effective params: group values already resolved. */
  params: Record<string, string>;
  /** Nothing outside this list is ever accepted from the frame. */
  declaredParamNames: string[];
  /**
   * `accepted` is ready to commit; `dropped` names the parameters the widget
   * does not declare. Split here rather than filtered silently so the card —
   * which is the only thing that knows its own id — can say so once.
   */
  onParamsUpdate: (accepted: Record<string, string>, dropped: string[]) => void;
};

type Options = WidgetMessaging & {
  /**
   * The frame's `src`, already through `safeUrl`. ABSENT means a `srcdoc`
   * frame, which has no origin of its own and is therefore never sent auth.
   */
  src?: string;
};

/**
 * Params carry no credential — they are the values the card's own parameter
 * panel displays and the values every request puts in a query string — and
 * the message still goes to exactly one window: the one whose handle we hold.
 *
 * A frame whose `src` is PRESENT here is one IframeRenderer granted
 * SRC_FRAME_SANDBOX, so it keeps its own origin: that origin is named, and a
 * frame whose origin cannot be determined at all is simply not posted to.
 *
 * An ABSENT `src` is the other branch, and two different frames reach it: a
 * `srcdoc` frame, which never had a URL; and a `src` frame on this app's own
 * origin, whose `src` IframeRenderer withholds precisely because it was
 * refused the same-origin grant. Both are sandboxed WITHOUT
 * allow-same-origin, so both have an opaque origin and neither has one to
 * name — the wildcard target is the only one that reaches either, and it is
 * used in this branch and nowhere else in this file.
 *
 * `openbb-auth` is the opposite case again and is never posted from here.
 */
function postParams(win: Window, options: Options): void {
  const target = options.src === undefined ? "*" : originOf(options.src);
  if (target === null) return;
  const message: Outbound = { type: "openbb-params-update", params: options.params };
  win.postMessage(message, target);
}

/**
 * The single `window` `message` listener a framed widget speaks through,
 * shared by the iframe and HTML renderers because a `srcdoc` frame is a frame
 * too and `event.source` identifies it just as well.
 */
export function useWidgetMessages(
  frame: RefObject<HTMLIFrameElement | null>,
  options: Options | undefined,
): void {
  /*
   * Mirrored on every render, synchronously, so the ONE long-lived listener
   * below always reads current headers and params. Both are rebuilt by the
   * card on every render (effectiveParams returns a fresh object by design),
   * so listing them as effect dependencies would tear the listener down and
   * re-register it on every render of every card — and would drop a message
   * that arrived in the gap.
   */
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      const current = latest.current;
      const win = frame.current?.contentWindow;
      // Two framed cards on one dashboard share this window listener. The
      // source check is the whole of what keeps one card's page from
      // speaking for another — it is an identity comparison against the
      // window this card itself created, which no other page can forge.
      if (!current || !win || event.source !== win) return;

      // Anything parseInbound does not recognise — `openbb-request` and
      // `openbb-data` included, both out of scope by design — is dropped in
      // silence. A page may push them continuously, so there is nothing a
      // notice could tell the log that this comment does not.
      const message = parseInbound(event.data);
      if (message === null) return;

      if (message.type === "openbb-connect") {
        // All three of the design's conditions, together, in one place: the
        // message came from the frame's OWN origin, that origin is nameable,
        // and there is actually a credential to send. The target is that
        // origin and never the wildcard — a frame that navigated itself away
        // between render and reply must not receive the header.
        const origin = current.src === undefined ? null : originOf(current.src);
        if (
          origin !== null &&
          event.origin === origin &&
          Object.keys(current.headers).length > 0
        ) {
          const auth: Outbound = { type: "openbb-auth", headers: current.headers };
          win.postMessage(auth, origin);
        }
        // Answered whether or not auth was: a page that has just connected
        // needs the current parameters to render anything at all.
        postParams(win, current);
        return;
      }

      const params = paramsFromUpdate(message);
      const accepted: Record<string, string> = {};
      const dropped: string[] = [];
      for (const [name, value] of Object.entries(params)) {
        if (current.declaredParamNames.includes(name)) accepted[name] = value;
        else dropped.push(name);
      }
      current.onParamsUpdate(accepted, dropped);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);

  // A value, not the object: effectiveParams hands back a fresh map on every
  // call, so object identity would re-post on every render.
  const signature = options ? paramsKey(options.params) : "";
  /*
   * The first run is skipped deliberately. Nothing has changed yet, the frame
   * has almost certainly not finished loading, and the page's own
   * openbb-connect is answered with the current params anyway — so a mount
   * post is a message into the void at best.
   */
  const posted = useRef(signature);
  useEffect(() => {
    if (posted.current === signature) return;
    posted.current = signature;
    const current = latest.current;
    const win = frame.current?.contentWindow;
    if (!current || !win) return;
    postParams(win, current);
  }, [frame, signature]);
}
