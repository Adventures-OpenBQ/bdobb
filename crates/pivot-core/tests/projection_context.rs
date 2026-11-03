// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{analytical::calculate_view, contract::*};
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
};
use support::*;
const PAYLOAD: usize = 8193;
const FIELD_BYTES: usize = 211;
thread_local! {static COPIES:Cell<Option<usize>>=const{Cell::new(None)};static FIELD_COPIES:Cell<Option<usize>>=const{Cell::new(None)};static VALUE_COPIES:Cell<Option<usize>>=const{Cell::new(None)};}
struct Allocator;
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.size() == PAYLOAD {
            let _ = COPIES.try_with(|n| {
                if let Some(v) = n.get() {
                    n.set(Some(v + 1))
                }
            });
        }
        if layout.size() == FIELD_BYTES {
            let _ = FIELD_COPIES.try_with(|n| {
                if let Some(v) = n.get() {
                    n.set(Some(v + 1))
                }
            });
        }
        if layout.size() == 5 {
            let _ = VALUE_COPIES.try_with(|n| {
                if let Some(v) = n.get() {
                    n.set(Some(v + 1))
                }
            });
        }
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}
#[global_allocator]
static ALLOCATOR: Allocator = Allocator;
#[test]
fn equal_column_scopes_do_not_recopy_source_payloads_per_formula() {
    let mut counts = vec![];
    for count in [1, 5, 20] {
        let (_, mut input, mut definition, params) = fixture("ratio-source-scope");
        for row in &mut input.rows {
            row.values
                .insert("payload".into(), WireValue::String("x".repeat(PAYLOAD)));
        }
        let mut column = input.columns[0].clone();
        column.id = "payload".into();
        column.label = "Payload".into();
        input.columns.push(column);
        let model = definition
            .definition
            .analytical
            .as_mut()
            .unwrap()
            .table_mut()
            .unwrap();
        let formula = model.formulas[0].clone();
        model.formulas = (0..count)
            .map(|i| {
                let mut f = formula.clone();
                f.id = format!("ratio{i}");
                f.name = f.id.clone();
                f
            })
            .collect();
        model.layout.values = model.formulas.iter().map(|f| f.id.clone()).collect();
        refresh_recipe(&mut definition);
        COPIES.with(|v| v.set(Some(0)));
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &params, &Host).unwrap();
        let copies = COPIES.with(|v| v.replace(None)).unwrap();
        assert_eq!(view.eligible_rows.len(), 2);
        assert_eq!(view.totals.values.len(), count);
        counts.push(copies);
    }
    println!("source payload copies for1/5/20 formula columns: {counts:?}");
    assert!(
        counts.iter().all(|n| *n == counts[0]),
        "same source scopes recopied payloads as column count grew: {counts:?}"
    );
}

#[test]
fn successful_aggregate_input_bounds_row_id_copies() {
    use pivot_core::formulas::aggregate::evaluate_aggregate;
    let (_, mut input, mut definition, params) = fixture("ratio-source-scope");
    let templates = input.rows.clone();
    input.rows = (0..8)
        .map(|i| {
            let mut row = templates[i % templates.len()].clone();
            row.id = format!("{i:04}{}", "r".repeat(PAYLOAD - 4));
            row
        })
        .collect();
    let model = definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    model.formulas.clear();
    model.measures = vec![serde_json::from_value(
        serde_json::json!({"id":"m","sourceFieldId":"x","aggregation":"sum"}),
    )
    .unwrap()];
    model.layout.values = vec!["m".into()];
    refresh_recipe(&mut definition);
    let view = calculate_view(&input, &definition, &SelectionSpec::None, &params, &Host).unwrap();
    COPIES.with(|v| v.set(Some(0)));
    let result = evaluate_aggregate(
        &view.calculated_totals.scope,
        &view.pool,
        &view.compiled,
        &Host,
    )
    .unwrap();
    let copies = COPIES.with(|v| v.replace(None)).unwrap();
    assert_eq!(
        result.measure_cells,
        view.calculated_totals.formulas.measure_cells
    );
    println!("successful aggregate row-ID copies: {copies}");
    // One error-index scope and two metadata scope copies per row. Deduplication
    // borrows its keys, and successful rows need no singleton error scope.
    assert!(
        copies <= 3 * input.rows.len(),
        "unexpected row-ID copies: {copies}"
    );
}

#[test]
fn aggregate_dedup_keeps_the_first_pool_row_for_an_id() {
    use pivot_core::{
        formulas::{aggregate::evaluate_aggregate, evaluate_source, CellResult},
        scopes::eligible_pool,
    };
    let (_, input, mut definition, params) = fixture("ratio-source-scope");
    let model = definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    model.formulas.clear();
    model.measures = vec![serde_json::from_value(
        serde_json::json!({"id":"m","sourceFieldId":"x","aggregation":"sum"}),
    )
    .unwrap()];
    model.layout.values = vec!["m".into()];
    refresh_recipe(&mut definition);
    let view = calculate_view(&input, &definition, &SelectionSpec::None, &params, &Host).unwrap();
    let number = |cell: &CellResult| match cell {
        CellResult::Value(WireValue::F64(WireNumber::Finite(v))) => *v,
        _ => panic!("finite sum: {cell:?}"),
    };
    let original = match &view.pool.rows[0].values["x"] {
        WireValue::F64(WireNumber::Finite(v)) => *v,
        _ => panic!("numeric source"),
    };
    let expected = number(&view.calculated_totals.formulas.measure_cells["m"]);
    for prepend in [false, true] {
        // This pool is deliberately unindexed, so duplicate IDs remain visible
        // to aggregate input. The index contract also preserves duplicates.
        let evaluated = evaluate_source(&input.rows, &view.compiled);
        let mut pool = eligible_pool(&evaluated, &view.compiled, &params, &Host);
        let mut duplicate = pool.rows[0].clone();
        duplicate
            .values
            .insert("x".into(), WireValue::F64(WireNumber::Finite(999.)));
        if prepend {
            pool.rows.insert(0, duplicate);
        } else {
            pool.rows.push(duplicate);
        }
        let result =
            evaluate_aggregate(&view.calculated_totals.scope, &pool, &view.compiled, &Host)
                .unwrap();
        assert_eq!(
            number(&result.measure_cells["m"]),
            if prepend {
                expected - original + 999.
            } else {
                expected
            }
        );
    }
}

#[test]
fn direct_field_metadata_does_not_clone_its_id_per_row() {
    use pivot_core::formulas::aggregate::evaluate_aggregate;
    let field = "f".repeat(FIELD_BYTES);
    let mut counts = vec![];
    for count in [1, 5, 20] {
        let (_, mut input, mut definition, params) = fixture("ratio-source-scope");
        let templates = input.rows.clone();
        input.rows = (0..count)
            .map(|i| {
                let mut row = templates[i % templates.len()].clone();
                row.id = format!("row-{i}");
                let value = row.values.remove("x").unwrap();
                row.values.insert(field.clone(), value);
                row
            })
            .collect();
        input.columns.iter_mut().find(|c| c.id == "x").unwrap().id = field.clone();
        let model = definition
            .definition
            .analytical
            .as_mut()
            .unwrap()
            .table_mut()
            .unwrap();
        model.formulas.clear();
        model.measures = vec![serde_json::from_value(
            serde_json::json!({"id":"m","sourceFieldId":field,"aggregation":"sum"}),
        )
        .unwrap()];
        model.layout.values = vec!["m".into()];
        refresh_recipe(&mut definition);
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &params, &Host).unwrap();
        FIELD_COPIES.with(|v| v.set(Some(0)));
        let result = evaluate_aggregate(
            &view.calculated_totals.scope,
            &view.pool,
            &view.compiled,
            &Host,
        )
        .unwrap();
        let copies = FIELD_COPIES.with(|v| v.replace(None)).unwrap();
        assert_eq!(
            result.measure_cells,
            view.calculated_totals.formulas.measure_cells
        );
        counts.push(copies);
    }
    println!("field-ID copies for1/5/20 rows: {counts:?}");
    assert!(
        counts.iter().all(|n| *n == counts[0]),
        "field-ID clones grew with rows: {counts:?}"
    );
}

#[test]
fn repeated_successful_field_sums_prepare_values_once_per_scope() {
    use pivot_core::formulas::aggregate::evaluate_aggregate;
    let (_, mut input, mut definition, params) = fixture("ratio-source-scope");
    let templates = input.rows.clone();
    input.rows = (0..8)
        .map(|i| {
            let mut r = templates[i % templates.len()].clone();
            r.id = format!("id{i}");
            r
        })
        .collect();
    input
        .columns
        .iter_mut()
        .find(|c| c.id == "x")
        .unwrap()
        .label = "Source X".into();
    let model = definition
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap();
    let mut f = model.formulas[0].clone();
    f.ast = FormulaAst::Call {
        function: FormulaFunction::Sum,
        args: vec![FormulaAst::Reference {
            target: ReferenceTarget::Field,
            id: "x".into(),
        }],
    };
    f.format = None;
    model.formulas = ["one", "two"]
        .into_iter()
        .map(|id| {
            let mut f = f.clone();
            f.id = id.into();
            f.name = id.into();
            f
        })
        .collect();
    model.layout.values = vec!["one".into(), "two".into()];
    refresh_recipe(&mut definition);
    let view = calculate_view(&input, &definition, &SelectionSpec::None, &params, &Host).unwrap();
    VALUE_COPIES.with(|n| n.set(Some(0)));
    let result = evaluate_aggregate(
        &view.calculated_totals.scope,
        &view.pool,
        &view.compiled,
        &Host,
    )
    .unwrap();
    let copies = VALUE_COPIES.with(|n| n.replace(None)).unwrap();
    assert_eq!(result.cells["one"], result.cells["two"]);
    println!("value-key allocations for two repeated sums of8 rows: {copies}");
    assert!(copies <= 8, "duplicate sum rebuilt value rows: {copies}");
}

#[test]
fn shared_sums_preserve_per_caller_metadata_failures_and_member_scopes() {
    use pivot_core::formulas::aggregate::evaluate_aggregate;
    for bad in [None, Some("not count"), Some("9007199254740992")] {
        for member in [false, true] {
            let (_, mut input, mut definition, params) = fixture("ratio-source-scope");
            if let Some(bad) = bad {
                input
                    .columns
                    .iter_mut()
                    .find(|c| c.id == "x")
                    .unwrap()
                    .aggregation = Some(Aggregation::Count);
                input.rows[0]
                    .values
                    .insert("x".into(), WireValue::String(bad.into()));
                input.rows[1]
                    .values
                    .insert("x".into(), WireValue::String("3".into()));
            }
            let model = definition
                .definition
                .analytical
                .as_mut()
                .unwrap()
                .table_mut()
                .unwrap();
            let mut f = model.formulas[0].clone();
            f.ast = FormulaAst::Call {
                function: FormulaFunction::Sum,
                args: vec![FormulaAst::Reference {
                    target: ReferenceTarget::Field,
                    id: "x".into(),
                }],
            };
            model.formulas = [("one", "number"), ("two", "percent")]
                .into_iter()
                .map(|(id, format)| {
                    let mut f = f.clone();
                    f.id = id.into();
                    f.name = id.into();
                    f.format = Some(format.into());
                    f
                })
                .collect();
            model.layout.values = vec!["one".into(), "two".into()];
            if member {
                let category = model.categories[0].id.clone();
                let key = serde_json::to_string(&serde_json::json!(["string", "B"])).unwrap();
                model.formulas[1].ast = FormulaAst::Member {
                    value: Box::new(model.formulas[1].ast.clone()),
                    selectors: vec![MemberSelector {
                        category_id: category,
                        member_key: key,
                    }],
                };
            }
            refresh_recipe(&mut definition);
            let view =
                calculate_view(&input, &definition, &SelectionSpec::None, &params, &Host).unwrap();
            let actual = evaluate_aggregate(
                &view.calculated_totals.scope,
                &view.pool,
                &view.compiled,
                &Host,
            )
            .unwrap();
            for id in ["one", "two"] {
                let mut single = view.compiled.clone();
                single
                    .graph
                    .entries
                    .retain(|e| e.value.as_ref().is_some_and(|f| f.id == id));
                single.graph.order.retain(|f| f == id);
                single.symbols.formulas.retain(|f| f.id == id);
                let expected =
                    evaluate_aggregate(&view.calculated_totals.scope, &view.pool, &single, &Host)
                        .unwrap();
                assert_eq!(
                    actual.cells[id], expected.cells[id],
                    "{bad:?}/{member}/{id}"
                );
                let a = &actual.metadata[id];
                let e = &expected.metadata[id];
                assert_eq!(
                    serde_json::to_value(&a.source_columns).unwrap(),
                    serde_json::to_value(&e.source_columns).unwrap()
                );
                assert_eq!(a.scopes, e.scopes);
                assert_eq!(a.format, e.format);
                assert_eq!(
                    serde_json::to_value(a.value_kind).unwrap(),
                    serde_json::to_value(e.value_kind).unwrap()
                );
                assert_eq!(a.statement_record_ids, e.statement_record_ids);
            }
        }
    }
}
