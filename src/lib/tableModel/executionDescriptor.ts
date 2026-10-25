// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DatasetColumn } from '../widgetData/types';
import type { FiscalBinding } from './types';
/** Private worker execution metadata. Never serialized as authored analytical intent. */
export type AnalyticalExecutionDescriptor = {
    memberOrders: Record<string, string[]>;
    memberLabels: Record<string, Record<string, string>>;
    scopeMembers: { selectors: { categoryId: string; memberKey: string }[]; formulaId: string }[];
    outputMembers: {
        selectors: {
            categoryId: string;
            memberKey: string;
        }[];
        formulaId?: string;
        requireObserved?: boolean;
        format?: DatasetColumn["format"];
    }[];
    policy: {
        categoryId: string;
        dependentCategoryIds: string[];
        measureId: string;
        valueFieldId: string;
        members: Record<string, 'single' | 'flow' | 'stock' | 'formula'>;
        formulas: Record<string, string>;
        /** Template `required` per line member; an optional line's missing value is blank (#19). */
        required: Record<string, boolean>;
        periodKind: 'FY' | 'FQ';
        companyFieldId: string;
        currencyFieldId?: string;
        unitFieldId?: string;
        fiscal: FiscalBinding;
    };
    sourceColumnsByRowId?: Map<string, DatasetColumn>;
};
