// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { legalAggregations } from '../../../lib/pivotConfig';
import type { FieldKind } from '../../../lib/pivotTable';
import { declaredKind } from '../../../lib/tableFiltering';
import type { TableModelV1 } from '../../../lib/tableModel/types';
import type { DatasetColumn } from '../../../lib/widgetData/types';
import type { InspectionResult } from '../../../lib/tableExecution/types';
/** Shared authoring policy; fallbackKind retains each surface's existing unknown-formula fallback. */
export function measureEligibility({model,columns,sourceFieldId,sourceInspection,fallbackKind}:{
  model:TableModelV1;columns:readonly DatasetColumn[];sourceFieldId:string;sourceInspection?:InspectionResult;fallbackKind?:FieldKind;
}) {
  const column=columns.find(column=>column.id===sourceFieldId);
  const columnKind:FieldKind=declaredKind(column?.dtype);
  const projected=sourceInspection?.definitionId===sourceFieldId?sourceInspection.rows[0]:undefined;
  const kind=projected?.kind==='formula'?projected.sourceFilterKind??fallbackKind??columnKind:columnKind;
  const dates=new Set(model.categories.filter(category=>category.transform!=='native'||category.legacyBucket).map(category=>category.sourceFieldId));
  const companies=new Set(model.categories.flatMap(category=>category.fiscalBinding?[category.fiscalBinding.companyFieldId]:[]));
  const chronology=dates.size===1&&companies.size<=1;
  return {chronology,operators:legalAggregations(kind,chronology)};
}
