// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Pure dashboard dependency validation, before allocating executors. */
export function validateGraph(nodes: {
  id: string;
  source?: string;
  producer?: boolean;
}[]): string[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (byId.size !== nodes.length)
    throw new Error('Duplicate table identity');
  const visiting = new Set<string>(), visited = new Set<string>(), order: string[] = [];
  function visit(id: string) {
    if (visiting.has(id))
      throw new Error(`Dependency cycle at ${id}; choose another source`);
    if (visited.has(id))
      return;
    const node = byId.get(id);
    if (!node)
      throw new Error(`Unknown source ${id}; choose a source in this dashboard`);
    visiting.add(id);
    if (node.source) {
      if (byId.get(node.source)?.producer === false)
        throw new Error(`Chart ${node.source} cannot be a table source; choose a table`);
      visit(node.source);
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }
  nodes.forEach(n => visit(n.id));
  return order;
}
