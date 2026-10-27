// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * Rita's text as markdown, built as React elements -- never as HTML -- so
 * whatever Rita (or a note she quotes) writes can only ever be text (spec
 * §4: "Rita's text renders as untrusted markdown"). The subset is what a
 * chat reply uses: `#` headings, paragraphs (a newline is a line break),
 * `-`/`*`/`1.` lists, fenced code, `` `code` ``, `**bold**`, `*italic*` and
 * `[text](url)`. A link is an http(s) URL and opens through the host's
 * `openUrl`; any other scheme stays the literal text. `_` is not italic, so
 * served column names (`bbands(20,2).bb_up`) read as written.
 *
 * The link part excludes `[` and `(` from label and URL so a hostile body of
 * brackets cannot make the scan quadratic (a URL with parentheses is cut short).
 *
 * ponytail: no nesting inside bold/italic/link text, no tables, no
 * blockquotes (shown as written). A markdown library when Rita's replies need them.
 */
import { Fragment, type ReactNode } from "react";

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^[\]\n]+)\]\(([^()\s]+)\)|\*(\S(?:[^*\n]*\S)?)\*/g;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s+(.*)$/;
const FENCE = "```";

/** The URL when it is http(s), else null: `javascript:`, `data:` and relative paths are never followed. */
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

function inline(text: string, openUrl: (url: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const [whole, code, bold, label, url, em] = m;
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (code !== undefined) out.push(<code key={key}>{code}</code>);
    else if (bold !== undefined) out.push(<strong key={key}>{bold}</strong>);
    else if (label !== undefined) {
      const href = safeHref(url);
      out.push(href === null ? whole : (
        <a key={key} href={href} onClick={(e) => { e.preventDefault(); openUrl(href); }}>{label}</a>
      ));
    } else out.push(<em key={key}>{em}</em>);
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, openUrl }: { text: string; openUrl: (url: string) => void }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const starts = (line: string) => line.startsWith(FENCE) || HEADING.test(line) || BULLET.test(line);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;
    if (line.trim() === "") { i += 1; continue; }
    if (line.startsWith(FENCE)) {
      const code: string[] = [];
      for (i += 1; i < lines.length && !lines[i].startsWith(FENCE); i += 1) code.push(lines[i]);
      i += 1; // the closing fence (or the end)
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push(<p key={key} className="arts-md-heading"><strong>{heading[1]}</strong></p>);
      i += 1;
      continue;
    }
    if (BULLET.test(line)) {
      const items: ReactNode[] = [];
      const ordered = /^\s*\d/.test(line);
      for (; i < lines.length && BULLET.test(lines[i]); i += 1) items.push(<li key={i}>{inline(lines[i].replace(BULLET, ""), openUrl)}</li>);
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() !== "" && !starts(lines[i]); i += 1) para.push(lines[i]);
    blocks.push(
      <p key={key}>
        {para.map((l, n) => <Fragment key={n}>{n > 0 ? <br /> : null}{inline(l, openUrl)}</Fragment>)}
      </p>,
    );
  }
  return <div className="arts-md">{blocks}</div>;
}
