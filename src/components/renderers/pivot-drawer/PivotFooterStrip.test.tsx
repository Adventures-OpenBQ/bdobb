// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PivotFooterStrip } from './PivotFooterStrip';
import { clearDrawerDashboard, getDrawerState, setDismissOnOutside } from '../../../stores/pivotDrawerStore';
afterEach(()=>act(()=>clearDrawerDashboard('footer')));
it('opens Arrange from Edit and respects outside preference while Show table always closes',()=>{
 const view=render(<PivotFooterStrip dashboardId="footer" widgetId="card" summary="Rows: Region" tableHidden={false}/>);fireEvent.click(screen.getByRole('button',{name:/Edit/}));expect(getDrawerState('footer','card')).toMatchObject({open:true,active:'arrange'});
 act(()=>setDismissOnOutside('footer','card',false));fireEvent.click(screen.getByRole('button',{name:/Close/}));expect(getDrawerState('footer','card').open).toBe(true);
 view.rerender(<PivotFooterStrip dashboardId="footer" widgetId="card" summary="Rows: Region" tableHidden/>);fireEvent.click(screen.getByRole('button',{name:/Show table/}));expect(getDrawerState('footer','card')).toMatchObject({open:false,returnFocus:'table'});
 expect(screen.getByRole('button').querySelector('button')).toBeNull();
});
