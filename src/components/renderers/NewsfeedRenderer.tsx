// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

type Article = { title?: string; date?: string; author?: string; excerpt?: string; body?: string };

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The article's calendar day. Kept as the ISO date so it is locale- and
 *  timezone-stable; a feed does not need a clock. */
function day(date: string | undefined): string | undefined {
  if (date === undefined) return undefined;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(date);
  return iso ? iso[1] : date;
}

function articlesOf(data: unknown): Article[] {
  if (!Array.isArray(data)) return [];
  return data.filter((a): a is Article => typeof a === "object" && a !== null);
}

/** One article row: a byline and excerpt, and -- when the article carries a
 *  body -- an expandable headline that reveals it as markdown. There is no
 *  external link in this payload, so the body IS the article. */
function Item({ article }: { article: Article }) {
  const [open, setOpen] = useState(false);
  const title = str(article.title) ?? "Untitled";
  const meta = [day(str(article.date)), str(article.author)].filter((v) => v !== undefined).join(" · ");
  const excerpt = str(article.excerpt);
  const body = str(article.body);

  const head = (
    <>
      <span className="newsfeed-title">{title}</span>
      {meta !== "" ? <span className="newsfeed-meta">{meta}</span> : null}
    </>
  );

  return (
    <li className="newsfeed-item">
      {body !== undefined ? (
        <button
          type="button"
          className="newsfeed-head"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {head}
        </button>
      ) : (
        <div className="newsfeed-head newsfeed-head-static">{head}</div>
      )}
      {excerpt !== undefined ? <p className="newsfeed-excerpt">{excerpt}</p> : null}
      {open && body !== undefined ? (
        <div className="newsfeed-body">
          <MarkdownRenderer data={body} />
        </div>
      ) : null}
    </li>
  );
}

/** A list of fetched articles. */
export function NewsfeedRenderer({ data }: { data: unknown }) {
  const articles = articlesOf(data);
  if (articles.length === 0) return <p className="empty-state">No articles in this feed.</p>;
  return (
    <ul className="newsfeed">
      {articles.map((article, i) => (
        <Item key={i} article={article} />
      ))}
    </ul>
  );
}
