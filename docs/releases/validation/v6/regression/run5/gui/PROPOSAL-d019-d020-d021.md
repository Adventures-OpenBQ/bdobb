# Fix proposal: D-019, D-020, D-021 (run 5 GUI findings)

Status: **proposal for approval — no product code changed.** Traced 2026-10-09
against `codex/clean-v4-integration` 8e91662, `codex/clean-v5-reconciled`
c7836fd and `codex/clean-v6` 98698a3. All three root causes were reproduced
by failing unit tests in a throwaway worktree. The prototype fix (6 files,
+34/−11) makes them pass. Typecheck and lint are clean. The full v6 unit
suite has 6838 passed and 1 failed, and that one failure is the
deliberately changed assertion listed under D-019. The scratch worktrees
have been removed.

Home lines were checked against each ref's tree with `git show ref:path`.
v3 (`bdobb-clean-v3-repair` c944889, tag v3.0.0) has none of the affected
code, so no v3 work is needed. `codex/clean-v4` (93bf263) is a v3 snapshot
and doesn't ship these features either.

| Defect | Home line | Files on the home line | Carry |
|---|---|---|---|
| D-019, worker Default-view export | v4 `codex/clean-v4-integration` | `src/lib/export.ts` | v5, v6 |
| D-019, Statement-view export | v5 `codex/clean-v5-reconciled` | `src/lib/statementPresentation.ts` (it first appears in v5, 8988979) | v6 |
| D-020 | v4 | `TableFilterRow.tsx`, `LocalTableRenderer.tsx` | v5, v6 |
| D-021 | v4 | `export.ts`, `tableModel/calculate.ts` | v5, v6 |

## D-019: exports drop the reason behind `#ERROR`

**Root cause.** Every presented cell error already carries its reason as
`row.cellErrors[col].message`. That is where the on-screen tooltip gets it
(`StatementRenderer.tsx:65`). The export paths write the literal and throw
the message away:
- Statement view (v5): `statementPresentation.ts:83` (template statements) and
  `:97` (generic statements) put `'#ERROR'` into `StatementRows.rows`. Those
  rows are used only by export (`WidgetCard.tsx:545`); the renderer reads
  `sections`.
- Worker Default view (v4): `export.ts:67` reads `r.values[c.id]`, which
  `calculate.ts:376` sets to `'#ERROR'`, and it never looks at `r.cellErrors`.
  The same defect is on v4 for any formula error, not only for Statement
  templates.

**What the export should contain. Recommendation: inline `"#ERROR: <reason>"`
in the same cell.**
- All three writers (`toCsv`, `toJsonRows`, `toXlsx`) take the same rows, so
  a single change gives an identical result in CSV, JSON and XLSX.
- The shape stays the same. A sibling column would add one column per period
  to a wide statement and change the header contract. A JSON
  `{error, reason}` object would make JSON differ from CSV and XLSX and turn a
  scalar cell into an object.
- The cell is already text (bare `#ERROR`), so nothing that reads it as
  numeric gets worse. A leading `#` isn't a spreadsheet formula trigger, and
  a reason that contains a comma gets RFC 4180 quoting.
- Example: `Profit,Calculated gross profit,"#ERROR: Mixed currency contexts cannot be combined in a derived Statement value."`

**Fix sketch.**
```diff
 // src/lib/export.ts
+/** A calculation error exports with the reason the cell shows on screen (V5-005). */
+export const errorCell = (error: { message: string }) => `#ERROR: ${error.message}`;
 ...
-      read: (r) => (Object.hasOwn(r.values, c.id) ? (r.values[c.id] ?? null) : null),
+      read: (r) => (r.cellErrors && Object.hasOwn(r.cellErrors, c.id) ? errorCell(r.cellErrors[c.id])
+        : Object.hasOwn(r.values, c.id) ? (r.values[c.id] ?? null) : null),
 // src/lib/statementPresentation.ts (v5): lines 83 and 97
-  [header, item.errors?.[index] ? '#ERROR' : item.values[index]]
+  [header, item.errors?.[index] ? errorCell(item.errors[index]) : item.values[index]]
```

**Tests.** There are two. The first projects a Statement row whose
`cellErrors` holds the mixed-currency reason and expects the cell
`#ERROR: Mixed currency…` in the projected rows and in the CSV. The second
calls `presentedForExport` on a row with `cellErrors` and expects the same in
the rows and in the JSON. Both fail now (`Received: "#ERROR"`) and pass with
the fix.

**Changed existing assertion (needs your OK).** `src/lib/statementExecution.test.ts:75`
pins the bare `'#ERROR'` in the export rows. It becomes
`'#ERROR: Upstream calculation refused this value'`.

## D-020: Input filters lose or reorder keystrokes

**Root cause.** `SourceFilterPanel` binds each input to the *saved*
definition (`LocalTableRenderer.tsx:334` on v4, `:331` on v6:
`filters={view.definition.table.columnFilters}`). Each keystroke calls
`patch()`, and that starts an asynchronous `replaceDefinition` save followed
by a re-execution. Three things then go wrong:
1. Until the save publishes, the controlled input gets the old value back, so
   React resets what's in the field.
2. The panel is passed `readonly={locked}`, and `locked` includes
   `definitionPending` and `view.status==='updating'`
   (`LocalTableRenderer.tsx:261`). The whole `<fieldset>`
   (`TableFilterRow.tsx:124`) is therefore disabled for the length of every
   save, and keys typed during that time are lost.
3. A second save started while one is pending is refused with `'busy'`
   (`tableCommitCoordinator.ts:170`), and `patch` discards the outcome.

Pasting works because it is one change event. Other text inputs work because
they hold local state.

**Fix sketch.** The panel keeps a local draft of typed values. A draft is
saved after a 250 ms pause, and only while nothing is pending. A draft is
dropped once the saved definition matches it. The inputs are disabled only
for a viewer or a view error, not while a save is pending.
```diff
 // TableFilterRow.tsx, SourceFilterPanel
+ busy=false  (new prop)
+ const [draft,setDraft]=useState(()=>new Map<string,unknown>());
+ const valueOf=(id)=>draft.has(id)?draft.get(id):saved(id);
+ useEffect(()=>{ prune drafts equal to saved; if(busy||!unsaved.length)return;
+   const t=setTimeout(()=>commit.current(id,value),250); return ()=>clearTimeout(t); },[draft,filters,busy]);
- value={filters.find(f=>f.id===column.id)?.value} onChange={value=>onChange(column.id,value)}
+ value={valueOf(column.id)} onChange={value=>edit(column.id,value)}     (same for the formula filter)
 // LocalTableRenderer.tsx
- readonly={locked}
+ readonly={viewer||!!view.error} busy={locked}
```

**Test.** A harness wires the panel the same way `LocalTableRenderer` does:
the value shown is the saved state, a save takes 40 ms, and a save requested
while one is pending is refused. Typing `AAPL` fast shows `''`, and only `A`
is saved. Typing `300` gives `3`. With the fix the field shows `AAPL` and
`300`, and those are the saved values. A third check confirms a viewer still
gets disabled inputs. These fail now and pass with the fix on both v4 and v6.

**Not reproduced.** The slow-typing *reorder* (`300` → `030`, with the caret
jumping to the start) does not happen in jsdom. The likely explanation is
WebKit's caret placement when a field is disabled and then has its value
reassigned. The fix removes both of those triggers, but the reorder needs a
GUI re-test of E05-053 to confirm it is gone.

## D-021: Default-view export writes stable ids, not labels

**Root cause.** For a Statement template, the worker builds each row's
`groupPath` member with `value` set to the stable id
(`calculate.ts:382`) and no `label`. The display labels and overrides sit in
`execution.memberLabels` (`statementModel/compile.ts:130`), and the on-screen
table reads them (`calculate.ts:302`, `:347`). The D-018 exporter reads only
`.value` (`export.ts:62`). The Statement view gets labels right because it
maps ids through its own presentation descriptor.

**Fix sketch.**
```diff
 // calculate.ts:382: the groupPath member carries the label the table shows
- groupPath: keys.map((key, i) => ({ ..., value: JSON.parse(key)[1] }))
+ groupPath: keys.map((key, i) => { const label = execution?.memberLabels[model.layout.rows[i]]?.[key];
+   return { ..., value: JSON.parse(key)[1], ...(label === undefined ? {} : { label }) }; })
 // export.ts:62
- read: (r) => r.groupPath?.[level]?.value ?? null,
+ read: (r) => { const m = r.groupPath?.[level]; return m ? (m.label ?? m.value ?? null) : null; },
```
`label` is already part of `DatasetGroupMember` and is accepted at the
worker boundary (`validation.ts:59`). Ordinary pivots set no label, so their
exports don't change.

**Test.** The test compiles the income Statement fixture with the override
"Sales" on `revenue`, runs `calculateView`, drains `presented()` and calls
`presentedForExport`. It expects no `statement/…` cells and expects "Sales"
to be present. On unfixed code all six cells are stable ids; with the fix the
test passes.

## Carry list and predicted conflicts

None of the affected functions changed between v4 and v6. `export.ts`,
`calculate.ts`, `compile.ts` and `TableFilterRow.tsx` are identical across the
three lines. `statementPresentation.ts` is identical between v5 and v6. A
scratch trial confirmed this:
1. The v4 change applied cleanly to v4.
2. Cherry-picking it onto v5 and onto v6 was clean.
3. The v5-only change (`statementPresentation.ts` plus the test assertion)
   cherry-picked onto v6 cleanly.
4. The result on v6 matches the prototype diff exactly.

The only drift is the line number of the `<SourceFilterPanel>` call:
334 on v4 and v5, 331 on v6.

## Risks
- **D-019:** anything that consumes these exports and matches the exact
  string `#ERROR` will need to match the `#ERROR` prefix instead. Error
  messages go into the file as written. They are app-authored diagnostics and
  carry no payload values, but a long message makes the cell long.
- **D-020:** while a save is pending, inputs stay editable, and the latest
  draft is saved once the save finishes. If a save is refused as `stale` (the
  definition changed underneath), the draft stays visible but unsaved until
  the next keystroke or until the saved filters change. The filter also
  applies 250 ms later than it does now.
- **D-021:** group members now carry labels. Linked-chart hover text
  (`chartFigure.ts:50`, which uses `m.label ?? m.value`) will show the
  Statement labels instead of the ids, which is the intent. No selection or
  linking code reads `label`, and the full suite passes.
- **Not traced:** the session 3 export lists sections as Expenses, Income,
  Profit, but the engine fixture presents the authored order Income,
  Expenses, Profit. This may be a sort in that session or a different
  template. It needs a GUI re-check when D-021 is re-tested.

## Decisions for you
1. **D-019 format:** inline `"#ERROR: <reason>"` in CSV, JSON and XLSX
   (recommended), or a sibling column, or a JSON `{error, reason}` object.
2. **D-019:** approve changing the `statementExecution.test.ts:75` assertion.
3. **D-020:** inputs editable during a pending save, with a 250 ms debounced
   save (proposed), or should a refused save also show a notice?
4. **D-021:** accept that linked-chart hover text changes to labels as part of
   the fix.
5. **Placement:** land the fix on v4 (`codex/clean-v4-integration`) and carry
   it to v5 and v6, with the Statement-view part landing on v5. Say whether
   this session or the walk coordinator does the landing.
