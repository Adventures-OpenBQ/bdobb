// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isYouTubeEmbed, youtubeEmbedUrl } from "../../lib/youtube";
import { SRC_FRAME_SANDBOX } from "./HtmlRenderer";

/**
 * The youtube widget's endpoint returns a plain-text watch URL (its
 * `video_name` param picks which). Unlike IframeRenderer, this never frames
 * the payload verbatim: youtubeEmbedUrl validates it down to an 11-char id and
 * rebuilds a fixed embed URL, so a hostile backend cannot frame an arbitrary
 * origin through this widget. That is also why IframeRenderer is not reused --
 * its sandbox is tuned for untrusted arbitrary sites and would break YouTube's
 * player, which needs the `allow` grants below.
 *
 * `_with_transcript`'s `raw:true` transcript is an AI-context extra, not part
 * of the visual render; the same endpoint without `raw` returns the URL, which
 * is what a card fetches, so the video plays here either way.
 *
 * The loopback wrapper (YouTube loopback spec, 2026-10-01): each mount asks
 * the app for `video_wrapper_port` -- not cached, so a listener re-bound after
 * an iOS suspension is picked up -- and frames the app's own
 * http://127.0.0.1:<port>/yt?id= page, which is what gets the desktop app past
 * YouTube's Error 153 (see youtube.ts). The call rejects in the browser build
 * and answers null when the bind failed; either way the card frames
 * youtube.com exactly as before. An invalid payload never asks at all. The
 * frame is held back until the answer arrives, so a card does not start
 * loading youtube.com only to swap it for the wrapper a moment later.
 *
 * The loopback page is not youtube.com's embed, so it is framed with the same
 * sandbox a Website card's frame gets (SRC_FRAME_SANDBOX), plus allow-presentation
 * for fullscreen; youtube.com's own embed (the fallback) keeps the unsandboxed
 * frame, which its player needs. This is the same rule main applies to any
 * wrapper frame.
 */
export function YouTubeRenderer({ data }: { data: unknown }) {
  const text = typeof data === "string" ? data : "";
  const direct = youtubeEmbedUrl(text);
  const wantPort = direct !== null;
  // undefined: still asking. null: no loopback (browser build, or the bind failed).
  const [port, setPort] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!wantPort) return;
    let live = true;
    invoke<number | null>("video_wrapper_port").then(
      (p) => {
        if (live) setPort(typeof p === "number" ? p : null);
      },
      () => {
        if (live) setPort(null);
      },
    );
    return () => {
      live = false;
    };
  }, [wantPort]);

  if (direct === null) return <p className="empty-state">Select a video in the widget's parameters.</p>;
  if (port === undefined) return <div className="iframe-wrap" />;
  const src = youtubeEmbedUrl(text, port ?? undefined) ?? direct;

  return (
    <div className="iframe-wrap">
      <iframe
        className="widget-frame"
        title="YouTube video"
        src={src}
        sandbox={isYouTubeEmbed(src) ? undefined : `${SRC_FRAME_SANDBOX} allow-presentation`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
