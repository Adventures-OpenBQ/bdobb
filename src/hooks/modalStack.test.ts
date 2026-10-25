// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { modalStack } from "./modalStack";

afterEach(() => { while (modalStack.top()) modalStack.remove(modalStack.top()!); });

describe("modalStack", () => {
  it("top() is the last pushed and remove() drops an entry from the middle", () => {
    const a = { close: () => {} };
    const b = { close: () => {} };
    modalStack.push(a);
    modalStack.push(b);
    expect(modalStack.top()).toBe(b);
    modalStack.remove(b);
    expect(modalStack.top()).toBe(a);
    modalStack.remove(a);
    expect(modalStack.top()).toBeUndefined();
  });
});
