// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";
import { __resetSerializeForTests, __serializeChainCountForTests, serialize } from "./serialize";

/** A promise plus its resolver, so a test can hold a step open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A step is queued through `.then`, so it starts on a later microtask, never
 * synchronously. A macrotask hop drains every microtask already queued, which
 * is what makes "did NOT start" an assertion rather than a race.
 */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// Keys are module-global; the empty prefix matches every one of them.
beforeEach(() => __resetSerializeForTests(""));

describe("serialize", () => {
  it("runs steps sharing a key one after another, in call order", async () => {
    const order: string[] = [];
    const first = deferred();

    const a = serialize("k", async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
    });
    const b = serialize("k", async () => {
      order.push("b:start");
    });

    // b must not have started while a is still in flight.
    await settle();
    expect(order).toEqual(["a:start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("lets different keys run concurrently", async () => {
    const order: string[] = [];
    const held = deferred();

    const a = serialize("k1", async () => {
      order.push("k1:start");
      await held.promise;
    });
    const b = serialize("k2", async () => {
      order.push("k2:start");
    });

    await b;
    expect(order).toEqual(["k1:start", "k2:start"]);
    held.resolve();
    await a;
  });

  it("hands the caller its own result", async () => {
    await expect(serialize("k", async () => 42)).resolves.toBe(42);
  });

  it("hands the caller its own rejection", async () => {
    await expect(
      serialize("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("does not let a failed step poison the next one on the same key", async () => {
    const failed = serialize("k", async () => {
      throw new Error("boom");
    });
    const after = serialize("k", async () => "ran");

    await expect(failed).rejects.toThrow("boom");
    await expect(after).resolves.toBe("ran");
  });

  it("still orders a step queued behind a failing one", async () => {
    const order: string[] = [];
    const held = deferred();

    const failing = serialize("k", async () => {
      await held.promise;
      order.push("failed");
      throw new Error("boom");
    });
    const next = serialize("k", async () => {
      order.push("next");
    });

    await settle();
    expect(order).toEqual([]);
    held.resolve();
    await expect(failing).rejects.toThrow("boom");
    await next;
    expect(order).toEqual(["failed", "next"]);
  });

  it("drops a settled key rather than holding its resolved chain forever", async () => {
    const before = __serializeChainCountForTests();
    await serialize("k", async () => {});
    // The map is what this is about: a later call runs either way, so only
    // the entry count can tell a dropped key from a retained one.
    expect(__serializeChainCountForTests()).toBe(before);

    const held = deferred();
    const running = serialize("k", async () => {
      await held.promise;
    });
    expect(__serializeChainCountForTests()).toBe(before + 1);
    held.resolve();
    await running;
    expect(__serializeChainCountForTests()).toBe(before);
  });

  it("resets only the keys matching the prefix", async () => {
    const order: string[] = [];
    const held = deferred();

    const a = serialize("json:a", async () => {
      order.push("json:a");
      await held.promise;
    });
    const b = serialize("logger", async () => {
      order.push("logger:1");
      await held.promise;
    });
    await settle();

    __resetSerializeForTests("json:");

    // The logger's queue survived the reset, so this waits for the step
    // already in flight; a fresh json: step no longer does.
    const b2 = serialize("logger", async () => {
      order.push("logger:2");
    });
    const a2 = serialize("json:a", async () => {
      order.push("json:a2");
    });

    await a2;
    expect(order).toEqual(["json:a", "logger:1", "json:a2"]);
    held.resolve();
    await Promise.all([a, b, b2]);
    expect(order).toEqual(["json:a", "logger:1", "json:a2", "logger:2"]);
  });
});
