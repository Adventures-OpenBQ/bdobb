// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from "node:child_process";

/** Registry packages in a crate's normal-dependency closure (build- and
 * dev-dependencies do not ship), as `cargo metadata` describes them. */
export function shippedCrates(manifestPath, cargoArgs = []) {
  const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", ...cargoArgs,
    "--manifest-path", manifestPath], { encoding: "utf8", maxBuffer: 1 << 28 }));
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const queue = [meta.resolve.root];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg);
    }
  }
  return [...seen].map((id) => byId.get(id)).filter((p) => p.source !== null);
}
