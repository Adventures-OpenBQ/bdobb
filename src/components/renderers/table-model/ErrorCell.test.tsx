// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ErrorCell } from './ErrorCell';
afterEach(cleanup);
it('renders the preserved scope code with an accessible original diagnostic',()=>{
 render(<ErrorCell error={{code:'scope',message:'Category member comparisons require aggregate scope.'}}/>);
 expect(screen.getByRole('img',{name:'Error: Category member comparisons require aggregate scope.'})).toHaveAttribute('data-error-code','scope');
});
