// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubMatchMedia } from "../test/matchMedia";
import { LONG_PRESS_MS, useLongPressContextMenu } from "./useLongPressContextMenu";

// jsdom reports no touch points; an iPad reports 5.
const touchPoints = (n: number) => Object.defineProperty(navigator, "maxTouchPoints", { value: n, configurable: true });
beforeEach(() => {
  vi.useFakeTimers();
  touchPoints(5);
});
afterEach(() => {
  vi.useRealTimers();
  delete (navigator as { maxTouchPoints?: number }).maxTouchPoints;
});

function Host({ onMenu, onClick }: { onMenu: (x: number, y: number) => void; onClick: () => void }) {
  useLongPressContextMenu();
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      Row
    </button>
  );
}

function PlainHost({ onClick }: { onClick: () => void }) {
  useLongPressContextMenu();
  return <button type="button" onClick={onClick}>Plain</button>;
}

// jsdom has no PointerEvent, and fireEvent's stand-in carries no clientX; a
// MouseEvent under the pointer name does, given the pointerType the hook reads.
const at = (type: string, el: Element, x: number, y: number, pointerType = "touch") => {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return el.dispatchEvent(event);
};

function mount() {
  const onMenu = vi.fn();
  const onClick = vi.fn();
  const { getByRole } = render(<Host onMenu={onMenu} onClick={onClick} />);
  return { row: getByRole("button"), onMenu, onClick };
}

describe("useLongPressContextMenu", () => {
  it("under touch, a held press opens the context menu where the finger is, and the lift closes nothing", () => {
    const { row, onMenu, onClick } = mount();
    // What RowContextMenu listens on to dismiss itself (seen on device: the
    // menu opened on the hold and the lift's mousedown closed it).
    const onWindowMouseDown = vi.fn();
    window.addEventListener("mousedown", onWindowMouseDown);

    at("pointerdown", row, 40, 90);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onMenu).toHaveBeenCalledWith(40, 90);

    // iOS's compatibility mouse events follow the touch's end.
    fireEvent.pointerUp(row);
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(onWindowMouseDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();

    // Only that one lift: the next tap is an ordinary tap.
    at("pointerdown", row, 40, 90);
    fireEvent.pointerUp(row);
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(onWindowMouseDown).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMenu).toHaveBeenCalledTimes(1);
    window.removeEventListener("mousedown", onWindowMouseDown);
  });

  it("after the lift's click, a keyboard click with no pointerdown goes through (U10)", () => {
    const { row, onClick } = mount();
    at("pointerdown", row, 40, 90);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerUp(row);
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();

    // Enter or Space on a focused control: a click, and nothing before it.
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("under touch, a slow tap on a button with no menu still clicks", () => {
    const onClick = vi.fn();
    const { getByRole } = render(<PlainHost onClick={onClick} />);
    const button = getByRole("button");

    at("pointerdown", button, 10, 10);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.pointerUp(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a lift, a move, or a drag before the hold ends is not a press", () => {
    const { row, onMenu, onClick } = mount();

    at("pointerdown", row, 40, 90);
    fireEvent.pointerUp(row);
    fireEvent.click(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));

    at("pointerdown", row, 40, 90);
    at("pointermove", row, 40, 120);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));

    at("pointerdown", row, 40, 90);
    fireEvent.dragStart(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));

    expect(onMenu).not.toHaveBeenCalled();
    // The tap's click went through untouched.
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a small wobble within the slop still counts as holding still", () => {
    const { row, onMenu } = mount();
    at("pointerdown", row, 40, 90);
    at("pointermove", row, 44, 95);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("a held mouse or trackpad press does nothing: right-click is the menu", () => {
    const { row, onMenu } = mount();
    at("pointerdown", row, 40, 90, "mouse");
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onMenu).not.toHaveBeenCalled();
  });

  it("on a device with no touch points, a held press does nothing", () => {
    touchPoints(0);
    const { row, onMenu } = mount();
    at("pointerdown", row, 40, 90);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onMenu).not.toHaveBeenCalled();
  });

  it("opens on an iPad whose media query claims a fine pointer, and the drag lift that follows is cancelled", () => {
    // Recorded on an iPad Pro 11-inch (M5), no keyboard or trackpad, held
    // still on a draggable rail row: (any-pointer: fine) matched, the press
    // was pointerType "touch", and at ~650 ms iOS sent a mousedown and a
    // dragstart with no movement. No pointercancel at all.
    const media = stubMatchMedia(true);
    const onWindowMouseDown = vi.fn();
    window.addEventListener("mousedown", onWindowMouseDown);
    const { row, onMenu } = mount();

    at("pointerdown", row, 72, 284);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onMenu).toHaveBeenCalledWith(72, 284);

    act(() => vi.advanceTimersByTime(150));
    fireEvent.mouseDown(row);
    const drag = new Event("dragstart", { bubbles: true, cancelable: true });
    row.dispatchEvent(drag);
    expect(onWindowMouseDown).not.toHaveBeenCalled();
    expect(drag.defaultPrevented).toBe(true);
    fireEvent.pointerUp(row);
    expect(onMenu).toHaveBeenCalledTimes(1);

    window.removeEventListener("mousedown", onWindowMouseDown);
    media.restore();
  });

  it("before the menu, a drag lift is still a drag", () => {
    const { row } = mount();
    at("pointerdown", row, 40, 90);
    const drag = new Event("dragstart", { bubbles: true, cancelable: true });
    row.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(false);
  });
});
