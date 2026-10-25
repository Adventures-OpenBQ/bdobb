#!/usr/bin/env node
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * pnpm gateway:vendor <openbq-docker tag> [<commit>]
 *
 * Copies the stack's route contract (funnel-gateway/policy.mjs) into
 * web/policy.mjs, verbatim, under a header that names the tag and the SHA-256 of
 * the body, and records both in web/policy.vendored.json. web/security.test.mjs
 * proves the copy is intact and that it pairs with package.json's `openbqDocker`.
 * It also writes web/ssrm-routes.vendored.json, the stack's SSRM route list as door
 * paths; web/ssrm-routes.test.mjs holds SSRM_ROUTES_JSON equal to it.
 * The contract is the stack's; this side never edits it -- to change what the
 * door admits, change the stack and vendor it again.
 *
 * With a tag alone the file is read at that tag. With a commit as well (the
 * stack's release branch before its tag exists), it is read at that commit, the
 * header still names the tag the branch becomes, and the commit is recorded so
 * the test can hold it to the paired commit. Vendor again from the tag once it
 * is cut.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [tag, commit] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "") || (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit))) {
  console.error("usage: pnpm gateway:vendor vX.Y.Z [<40-hex commit>]"); process.exit(2);
}
// OPENBQ_DOCKER_DIR is preferred; OPENBB_DOCKER_DIR (the older name) still works.
const OD = process.env.OPENBQ_DOCKER_DIR ?? process.env.OPENBB_DOCKER_DIR ?? join(homedir(), "Developer", "openbq-docker");
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const body = execFileSync("git", ["-C", OD, "show", `${commit ?? tag}:funnel-gateway/policy.mjs`], { encoding: "utf8" });
const revision = execFileSync("git", ["-C", OD, "rev-parse", `${commit ?? tag}^{commit}`], { encoding: "utf8" }).trim();
const repository = "https://github.com/Adventures-OpenBQ/openbq-docker";
const sha256 = createHash("sha256").update(body).digest("hex");
writeFileSync(join(ROOT, "web", "policy.mjs"), `// vendored from openbq-docker ${tag} funnel-gateway/policy.mjs sha256:${sha256}\n${body}`);
writeFileSync(join(ROOT, "web", "policy.vendored.json"),
  JSON.stringify({ tag, commit: revision, repository, path: "funnel-gateway/policy.mjs", sha256 }, null, 2) + "\n");
// The stack's SSRM routes (lanes/ssrm_widgets.json) as door paths, so SSRM_ROUTES_JSON can be held equal to them.
const widgets = JSON.parse(execFileSync("git", ["-C", OD, "show", `${commit ?? tag}:lanes/ssrm_widgets.json`], { encoding: "utf8" }));
writeFileSync(join(ROOT, "web", "ssrm-routes.vendored.json"), JSON.stringify(widgets.map(w => `/api${w.route}/ssrm`), null, 2) + "\n");
console.log(`web/policy.mjs <- openbq-docker ${commit ?? tag} funnel-gateway/policy.mjs as ${tag} (${sha256})`);
