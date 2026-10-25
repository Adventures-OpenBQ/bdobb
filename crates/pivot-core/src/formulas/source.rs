// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Retain full structured cell-error evidence at the native stage boundary.
#![allow(clippy::result_large_err)]
use super::*;
use std::collections::BTreeSet;
// Formula numbers are finite here (literals are validated, arithmetic checks results).
use crate::pivot::scalar_number as number;
pub(crate) fn literal(value: &Literal) -> WireValue {
    match value {
        Literal::Number(n) => number(*n),
        Literal::String(s) => WireValue::String(s.clone()),
        Literal::Bool(b) => WireValue::Bool(*b),
        Literal::Null => WireValue::Null,
    }
}
fn fail(
    code: &str,
    message: &str,
    row: &DatasetRow,
    id: &str,
    dependencies: Vec<String>,
) -> CellResult {
    CellResult::Error(ModelError {
        record_ids_present: true,
        dependency_ids_present: false,
        code: code.into(),
        message: message.into(),
        definition_id: id.into(),
        record_ids: vec![row.id.clone()],
        dependency_ids: dependencies,
    })
}
fn scalar(value: &WireValue) -> bool {
    !matches!(value, WireValue::Array(_) | WireValue::Record(_))
}
fn equal(a: &WireValue, b: &WireValue) -> bool {
    match (
        crate::validation::arithmetic_number(a),
        crate::validation::arithmetic_number(b),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}
fn numeric(value: CellResult, row: &DatasetRow, id: &str) -> Result<f64, CellResult> {
    match value {
        CellResult::Error(_) => Err(value),
        CellResult::Value(value) => crate::validation::arithmetic_number(&value).map_err(|d| {
            fail(
                &d.code,
                if d.code == "nonfinite" {
                    "Numeric value must be finite."
                } else {
                    "Arithmetic requires numeric values; blanks and text are not zero."
                },
                row,
                id,
                vec![],
            )
        }),
    }
}
/// Shared scalar evaluator. A later aggregate stage supplies a resolver for scoped
/// references/calls/members; IF retains its unevaluated branches here.
pub fn evaluate_expression(
    ast: &FormulaAst,
    row: &DatasetRow,
    cells: &BTreeMap<String, CellResult>,
    definition_id: &str,
    resolver: &mut dyn FnMut(&FormulaAst) -> Option<CellResult>,
) -> CellResult {
    if let Some(result) = resolver(ast) {
        return result;
    }
    let run = |ast: &FormulaAst, resolver: &mut dyn FnMut(&FormulaAst) -> Option<CellResult>| {
        evaluate_expression(ast, row, cells, definition_id, resolver)
    };
    match ast {
        FormulaAst::Literal { value } => CellResult::Value(literal(value)),
        FormulaAst::Reference {
            target: ReferenceTarget::Formula,
            id,
        } => match cells.get(id) {
            None => fail(
                "missing-reference",
                "Formula dependency is unavailable.",
                row,
                definition_id,
                vec![id.clone()],
            ),
            Some(CellResult::Value(v)) => CellResult::Value(v.clone()),
            Some(CellResult::Error(error)) => {
                let mut ids = vec![id.clone()];
                for dependency in &error.dependency_ids {
                    if !ids.contains(dependency) {
                        ids.push(dependency.clone());
                    }
                }
                fail(
                    "blocked-dependency",
                    &error.message,
                    row,
                    definition_id,
                    ids,
                )
            }
        },
        FormulaAst::Reference {
            target: ReferenceTarget::Field,
            id,
        } => match row.values.get(id) {
            None => fail(
                "missing-input",
                &format!("Source field {id} is unavailable."),
                row,
                definition_id,
                vec![id.clone()],
            ),
            Some(v @ WireValue::F64(_)) if crate::validation::arithmetic_number(v).is_err() => {
                fail(
                    "nonfinite",
                    "Source numeric value must be finite.",
                    row,
                    definition_id,
                    vec![id.clone()],
                )
            }
            Some(v) => CellResult::Value(v.clone()),
        },
        FormulaAst::Reference { .. } => fail(
            "scope",
            "Source expressions cannot read measures.",
            row,
            definition_id,
            vec![],
        ),
        FormulaAst::Unary { operator, operand } => {
            match numeric(run(operand, resolver), row, definition_id) {
                Ok(n) => CellResult::Value(number(if *operator == UnaryOperator::Minus {
                    -n
                } else {
                    n
                })),
                Err(e) => e,
            }
        }
        FormulaAst::Binary {
            operator,
            left,
            right,
        } => {
            let left = run(left, resolver);
            let right = run(right, resolver);
            let (a, b) = match (left, right) {
                (CellResult::Error(e), _) | (_, CellResult::Error(e)) => {
                    return CellResult::Error(e)
                }
                (CellResult::Value(a), CellResult::Value(b)) => (a, b),
            };
            if matches!(
                operator,
                BinaryOperator::Add
                    | BinaryOperator::Subtract
                    | BinaryOperator::Multiply
                    | BinaryOperator::Divide
            ) {
                let a = match numeric(CellResult::Value(a), row, definition_id) {
                    Ok(n) => n,
                    Err(e) => return e,
                };
                let b = match numeric(CellResult::Value(b), row, definition_id) {
                    Ok(n) => n,
                    Err(e) => return e,
                };
                if *operator == BinaryOperator::Divide && b == 0. {
                    return fail(
                        "division-by-zero",
                        "Cannot divide by zero.",
                        row,
                        definition_id,
                        vec![],
                    );
                }
                let n = match operator {
                    BinaryOperator::Add => a + b,
                    BinaryOperator::Subtract => a - b,
                    BinaryOperator::Multiply => a * b,
                    _ => a / b,
                };
                if n.is_finite() {
                    CellResult::Value(number(n))
                } else {
                    fail(
                        "nonfinite",
                        "Calculation result must be finite.",
                        row,
                        definition_id,
                        vec![],
                    )
                }
            } else {
                if !scalar(&a) || !scalar(&b) {
                    return fail(
                        "invalid-type",
                        "Comparison requires scalar values.",
                        row,
                        definition_id,
                        vec![],
                    );
                }
                let result = match operator {
                    BinaryOperator::Equal => equal(&a, &b),
                    BinaryOperator::NotEqual => !equal(&a, &b),
                    _ => {
                        let comparison = match (&a, &b) {
                            (WireValue::F64(_), WireValue::F64(_)) => {
                                crate::validation::arithmetic_number(&a)
                                    .unwrap()
                                    .partial_cmp(&crate::validation::arithmetic_number(&b).unwrap())
                                    .unwrap()
                            }
                            (WireValue::String(a), WireValue::String(b)) => {
                                a.encode_utf16().cmp(b.encode_utf16())
                            }
                            _ => {
                                return fail(
                                    "invalid-type",
                                    "Ordered comparison requires two numbers or two strings.",
                                    row,
                                    definition_id,
                                    vec![],
                                )
                            }
                        };
                        match operator {
                            BinaryOperator::Less => comparison.is_lt(),
                            BinaryOperator::LessEqual => !comparison.is_gt(),
                            BinaryOperator::Greater => comparison.is_gt(),
                            _ => !comparison.is_lt(),
                        }
                    }
                };
                CellResult::Value(WireValue::Bool(result))
            }
        }
        FormulaAst::Call {
            function: FormulaFunction::If,
            args,
        } => {
            let condition = run(&args[0], resolver);
            match condition {
                CellResult::Error(_) => condition,
                CellResult::Value(WireValue::Bool(b)) => {
                    run(&args[if b { 1 } else { 2 }], resolver)
                }
                _ => fail(
                    "invalid-type",
                    "IF condition must be boolean.",
                    row,
                    definition_id,
                    vec![],
                ),
            }
        }
        FormulaAst::Call { .. } => fail(
            "scope",
            "Aggregate calls require aggregate scope.",
            row,
            definition_id,
            vec![],
        ),
        FormulaAst::Member { .. } => fail(
            "scope",
            "Member expressions require aggregate scope.",
            row,
            definition_id,
            vec![],
        ),
    }
}
pub fn evaluate_source(rows: &[DatasetRow], model: &CompiledModel) -> EvaluatedRows {
    let mut result = EvaluatedRows {
        rows: vec![],
        columns: model.columns.clone(),
        formula_cells: BTreeMap::new(),
        source_dependencies: BTreeMap::new(),
        errors: BTreeMap::new(),
    };
    let mut seen = BTreeSet::new();
    let sources = model
        .symbols
        .formulas
        .iter()
        .filter(|f| f.scope == FormulaScope::Source)
        .collect::<Vec<_>>();
    let allowed = model
        .graph
        .order
        .iter()
        .filter(|id| !model.graph.blocked_ids.contains(id))
        .collect::<BTreeSet<_>>();
    for input in rows {
        if !seen.insert(&input.id) {
            continue;
        }
        let mut row = input.clone();
        let mut cells = BTreeMap::new();
        let mut dependencies = BTreeMap::new();
        for source in &sources {
            let diagnostics = model
                .graph
                .diagnostics
                .iter()
                .filter(|d| d.definition_id.as_deref() == Some(&source.id))
                .collect::<Vec<_>>();
            let entry = model
                .graph
                .entries
                .iter()
                .find(|e| e.value.as_ref().is_some_and(|f| f.id == source.id));
            let collision = model.columns.iter().any(|c| c.id == source.id)
                || input.values.contains_key(&source.id);
            if entry.is_none()
                || !allowed.contains(&source.id)
                || !diagnostics.is_empty()
                || collision
            {
                let code = if collision {
                    "ambiguous-reference"
                } else if diagnostics.iter().any(|d| d.code == "cycle") {
                    "cycle"
                } else if diagnostics.first().is_some_and(|d| d.code == "scope") {
                    "scope"
                } else {
                    "blocked-dependency"
                };
                cells.insert(
                    source.id.clone(),
                    fail(
                        code,
                        diagnostics
                            .first()
                            .map_or("Formula is not approved for source evaluation.", |d| {
                                d.message.as_str()
                            }),
                        &row,
                        &source.id,
                        diagnostics
                            .iter()
                            .flat_map(|d| d.dependency_ids.clone())
                            .collect(),
                    ),
                );
            }
        }
        for id in &model.graph.order {
            if cells.contains_key(id) || !allowed.contains(id) {
                continue;
            }
            let Some(f) = model
                .graph
                .entries
                .iter()
                .filter_map(|e| e.value.as_ref())
                .find(|f| f.id == *id && f.scope == FormulaScope::Source)
            else {
                continue;
            };
            let mut inputs = Vec::new();
            let evaluated = evaluate_expression(&f.ast, &row, &cells, id, &mut |ast| {
                let FormulaAst::Reference { target, id: field } = ast else {
                    return None;
                };
                if !inputs.contains(field) {
                    inputs.push(field.clone());
                }
                if *target != ReferenceTarget::Field {
                    return None;
                }
                if let Some(error) = row.cell_errors.as_ref().and_then(|e| e.get(field)) {
                    let mut deps = vec![field.clone()];
                    deps.extend(error.dependency_ids.clone().unwrap_or_default());
                    return Some(fail("blocked-dependency", &error.message, &row, id, deps));
                }
                let column = model.columns.iter().find(|c| c.id == *field)?;
                if !matches!(
                    column.aggregation,
                    Some(Aggregation::Count | Aggregation::UniqueCount)
                ) {
                    return None;
                }
                let WireValue::String(value) = row.values.get(field)? else {
                    return None;
                };
                if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                    return Some(fail(
                        "invalid-type",
                        "Incoming count must be an integer.",
                        &row,
                        id,
                        vec![field.clone()],
                    ));
                }
                let parsed = value.parse::<f64>().unwrap_or(f64::INFINITY);
                if parsed > 9007199254740991. {
                    return Some(fail(
                        "nonfinite",
                        "Incoming count exceeds the exact integer range.",
                        &row,
                        id,
                        vec![field.clone()],
                    ));
                }
                Some(CellResult::Value(number(parsed)))
            });
            if let CellResult::Value(value) = &evaluated {
                row.values.insert(id.clone(), value.clone());
            }
            dependencies.insert(id.clone(), inputs);
            cells.insert(id.clone(), evaluated);
        }
        let mut errors = BTreeMap::new();
        for (id, error) in row.cell_errors.iter().flat_map(|e| e.iter()) {
            errors.insert(
                id.clone(),
                ModelError {
                    record_ids_present: true,
                    dependency_ids_present: false,
                    code: "blocked-dependency".into(),
                    message: error.message.clone(),
                    definition_id: id.clone(),
                    record_ids: vec![row.id.clone()],
                    dependency_ids: error.dependency_ids.clone().unwrap_or_default(),
                },
            );
        }
        for (id, cell) in &cells {
            if let CellResult::Error(error) = cell {
                errors.insert(id.clone(), error.clone());
            }
        }
        if !errors.is_empty() {
            result.errors.insert(row.id.clone(), errors);
        }
        result.formula_cells.insert(row.id.clone(), cells);
        result
            .source_dependencies
            .insert(row.id.clone(), dependencies);
        result.rows.push(row);
    }
    for source in sources {
        if !result.columns.iter().any(|c| c.id == source.id) {
            result.columns.push(Column {
                id: source.id.clone(),
                label: source.name.clone(),
                ..Default::default()
            });
        }
    }
    result
}
