// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { safeUrl } from "./safeUrl";

/**
 * One headline. `link`, `date` and `source` are absent whenever the feed did
 * not carry a usable one — an unparsable `pubDate` is not a zero timestamp,
 * and a `javascript:` href is not a link.
 */
export type FeedItem = { title: string; link?: string; date?: number; source?: string };

/** Thrown for anything that is not a feed this app can read. */
export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedError";
  }
}

/**
 * Direct children with this local name, in document order.
 *
 * `localName`, not `nodeName`: Atom is namespaced
 * (`http://www.w3.org/2005/Atom`) and a minority of feeds declare it with a
 * prefix, so an entry's `nodeName` can be `atom:entry` where its `localName`
 * is always `entry`. Direct children, not `getElementsByTagName`: an
 * `<entry>` quoted inside another entry's `<content>` is not a headline of
 * this feed, and a channel's `<title>` must not be shadowed by an item's.
 */
function kids(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((el) => el.localName === name);
}

/** The first of them, or undefined. */
function kid(parent: Element, name: string): Element | undefined {
  return kids(parent, name)[0];
}

/**
 * `textContent`, trimmed, or "" — never null. The XML parser has already
 * decoded entities and unwrapped CDATA, so this is the plain text the feed
 * meant, and it is the ONLY thing this module ever reads out of an element.
 * Nothing here returns markup, because nothing downstream may render markup:
 * a feed is whatever URL the user typed, and a `<title>` routinely carries
 * escaped HTML that must be shown as the text it escapes to.
 */
function text(el: Element | undefined): string {
  return el?.textContent?.trim() ?? "";
}

/**
 * A feed date is RFC 822 (`pubDate`) or RFC 3339 (`updated`/`published`).
 * `Date.parse` reads both; anything it cannot read (an absent element, a
 * hand-rolled format) yields undefined rather than NaN, so no caller has to
 * test for NaN and a bad date can never render as 1970.
 */
function parseDate(raw: string): number | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * A link is handed to the system browser on click, so it passes the app's own
 * boundary rather than being trusted because it arrived as XML. `javascript:`
 * and `data:` are refused, and a refused link is simply absent — the item
 * still renders, it is just inert.
 */
function link(raw: string): string | undefined {
  return safeUrl(raw) ?? undefined;
}

/** Atom: `<link rel="alternate" href>` wins; otherwise the first `href`. */
function atomLink(entry: Element): string | undefined {
  const links = kids(entry, "link");
  const chosen =
    links.find((el) => el.getAttribute("rel") === "alternate") ??
    links.find((el) => el.getAttribute("href"));
  return link(chosen?.getAttribute("href") ?? "");
}

/**
 * Builds one item, or undefined when it has no title. An untitled item has
 * nothing to render as a headline; dropping it is what keeps the list from
 * growing blank rows a reader can neither read nor click.
 */
function item(title: string, source: string, href?: string, date?: number): FeedItem | undefined {
  if (!title) return undefined;
  const out: FeedItem = { title };
  if (href !== undefined) out.link = href;
  if (date !== undefined) out.date = date;
  if (source) out.source = source;
  return out;
}

/**
 * RSS 2.0 or Atom -> headlines, in the order the document lists them.
 *
 * Parsed with `DOMParser("application/xml")`: it never executes script, never
 * loads an external entity, and never runs the HTML parser's error recovery,
 * so a page that merely looks like XML is rejected rather than silently
 * reinterpreted. A rejected document is reported by the parser as a
 * `<parsererror>` element rather than as an exception, which is why that is
 * checked explicitly.
 *
 * Every string that comes back is plain text (see `text`) and every link has
 * passed `safeUrl`. The caller renders both as text and as an href — never
 * through innerHTML.
 */
export function parseFeed(xml: string): FeedItem[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // The element is namespaced (Mozilla's parsererror namespace), and a type
  // selector with no namespace prefix matches any namespace — which is what
  // makes this one line cover every engine, whether it puts the element at
  // the document root or inside a generated <html><body>.
  if (doc.querySelector("parsererror") !== null) throw new FeedError("not a feed");

  const root = doc.documentElement;

  if (root.localName === "rss") {
    const channel = kid(root, "channel");
    if (!channel) throw new FeedError("not a feed");
    const source = text(kid(channel, "title"));
    return kids(channel, "item").flatMap((el) => {
      const one = item(
        text(kid(el, "title")),
        source,
        link(text(kid(el, "link"))),
        parseDate(text(kid(el, "pubDate"))),
      );
      return one ? [one] : [];
    });
  }

  if (root.localName === "feed") {
    const source = text(kid(root, "title"));
    return kids(root, "entry").flatMap((el) => {
      const one = item(
        text(kid(el, "title")),
        source,
        atomLink(el),
        // `updated` is Atom's required timestamp; `published` is optional and
        // is read only when `updated` is missing or empty.
        parseDate(text(kid(el, "updated")) || text(kid(el, "published"))),
      );
      return one ? [one] : [];
    });
  }

  throw new FeedError("not a feed");
}

/** Largest first: the first unit the gap fills is the one that reads best. */
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60_000],
  ["month", 30 * 24 * 60 * 60_000],
  ["day", 24 * 60 * 60_000],
  ["hour", 60 * 60_000],
  ["minute", 60_000],
];

/**
 * "3 hours ago", in the user's own locale. Split out of the renderer so the
 * unit choice — the only part of this that is the app's decision rather than
 * Intl's — is testable without rendering anything.
 *
 * A future date (a feed whose clock runs ahead of ours) formats as "in 3
 * hours" rather than being clamped: calling it "3 hours ago" would be a lie,
 * and Intl already carries the wording for both directions.
 */
export function relativeTime(at: number, now: number): string {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const delta = at - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return format.format(Math.round(delta / ms), unit);
  }
  return format.format(Math.round(delta / 1000), "second");
}
