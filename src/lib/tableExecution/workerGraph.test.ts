// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The table worker has no `window` and no Tauri bridge. A static import that
// reaches the logger (plugin-fs shim), @tauri-apps/* or the browser shim breaks
// it at load ("window is not defined"). Dynamic import() is allowed on purpose.
const SRC = resolve(__dirname, "../..");
const ENTRY = join(SRC, "lib/tableExecution/table.worker.ts");
const STATIC_IMPORT = /\b(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;

function resolveModule(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  throw new Error(`cannot resolve ${spec} from ${relative(SRC, from)}`);
}

/** Every reachable file and bare specifier, each with the chain that reached it. */
function walk(entry: string): { files: Map<string, string[]>; bare: Map<string, string[]> } {
  const files = new Map<string, string[]>([[entry, [relative(SRC, entry)]]]);
  const bare = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    const chain = files.get(file)!;
    for (const m of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
      const spec = m[1];
      if (!spec.startsWith(".")) {
        if (!bare.has(spec)) bare.set(spec, [...chain, spec]);
        continue;
      }
      const next = resolveModule(file, spec);
      if (!files.has(next)) {
        files.set(next, [...chain, relative(SRC, next)]);
        queue.push(next);
      }
    }
  }
  return { files, bare };
}

describe("table.worker static import graph", () => {
  const { files, bare } = walk(ENTRY);

  it("walks the real graph", () => {
    expect(files.size).toBeGreaterThan(5);
  });

  it("never reaches the logger", () => {
    const hits = [...files].filter(([f]) => /(^|\/)lib\/logger[^/]*$/.test(relative(SRC, f))).map(([, c]) => c.join(" -> "));
    expect(hits).toEqual([]);
  });

  it("never reaches @tauri-apps/* or the browser shim", () => {
    const tauri = [...bare].filter(([s]) => s.startsWith("@tauri-apps/")).map(([, c]) => c.join(" -> "));
    const shim = [...files].filter(([f]) => relative(SRC, f).startsWith("browser-shim/")).map(([, c]) => c.join(" -> "));
    expect([...tauri, ...shim]).toEqual([]);
  });
});
