// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

import { MarkdownRenderer } from "./MarkdownRenderer";

beforeEach(() => openUrl.mockReset());

describe("MarkdownRenderer", () => {
  it("renders a markdown string as HTML", () => {
    render(<MarkdownRenderer data={"## Heading\n\nsome text"} />);
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.getByText("some text")).toBeInTheDocument();
  });

  it("says so rather than throwing when the payload is not a string", () => {
    render(<MarkdownRenderer data={{ content: "x" }} />);
    expect(screen.getByText(/not markdown/i)).toBeInTheDocument();
  });

  it("opens a link externally instead of navigating the app's own webview", () => {
    render(<MarkdownRenderer data={"[go](https://example.com/x)"} />);
    const link = screen.getByRole("link", { name: "go" });

    // fireEvent.click returns false when the event's default was prevented
    // — i.e. the click did NOT fall through to a real navigation.
    const notCancelled = fireEvent.click(link);

    expect(notCancelled).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("renders a link with a rejected href as inert text, never clickable", () => {
    render(<MarkdownRenderer data={"[go](javascript:alert(1))"} />);

    expect(screen.queryByRole("link", { name: "go" })).not.toBeInTheDocument();
    expect(screen.getByText("go")).toBeInTheDocument();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("hands a #guide/ link to onHelpLink instead of the browser", () => {
    const onHelpLink = vi.fn();
    render(<MarkdownRenderer data={"[Tables](#guide/tables)"} onHelpLink={onHelpLink} />);

    const notCancelled = fireEvent.click(screen.getByRole("link", { name: "Tables" }));

    expect(notCancelled).toBe(false);
    expect(onHelpLink).toHaveBeenCalledWith("tables");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("renders a #guide/ link as inert text when nobody is listening for it", () => {
    render(<MarkdownRenderer data={"[Tables](#guide/tables)"} />);

    expect(screen.queryByRole("link", { name: "Tables" })).not.toBeInTheDocument();
    expect(screen.getByText("Tables")).toBeInTheDocument();
  });

  it("draws a GFM table", () => {
    render(<MarkdownRenderer data={"| a | b |\n|---|---|\n| 1 | 2 |"} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "a" })).toBeInTheDocument();
  });
});

/**
 * The help dialog resolves `./shots/x.png` to a theme-suffixed bundled asset;
 * every other caller passes no resolver and must be untouched. The first test
 * pins TODAY's behaviour so the no-resolver path cannot drift.
 */
describe("MarkdownRenderer images", () => {
  // The reference backend's two image widgets both answer with an inline
  // `data:` image -- even "image from URL" is fetched server-side and
  // base64'd -- and react-markdown's default transform blanks any src that
  // is not http(s), so both cards rendered an empty <img>.
  it("keeps an inline data:image src", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    render(<MarkdownRenderer data={`![logo](${src})`} />);
    expect(screen.getByRole("img", { name: "logo" })).toHaveAttribute("src", src);
  });

  it("still blanks a data: src that is not an image", () => {
    render(<MarkdownRenderer data={"![x](data:text/html;base64,PHA+aGk8L3A+)"} />);
    expect(screen.getByRole("img", { name: "x" }).getAttribute("src") ?? "").not.toMatch(/^data:/);
  });

  it("still refuses a data: href on a link", () => {
    render(<MarkdownRenderer data={"[click](data:image/png;base64,iVBORw0KGgo=)"} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders an image with its original src when there is no resolver", () => {
    render(<MarkdownRenderer data={"![a chart](./shots/x.png)"} />);
    const img = screen.getByRole("img", { name: "a chart" });
    expect(img).toHaveAttribute("src", "./shots/x.png");
  });

  it("maps src through the resolver when there is one", () => {
    const resolve = vi.fn(() => "/assets/x-dark.png");
    render(<MarkdownRenderer data={"![a chart](./shots/x.png)"} resolveImage={resolve} />);

    expect(resolve).toHaveBeenCalledWith("./shots/x.png");
    expect(screen.getByRole("img", { name: "a chart" })).toHaveAttribute(
      "src",
      "/assets/x-dark.png",
    );
  });

  it("renders no img at all when the resolver returns null", () => {
    // A missing shot must never leave a broken-image glyph in the middle of a
    // paragraph. shots.test.ts is what stops this from happening silently.
    const { container } = render(
      <MarkdownRenderer data={"before\n\n![a chart](./shots/gone.png)\n\nafter"} resolveImage={() => null} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("before")).toBeInTheDocument();
    expect(screen.getByText("after")).toBeInTheDocument();
  });

  // The help dialog re-renders on every keystroke in its search field. If the
  // `img` component were minted fresh each time, React would see a new element
  // type, unmount the old <img> and mount a new one -- every screenshot in the
  // open topic would reload mid-typing.
  it("keeps the same img element across a re-render with the same resolver", () => {
    const resolve = () => "/assets/x-dark.png";
    const { container, rerender } = render(
      <MarkdownRenderer data={"![a chart](./shots/x.png)"} resolveImage={resolve} />,
    );
    const first = container.querySelector("img");

    rerender(<MarkdownRenderer data={"![a chart](./shots/x.png)"} resolveImage={resolve} />);

    expect(container.querySelector("img")).toBe(first);
  });

  it("passes alt text through unchanged", () => {
    render(
      <MarkdownRenderer
        data={"![The left rail, expanded](./shots/the-left-rail.png)"}
        resolveImage={() => "/assets/the-left-rail-light.png"}
      />,
    );
    expect(screen.getByAltText("The left rail, expanded")).toBeInTheDocument();
  });
});
