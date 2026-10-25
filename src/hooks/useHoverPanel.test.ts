// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoverPanel } from "./useHoverPanel";
import { stubMatchMedia, type MatchMediaStub } from "../test/matchMedia";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// onDragLeave reads relatedTarget/currentTarget off the event (see
// useHoverPanel.ts), so calls below stand in for a leave with nowhere
// related to go — e.g. off the panel entirely.
const dragLeaveEvent = () =>
  ({ relatedTarget: null, currentTarget: null }) as unknown as Parameters<
    ReturnType<typeof useHoverPanel>["handlers"]["onDragLeave"]
  >[0];

// 300ms is the hook's own collapse delay; the timer assertions below are
// written against it.
describe("useHoverPanel", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useHoverPanel());
    expect(result.current.open).toBe(false);
  });

  it("opens immediately on mouse enter", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    expect(result.current.open).toBe(true);
  });

  it("collapses only after the delay", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.handlers.onMouseLeave());

    act(() => void vi.advanceTimersByTime(299));
    expect(result.current.open).toBe(true);

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(false);
  });

  it("cancels a pending collapse when the pointer returns", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.handlers.onMouseLeave());
    act(() => void vi.advanceTimersByTime(200));
    act(() => result.current.handlers.onMouseEnter());
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.open).toBe(true);
  });

  it("close() collapses immediately", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it("opens on dragenter, because a drag suppresses mouseenter", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onDragEnter());
    expect(result.current.open).toBe(true);
  });

  it("collapses after dragleave on the same delay as the mouse", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onDragEnter());
    act(() => result.current.handlers.onDragLeave(dragLeaveEvent()));

    expect(result.current.open).toBe(true);
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current.open).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.open).toBe(false);
  });

  it("a dragenter cancels a pending mouseleave collapse", () => {
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    act(() => result.current.handlers.onMouseLeave());
    act(() => result.current.handlers.onDragEnter());
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current.open).toBe(true);
  });

  describe("with an enter delay", () => {
    it("stays closed until the delay has run", () => {
      const { result } = renderHook(() => useHoverPanel(500));
      act(() => result.current.handlers.onMouseEnter());
      expect(result.current.open).toBe(false);
      act(() => void vi.advanceTimersByTime(499));
      expect(result.current.open).toBe(false);
      act(() => void vi.advanceTimersByTime(1));
      expect(result.current.open).toBe(true);
    });

    it("cancels a pending open when the pointer leaves first", () => {
      // The whole point of the delay: crossing the rail on the way somewhere
      // else must not leave an open queued behind the pointer.
      const { result } = renderHook(() => useHoverPanel(500));
      act(() => result.current.handlers.onMouseEnter());
      act(() => void vi.advanceTimersByTime(200));
      act(() => result.current.handlers.onMouseLeave());
      act(() => void vi.advanceTimersByTime(1000));
      expect(result.current.open).toBe(false);
    });

    it("still opens on the enter event itself when the delay is 0", () => {
      const { result } = renderHook(() => useHoverPanel(0));
      act(() => result.current.handlers.onMouseEnter());
      expect(result.current.open).toBe(true);
    });
  });
});

let media: MatchMediaStub | null = null;

afterEach(() => {
  media?.restore();
  media = null;
});

/** A panel element with a text input inside it, mounted in the document. */
function panelWithInput(): { panel: HTMLDivElement; input: HTMLInputElement } {
  const panel = document.createElement("div");
  const input = document.createElement("input");
  input.type = "text";
  panel.appendChild(input);
  document.body.appendChild(panel);
  return { panel, input };
}

describe("useHoverPanel — touch dialect", () => {
  it("ignores hover entirely when the pointer is coarse", () => {
    media = stubMatchMedia(false);
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onMouseEnter());
    // iOS fires synthetic mouseenter on a tap. Honouring it would open the
    // panel on the tap that was meant to dismiss it.
    expect(result.current.open).toBe(false);
  });

  it("opens on tap when the pointer is coarse, and a second tap leaves it open", () => {
    // The second tap is what a row or checkbox inside the panel bubbles up.
    // Toggling here closed the rail under the finger using it.
    media = stubMatchMedia(false);
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onClick());
    expect(result.current.open).toBe(true);
    act(() => result.current.handlers.onClick());
    expect(result.current.open).toBe(true);
  });

  it("does not toggle on click when the pointer is fine", () => {
    media = stubMatchMedia(true);
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onClick());
    expect(result.current.open).toBe(false);
  });

  it("dismisses on a tap outside the panel", () => {
    media = stubMatchMedia(false);
    const { panel } = panelWithInput();
    const { result } = renderHook(() => useHoverPanel());
    act(() => {
      result.current.ref.current = panel;
      result.current.handlers.onClick();
    });
    expect(result.current.open).toBe(true);
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(result.current.open).toBe(false);
    panel.remove();
  });

  it("does not dismiss on a tap inside the panel", () => {
    media = stubMatchMedia(false);
    const { panel, input } = panelWithInput();
    const { result } = renderHook(() => useHoverPanel());
    act(() => {
      result.current.ref.current = panel;
      result.current.handlers.onClick();
    });
    act(() => {
      input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(result.current.open).toBe(true);
    panel.remove();
  });

  it("will not fold while a text input inside it has focus", () => {
    // The draft guard. The spec words this as a chat-pane exception; there is
    // no chat pane in this tree, so it is built one level up and any panel
    // holding an input gets it.
    media = stubMatchMedia(false);
    const { panel, input } = panelWithInput();
    const { result } = renderHook(() => useHoverPanel());
    act(() => {
      result.current.ref.current = panel;
      result.current.handlers.onClick();
    });
    input.focus();
    expect(document.activeElement).toBe(input);
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(result.current.open).toBe(true);
    panel.remove();
  });

  it("folds on an outside tap while a ticked checkbox inside still has focus, and drops that focus", () => {
    // A checkbox is an HTMLInputElement too, but a tap merely sets it: there
    // is no draft to guard. Treating it as one kept the documents rail open
    // against every outside tap -- and the focus it kept painted the rail
    // expanded through :focus-within even once `open` was false.
    media = stubMatchMedia(false);
    const { panel, input } = panelWithInput();
    input.type = "checkbox";
    const { result } = renderHook(() => useHoverPanel());
    act(() => {
      result.current.ref.current = panel;
      result.current.handlers.onClick();
    });
    input.focus();
    expect(document.activeElement).toBe(input);
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(result.current.open).toBe(false);
    expect(document.activeElement).not.toBe(input);
    panel.remove();
  });

  it("folds on an outside tap while an InlineRename field inside still has focus, and drops that focus", () => {
    // InlineRename commits on blur and reports an unchanged or blank commit
    // as a cancel, so an outside tap ends it rather than destroying a draft.
    // Guarding it was a trap: LeftRail pins the rail open with
    // `renamingId !== null` on top of `open`, so a rename left in progress
    // kept the rail expanded AND made the guard refuse every outside tap --
    // the rail could not be dismissed at all (seen on iPad). Letting the tap
    // through blurs the field, which clears `renamingId` and folds the rail.
    media = stubMatchMedia(false);
    const { panel, input } = panelWithInput();
    input.className = "inline-rename";
    const { result } = renderHook(() => useHoverPanel());
    act(() => {
      result.current.ref.current = panel;
      result.current.handlers.onClick();
    });
    input.focus();
    expect(document.activeElement).toBe(input);
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(result.current.open).toBe(false);
    expect(document.activeElement).not.toBe(input);
    panel.remove();
  });

  it("folds on an outside tap once the input is blurred", () => {
    media = stubMatchMedia(false);
    const { panel, input } = panelWithInput();
    const { result } = renderHook(() => useHoverPanel());
    act(() => {
      result.current.ref.current = panel;
      result.current.handlers.onClick();
    });
    input.focus();
    input.blur();
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(result.current.open).toBe(false);
    panel.remove();
  });

  it("a close() during a click wins over the tap-to-open the click bubbles to (U2)", async () => {
    media = stubMatchMedia(false);
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onClick());
    // A row's onClick closes; the same click then reaches the panel's onClick.
    act(() => {
      result.current.close();
      result.current.handlers.onClick();
    });
    expect(result.current.open).toBe(false);
    // Only for that event: the next tap opens again.
    await act(async () => {});
    act(() => result.current.handlers.onClick());
    expect(result.current.open).toBe(true);
  });

  it("opens on dragenter under touch too, since a drag is no synthetic tap (U11)", () => {
    media = stubMatchMedia(false);
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onDragEnter());
    expect(result.current.open).toBe(true);
  });

  it("removes the very listener it added when the panel closes", () => {
    media = stubMatchMedia(false);
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    const { result } = renderHook(() => useHoverPanel());
    act(() => result.current.handlers.onClick());
    const call = added.mock.calls.find(([type]) => type === "pointerdown");
    expect(call).toBeDefined();
    act(() => result.current.close());
    // Same handler, same capture flag: removing a different pair is a leak.
    expect(removed.mock.calls).toContainEqual(call);
    added.mockRestore();
    removed.mockRestore();
  });
});
