// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const useNewsWire = vi.fn();
vi.mock("../../hooks/useNewsWire", () => ({ useNewsWire: (o: unknown) => useNewsWire(o) }));
const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));
const usePointerKind = vi.fn(() => "fine" as "fine" | "coarse");
vi.mock("../../hooks/usePointerKind", () => ({ usePointerKind: () => usePointerKind() }));

import type { NewsRow } from "../../hooks/useNewsWire";
import type { NewsFeed } from "../../lib/types";
import { NewsRenderer } from "./NewsRenderer";

const FEEDS: NewsFeed[] = [
  { url: "https://a.example/feed", name: "Bloomberg", tab: "Wires" },
  { url: "https://s.example/feed", name: "", tab: "Substack" },
];
const row = (id: number, feedIndex: 0 | 1, title: string, over: Partial<NewsRow["article"]> = {}): NewsRow => ({
  article: { id, feed_id: feedIndex + 1, title, link: `https://x.example/${id}`, author: null, published_at: null, sort_at: 1_756_800_000 + id, ...over },
  feed: FEEDS[feedIndex],
  record: { id: feedIndex + 1, url: FEEDS[feedIndex].url, title: feedIndex === 0 ? "Bloomberg Markets" : "Notes", favicon: feedIndex === 0 ? "data:image/png;base64,AA==" : null },
});

function live(rows: NewsRow[], status = "live") {
  useNewsWire.mockReturnValue({ status, rows });
}

const props = {
  base: "https://ticker.example",
  feeds: FEEDS,
  highlights: [] as string[],
  refreshKey: 0,
  onConfigure: vi.fn(),
  tabOrder: [] as string[],
  onReorderTabs: vi.fn(),
};

beforeEach(() => {
  useNewsWire.mockReset();
  openUrl.mockReset();
  usePointerKind.mockReset();
  usePointerKind.mockReturnValue("fine");
  props.onConfigure.mockReset();
  props.onReorderTabs.mockReset();
  live([]);
});

describe("NewsRenderer empty states", () => {
  it("asks for a server URL, then for an http(s) one, before opening anything", () => {
    const { rerender } = render(<NewsRenderer {...props} base="  " />);
    expect(screen.getByText("Enter the RSS Aggregator server in Parameters.")).toBeInTheDocument();
    rerender(<NewsRenderer {...props} base="ftp://x" />);
    expect(screen.getByText("Enter an http or https server URL.")).toBeInTheDocument();
  });

  it("offers Configure feeds… when the list is empty, and it calls onConfigure", async () => {
    render(<NewsRenderer {...props} feeds={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Configure feeds…" }));
    expect(props.onConfigure).toHaveBeenCalledTimes(1);
  });

  it("without onConfigure (a locked card or viewer) the empty list offers no Configure feeds…", () => {
    render(<NewsRenderer {...props} feeds={[]} onConfigure={undefined} />);
    expect(screen.queryByRole("button", { name: "Configure feeds…" })).toBeNull();
    expect(screen.getByText("No feeds configured.")).toBeInTheDocument();
  });

  it("waits for headlines once connected with nothing to show", () => {
    render(<NewsRenderer {...props} />);
    expect(screen.getByText("Waiting for headlines…")).toBeInTheDocument();
  });
});

describe("NewsRenderer rows", () => {
  it("renders time, icon, source and title per row, newest first as given", () => {
    live([row(2, 0, "Second"), row(1, 1, "First", { author: "Jane" })]);
    render(<NewsRenderer {...props} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Bloomberg");
    expect(items[0]).toHaveTextContent("Second");
    expect(items[0].querySelector("img.news-icon")).toHaveAttribute("src", "data:image/png;base64,AA==");
    // A feed with a blank name falls back to the server's title; a null
    // favicon renders a placeholder, not an <img>.
    expect(items[1]).toHaveTextContent("Notes");
    expect(items[1]).toHaveTextContent("First - Jane");
    expect(items[1].querySelector("img")).toBeNull();
    expect(items[1].querySelector(".news-icon")).not.toBeNull();
  });

  it("shows [-N] after the time on a row dated before today", () => {
    const now = Math.floor(Date.now() / 1000);
    const twoDaysAgo = now - 2 * 86_400;
    live([row(2, 0, "Old post", { sort_at: twoDaysAgo, published_at: twoDaysAgo }), row(1, 0, "Fresh", { sort_at: now, published_at: now })]);
    render(<NewsRenderer {...props} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].querySelector(".news-age")).toHaveTextContent("[-2]");
    expect(items[1].querySelector(".news-age")).toBeNull();
  });

  it("marks a video clip with a ▶ after its headline, by the link's path", () => {
    live([
      row(2, 0, "Clip", { link: "https://www.bloomberg.com/news/videos/2026-09-04/clip-video" }),
      row(1, 0, "Story", { link: "https://www.bloomberg.com/news/articles/2026-09-04/story" }),
    ]);
    render(<NewsRenderer {...props} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].querySelector(".news-video")).toHaveAccessibleName("video");
    expect(items[1].querySelector(".news-video")).toBeNull();
  });

  it("horizontal: a strip of cards, favicon · time · ▶ on the top line and the headline beneath", () => {
    live([
      row(2, 0, "Clip", { link: "https://www.bloomberg.com/news/videos/2026-09-04/clip-video" }),
      row(1, 1, "Note", { author: "Jane" }),
    ]);
    render(<NewsRenderer {...props} layout="horizontal" />);
    expect(document.querySelector(".news-list")).toBeNull();
    const cards = document.querySelectorAll(".news-strip .news-card");
    expect(cards).toHaveLength(2);
    const head = cards[0].querySelector(".news-card-head")!;
    // Order on the top line: icon, time, ▶.
    expect(Array.from(head.children).map((c) => c.className)).toEqual(["news-icon", "news-time", "news-video"]);
    expect(cards[0].querySelector(".news-card-title")).toHaveTextContent("Clip");
    expect(cards[0]).toHaveAttribute("title", "Bloomberg");
    // A publisher with no icon shows its name on the top line instead.
    expect(cards[1].querySelector(".news-card-head .news-source")).toHaveTextContent("Notes");
    expect(cards[1].querySelector(".news-card-title")).toHaveTextContent("Note - Jane");
  });

  it("horizontal: the headline clamp follows the measured card height", () => {
    // jsdom lays nothing out, so the measurements are stubbed: a 130px card
    // with 4px padding top and bottom, a 4px gap and an 18px top line leaves
    // 100px, which at a 15.6px line height is six lines.
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(130);
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(18);
    const gcs = vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ lineHeight: "15.6px", paddingTop: "4px", paddingBottom: "4px", rowGap: "4px" }) as CSSStyleDeclaration,
    );
    live([row(1, 0, "A")]);
    render(<NewsRenderer {...props} layout="horizontal" />);
    expect(document.querySelector<HTMLElement>(".news-strip")?.style.getPropertyValue("--news-lines")).toBe("6");
    clientHeight.mockRestore();
    offsetHeight.mockRestore();
    gcs.mockRestore();
  });

  it("horizontal: dragging the strip scrolls it, and a drag does not open the card it ends on", () => {
    const opener = vi.mocked(openUrl);
    opener.mockClear();
    // jsdom has no PointerEvent; a MouseEvent carries the button and clientX
    // the handler reads, which is all the drag needs.
    vi.stubGlobal("PointerEvent", MouseEvent);
    live([row(1, 0, "A"), row(2, 0, "B")]);
    render(<NewsRenderer {...props} layout="horizontal" />);
    const strip = document.querySelector<HTMLElement>(".news-strip")!;
    strip.scrollLeft = 100;
    const card = strip.querySelector<HTMLElement>(".news-card")!;
    fireEvent.pointerDown(strip, { button: 0, clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(strip, { clientX: 150, pointerId: 1 });
    expect(strip.scrollLeft).toBe(150);
    fireEvent.pointerUp(strip, { pointerId: 1 });
    fireEvent.doubleClick(card);
    expect(opener).not.toHaveBeenCalled();
    // A plain double-click (no pull) still opens.
    fireEvent.pointerDown(strip, { button: 0, clientX: 200, pointerId: 2 });
    fireEvent.pointerUp(strip, { pointerId: 2 });
    fireEvent.doubleClick(card);
    expect(opener).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("the tab bar's buttons page and jump, oriented per layout", async () => {
    live([row(1, 0, "A"), row(2, 0, "B")]);
    const { unmount } = render(<NewsRenderer {...props} />);
    const list = document.querySelector<HTMLElement>(".news-list")!;
    Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
    await userEvent.click(screen.getByRole("button", { name: "Page down" }));
    expect(list.scrollTop).toBe(90);
    await userEvent.click(screen.getByRole("button", { name: "Bottom" }));
    expect(list.scrollTop).toBe(900);
    await userEvent.click(screen.getByRole("button", { name: "Page up" }));
    expect(list.scrollTop).toBe(810);
    await userEvent.click(screen.getByRole("button", { name: "Top" }));
    expect(list.scrollTop).toBe(0);
    expect(screen.queryByRole("button", { name: "Page forward" })).toBeNull();
    unmount();

    render(<NewsRenderer {...props} layout="horizontal" />);
    const strip = document.querySelector<HTMLElement>(".news-strip")!;
    Object.defineProperty(strip, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(strip, "scrollWidth", { value: 2000, configurable: true });
    await userEvent.click(screen.getByRole("button", { name: "Page forward" }));
    expect(strip.scrollLeft).toBe(180);
    await userEvent.click(screen.getByRole("button", { name: "End" }));
    expect(strip.scrollLeft).toBe(1800);
    await userEvent.click(screen.getByRole("button", { name: "Beginning" }));
    expect(strip.scrollLeft).toBe(0);
  });

  it("vertical: a mouse drag scrolls the list, and a drag does not open the row it ends on", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    live([row(1, 0, "A"), row(2, 0, "B")]);
    render(<NewsRenderer {...props} />);
    const list = document.querySelector<HTMLElement>(".news-list")!;
    list.scrollTop = 100;
    fireEvent.pointerDown(list, { button: 0, clientX: 50, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(list, { clientX: 50, clientY: 250, pointerId: 1 });
    expect(list.scrollTop).toBe(150);
    fireEvent.pointerUp(list, { pointerId: 1 });
    fireEvent.doubleClick(list.querySelector(".news-row")!);
    expect(openUrl).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("horizontal: a vertical wheel scrolls the strip sideways", () => {
    live([row(1, 0, "A"), row(2, 0, "B")]);
    render(<NewsRenderer {...props} layout="horizontal" />);
    const strip = document.querySelector<HTMLElement>(".news-strip")!;
    strip.scrollLeft = 0;
    const ev = new WheelEvent("wheel", { deltaY: 40, deltaX: 0, cancelable: true, bubbles: true });
    strip.dispatchEvent(ev);
    expect(strip.scrollLeft).toBe(40);
    expect(ev.defaultPrevented).toBe(true);
    // A sideways wheel is left to the browser.
    const side = new WheelEvent("wheel", { deltaY: 0, deltaX: 30, cancelable: true, bubbles: true });
    strip.dispatchEvent(side);
    expect(side.defaultPrevented).toBe(false);
  });

  it("horizontal: auto-scroll runs a frame loop only when on, and stops on unmount", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    live([row(1, 0, "A")]);
    const off = render(<NewsRenderer {...props} layout="horizontal" autoScroll="off" />);
    expect(raf).not.toHaveBeenCalled();
    off.unmount();
    const on = render(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    expect(raf).toHaveBeenCalled();
    on.unmount();
    expect(caf).toHaveBeenCalled();
    raf.mockRestore();
    caf.mockRestore();
  });

  // The wire starts with no rows, so on a fresh card the strip does not exist
  // when the component mounts; the glide has to start when it appears.
  it("horizontal: auto-scroll starts when the first rows arrive after mount", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    live([]);
    const { rerender } = render(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    expect(raf).not.toHaveBeenCalled();
    live([row(1, 0, "A")]);
    rerender(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    expect(raf).toHaveBeenCalled();
    raf.mockRestore();
    caf.mockRestore();
  });

  // An empty tab swaps the strip for the waiting message; coming back renders
  // a NEW <ul>, and the glide must move that one, not the detached old one.
  it("horizontal: after an empty spell, auto-scroll glides the new strip", () => {
    const ticks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => ticks.push(cb));
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    live([row(1, 0, "A")]);
    const { rerender } = render(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    live([]);
    rerender(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    live([row(2, 0, "B")]);
    rerender(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    const strip = document.querySelector<HTMLElement>(".news-strip")!;
    Object.defineProperty(strip, "scrollWidth", { value: 1000, configurable: true });
    Object.defineProperty(strip, "clientWidth", { value: 100, configurable: true });
    ticks.at(-1)!(performance.now() + 1000);
    expect(strip.scrollLeft).toBeGreaterThan(0);
    raf.mockRestore();
    caf.mockRestore();
  });

  it("horizontal: auto-scroll starts at the oldest end and drifts toward the newest", () => {
    const ticks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => ticks.push(cb));
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    live([row(1, 0, "A"), row(2, 0, "B")]);
    render(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    const strip = document.querySelector<HTMLElement>(".news-strip")!;
    Object.defineProperty(strip, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(strip, "scrollWidth", { value: 2000, configurable: true });
    const t0 = performance.now();
    ticks.at(-1)!(t0 + 16);
    expect(strip.scrollLeft).toBe(1800);
    ticks.at(-1)!(t0 + 1016);
    expect(strip.scrollLeft).toBeLessThan(1800);
    // Its own arrival at the newest wraps it back to the oldest end.
    ticks.at(-1)!(t0 + 200_000);
    expect(strip.scrollLeft).toBe(0);
    ticks.at(-1)!(t0 + 200_016);
    expect(strip.scrollLeft).toBe(1800);
    raf.mockRestore();
    caf.mockRestore();
  });

  // WebKit truncates a fractional scrollLeft write to a whole pixel, so a
  // sub-pixel step read back from the DOM never moves the strip.
  it.each([
    ["slow", 20],
    ["medium", 45],
    ["fast", 90],
  ] as const)("horizontal: auto-scroll %s glides at its nominal speed when scrollLeft truncates, at 60 and 120 Hz", (speed, pxPerS) => {
    for (const hz of [60, 120]) {
      const ticks: FrameRequestCallback[] = [];
      const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => ticks.push(cb));
      const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
      live([row(1, 0, "A")]);
      const view = render(<NewsRenderer {...props} layout="horizontal" autoScroll={speed} />);
      const strip = document.querySelector<HTMLElement>(".news-strip")!;
      let left = 0;
      Object.defineProperty(strip, "scrollLeft", { get: () => left, set: (v: number) => { left = Math.trunc(v); }, configurable: true });
      Object.defineProperty(strip, "scrollWidth", { value: 5000, configurable: true });
      Object.defineProperty(strip, "clientWidth", { value: 200, configurable: true });
      const t0 = performance.now();
      // The first frame puts the strip at its oldest end (4800); the rest glide back.
      for (let i = 1; i <= hz; i++) ticks.at(-1)!(t0 + (i * 1000) / hz);
      expect(4800 - left).toBeGreaterThanOrEqual(pxPerS - 1);
      expect(4800 - left).toBeLessThanOrEqual(pxPerS + 1);
      view.unmount();
      raf.mockRestore();
      caf.mockRestore();
    }
  });

  it("horizontal: paging lands on a card's left edge, so the first card in view is whole", async () => {
    live([row(1, 0, "A"), row(2, 0, "B"), row(3, 0, "C"), row(4, 0, "D")]);
    render(<NewsRenderer {...props} layout="horizontal" />);
    const strip = document.querySelector<HTMLElement>(".news-strip")!;
    Object.defineProperty(strip, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(strip, "scrollWidth", { value: 800, configurable: true });
    // Cards 186px apart (180 + the 6px gap), laid out from the strip's left.
    const rect = (left: number) => ({ left, right: left + 180, top: 0, bottom: 0, width: 180, height: 0, x: left, y: 0, toJSON() {} });
    strip.getBoundingClientRect = () => rect(0);
    Array.from(strip.children).forEach((c, i) => {
      c.getBoundingClientRect = () => rect(i * 186 - strip.scrollLeft);
    });
    await userEvent.click(screen.getByRole("button", { name: "Page forward" }));
    // 0.9 x 400 = 360 would cut the second card (186); it leads instead.
    expect(strip.scrollLeft).toBe(186);
    await userEvent.click(screen.getByRole("button", { name: "Page back" }));
    expect(strip.scrollLeft).toBe(0);
  });

  it("horizontal: Beginning holds the newest under auto-scroll instead of wrapping to the end", async () => {
    const ticks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => ticks.push(cb));
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    live([row(1, 0, "A"), row(2, 0, "B")]);
    render(<NewsRenderer {...props} layout="horizontal" autoScroll="slow" />);
    const strip = document.querySelector<HTMLElement>(".news-strip")!;
    Object.defineProperty(strip, "clientWidth", { value: 200, configurable: true });
    Object.defineProperty(strip, "scrollWidth", { value: 2000, configurable: true });
    const t0 = performance.now();
    ticks.at(-1)!(t0 + 16);
    expect(strip.scrollLeft).toBe(1800);
    await userEvent.click(screen.getByRole("button", { name: "Beginning" }));
    ticks.at(-1)!(t0 + 32);
    ticks.at(-1)!(t0 + 48);
    expect(strip.scrollLeft).toBe(0);
    // Moved away by the reader, the glide carries on from there toward the newest.
    strip.scrollLeft = 400;
    ticks.at(-1)!(t0 + 64);
    ticks.at(-1)!(t0 + 1064);
    expect(strip.scrollLeft).toBeLessThan(400);
    raf.mockRestore();
    caf.mockRestore();
  });

  it("colours a row whose title matches a highlight keyword", () => {
    live([row(1, 0, "Fed holds rates"), row(2, 0, "Gold slips")]);
    render(<NewsRenderer {...props} highlights={["RATES"]} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveClass("news-hit");
    expect(items[1]).not.toHaveClass("news-hit");
  });

  it("opens on double-click and Enter, not on a single click, and never a non-http link", async () => {
    live([row(1, 0, "Open me"), row(2, 0, "Bad link", { link: "javascript:alert(1)" }), row(3, 0, "No link", { link: null })]);
    render(<NewsRenderer {...props} />);
    const [good, bad, none] = screen.getAllByRole("listitem");

    await userEvent.click(good);
    expect(openUrl).not.toHaveBeenCalled();
    await userEvent.dblClick(good);
    expect(openUrl).toHaveBeenCalledWith("https://x.example/1");

    good.focus();
    await userEvent.keyboard("{Enter}");
    expect(openUrl).toHaveBeenCalledTimes(2);

    await userEvent.dblClick(bad);
    await userEvent.dblClick(none);
    expect(openUrl).toHaveBeenCalledTimes(2);
  });

  it("a single tap under a coarse pointer does nothing either: a finger scrolls, a double-tap opens", async () => {
    usePointerKind.mockReturnValue("coarse");
    live([row(1, 0, "Open me")]);
    render(<NewsRenderer {...props} />);
    await userEvent.click(screen.getByRole("listitem"));
    expect(openUrl).not.toHaveBeenCalled();
    await userEvent.dblClick(screen.getByRole("listitem"));
    expect(openUrl).toHaveBeenCalledWith("https://x.example/1");
  });

  it("shows the wire status as a dot", () => {
    live([], "connecting");
    render(<NewsRenderer {...props} />);
    expect(screen.getByRole("img", { name: "connecting" })).toHaveClass("news-dot-connecting");
  });
});

describe("NewsRenderer tabs", () => {
  it("lists All first then the feeds' tabs, and filters rows by tab", async () => {
    live([row(1, 0, "Wire story"), row(2, 1, "Substack story")]);
    render(<NewsRenderer {...props} />);
    // Real DOM tagName is uppercase (the v8 tab-filter gotcha); the roles
    // below do not depend on it, but the assertion keeps the harness honest.
    expect(screen.getAllByRole("tab").map((t) => t.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All", "Wires", "Substack"]);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tablist").querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(screen.getByRole("tablist").querySelector('[role="img"]')).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Substack" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("Substack story")]);

    await userEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("falls back to All when the active tab disappears from the feed list", async () => {
    live([row(1, 0, "Wire story")]);
    const { rerender } = render(<NewsRenderer {...props} />);
    await userEvent.click(screen.getByRole("tab", { name: "Wires" }));
    rerender(<NewsRenderer {...props} feeds={[{ ...FEEDS[0], tab: "" }]} />);
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("NewsRenderer tab drag", () => {
  const THREE: NewsFeed[] = [...FEEDS, { url: "https://s.example/sa", name: "", tab: "Seeking Alpha" }];

  beforeAll(() => {
    // jsdom has no PointerEvent (a MouseEvent carries the same coordinates)
    // and no hit-testing; elementFromPoint is stubbed per test.
    if (!("PointerEvent" in window)) (window as unknown as { PointerEvent: unknown }).PointerEvent = MouseEvent;
    if (typeof document.elementFromPoint !== "function") document.elementFromPoint = () => null;
  });

  function dragTab(from: string, to: string | null) {
    const target = to === null ? null : screen.getByRole("tab", { name: to });
    const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    const dragged = screen.getByRole("tab", { name: from });
    fireEvent.pointerDown(dragged, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(dragged, { clientX: 80, clientY: 10, pointerId: 1 });
    const cue = { dragging: dragged.className, over: target?.className };
    fireEvent.pointerUp(dragged, { clientX: 80, clientY: 10, pointerId: 1 });
    spy.mockRestore();
    return cue;
  }

  it("renders the saved order after All", () => {
    live([]);
    render(<NewsRenderer {...props} feeds={THREE} tabOrder={["Seeking Alpha"]} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All", "Seeking Alpha", "Wires", "Substack"]);
  });

  it("dropping a tab on another reports the new order, with a cue on both while dragging", () => {
    live([]);
    render(<NewsRenderer {...props} feeds={THREE} />);
    const cue = dragTab("Wires", "Seeking Alpha");
    expect(cue.dragging).toContain("news-tab-dragging");
    expect(cue.over).toContain("news-tab-over");
    expect(props.onReorderTabs).toHaveBeenCalledWith(["Substack", "Seeking Alpha", "Wires"]);
    // Nothing is left dimmed once released.
    expect(document.querySelector(".news-tab-dragging")).toBeNull();
  });

  it("without onReorderTabs (a locked card or viewer) a tab does not drag", () => {
    live([]);
    render(<NewsRenderer {...props} feeds={THREE} onReorderTabs={undefined} />);
    expect(dragTab("Wires", "Seeking Alpha").dragging).not.toContain("news-tab-dragging");
  });

  it("All cannot be dragged or be a drop target, and a drop on nothing changes nothing", () => {
    live([]);
    render(<NewsRenderer {...props} feeds={THREE} />);
    dragTab("Wires", "All");
    dragTab("Wires", null);
    expect(props.onReorderTabs).not.toHaveBeenCalled();
    const all = screen.getByRole("tab", { name: "All" });
    fireEvent.pointerDown(all, { clientX: 1, clientY: 1, pointerId: 2 });
    expect(all.className).not.toContain("news-tab-dragging");
  });
});
