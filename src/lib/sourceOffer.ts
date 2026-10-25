// Copyright 2026 SecretoftheUniverse.com LLC.
// SPDX-License-Identifier: AGPL-3.0-only
import manifest from '../../source-offer.json?raw';
import { validateSourceOffer } from './sourceOfferManifest.mjs';

export const sourceOffer = validateSourceOffer(JSON.parse(manifest));
export const SOURCE_CODE_LINK = {
  label: 'Source Code…',
  url: sourceOffer.archiveUrl,
  title: `Download the corresponding source for ${sourceOffer.release} (GNU AGPL v3).`,
};
