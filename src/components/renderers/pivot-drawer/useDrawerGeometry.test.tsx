// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useDrawerGeometry } from './useDrawerGeometry';
function Harness({ready=false}:{ready?:boolean}) {
 const root=useRef<HTMLDivElement>(null);const result=useDrawerGeometry(root,'arrange',.45,ready);
 return <div ref={root} className="geometry-root"><div className="pivot-splitter"/><div className="table-execution-layout"><div className="table-selection-controls"/><table><thead/><tbody>{ready?<tr><td>value</td></tr>:null}</tbody></table><div className="table-total-footer"/></div><button className="pivot-footer-strip"/><output>{result.mode}</output><span data-testid="body-height">{result.bodyH}</span></div>;
}
afterEach(()=>vi.restoreAllMocks());
function dimensions(height:number){vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const h=this.classList.contains('geometry-root')?height:this.classList.contains('pivot-footer-strip')?26:this.classList.contains('table-total-footer')?60:this.classList.contains('pivot-splitter')?6:this.classList.contains('table-selection-controls')?24:this.tagName==='THEAD'?40:this.tagName==='TR'?30:0;return {height:h,width:900,x:0,y:0,top:0,left:0,bottom:h,right:900,toJSON:()=>({})};});}
it('fills until real table rows are measured, then remeasures ready DOM without a container resize',()=>{
 dimensions(600);const view=render(<Harness/>);expect(screen.getByRole('status')).toHaveTextContent('fill');view.rerender(<Harness ready/>);expect(screen.getByRole('status')).toHaveTextContent('split');
});
it('reserves detached totals as well as the header and three rows',()=>{
 dimensions(300);render(<Harness ready/>);expect(screen.getByRole('status')).toHaveTextContent('fill');
});

it('uses the same totals-excluded height for the split percentage and fit policy',()=>{dimensions(600);render(<Harness ready/>);expect(screen.getByTestId('body-height')).toHaveTextContent('508');});

it('fills at the boundary where splitter and selection chrome leave fewer than three rows',()=>{dimensions(350);render(<Harness ready/>);expect(screen.getByRole('status')).toHaveTextContent('fill');});
