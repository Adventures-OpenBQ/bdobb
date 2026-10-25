// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardStore } from "../stores/dashboardStore";
import { useDashboardShortcuts } from "./useDashboardShortcuts";

function Harness({
  onOpenLibrary = () => {},
  onOpenHelp = () => {},
}: {
  onOpenLibrary?: () => void;
  onOpenHelp?: () => void;
}) {
  useDashboardShortcuts(onOpenLibrary, onOpenHelp);
  return <input aria-label="typing target" />;
}

/** ⌘? is ⌘⇧/ -- Shift is what makes the character. */
function pressCommandShift(code: string, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: code === "Slash" ? "?" : "R",
    code,
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** ⌘K / ⌘R: metaKey with the physical key code. */
function pressCommand(code: string, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: code === "KeyK" ? "k" : "r",
    code,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** Option+N: altKey with the physical digit code, not the produced character. */
function pressOptionDigit(digit: number, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", {
    // What macOS actually produces for Option+1.
    key: digit === 1 ? "¡" : "™",
    code: `Digit${digit}`,
    altKey: true,
    bubbles: true,
  });
  target.dispatchEvent(event);
}

/** Option+0, dispatched on `target` (a real keypress targets a descendant of window). */
function pressOptionZero(target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "º", code: "Digit0", altKey: true, bubbles: true }));
}

// A test below replaces refreshAll with a vi.fn() via setState. There is no
// vi.restoreAllMocks() in this file (it would not help anyway — that only
// reverts vi.spyOn spies), so the real action is captured once at module
// load and reinstated here before every test.
const REAL_ACTIONS = {
  refreshAll: useDashboardStore.getState().refreshAll,
};

beforeEach(() => {
  useDashboardStore.setState({
    ...REAL_ACTIONS,
    viewer: false,
    dashboards: [
      { id: "d1", name: "One", tabs: [{ id: "t1", name: "Main", cards: [] }] },
      { id: "d2", name: "Two", tabs: [{ id: "t2", name: "Main", cards: [] }] },
      { id: "d3", name: "Three", tabs: [{ id: "t3", name: "Main", cards: [] }] },
    ],
    activeId: "d1",
    activeTabId: "t1",
    previousId: null,
    maximizedCardId: null,
  });
});

describe("useDashboardShortcuts", () => {
  it("selects the Nth dashboard on Option+N", () => {
    render(<Harness />);
    pressOptionDigit(2);
    expect(useDashboardStore.getState().activeId).toBe("d2");
    pressOptionDigit(3);
    expect(useDashboardStore.getState().activeId).toBe("d3");
  });

  it("swaps back and forth between the last two dashboards on Option+0", () => {
    render(<Harness />);
    pressOptionDigit(2);

    pressOptionZero();
    expect(useDashboardStore.getState().activeId).toBe("d1");

    pressOptionZero();
    expect(useDashboardStore.getState().activeId).toBe("d2");
  });

  it("does nothing on Option+0 when there is no history", () => {
    render(<Harness />);
    pressOptionZero();
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("does nothing on Option+0 when the previous dashboard has been deleted", () => {
    useDashboardStore.setState({ previousId: "gone" });
    render(<Harness />);
    pressOptionZero();
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("clears the maximized card on Option+0, which is a dashboard switch like any other", () => {
    useDashboardStore.setState({ previousId: "d2", maximizedCardId: "c1" });
    render(<Harness />);
    pressOptionZero();
    // The maximized card is on the dashboard being left.
    expect(useDashboardStore.getState().activeId).toBe("d2");
    expect(useDashboardStore.getState().maximizedCardId).toBeNull();
  });

  it("keeps the maximized card on an Option+0 with no history to go back to", () => {
    useDashboardStore.setState({ maximizedCardId: "c1" });
    render(<Harness />);
    pressOptionZero();
    // Nothing was switched, so nothing is stale.
    expect(useDashboardStore.getState().maximizedCardId).toBe("c1");
  });

  it("does nothing when no dashboard exists at that position", () => {
    render(<Harness />);
    pressOptionDigit(9);
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("ignores a bare digit with no Option modifier", () => {
    render(<Harness />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", code: "Digit2", bubbles: true }),
    );
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
  ])("ignores Option+digit when %s is also held", (_label, extraKeys) => {
    render(<Harness />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "™",
        code: "Digit2",
        altKey: true,
        bubbles: true,
        ...extraKeys,
      }),
    );
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("ignores Option+key when the code is not a digit", () => {
    render(<Harness />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "å", code: "KeyA", altKey: true, bubbles: true }),
    );
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("ignores the shortcut while the user is typing in a field", () => {
    render(<Harness />);
    pressOptionDigit(2, screen.getByLabelText("typing target"));
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  // A modal covers the dashboard: ⌥N switched it out of sight, and ⌘K opened
  // the library invisibly behind the modal, where its capture listener then
  // swallowed the next Escape meant for the dialog.
  it("ignores every shortcut while a modal dialog is open", () => {
    const onOpenLibrary = vi.fn();
    const onOpenHelp = vi.fn();
    render(<Harness onOpenLibrary={onOpenLibrary} onOpenHelp={onOpenHelp} />);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    try {
      pressOptionDigit(2);
      pressCommand("KeyK");
      pressCommandShift("Slash");
    } finally {
      dialog.remove();
    }
    expect(useDashboardStore.getState().activeId).toBe("d1");
    expect(onOpenLibrary).not.toHaveBeenCalled();
    expect(onOpenHelp).not.toHaveBeenCalled();
  });

  // ⌘R behind a modal refreshed cards the user cannot see, but its
  // preventDefault must stand: in `vite --mode browser` the default is a
  // reload that discards the dialog's unsaved draft.
  it("refreshes nothing on Command+R while a modal dialog is open, but still stops the browser's reload", () => {
    const refreshAll = vi.fn();
    useDashboardStore.setState({ refreshAll });
    render(<Harness />);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    let prevented: boolean;
    try {
      prevented = pressCommand("KeyR").defaultPrevented;
    } finally {
      dialog.remove();
    }
    expect(refreshAll).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<Harness />);
    unmount();
    pressOptionDigit(2);
    expect(useDashboardStore.getState().activeId).toBe("d1");
  });

  it("opens the widget library on Command+K", () => {
    const onOpenLibrary = vi.fn();
    render(<Harness onOpenLibrary={onOpenLibrary} />);

    pressCommand("KeyK");

    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it("calls the CURRENT openLibrary, not the one captured when the listener was registered", () => {
    // App rebuilds openLibrary on every render. The listener is registered
    // once, with [] deps, so without a ref it would keep calling the very
    // first closure forever — and that closure's setLibraryTarget would
    // still work, which is exactly why this needs its own test.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onOpenLibrary={first} />);
    rerender(<Harness onOpenLibrary={second} />);

    pressCommand("KeyK");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores Command+K while the user is typing in a field", () => {
    const onOpenLibrary = vi.fn();
    render(<Harness onOpenLibrary={onOpenLibrary} />);

    pressCommand("KeyK", screen.getByLabelText("typing target"));

    expect(onOpenLibrary).not.toHaveBeenCalled();
  });

  it("refreshes every mounted card on Command+R", () => {
    const refreshAll = vi.fn();
    useDashboardStore.setState({ refreshAll });
    render(<Harness />);

    pressCommand("KeyR");

    expect(refreshAll).toHaveBeenCalledTimes(1);
  });

  it("ignores Command+R while the user is typing in a field", () => {
    const refreshAll = vi.fn();
    useDashboardStore.setState({ refreshAll });
    render(<Harness />);

    pressCommand("KeyR", screen.getByLabelText("typing target"));

    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("prevents the default for both Command shortcuts, so a real browser does not reload or open its own find bar", () => {
    // `vite --mode browser` runs this same handler in Chromium, where
    // Command+R reloads the page and throws the whole in-memory session
    // away. The shipped Tauri webview binds no reload accelerator, but the
    // browser-mode build is a first-class target here.
    useDashboardStore.setState({ refreshAll: vi.fn() });
    render(<Harness />);

    expect(pressCommand("KeyK").defaultPrevented).toBe(true);
    expect(pressCommand("KeyR").defaultPrevented).toBe(true);
  });

  it("leaves Command+Shift+R to the browser, which hard-reloads on it", () => {
    // ⌘⇧R is Chromium's hard reload, and `vite --mode browser` is a
    // first-class target: claiming it (and preventDefault-ing it) would take
    // a reload gesture away from the user for a refresh-all they did not ask
    // for. ⌘⇧K is likewise the browser console in several builds.
    const onOpenLibrary = vi.fn();
    const refreshAll = vi.fn();
    useDashboardStore.setState({ refreshAll });
    render(<Harness onOpenLibrary={onOpenLibrary} />);

    for (const code of ["KeyK", "KeyR"]) {
      const event = new KeyboardEvent("keydown", {
        key: code === "KeyK" ? "K" : "R",
        code,
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(onOpenLibrary).not.toHaveBeenCalled();
    expect(refreshAll).not.toHaveBeenCalled();
  });

  it("ignores a Command combination this app does not claim", () => {
    const onOpenLibrary = vi.fn();
    const refreshAll = vi.fn();
    useDashboardStore.setState({ refreshAll });
    render(<Harness onOpenLibrary={onOpenLibrary} />);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", code: "KeyC", metaKey: true, bubbles: true }),
    );

    expect(onOpenLibrary).not.toHaveBeenCalled();
    expect(refreshAll).not.toHaveBeenCalled();
  });

  describe("viewer mode", () => {
    beforeEach(() => {
      useDashboardStore.setState({ viewer: true });
    });

    it("leaves the active dashboard alone on Option+N, so the window stays pinned to the one its URL named", () => {
      render(<Harness />);

      pressOptionDigit(2);

      expect(useDashboardStore.getState().activeId).toBe("d1");
    });

    it("leaves it alone on Option+0 too", () => {
      useDashboardStore.setState({ previousId: "d2" });

      render(<Harness />);
      pressOptionZero();

      expect(useDashboardStore.getState().activeId).toBe("d1");
    });

    it("still refreshes every mounted card on Command+R", () => {
      const refreshAll = vi.fn();
      useDashboardStore.setState({ refreshAll });
      render(<Harness />);

      pressCommand("KeyR");

      expect(refreshAll).toHaveBeenCalledTimes(1);
    });
  });

  it("does not go to the previous dashboard when a capture-phase window listener stops propagation first (as WidgetLibrary's own Option+0 handler does)", () => {
    useDashboardStore.setState({ previousId: "d2" });

    // Mirrors WidgetLibrary's own keydown listener: registered with
    // { capture: true } and calling stopImmediatePropagation. A window
    // capture-phase listener always runs before this hook's plain
    // (bubble-phase) one, provided the event's real target is a descendant
    // of window rather than window itself -- dispatching straight on
    // `window` would collapse both into a single same-node phase ordered by
    // registration instead, which is not what a real keypress does.
    const captureHandler = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "Digit0") {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", captureHandler, { capture: true });

    try {
      render(<Harness />);
      pressOptionZero(document.body);
      expect(useDashboardStore.getState().activeId).toBe("d1");
    } finally {
      window.removeEventListener("keydown", captureHandler, { capture: true });
    }
  });
});

describe("Command+? opens Help", () => {
  it("calls onOpenHelp and prevents the default", () => {
    const onOpenHelp = vi.fn();
    render(<Harness onOpenHelp={onOpenHelp} />);

    const event = pressCommandShift("Slash");

    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing for Command+Slash without Shift", () => {
    const onOpenHelp = vi.fn();
    render(<Harness onOpenHelp={onOpenHelp} />);

    const event = new KeyboardEvent("keydown", {
      key: "/",
      code: "Slash",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onOpenHelp).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing inside a text field", () => {
    const onOpenHelp = vi.fn();
    render(<Harness onOpenHelp={onOpenHelp} />);

    pressCommandShift("Slash", screen.getByLabelText("typing target"));

    expect(onOpenHelp).not.toHaveBeenCalled();
  });

  it("leaves Command+Shift+R and Command+Shift+K to the browser", () => {
    // ⌘⇧R is Chromium's hard reload and ⌘⇧K its console, and `vite --mode
    // browser` runs this same handler there.
    const onOpenHelp = vi.fn();
    const onOpenLibrary = vi.fn();
    render(<Harness onOpenHelp={onOpenHelp} onOpenLibrary={onOpenLibrary} />);
    const refreshAll = vi.fn();
    useDashboardStore.setState({ refreshAll });

    const r = pressCommandShift("KeyR");
    const k = pressCommandShift("KeyK");

    expect(onOpenHelp).not.toHaveBeenCalled();
    expect(onOpenLibrary).not.toHaveBeenCalled();
    expect(refreshAll).not.toHaveBeenCalled();
    expect(r.defaultPrevented).toBe(false);
    expect(k.defaultPrevented).toBe(false);
  });

  it("works in a viewer window, where the Option shortcuts are inert", () => {
    useDashboardStore.setState({ viewer: true });
    const onOpenHelp = vi.fn();
    render(<Harness onOpenHelp={onOpenHelp} />);

    pressCommandShift("Slash");

    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });
});
