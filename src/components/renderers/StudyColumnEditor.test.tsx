// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {StudyColumnEditor} from './StudyColumnEditor';
import {parseStudyCatalog} from '../../lib/studyColumns';
import {catalog} from '../../test/studyCatalog';
it('generates typed custom decorator parameters, validates bounds and keeps presentation points independent of period',()=>{const save=vi.fn();render(<StudyColumnEditor catalog={parseStudyCatalog(catalog)} onSave={save} onCancel={()=>{}}/>);fireEvent.change(screen.getByLabelText('Period'),{target:{value:'7'}});fireEvent.change(screen.getByLabelText('Sparkline points'),{target:{value:'120'}});fireEvent.click(screen.getByRole('button',{name:'Save study column'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({params:{period:7},points:120,presentation:'latest'}));fireEvent.change(screen.getByLabelText('Study'),{target:{value:'custom'}});expect(screen.getByLabelText('enabled')).toBeChecked();fireEvent.change(screen.getByLabelText('mode'),{target:{value:'two'}});fireEvent.change(screen.getByLabelText('factor'),{target:{value:'2.5'}});fireEvent.click(screen.getByRole('button',{name:'Save study column'}));expect(save).toHaveBeenLastCalledWith(expect.objectContaining({study:'custom',output:'value',params:{enabled:true,mode:'two',factor:2.5},points:120}));});
