// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function LinkedParametersPortal({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  return target ? createPortal(children, target) : null;
}

export function OpenLinkedParameters({ onOpen }: { onOpen?: () => void }) {
  return onOpen ? <button type="button" className="linked-parameters-repair" onClick={onOpen}>Open Parameters</button> : null;
}
