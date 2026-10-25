// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A YouTube video id is exactly 11 URL-safe base64 characters. The renderer
 * NEVER frames the backend's URL verbatim: it extracts an id, validates it
 * against this, and drops it into a fixed youtube.com/embed/ template. So a
 * hostile backend cannot use the youtube widget to frame an arbitrary origin.
 */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** The hosts a youtube URL may legitimately carry. youtu.be is the share form. */
const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/**
 * Maps whatever the youtube widget's endpoint returned -- a watch URL, a
 * youtu.be link, an already-embed/shorts/live URL, or a bare id -- to a
 * canonical `https://www.youtube.com/embed/<id>`. Returns null for anything
 * that is not a recognisable YouTube video (including a non-YouTube host),
 * which the renderer shows as an empty state rather than framing.
 *
 * The body may arrive as text/plain with a trailing newline, so it is trimmed.
 *
 * `wrapperPort` (YouTube loopback spec, 2026-10-01): the port of the app's own
 * loopback wrapper (src-tauri/src/video_wrapper.rs). The app's pages come from
 * tauri://localhost, so an embed it frames directly carries no usable Referer
 * and YouTube answers Error 153; the wrapper's `http://127.0.0.1:<port>/yt?id=`
 * page embeds the same video from the loopback origin, which YouTube accepts.
 * Only ever built from the id validated above -- an invalid payload returns
 * null with or without a port, so it never yields a loopback URL. Without a
 * port (the browser build, or the bind failed) the result is youtube.com's
 * embed exactly as before.
 */
export function youtubeEmbedUrl(input: string, wrapperPort?: number): string | null {
  const id = extractId(input.trim());
  if (id === null || !ID_RE.test(id)) return null;
  return wrapperPort === undefined
    ? `https://www.youtube.com/embed/${id}`
    : `http://127.0.0.1:${wrapperPort}/yt?id=${id}`;
}

/** True when `src` is the fixed youtube.com embed rather than a wrapper page (the loopback, or a backend's). */
export function isYouTubeEmbed(src: string): boolean {
  return src.startsWith("https://www.youtube.com/embed/");
}

function extractId(s: string): string | null {
  if (s === "") return null;
  if (ID_RE.test(s)) return s; // a bare id
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(url.hostname)) return null;
  if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
  const v = url.searchParams.get("v");
  if (v !== null) return v;
  const path = /^\/(?:embed|shorts|live)\/([^/?]+)/.exec(url.pathname);
  return path ? path[1] : null;
}
