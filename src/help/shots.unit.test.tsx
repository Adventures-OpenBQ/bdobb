// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { shotUrl } from "./shots";

describe("shotUrl", () => {
  it("returns null for a name no shot exists for", () => {
    expect(shotUrl("./shots/no-such-topic.png", "light")).toBeNull();
    expect(shotUrl("./shots/no-such-topic.png", "dark")).toBeNull();
  });

  it("returns null for a src that already carries a theme suffix", () => {
    // The one spelling is the only spelling: a topic writes ./shots/x.png and
    // the resolver adds the theme. Accepting a suffixed name too would let
    // half the manual pin itself to one theme by accident.
    expect(shotUrl("./shots/tables-light.png", "light")).toBeNull();
    expect(shotUrl("./shots/tables-dark.png", "dark")).toBeNull();
  });

  it("returns null for an absolute or otherwise foreign src", () => {
    expect(shotUrl("https://example.com/x.png", "light")).toBeNull();
    expect(shotUrl("/shots/tables.png", "light")).toBeNull();
    expect(shotUrl("./shots/../secrets.png", "light")).toBeNull();
    expect(shotUrl("shots/tables.png", "light")).toBeNull();
  });
});

describe("PENDING_MARKER", () => {
  it("matches a PR number and a branch name, on its own line", async () => {
    const { PENDING_MARKER } = await import("./shots");
    expect(PENDING_MARKER.test("body\n\n[shot-pending]: #19\n")).toBe(true);
    expect(PENDING_MARKER.test("body\n\n[shot-pending]: form-tabs-params\n")).toBe(true);
    expect(PENDING_MARKER.test("body with [shot-pending]: #19 inline\n")).toBe(false);
    expect(PENDING_MARKER.test("# Topic\n\nordinary body\n")).toBe(false);
  });
});

describe("the pending marker is invisible in the rendered topic", () => {
  it("renders nothing, unlike an HTML comment", async () => {
    // Measured before this design was chosen: react-markdown 10 with no
    // rehype-raw renders `<!-- x -->` as visible literal text, and a link
    // reference definition as nothing at all. If a future dependency bump
    // reverses either, this test says so before a reader sees "#19" in the
    // middle of a help topic.
    const { render } = await import("@testing-library/react");
    const { MarkdownRenderer } = await import("../components/renderers/MarkdownRenderer");
    const { container } = render(
      <MarkdownRenderer data={"# T\n\nbody text\n\n[shot-pending]: #19\n"} />,
    );
    expect(container.textContent).not.toContain("shot-pending");
    expect(container.textContent).not.toContain("#19");
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("T body text");
  });
});
