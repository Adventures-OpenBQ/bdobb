// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

declare module 'plotly.js/src/traces/treemap/partition.js' {
  export interface TreemapRectangle {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  }

  interface PartitionNode extends TreemapRectangle {
    value: number;
    depth: number;
    children?: PartitionNode[];
    eachBefore(visit: (node: PartitionNode) => void): void;
  }

  export default function partition(
    root: PartitionNode,
    size: [number, number],
    options: {
      packing: 'slice-dice';
      pad: { inner: number; left: number; right: number; top: number; bottom: number };
    },
  ): void;
}
