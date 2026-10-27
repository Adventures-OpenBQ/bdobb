// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1
/**
 * bdobb-v2's logger API over the host's `log`. Ordered and never-throwing as
 * the original (one serialize chain; a failed write is swallowed);
 * `reportError` and `logOnce` are copied verbatim from caca7d87:src/lib/logger.ts.
 */
import { getHost } from "../host";
import { __resetSerializeForTests, serialize } from "./serialize";

const QUEUE_KEY = "logger";
const onceKeys = new Set<string>();

function write(level: "info" | "error", message: string): Promise<void> {
  return serialize(QUEUE_KEY, async () => {
    await getHost().log(level, message);
  }).catch(() => {});
}

export function logInfo(message: string): Promise<void> {
  return write("info", message);
}

export function logError(message: string): Promise<void> {
  return write("error", message);
}

/** Logs a rejection as `what: message` and settles; the promise handed back never rejects. */
export function reportError(what: string, p: Promise<unknown>): Promise<void> {
  return p.then(
    () => undefined,
    (err) => logError(`${what}: ${err instanceof Error ? err.message : String(err)}`),
  );
}

/** Once-per-session notices — never once per render. */
export function logOnce(key: string, message: string): Promise<void> {
  if (onceKeys.has(key)) return Promise.resolve();
  onceKeys.add(key);
  return write("info", message);
}

export function __resetLoggerForTests(): void {
  __resetSerializeForTests(QUEUE_KEY);
  onceKeys.clear();
}
