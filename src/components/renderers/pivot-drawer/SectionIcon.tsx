// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { DrawerSection } from './drawerState';
// Section artwork ported verbatim from the supplied prototype.
export function SectionIcon({section}:{section:DrawerSection}) {
 switch(section){
 case 'arrange':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/><path d="M1.5 5.5h13M5.5 1.5v13"/></svg>;
 case 'categories':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 3h5v4H2zM9 3h5v4H9zM2 9h5v4H2zM9 9h5v4H9z"/></svg>;
 case 'measures':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 13V8M8 13V3M13 13V6" strokeLinecap="round"/></svg>;
 case 'statement':
 case 'pages':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2h6l3 3v9H4z"/><path d="M10 2v3h3"/></svg>;
 case 'formulas':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10.5 2.5c-1.5-.5-2.5.3-2.8 2L6.3 12c-.3 1.6-1.3 2.2-2.8 1.7M5 6.5h5" strokeLinecap="round"/></svg>;
 case 'checklists':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4l1.5 1.5L6 3M2 10l1.5 1.5L6 9M8 4.5h6M8 10.5h6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
 case 'resultFilters':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6z" strokeLinejoin="round"/></svg>;
 // Saved: the model's saved definitions and its Statement template share one tab.
 case 'inspect':return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2h8v12l-4-3-4 3z" strokeLinejoin="round"/></svg>;
 }
}
