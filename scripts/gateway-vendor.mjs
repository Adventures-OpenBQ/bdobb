#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * pnpm gateway:vendor <openbb-docker tag>
 *
 * Copies the stack's route contract (funnel-gateway/policy.mjs at that tag) into
 * web/policy.mjs, verbatim, under a header that names the tag and the SHA-256 of
 * the body, and records both in web/policy.vendored.json. web/security.test.mjs
 * proves the copy is intact and the tag is at or below the paired stack tag.
 * The contract is the stack's; this side never edits it -- to change what the
 * door admits, change the stack and vendor the new tag.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) { console.error("usage: pnpm gateway:vendor vX.Y.Z"); process.exit(2); }
const OD = process.env.OPENBB_DOCKER_DIR ?? join(homedir(), "Developer", "openbb-docker");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const body = execFileSync("git", ["-C", OD, "show", `${tag}:funnel-gateway/policy.mjs`], { encoding: "utf8" });
const sha256 = createHash("sha256").update(body).digest("hex");
writeFileSync(join(ROOT, "web", "policy.mjs"), `// vendored from openbb-docker ${tag} funnel-gateway/policy.mjs sha256:${sha256}\n${body}`);
writeFileSync(join(ROOT, "web", "policy.vendored.json"), JSON.stringify({ tag, sha256 }, null, 2) + "\n");
console.log(`web/policy.mjs <- openbb-docker ${tag} funnel-gateway/policy.mjs (${sha256})`);
