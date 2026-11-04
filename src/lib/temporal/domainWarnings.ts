// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** Source-domain limits survive complete query exhaustion, including empty results. */
export function temporalDomainWarnings(versions:Readonly<Record<string,unknown>>):string[]{
 return Object.keys(versions).some(key=>key==='sip_archive.ObservedSlice'||key==='gold.sip_archive.ObservedSlice')
  ?['SIP inspection only: sampled partition; unmatched originals remain retained diagnostics. Complete result loading does not establish complete source coverage, enterprise security identity or canonical tick eligibility.']
  :[];
}
