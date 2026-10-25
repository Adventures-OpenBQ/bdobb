// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, type AnchorHTMLAttributes, type ImgHTMLAttributes } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeUrl } from "../../lib/safeUrl";

/** GFM on, everywhere: tables, strikethrough, task lists, autolinks. */
const PLUGINS = [remarkGfm];

/**
 * An inline image is the one `data:` URL let through, and only as an `img`
 * src: the reference backend's image widgets answer with base64 images (even
 * "image from URL" is fetched server-side), and the default transform blanks
 * every non-http(s) src. An `<img>` never runs script, SVG included, so this
 * opens nothing a link could; hrefs keep the default transform untouched.
 */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i;
function urlTransform(url: string, key: string): string {
  return key === "src" && DATA_IMAGE.test(url) ? url : defaultUrlTransform(url);
}

/** A link into the Help dialog's own guide, as guide.ts writes it. */
const HELP_LINK = /^#guide\/([a-z0-9-]+)$/;

/**
 * The app's own webview has no chrome and no back button — a backend-
 * controlled link followed as a normal navigation takes the whole app away
 * with no way back short of a restart. Every link is routed through the
 * system browser instead, the same way IframeRenderer's "Open externally"
 * button does. A href `safeUrl` refuses (e.g. `javascript:`) is rendered as
 * plain text rather than a link — react-markdown's own defaultUrlTransform
 * already neutralises those, but this is the layer that must hold either way.
 *
 * The one exception is a `#guide/slug` fragment when the caller passed an
 * `onHelpLink`: that is the Help dialog asking for one of its own pages, and
 * it stays inside the app. Without the callback such a link is a fragment
 * nobody handles, and safeUrl turns it into plain text like any other.
 */
function linkThrough(onHelpLink?: (slug: string) => void) {
  return function MarkdownLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
    const internal = href !== undefined && onHelpLink !== undefined ? HELP_LINK.exec(href) : null;
    if (internal !== null) {
      const slug = internal[1];
      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onHelpLink?.(slug);
          }}
        >
          {children}
        </a>
      );
    }
    const safe = href ? safeUrl(href) : null;
    if (safe === null) return <>{children}</>;
    return (
      <a
        href={safe}
        onClick={(event) => {
          event.preventDefault();
          // A link that has handled its own click has no business letting it
          // continue upward — e.g. NoteRenderer wraps the rendered markdown in
          // a <button> that enters edit mode on click, and a link click must
          // not also trigger that.
          event.stopPropagation();
          void openUrl(safe);
        }}
      >
        {children}
      </a>
    );
  };
}

/** The default, built once so its identity is stable for every caller without a help callback. */
const ExternalLink = linkThrough();

/**
 * An `img` override, built per resolver so the component identity is stable
 * for a stable resolver. `null` from the resolver means render NOTHING: a
 * missing shot must never leave a broken-image glyph mid-paragraph. `alt` is
 * passed through untouched -- a screenshot with no alt text is the one thing
 * here a screen reader cannot recover from.
 */
function imageThrough(resolve: (src: string) => string | null) {
  return function MarkdownImage({ src, alt }: ImgHTMLAttributes<HTMLImageElement>) {
    const resolved = typeof src === "string" ? resolve(src) : null;
    if (resolved === null) return null;
    return <img src={resolved} alt={alt ?? ""} />;
  };
}

/**
 * `data` has already had the widget's dataKey applied, so a markdown widget
 * declaring `dataKey: "results.content"` arrives here as the string itself.
 * Anything else says so rather than throwing — a card must never go blank.
 *
 * `resolveImage` and `onHelpLink` are optional and only the help dialog passes
 * them. Without them NO `img` component and the default link component are
 * handed to react-markdown, so every existing markdown widget card renders
 * exactly what it renders today -- the branch is on the components object,
 * not inside a component that always runs.
 */
export function MarkdownRenderer({
  data,
  resolveImage,
  onHelpLink,
}: {
  data: unknown;
  resolveImage?: (src: string) => string | null;
  onHelpLink?: (slug: string) => void;
}) {
  // Memoised on the callbacks' identities, and ABOVE the early return so the
  // hook runs on every render: a fresh `img` component each render is a new
  // element type to React, which unmounts and remounts every <img> -- and the
  // help dialog re-renders on every keystroke in its search field.
  const components = useMemo(() => {
    const a = onHelpLink ? linkThrough(onHelpLink) : ExternalLink;
    return resolveImage ? { a, img: imageThrough(resolveImage) } : { a };
  }, [resolveImage, onHelpLink]);
  if (typeof data !== "string") {
    return <p className="empty-state">This payload is not markdown.</p>;
  }
  return (
    <div className="markdown-body">
      <Markdown components={components} remarkPlugins={PLUGINS} urlTransform={urlTransform}>
        {data}
      </Markdown>
    </div>
  );
}
