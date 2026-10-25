// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PivotSplitter } from './PivotSplitter';
afterEach(()=>vi.unstubAllGlobals());
it('supports keyboard bounds and two-percent resizing',()=>{
 const change=vi.fn();render(<PivotSplitter bodyH={500} splitPct={.45} onChange={change}/>);const separator=screen.getByRole('separator');
 fireEvent.keyDown(separator,{key:'Home'});expect(change).toHaveBeenLastCalledWith(.18);fireEvent.keyDown(separator,{key:'End'});expect(change).toHaveBeenLastCalledWith(.92);fireEvent.keyDown(separator,{key:'ArrowDown'});expect(change.mock.calls.at(-1)?.[0]).toBeCloseTo(.47);
 expect(separator).toHaveAttribute('aria-orientation','horizontal');
});
it('captures pointer drag and stops resizing when pointer capture is lost',()=>{
 vi.stubGlobal('PointerEvent',MouseEvent);const change=vi.fn();render(<PivotSplitter bodyH={200} splitPct={.45} onChange={change}/>);const separator=screen.getByRole('separator');
 separator.setPointerCapture=vi.fn();separator.hasPointerCapture=()=>false;
 fireEvent.pointerDown(separator,{button:0,clientY:10});fireEvent.pointerMove(separator,{clientY:30});expect(change).toHaveBeenLastCalledWith(.55);
 fireEvent(separator,new Event('lostpointercapture',{bubbles:true}));fireEvent.pointerMove(separator,{clientY:100});expect(change).toHaveBeenCalledTimes(1);
});
