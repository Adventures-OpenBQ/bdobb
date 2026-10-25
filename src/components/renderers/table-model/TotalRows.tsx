// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { ErrorCell } from './ErrorCell';
import type { CSSProperties } from 'react';
import type { DatasetCellError } from '../../../lib/widgetData/types';
export type TotalColumn = { id: string; label: string; style?: CSSProperties; pin?: false | 'left' | 'right' };
/** Presentation-only footer. It never offers selection or contributes report records. */
export function TotalRows({ columns, values, cellErrors, format, label = 'Grand total · Surviving groups', selectionGutter, selectionGutterWidth = 32, empty }: {
  columns: TotalColumn[]; values: Record<string, unknown>; cellErrors?: Record<string, DatasetCellError>;
  format: (value: unknown, id: string) => string; label?: string; selectionGutter?: boolean; selectionGutterWidth?: number; empty?: boolean;
}) {
  return <tfoot aria-label={label}><tr>{selectionGutter ? <td className="selection-cell pin-left" style={{left:0,width:selectionGutterWidth,minWidth:selectionGutterWidth,maxWidth:selectionGutterWidth}} aria-hidden="true" /> : null}
    {empty && columns.length===0 ? <td>No eligible data</td> : null}
    {columns.map((column,i) => {
      const error = cellErrors && Object.hasOwn(cellErrors,column.id) ? cellErrors[column.id] : undefined;
      return <td key={column.id} data-field={column.id} className={[column.pin ? `pin-${column.pin}` : undefined,column.pin === "left" && !columns.slice(i+1).some(c=>c.pin === "left") ? "pin-left-last" : undefined,error ? "cell-error" : undefined].filter(Boolean).join(" ") || undefined} style={column.style}
        title={error ? `${error.code}: ${error.message}` : undefined}
        aria-label={`${column.label} total${error ? `: ${error.code}: ${error.message}` : ''}`}>
        {empty ? i===0 ? 'No eligible data' : '' : error ? <ErrorCell error={error} /> : format(Object.hasOwn(values,column.id) ? values[column.id] : undefined,column.id)}
      </td>;
    })}
  </tr></tfoot>;
}
