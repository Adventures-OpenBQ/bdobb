// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll } from "vitest";

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 28;

/**
 * jsdom has no layout, so @tanstack/react-virtual sizes its viewport to zero
 * and the virtualised table renders ZERO rows. A test file that renders a real
 * TableRenderer (directly or through LiveGridRenderer) calls this at module
 * scope to install the three stubs the virtualiser needs -- offsetHeight for
 * the viewport, a fixed row getBoundingClientRect for measureElement, and a
 * scrollTo that actually moves scrollTop and fires the scroll event -- and to
 * restore them afterwards. Mirrors the stubs TableRenderer.test.tsx installs.
 */
export function installVirtualizerDom(): void {
  let realOffsetHeight: PropertyDescriptor | undefined;
  let realRowRect: typeof HTMLTableRowElement.prototype.getBoundingClientRect;
  let realScrollTo: typeof HTMLElement.prototype.scrollTo;

  beforeAll(() => {
    realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => VIEWPORT_HEIGHT,
    });

    realRowRect = HTMLTableRowElement.prototype.getBoundingClientRect;
    HTMLTableRowElement.prototype.getBoundingClientRect = () =>
      ({
        height: ROW_HEIGHT,
        width: 800,
        top: 0,
        left: 0,
        right: 800,
        bottom: ROW_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    realScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = function (this: HTMLElement, ...args: unknown[]) {
      const first = args[0] as number | { top?: number } | undefined;
      this.scrollTop = typeof first === "number" ? Number(args[1] ?? 0) : (first?.top ?? 0);
      this.dispatchEvent(new Event("scroll"));
    } as typeof HTMLElement.prototype.scrollTo;
  });

  afterAll(() => {
    if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
    HTMLTableRowElement.prototype.getBoundingClientRect = realRowRect;
    HTMLElement.prototype.scrollTo = realScrollTo;
  });
}
