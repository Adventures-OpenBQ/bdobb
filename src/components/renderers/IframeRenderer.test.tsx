// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The renderer's own paths never touch the filesystem, but the logger they
// reach on failure does; memfs keeps that off the real disk.

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

import { __reset } from "../../test/memfs";
import { __resetLoggerForTests } from "../../lib/logger";
import { FRAME_SANDBOX, SRC_FRAME_SANDBOX } from "./HtmlRenderer";
import { IframeRenderer } from "./IframeRenderer";
import type { WidgetMessaging } from "./useWidgetMessages";

beforeEach(() => {
  openUrl.mockReset();
  __reset();
  __resetLoggerForTests();
});

describe("IframeRenderer", () => {
  it("frames a valid https URL", () => {
    render(<IframeRenderer url="https://example.com/x" />);
    expect(screen.getByTitle("Embedded page")).toHaveAttribute("src", "https://example.com/x");
  });

  it("sandboxes a CROSS-origin src frame WITH allow-same-origin, so it keeps an origin of its own", () => {
    // A CROSS-origin src frame granted allow-same-origin keeps its OWN real
    // origin, not this app's — measured, twice, in Chromium. That is what
    // makes event.origin nameable, and therefore what makes the openbb-auth
    // rule (reply only to the exact src origin) reachable instead of a branch
    // that can never be true. Cross-origin is a premise, not an assumption:
    // IframeRenderer enforces it, and a same-origin-as-app src is refused the
    // grant (see "sends no headers to a frame whose src is this app's OWN
    // origin" below). The srcdoc case keeps FRAME_SANDBOX for the same reason.
    render(<IframeRenderer url="https://example.com" />);
    const sandbox = screen.getByTitle("Embedded page").getAttribute("sandbox");
    expect(sandbox).toBe(SRC_FRAME_SANDBOX);
    expect(sandbox).toContain("allow-same-origin");
  });

  it("refuses a javascript: URL and frames nothing", () => {
    render(<IframeRenderer url="javascript:alert(1)" />);
    expect(screen.queryByTitle("Embedded page")).not.toBeInTheDocument();
    expect(screen.getByText(/not a valid http/i)).toBeInTheDocument();
  });

  it("always carries the refusal hint, because a refused frame looks like a blank one", () => {
    render(<IframeRenderer url="https://example.com" />);
    expect(screen.getByText(/may refuse to be embedded/i)).toBeInTheDocument();
  });

  it("opens the URL externally on request", async () => {
    render(<IframeRenderer url="https://example.com/x" />);
    await userEvent.click(screen.getByRole("button", { name: /open externally/i }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("offers no external-open button for a refused URL", () => {
    render(<IframeRenderer url="file:///etc/passwd" />);
    expect(screen.queryByRole("button", { name: /open externally/i })).not.toBeInTheDocument();
  });
});

describe("IframeRenderer fallback for a frame that refuses to load", () => {
  it("shows the empty hint, not an error, when no address is set", () => {
    render(<IframeRenderer url="" emptyHint="Enter a URL to frame a page." />);
    expect(screen.getByText("Enter a URL to frame a page.")).toBeInTheDocument();
    expect(screen.queryByTitle("Embedded page")).not.toBeInTheDocument();
    expect(document.querySelector(".error-state")).toBeNull();
  });

  // A site that refuses the frame is indistinguishable from one that rendered
  // nothing, so the card never swaps the frame out for a refusal panel: the
  // frame stays, and the footer hint plus "Open externally" ARE the fallback.
  it("keeps framing a site that refuses to be embedded, and explains it in the footer", () => {
    render(<IframeRenderer url="https://refuses.example/a/b" />);
    expect(screen.getByTitle("Embedded page")).toHaveAttribute(
      "src",
      "https://refuses.example/a/b",
    );
    expect(screen.getByText(/may refuse to be embedded/i)).toBeInTheDocument();
    expect(screen.queryByText(/refuses to be embedded\./i)).not.toBeInTheDocument();
  });

  it("offers Open externally beside the hint, as the escape hatch for a blank frame", async () => {
    render(<IframeRenderer url="https://refuses.example/x" />);
    await userEvent.click(screen.getByRole("button", { name: /open externally/i }));
    expect(openUrl).toHaveBeenCalledWith("https://refuses.example/x");
  });

  it("carries the hint and the escape hatch on the first paint, with nothing to wait for", () => {
    render(<IframeRenderer url="https://example.com/" />);
    expect(screen.getByText(/may refuse to be embedded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open externally/i })).toBeInTheDocument();
  });
});

describe("IframeRenderer URL transitions", () => {
  it("swaps the frame to the new URL, carrying no state from the previous one", () => {
    const { rerender } = render(<IframeRenderer url="https://first.example/" />);
    expect(screen.getByTitle("Embedded page")).toHaveAttribute("src", "https://first.example/");

    rerender(<IframeRenderer url="https://second.example/" />);
    const frame = screen.getByTitle("Embedded page");
    expect(frame).toHaveAttribute("src", "https://second.example/");
    expect(screen.getByText(/may refuse to be embedded/i)).toBeInTheDocument();
  });

  it("opens the CURRENT url externally after a transition", async () => {
    const { rerender } = render(<IframeRenderer url="https://first.example/" />);
    rerender(<IframeRenderer url="https://second.example/" />);
    await userEvent.click(screen.getByRole("button", { name: /open externally/i }));
    expect(openUrl).toHaveBeenCalledWith("https://second.example/");
    expect(openUrl).not.toHaveBeenCalledWith("https://first.example/");
  });

  it("falls back to the invalid-address message when the new URL is not http(s)", () => {
    const { rerender } = render(<IframeRenderer url="https://first.example/" />);
    rerender(<IframeRenderer url="javascript:alert(1)" />);
    expect(screen.queryByTitle("Embedded page")).not.toBeInTheDocument();
    expect(screen.getByText(/not a valid http/i)).toBeInTheDocument();
  });
});

/**
 * jsdom mechanics, established once here and reused by HtmlRenderer.test.tsx:
 *
 * - `contentWindow` is a prototype getter and jsdom's real about:blank window
 *   is not reliably spyable, so a stub is defined on the ELEMENT. The hook
 *   reads `frame.current?.contentWindow` afresh on every event, so a stub
 *   installed after mount is picked up.
 * - `new MessageEvent("message", { source })` validates `source` against the
 *   IDL type (WindowProxy | MessagePort | ServiceWorker) and refuses a plain
 *   object, so `source` is defined on the event afterwards. The listener only
 *   ever compares it by identity.
 */
function stubFrame(frame: Element): { win: Window; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn();
  Object.defineProperty(frame, "contentWindow", {
    value: { postMessage },
    configurable: true,
  });
  return { win: (frame as HTMLIFrameElement).contentWindow as Window, postMessage };
}

function send(source: unknown, data: unknown, origin: string): void {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

/**
 * Lets a posted reply settle inside act(). The hook answers a frame's message
 * from a promise continuation, so the resulting state lands on a microtask
 * AFTER the dispatching act() body returns; awaiting one further act() tick
 * keeps that update inside act() and React quiet about it.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("IframeRenderer widget messages", () => {
  const HEADERS = { "X-Key": "secret-value" };

  function messaging(over: Partial<WidgetMessaging> = {}): WidgetMessaging {
    return {
      headers: HEADERS,
      params: { symbol: "AAPL" },
      declaredParamNames: ["symbol"],
      onParamsUpdate: vi.fn(),
      ...over,
    };
  }

  it("replies with the backend's headers, to the frame's own origin", async () => {
    render(<IframeRenderer url="https://embed.example/p" messaging={messaging()} />);
    await settle();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    send(win, { type: "openbb-connect" }, "https://embed.example");

    expect(postMessage).toHaveBeenCalledWith(
      { type: "openbb-auth", headers: HEADERS },
      "https://embed.example",
    );
  });

  it("never targets auth at a wildcard", async () => {
    render(<IframeRenderer url="https://embed.example/p" messaging={messaging()} />);
    await settle();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    send(win, { type: "openbb-connect" }, "https://embed.example");

    const auth = postMessage.mock.calls.filter(
      ([m]) => (m as { type: string }).type === "openbb-auth",
    );
    expect(auth).toHaveLength(1);
    expect(auth[0][1]).not.toBe("*");
  });

  it("sends no headers when the message came from a different origin", async () => {
    render(<IframeRenderer url="https://embed.example/p" messaging={messaging()} />);
    await settle();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    send(win, { type: "openbb-connect" }, "https://evil.example");

    expect(postMessage.mock.calls.map(([m]) => (m as { type: string }).type)).not.toContain(
      "openbb-auth",
    );
  });

  it("sends no headers when the backend has none", async () => {
    render(<IframeRenderer url="https://embed.example/p" messaging={messaging({ headers: {} })} />);
    await settle();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    send(win, { type: "openbb-connect" }, "https://embed.example");

    expect(postMessage.mock.calls.map(([m]) => (m as { type: string }).type)).not.toContain(
      "openbb-auth",
    );
  });

  it("sends no headers to a frame whose src is this app's OWN origin", async () => {
    // The frame is refused allow-same-origin, so it has no
    // origin of its own to name -- and the renderer therefore hands the hook
    // no `src` at all, which is what makes the auth branch unreachable rather
    // than merely unsatisfied. Even a connect that reports the app's origin,
    // which such a frame genuinely would, gets nothing.
    const appOrigin = window.location.origin;
    render(<IframeRenderer url={`${appOrigin}/steal`} messaging={messaging()} />);
    await settle();
    const frame = screen.getByTitle("Embedded page");
    expect(frame.getAttribute("sandbox")).toBe(FRAME_SANDBOX);
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    const { win, postMessage } = stubFrame(frame);

    send(win, { type: "openbb-connect" }, appOrigin);

    expect(postMessage.mock.calls.map(([m]) => (m as { type: string }).type)).not.toContain(
      "openbb-auth",
    );
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("secret-value");
  });

  it("sends no headers to a connect that names the origin the frame has since left", async () => {
    const { rerender } = render(
      <IframeRenderer url="https://first.example/p" messaging={messaging()} />,
    );
    await settle();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    rerender(<IframeRenderer url="https://second.example/p" messaging={messaging()} />);
    await settle();
    // A connect still claiming the OLD origin: either a stale page or a
    // deliberate replay. The rule matches against the src the frame carries
    // NOW, so the old origin matches nothing.
    send(win, { type: "openbb-connect" }, "https://first.example");

    expect(postMessage.mock.calls.map(([m]) => (m as { type: string }).type)).not.toContain(
      "openbb-auth",
    );
  });

  it("answers a connect with the current params as well, addressed to the frame's origin", async () => {
    render(<IframeRenderer url="https://embed.example/p" messaging={messaging()} />);
    await settle();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    send(win, { type: "openbb-connect" }, "https://embed.example");

    // A cross-origin src frame has an origin of its own under
    // SRC_FRAME_SANDBOX, so the params post names it. "*" is for frames with
    // no origin -- srcdoc, and a src refused allow-same-origin -- and nothing
    // else.
    expect(postMessage).toHaveBeenCalledWith(
      { type: "openbb-params-update", params: { symbol: "AAPL" } },
      "https://embed.example",
    );
  });

  it("ignores a message from a window that is not this frame", async () => {
    const onParamsUpdate = vi.fn();
    render(
      <IframeRenderer url="https://embed.example/p" messaging={messaging({ onParamsUpdate })} />,
    );
    await settle();
    const { postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    // A second card's frame, or the top window itself: same origin, same
    // shape, different source. Nothing may cross between two framed cards.
    send({ postMessage: vi.fn() }, { type: "openbb-connect" }, "https://embed.example");
    send(
      { postMessage: vi.fn() },
      { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" },
      "https://embed.example",
    );

    expect(postMessage).not.toHaveBeenCalled();
    expect(onParamsUpdate).not.toHaveBeenCalled();
  });

  it("splits an inbound params update into declared and undeclared names", async () => {
    const onParamsUpdate = vi.fn();
    render(
      <IframeRenderer url="https://embed.example/p" messaging={messaging({ onParamsUpdate })} />,
    );
    await settle();
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    send(
      win,
      { type: "openbb:widget-params:update", params: { symbol: "MSFT", nonsense: 1 } },
      "https://embed.example",
    );

    expect(onParamsUpdate).toHaveBeenCalledWith({ symbol: "MSFT" }, ["nonsense"]);
  });

  it("accepts a params update from a frame whose origin does not match, since the source proves it", async () => {
    // The origin rule guards the CREDENTIAL and nothing else. A sandboxed
    // frame reports origin "null" in a real browser, so requiring a match
    // here would make the whole parameter path unreachable in production.
    const onParamsUpdate = vi.fn();
    render(
      <IframeRenderer url="https://embed.example/p" messaging={messaging({ onParamsUpdate })} />,
    );
    await settle();
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    send(win, { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" }, "null");

    expect(onParamsUpdate).toHaveBeenCalledWith({ symbol: "MSFT" }, []);
  });

  it("drops openbb-request and openbb-data, which are out of scope", async () => {
    const onParamsUpdate = vi.fn();
    render(
      <IframeRenderer url="https://embed.example/p" messaging={messaging({ onParamsUpdate })} />,
    );
    await settle();
    const { win, postMessage } = stubFrame(screen.getByTitle("Embedded page"));

    // Three of each: a page may push sub-widget data on a timer, and none of
    // it may reach the card.
    for (let i = 0; i < 3; i++) {
      send(win, { type: "openbb-request", id: i }, "https://embed.example");
      send(win, { type: "openbb-data", id: i }, "https://embed.example");
    }

    expect(onParamsUpdate).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("posts the params again when they change, and not before", async () => {
    const { rerender } = render(
      <IframeRenderer url="https://embed.example/p" messaging={messaging()} />,
    );
    await settle();
    const { postMessage } = stubFrame(screen.getByTitle("Embedded page"));
    expect(postMessage).not.toHaveBeenCalled();

    rerender(
      <IframeRenderer
        url="https://embed.example/p"
        messaging={messaging({ params: { symbol: "MSFT" } })}
      />,
    );

    expect(postMessage).toHaveBeenCalledWith(
      { type: "openbb-params-update", params: { symbol: "MSFT" } },
      "https://embed.example",
    );
  });

  it("stops listening once the card is gone", async () => {
    const onParamsUpdate = vi.fn();
    const { unmount } = render(
      <IframeRenderer url="https://embed.example/p" messaging={messaging({ onParamsUpdate })} />,
    );
    await settle();
    const { win } = stubFrame(screen.getByTitle("Embedded page"));

    unmount();
    send(win, { type: "openbb:widget-params:update", paramName: "symbol", value: "MSFT" }, "null");

    expect(onParamsUpdate).not.toHaveBeenCalled();
  });
});
