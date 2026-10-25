// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewsfeedRenderer } from "./NewsfeedRenderer";

const articles = [
  {
    title: "Global Markets Rally",
    date: "2026-09-25T19:25:35.943207",
    author: "Robert Williams",
    excerpt: "Stock markets surged today.",
    body: "# Big News\n\nMarkets rallied worldwide.",
  },
  { title: "Quiet Session", date: "2026-09-24T09:00:00", author: "Jane Doe", excerpt: "Not much moved." },
];

describe("NewsfeedRenderer", () => {
  it("lists each article's title, byline and excerpt", () => {
    render(<NewsfeedRenderer data={articles} />);
    expect(screen.getByText("Global Markets Rally")).toBeInTheDocument();
    expect(screen.getByText(/Robert Williams/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-25/)).toBeInTheDocument(); // date shown as its ISO calendar day
    expect(screen.getByText("Stock markets surged today.")).toBeInTheDocument();
  });

  it("hides the body until the headline is expanded, then renders it as markdown", () => {
    render(<NewsfeedRenderer data={articles} />);
    expect(screen.queryByText("Big News")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Global Markets Rally/ }));
    expect(screen.getByText("Big News")).toBeInTheDocument(); // the body's markdown heading
  });

  it("an article with no body is not an expandable button", () => {
    render(<NewsfeedRenderer data={articles} />);
    expect(screen.queryByRole("button", { name: /Quiet Session/ })).not.toBeInTheDocument();
    expect(screen.getByText("Quiet Session")).toBeInTheDocument();
  });

  it("shows an empty state for an empty or non-array payload", () => {
    render(<NewsfeedRenderer data={[]} />);
    expect(screen.getByText(/no articles/i)).toBeInTheDocument();
  });
});
