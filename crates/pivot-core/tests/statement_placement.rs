// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{analytical::*, contract::*};
use support::*;
#[test]
fn placement_refuses_foreign_references_and_stale_membership_orders() {
    let (_, input, definition, _) = fixture("statement-income-wide");
    let Some(AnalyticalDefinition::Statement(intent)) = definition.definition.analytical else {
        panic!("statement")
    };
    let line = intent.template.sections[0].line_ids[0].clone();
    let destination = intent.template.sections[1].id.clone();
    for (key, value) in [
        ("foreign-line".to_string(), destination.clone()),
        (line.clone(), "foreign-section".to_string()),
    ] {
        let mut invalid = intent.clone();
        invalid.overrides.line_section.insert(key, value);
        assert_eq!(
            pivot_core::statement::compile_statement(&invalid, &input.columns)
                .unwrap_err()
                .path
                .as_deref(),
            Some("overrides.lineSection")
        );
    }
    let mut stale = intent.clone();
    stale
        .overrides
        .line_section
        .insert(line.clone(), destination);
    let home = &intent.template.sections[0];
    stale
        .overrides
        .line_order
        .insert(home.id.clone(), home.line_ids.clone());
    assert_eq!(
        pivot_core::statement::compile_statement(&stale, &input.columns)
            .unwrap_err()
            .path
            .as_deref(),
        Some("overrides.lineOrder")
    );
    let mut raw = serde_json::to_value(&intent).unwrap();
    for bad in [
        serde_json::Value::Null,
        serde_json::json!([]),
        serde_json::json!({(line.clone()): 1}),
    ] {
        raw["overrides"]["lineSection"] = bad;
        assert!(
            serde_json::from_value::<pivot_core::statement::StatementIntent>(raw.clone()).is_err()
        );
    }
}
#[test]
fn moved_formula_keeps_values_and_effective_section_visibility_and_reset() {
    let (_, input, mut definition, runtime) = fixture("statement-income-wide");
    let baseline =
        calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
    let Some(AnalyticalDefinition::Statement(intent)) = &definition.definition.analytical else {
        panic!("statement")
    };
    let formula = intent
        .template
        .lines
        .iter()
        .find(|line| line.formula.is_some())
        .unwrap()
        .id
        .clone();
    let home = intent
        .template
        .sections
        .iter()
        .find(|section| section.line_ids.contains(&formula))
        .unwrap()
        .id
        .clone();
    let destination = intent
        .template
        .sections
        .iter()
        .find(|section| section.id != home)
        .unwrap()
        .id
        .clone();
    let key = pivot_core::pivot::pivot_value_key(&WireValue::String(formula.clone()));
    let has = |row: &&DatasetRow| {
        row.group_path
            .as_ref()
            .is_some_and(|path| path.len() == 2 && path[1].member_key.as_ref() == Some(&key))
    };
    let original_values = baseline.rows.iter().find(has).unwrap().values.clone();
    let mut moved = intent.clone();
    moved
        .overrides
        .line_section
        .insert(formula.clone(), destination.clone());
    for hidden in [None, Some(home.clone()), Some(destination.clone())] {
        moved.overrides.hidden_ids = hidden.clone().into_iter().collect();
        definition.definition.analytical = Some(AnalyticalDefinition::Statement(moved.clone()));
        refresh_recipe(&mut definition);
        let view =
            calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
        let row = view.rows.iter().find(has);
        if hidden.as_ref() == Some(&destination) {
            assert!(row.is_none());
        } else {
            assert_eq!(row.unwrap().values, original_values);
        }
    }
    moved.overrides.hidden_ids.clear();
    moved
        .overrides
        .line_section
        .insert(formula.clone(), home.clone());
    let explicit_home = pivot_core::statement::compile_statement(&moved, &input.columns).unwrap();
    moved.overrides.line_section.clear();
    let reset = pivot_core::statement::compile_statement(&moved, &input.columns).unwrap();
    assert_eq!(explicit_home.section_by_line, reset.section_by_line);
    assert_eq!(reset.section_by_line.get(&formula), Some(&home));
}
#[test]
fn moved_statement_line_round_trips_and_executes_in_its_displayed_section() {
    let (_, input, mut definition, runtime) = fixture("statement-income-wide");
    let Some(AnalyticalDefinition::Statement(intent)) = &definition.definition.analytical else {
        panic!("statement intent")
    };
    let income = &intent.template.sections[0];
    let expenses = &intent.template.sections[1];
    let moved = income.line_ids[0].clone();
    let income_id = income.id.clone();
    let expenses_id = expenses.id.clone();
    let mut raw = serde_json::to_value(intent).unwrap();
    raw["overrides"]["lineSection"] = serde_json::json!({(moved.clone()): expenses_id.clone()});
    raw["overrides"]["lineOrder"][&income_id] = serde_json::json!(income
        .line_ids
        .iter()
        .filter(|id| *id != &moved)
        .collect::<Vec<_>>());
    let mut expense_order = vec![moved.clone()];
    expense_order.extend(expenses.line_ids.clone());
    raw["overrides"]["lineOrder"][&expenses_id] = serde_json::json!(expense_order);
    let restored: pivot_core::statement::StatementIntent = serde_json::from_value(raw)
        .expect("saved line placement must survive the native wire contract");
    let compiled = pivot_core::statement::compile_statement(&restored, &input.columns).unwrap();
    assert_eq!(compiled.section_by_line.get(&moved), Some(&expenses_id));
    definition.definition.analytical = Some(AnalyticalDefinition::Statement(Box::new(restored)));
    refresh_recipe(&mut definition);
    let view = calculate_view(&input, &definition, &SelectionSpec::None, &runtime, &Host).unwrap();
    assert!(view
        .rows
        .iter()
        .any(|row| row.group_path.as_ref().is_some_and(|path| {
            path.len() == 2
                && path[0].member_key.as_deref()
                    == Some(
                        pivot_core::pivot::pivot_value_key(&WireValue::String(expenses_id.clone()))
                            .as_str(),
                    )
                && path[1].member_key.as_deref()
                    == Some(
                        pivot_core::pivot::pivot_value_key(&WireValue::String(moved.clone()))
                            .as_str(),
                    )
        })));
}
