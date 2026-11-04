// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type {DatasetColumn} from '../widgetData/types';
const inspection=(versions:Readonly<Record<string,unknown>>)=>Object.keys(versions).some(key=>key==='sip_archive.ObservedSlice'||key==='gold.sip_archive.ObservedSlice');
/** Inspection values are evidence: preserve clock text, zone markers and identifiers. */
export function temporalColumnFormat(versions:Readonly<Record<string,unknown>>):DatasetColumn['format']{
 return inspection(versions)?{formatterFn:'none'}:undefined;
}
/** Source-domain limits survive complete query exhaustion, including empty results. */
export function temporalDomainWarnings(versions:Readonly<Record<string,unknown>>):string[]{
 return inspection(versions)
  ?['SIP inspection only: sampled partition; unmatched originals remain retained diagnostics. Complete result loading does not establish complete source coverage, enterprise security identity or canonical tick eligibility.']
  :[];
}
