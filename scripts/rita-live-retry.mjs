// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Live gate retry: picks the tests that failed on Rita's default model so rita-live-check.sh can rerun just those
// on RITA_LIVE_RETRY_MODEL, telling a free model's tool-choice miss from a real defect.
import { readFileSync } from "node:fs";

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The failed tests to rerun, or null when a skip or a file that failed to load makes a retry meaningless. */
export function retryPlan(report) {
  if (report.numPendingTests > 0 || (report.numTodoTests ?? 0) > 0) return null;
  const files = [];
  const names = [];
  for (const f of report.testResults ?? []) {
    const failed = (f.assertionResults ?? []).filter((a) => a.status === "failed");
    if (f.status === "failed" && failed.length === 0) return null; // failed to load
    if (failed.length === 0) continue;
    files.push(f.name);
    names.push(...failed.map((a) => a.fullName));
  }
  if (names.length === 0) return null;
  return { files, names, pattern: `^(?:${names.map(escape).join("|")})$` };
}

/** True when the retry ran every failed test and all of them passed. */
export const retryPassed = (plan, report) => report.numFailedTests === 0 && report.numPassedTests === plan.names.length;

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...paths] = process.argv.slice(2);
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  if (cmd === "plan") {
    const plan = retryPlan(read(paths[0]));
    if (!plan) process.exit(1);
    console.log(JSON.stringify(plan));
  } else if (cmd === "verdict") {
    const plan = JSON.parse(paths[0]);
    const report = read(paths[1]);
    const model = paths[2];
    const ok = retryPassed(plan, report);
    console.error(`live gate retry on ${model}: ${report.numPassedTests}/${plan.names.length} passed${ok ? "" : `, ${report.numFailedTests} failed`}`);
    for (const n of plan.names) console.error(`  ${ok ? "passed only on retry" : "retried"}: ${n}`);
    process.exit(ok ? 0 : 1);
  } else {
    console.error("usage: rita-live-retry.mjs plan <report.json> | verdict <plan-json> <report.json> <model>");
    process.exit(2);
  }
}
