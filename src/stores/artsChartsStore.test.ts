// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { useArtsChartsStore } from "./artsChartsStore";

it("bumps the epoch, holds an inbox focus and a fresh reveal nonce each time", () => {
  const s = useArtsChartsStore.getState();
  const e = s.epoch;
  s.bump();
  expect(useArtsChartsStore.getState().epoch).toBe(e + 1);
  s.focusInbox("0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d");
  expect(useArtsChartsStore.getState().focusItem).toBe("0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d");
  s.revealCard("card-1");
  const first = useArtsChartsStore.getState().reveal!;
  s.revealCard("card-1");
  expect(useArtsChartsStore.getState().reveal!.nonce).toBeGreaterThan(first.nonce);
});
