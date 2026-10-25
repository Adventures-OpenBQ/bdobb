// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { DashboardCard } from './types';
/** What a table card reads its rows from, as one comparable string; undefined for no card. */
export const cardSourceIdentity = (card: DashboardCard | undefined): string | undefined =>
    JSON.stringify(card && [card.widgetId, card.backendId, card.params, card.linkedSource, card.view, ...(card.managedSource ? [card.managedSource] : [])]);
