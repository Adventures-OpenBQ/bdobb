// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = (env) => { try { execFileSync("bash", ["scripts/rita-live-check.sh", "--self-check"], { env: { ...process.env, ...env }, stdio: "pipe" }); return 0; } catch (e) { return e.status; } };

it("fails when an endpoint is unreachable instead of skipping", () => {
  expect(run({ OPENBB_RITA_URL: "http://127.0.0.1:9", OPENBB_MCP_URLS: "http://127.0.0.1:9/mcp", OPENBB_BACKEND_URL: "http://127.0.0.1:9" })).not.toBe(0);
});
it("fails when OPENBB_BACKEND_URL is not set", () => {
  expect(run({ OPENBB_BACKEND_URL: "" })).not.toBe(0);
});
it("treats a report with skipped tests as a failure", () => {
  expect(run({ RITA_LIVE_REPORT_FIXTURE: JSON.stringify({ numTotalTests: 3, numPassedTests: 2, numPendingTests: 1, numFailedTests: 0 }) })).not.toBe(0);
});
it("accepts a fully passing report", () => {
  expect(run({ RITA_LIVE_REPORT_FIXTURE: JSON.stringify({ numTotalTests: 3, numPassedTests: 3, numPendingTests: 0, numFailedTests: 0 }) })).toBe(0);
});
it("treats a file that failed to load (0 tests collected from it) as a failure", () => {
  // A suite that throws at collect adds no tests, so the test counts alone read as green (seen live: real-endpoints).
  expect(run({ RITA_LIVE_REPORT_FIXTURE: JSON.stringify({ numTotalTests: 17, numPassedTests: 17, numPendingTests: 0, numFailedTests: 0, numFailedTestSuites: 1 }) })).not.toBe(0);
});

// Real loopback server: records what the script actually probed. Needs an unsandboxed shell (listen EPERM otherwise).
const runAsync = async (env) => { try { await promisify(execFile)("bash", ["scripts/rita-live-check.sh", "--self-check"], { env: { ...process.env, ...env } }); return 0; } catch (e) { return e.code; } };
async function withServer(fn) {
  const seen = [];
  const srv = createServer((req, res) => { seen.push({ url: req.url, auth: req.headers.authorization }); res.end("{}"); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, seen); } finally { srv.close(); }
}
const envFor = (base, mcp, extra = {}) => ({ OPENBB_RITA_URL: base, OPENBB_MCP_URLS: mcp, OPENBB_BACKEND_URL: base, OPENBB_NAS_AUTH: "", ...extra });

it("strips a leading id= from an MCP url entry", () => withServer(async (base, seen) => {
  expect(await runAsync(envFor(base, `openbq-mcp=${base}/mcp`))).toBe(0);
  expect(seen.map(s => s.url)).toContain("/mcp");
}));
it("keeps a bare url whose query contains '=' intact", () => withServer(async (base, seen) => {
  expect(await runAsync(envFor(base, `${base}/mcp?a=b=c`))).toBe(0);
  expect(seen.map(s => s.url)).toContain("/mcp?a=b=c");
}));
it("does not strip a prefix that is not a plain id", () => withServer(async (base) => {
  expect(await runAsync(envFor(base, `bad id=${base}/mcp`))).toBe(3);
}));
it("sends the Basic header single-line and correct for a long credential", () => withServer(async (base, seen) => {
  const auth = `user:${"p".repeat(120)}`;
  expect(await runAsync(envFor(base, `${base}/mcp`, { OPENBB_NAS_AUTH: auth }))).toBe(0);
  const hit = seen.find(s => s.url === "/widgets.json");
  expect(hit.auth).toBe(`Basic ${Buffer.from(auth).toString("base64")}`);
  expect(seen.find(s => s.url === "/mcp").auth).toBeUndefined();
}));

// Retry on RITA_LIVE_RETRY_MODEL: only the failed tests, matched by their full names.
const { retryPlan, retryPassed } = await import("./rita-live-retry.mjs");
const fileResult = (name, results, status = results.some((r) => r[1] === "failed") ? "failed" : "passed") =>
  ({ name, status, assertionResults: results.map(([fullName, s]) => ({ fullName, status: s })) });
const report = (testResults, extra = {}) => ({ numPendingTests: 0, numFailedTests: 0, numPassedTests: 0, testResults, ...extra });

it("plans a retry of exactly the failed tests, with an anchored name pattern", () => {
  const plan = retryPlan(report([
    fileResult("/a.test.ts", [["A moves/resizes (x)", "failed"], ["A other", "passed"]]),
    fileResult("/b.test.ts", [["B ok", "passed"]]),
    fileResult("/c.test.ts", [["C totals", "failed"]]),
  ], { numFailedTests: 2 }));
  expect(plan.files).toEqual(["/a.test.ts", "/c.test.ts"]);
  const re = new RegExp(plan.pattern);
  expect(re.test("A moves/resizes (x)")).toBe(true);
  expect(re.test("C totals")).toBe(true);
  expect(re.test("A other")).toBe(false);
  expect(re.test("A moves/resizes (x) and more")).toBe(false);
});
it("does not retry when tests were skipped or a file failed to load", () => {
  expect(retryPlan(report([fileResult("/a.test.ts", [["A", "failed"]])], { numPendingTests: 1 }))).toBeNull();
  expect(retryPlan(report([fileResult("/a.test.ts", [["A", "failed"]]), { name: "/b.test.ts", status: "failed", assertionResults: [] }]))).toBeNull();
});
it("passes the retry only when every failed test passed on it", () => {
  const plan = { names: ["A", "B"] };
  expect(retryPassed(plan, { numFailedTests: 0, numPassedTests: 2 })).toBe(true);
  expect(retryPassed(plan, { numFailedTests: 1, numPassedTests: 1 })).toBe(false);
  expect(retryPassed(plan, { numFailedTests: 0, numPassedTests: 1 })).toBe(false);
});
