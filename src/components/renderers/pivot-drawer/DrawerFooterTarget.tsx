// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
/** Each mounted section owns its target; editor state remains in its body. */
export const DrawerFooterTarget = createContext<HTMLElement | null>(null);
/** A section's actions: portalled into the drawer footer when there is one, else inline (in `inline`'s wrapper, if given). */
export function DrawerFooterActions({ inline, children }: { inline?: string; children: ReactNode }) {
    const target = useContext(DrawerFooterTarget);
    if (target) return createPortal(children, target);
    return inline ? <div className={inline}>{children}</div> : <>{children}</>;
}
