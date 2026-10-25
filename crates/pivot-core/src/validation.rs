// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Public contract returns complete diagnostic evidence by value as specified.
#![allow(clippy::result_large_err)]
use crate::{contract::*, PROTOCOL_VERSION};
use std::collections::BTreeSet;

pub fn diagnostic(code: &str, path: &str, message: &str) -> Diagnostic {
    Diagnostic {
        code: code.into(),
        path: Some(path.into()),
        message: message.into(),
        severity: Severity::Error,
        definition_id: None,
        dependency_id: None,
        key: None,
        member_keys: None,
        unmatched_count: None,
        truncated: None,
    }
}
fn invalid(path: &str) -> Diagnostic {
    diagnostic("invalid-structure", path, "Invalid analytical structure")
}
fn required(value: &str, path: &str) -> Result<(), Diagnostic> {
    if value.is_empty() {
        Err(invalid(path))
    } else {
        Ok(())
    }
}
fn unique<'a>(
    values: impl IntoIterator<Item = &'a String>,
    path: &str,
) -> Result<BTreeSet<String>, Diagnostic> {
    let mut seen = BTreeSet::new();
    for value in values {
        required(value, path)?;
        if !seen.insert(value.clone()) {
            return Err(diagnostic(
                "duplicate-id",
                path,
                "Duplicate analytical identity",
            ));
        }
    }
    Ok(seen)
}
fn reference(ids: &BTreeSet<String>, id: &str, path: &str) -> Result<(), Diagnostic> {
    if ids.contains(id) {
        Ok(())
    } else {
        let mut issue = diagnostic(
            "missing-reference",
            path,
            "Referenced definition is missing or invalid",
        );
        issue.dependency_id = Some(id.into());
        Err(issue)
    }
}
/// Values accepted for identity/transport are not automatically valid arithmetic inputs.
pub fn validate_wire_value(value: &WireValue) -> Result<(), Diagnostic> {
    match value {
        WireValue::F64(WireNumber::Finite(number))
            if !number.is_finite() || (*number == 0.0 && number.is_sign_negative()) =>
        {
            Err(invalid("value"))
        }
        WireValue::BigIntString(text) => {
            let digits = text.strip_prefix('-').unwrap_or(text);
            if text == "0"
                || !digits.is_empty()
                    && !digits.starts_with('0')
                    && digits.bytes().all(|b| b.is_ascii_digit())
            {
                Ok(())
            } else {
                Err(invalid("value"))
            }
        }
        WireValue::Array(values) => {
            for value in values {
                validate_wire_value(value)?;
            }
            Ok(())
        }
        WireValue::Record(entries) => {
            let mut keys = BTreeSet::new();
            for (key, value) in entries {
                if !keys.insert(key) {
                    return Err(invalid("value"));
                }
                validate_wire_value(value)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
pub fn arithmetic_number(value: &WireValue) -> Result<f64, Diagnostic> {
    match value {
        WireValue::F64(WireNumber::Finite(number)) if number.is_finite() => Ok(*number),
        WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero)) => Ok(-0.0),
        WireValue::F64(_) => Err(diagnostic(
            "nonfinite",
            "value",
            "Arithmetic requires a finite number",
        )),
        _ => Err(diagnostic(
            "invalid-type",
            "value",
            "Arithmetic requires a number; text, blanks and bigint are not coerced",
        )),
    }
}
fn validate_pivot(pivot: &PivotConfig) -> Result<(), Diagnostic> {
    for id in pivot.grouping.iter().chain(&pivot.split) {
        required(id, "pivot.axes")?;
    }
    if matches!(pivot.expanded, Some(Expanded::All(false))) {
        return Err(invalid("pivot.expanded"));
    }
    if let Some(measures) = &pivot.measures {
        for measure in measures {
            validate_measure(measure)?;
        }
    }
    Ok(())
}
fn validate_measure(measure: &Measure) -> Result<(), Diagnostic> {
    required(&measure.id, "measures.id")?;
    required(&measure.source_field_id, "measures.sourceFieldId")
}
fn validate_literal(value: &Literal, path: &str) -> Result<(), Diagnostic> {
    if matches!(value,Literal::Number(number) if !number.is_finite()) {
        Err(diagnostic(
            "invalid-ast",
            path,
            "Literals must be finite scalar values",
        ))
    } else {
        Ok(())
    }
}
fn ast_string_bytes(text: &str, total: &mut usize) -> Result<(), Diagnostic> {
    *total = total.saturating_add(text.len());
    if *total > 16384 {
        Err(diagnostic(
            "expression-limit",
            "formulas.ast",
            "Formula exceeds the 16 KiB cumulative UTF-8 string limit",
        ))
    } else {
        Ok(())
    }
}
fn ast_array_length(length: usize) -> Result<(), Diagnostic> {
    if length > 1024 {
        Err(diagnostic(
            "node-limit",
            "formulas.ast",
            "Formula exceeds the AST array limit of 1,024",
        ))
    } else {
        Ok(())
    }
}
fn validate_ast(
    ast: &FormulaAst,
    model: &TableModel,
    depth: usize,
    nodes: &mut usize,
    string_bytes: &mut usize,
) -> Result<(), Diagnostic> {
    *nodes += 1;
    if depth > 64 {
        return Err(diagnostic(
            "depth-limit",
            "formulas.ast",
            "Formula exceeds AST depth 64",
        ));
    }
    if *nodes > 1024 {
        return Err(diagnostic(
            "node-limit",
            "formulas.ast",
            "Formula exceeds AST node count 1024",
        ));
    }
    match ast {
        FormulaAst::Literal { value } => {
            if let Literal::String(text) = value {
                ast_string_bytes(text, string_bytes)?;
            }
            validate_literal(value, "formulas.ast")
        }
        FormulaAst::Reference { id, .. } => {
            required(id, "formulas.ast.id")?;
            ast_string_bytes(id, string_bytes)?;
            // Known AST references are structurally valid even when their target
            // is absent. Formula evaluation owns local missing-reference cells.
            Ok(())
        }
        FormulaAst::Unary { operand, .. } => {
            validate_ast(operand, model, depth + 1, nodes, string_bytes)
        }
        FormulaAst::Binary { left, right, .. } => {
            validate_ast(left, model, depth + 1, nodes, string_bytes)?;
            validate_ast(right, model, depth + 1, nodes, string_bytes)
        }
        FormulaAst::Call { function, args } => {
            ast_array_length(args.len())?;
            if args.len()
                != if *function == FormulaFunction::If {
                    3
                } else {
                    1
                }
            {
                return Err(diagnostic(
                    "invalid-ast",
                    "formulas.ast.args",
                    "Invalid function argument count",
                ));
            }
            for arg in args {
                validate_ast(arg, model, depth + 1, nodes, string_bytes)?;
            }
            Ok(())
        }
        FormulaAst::Member { value, selectors } => {
            ast_array_length(selectors.len())?;
            if selectors.is_empty() {
                return Err(diagnostic(
                    "invalid-ast",
                    "formulas.ast.selectors",
                    "Member selectors are required",
                ));
            }
            validate_ast(value, model, depth + 1, nodes, string_bytes)?;
            unique(
                selectors.iter().map(|s| &s.category_id),
                "formulas.ast.selectors",
            )?;
            let categories = model.categories.iter().map(|c| c.id.clone()).collect();
            for selector in selectors {
                required(&selector.member_key, "formulas.ast.selectors.memberKey")?;
                ast_string_bytes(&selector.category_id, string_bytes)?;
                ast_string_bytes(&selector.member_key, string_bytes)?;
                reference(&categories, &selector.category_id, "formulas.ast.selectors")?;
            }
            Ok(())
        }
    }
}
/// Structural validity only. Dataset binding, scope/cycle compilation and evaluation are separate stages.
pub fn validate_definition(raw: &WireDefinition) -> Result<ValidatedDefinition, Diagnostic> {
    if raw.protocol_version != PROTOCOL_VERSION {
        return Err(diagnostic(
            "unsupported-protocol",
            "protocolVersion",
            "Unsupported Pivot protocol version",
        ));
    }
    required(&raw.locale, "locale")?;
    if let Some(pivot) = &raw.definition.table.pivot {
        validate_pivot(pivot)?;
    }
    if let Some(filters) = &raw.definition.table.column_filters {
        for filter in filters {
            required(&filter.id, "table.columnFilters.id")?;
            validate_wire_value(&filter.value)?;
        }
    }
    if let Some(model) = raw
        .definition
        .analytical
        .as_ref()
        .and_then(AnalyticalDefinition::table)
    {
        if model.schema_version != 1 {
            return Err(diagnostic(
                "unsupported-schema",
                "analytical.schemaVersion",
                "Unsupported analytical saved schema",
            ));
        }
        let categories = unique(model.categories.iter().map(|c| &c.id), "categories.id")?;
        let measures = unique(model.measures.iter().map(|m| &m.id), "measures.id")?;
        let formulas = unique(model.formulas.iter().map(|f| &f.id), "formulas.id")?;
        for category in &model.categories {
            required(&category.name, "categories.name")?;
            required(&category.source_field_id, "categories.sourceFieldId")?;
            if category.legacy_bucket.is_some() && category.transform != Transform::Native {
                return Err(invalid("categories.legacyBucket"));
            }
            if let Some(binding) = &category.fiscal_binding {
                required(
                    &binding.company_field_id,
                    "categories.fiscalBinding.companyFieldId",
                )?;
                for value in [
                    &binding.date_field_id,
                    &binding.metadata_key,
                    &binding.period_start_field_id,
                    &binding.period_end_field_id,
                    &binding.fiscal_year_field_id,
                    &binding.fiscal_quarter_field_id,
                ]
                .into_iter()
                .flatten()
                {
                    required(value, "categories.fiscalBinding")?;
                }
            }
        }
        for measure in &model.measures {
            validate_measure(measure)?;
        }
        for formula in &model.formulas {
            required(&formula.name, "formulas.name")?;
            if formula.expression.len() > 16384 {
                return Err(diagnostic(
                    "expression-limit",
                    "formulas.expression",
                    "Formula exceeds 16 KiB expression limit",
                ));
            }
            validate_ast(&formula.ast, model, 1, &mut 0, &mut 0)?;
        }
        let mut assigned = BTreeSet::new();
        for category in model
            .layout
            .rows
            .iter()
            .chain(&model.layout.columns)
            .chain(model.layout.page.iter().map(|p| &p.category_id))
        {
            reference(&categories, category, "layout")?;
            if !assigned.insert(category) {
                return Err(invalid("layout"));
            }
        }
        unique(&model.layout.values, "layout.values")?;
        for value in &model.layout.values {
            if !measures.contains(value)
                && !model
                    .formulas
                    .iter()
                    .any(|f| f.id == *value && f.scope == FormulaScope::Aggregate)
            {
                return Err(diagnostic(
                    "missing-reference",
                    "layout.values",
                    "Data values require a measure or aggregate formula",
                ));
            }
        }
        if let Some(page) = &model.layout.page {
            unique(&page.member_keys, "layout.page.memberKeys")?;
        }
        unique(
            model.checklists.iter().map(|c| &c.category_id),
            "checklists",
        )?;
        for constraint in &model.checklists {
            reference(
                &categories,
                &constraint.category_id,
                "checklists.categoryId",
            )?;
            unique(&constraint.member_keys, "checklists.memberKeys")?;
        }
        if model.params.filters.len() > 64 {
            return Err(invalid("params.filters"));
        }
        unique(
            model.params.filters.iter().map(|p| &p.id),
            "params.filters.id",
        )?;
        unique(
            model.params.filters.iter().map(|p| &p.category_id),
            "params.filters.categoryId",
        )?;
        for param in &model.params.filters {
            for text in [&param.id, &param.category_id, &param.label] {
                if text.trim().is_empty() || text.len() > 256 {
                    return Err(invalid("params.filters"));
                }
            }
            reference(&categories, &param.category_id, "params.filters.categoryId")?;
        }
        unique(
            model.result_filters.iter().map(|f| &f.id),
            "resultFilters.id",
        )?;
        for filter in &model.result_filters {
            reference(&categories, &filter.category_id, "resultFilters.categoryId")?;
            match &filter.target {
                ResultTarget::Measure { id } => reference(&measures, id, "resultFilters.target")?,
                ResultTarget::Formula { id } => reference(&formulas, id, "resultFilters.target")?,
            }
            validate_literal(&filter.value, "resultFilters.value")?;
        }
        if let Some(pivot) = &model.legacy_pivot {
            validate_pivot(pivot)?;
        }
    }
    if let Some(AnalyticalDefinition::Statement(intent)) = &raw.definition.analytical {
        crate::statement::validate_intent(intent)?;
    }
    if let Some(source) = &raw.analytical_recipe_source {
        let model = raw.definition.analytical.as_ref().ok_or_else(|| {
            diagnostic(
                "INVALID_REQUEST",
                "analyticalRecipeSource",
                "Ordered recipe source requires an analytical model.",
            )
        })?;
        validate_analytical_recipe_source(source, model)?;
    }
    Ok(ValidatedDefinition {
        analytical_recipe_source: raw.analytical_recipe_source.clone(),
        locale: raw.locale.clone(),
        definition: raw.definition.clone(),
    })
}

/// Validate every original own value before stringify can omit undefined-valued properties.
#[allow(clippy::result_large_err)]
pub(crate) fn validate_original_recipe_graph(value: &WireValue) -> Result<(), Diagnostic> {
    enum Visit<'a> {
        Value(&'a WireValue, usize),
        ArrayLength(usize),
    }
    let invalid = |message: &str| diagnostic("INVALID_REQUEST", "analyticalRecipeSource", message);
    let mut remaining = 50000usize;
    let mut visits = vec![Visit::Value(value, 0)];
    while let Some(visit) = visits.pop() {
        let depth = match &visit {
            Visit::Value(_, depth) | Visit::ArrayLength(depth) => *depth,
        };
        if remaining == 0 || depth > 256 {
            return Err(invalid(
                "Ordered recipe source exceeds its plain-data budget.",
            ));
        }
        remaining -= 1;
        let Visit::Value(value, _) = visit else {
            continue;
        };
        match value {
            WireValue::Missing | WireValue::Null | WireValue::Bool(_) => {}
            WireValue::String(s) => {
                if s.encode_utf16().count() > 1000000 {
                    return Err(invalid("Ordered recipe source string exceeds its limit."));
                }
            }
            WireValue::F64(WireNumber::Finite(n)) if n.is_finite() => {}
            WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero)) => {}
            WireValue::Array(values) => {
                if values.len() + 1 > remaining {
                    return Err(invalid("Ordered recipe source exceeds its own-key budget."));
                }
                visits.push(Visit::ArrayLength(depth + 1));
                visits.extend(values.iter().rev().map(|v| Visit::Value(v, depth + 1)));
            }
            WireValue::Record(entries) => {
                if entries.len() > remaining {
                    return Err(invalid("Ordered recipe source exceeds its own-key budget."));
                }
                let mut names = std::collections::BTreeSet::new();
                if entries.iter().any(|(key, _)| !names.insert(key)) {
                    return Err(invalid("Ordered recipe source keys must be unique."));
                }
                visits.extend(
                    entries
                        .iter()
                        .rev()
                        .map(|(_, v)| Visit::Value(v, depth + 1)),
                );
            }
            _ => {
                return Err(invalid(
                    "Ordered recipe source requires finite JSON scalars.",
                ))
            }
        }
    }
    Ok(())
}

/// JSON.stringify-compatible serialization of ordered recipe source only. Execution stays typed.
#[allow(clippy::result_large_err)]
pub fn ordered_recipe_json(value: &WireValue) -> Result<String, Diagnostic> {
    validate_original_recipe_graph(value)?;
    enum Task<'a> {
        Value(&'a WireValue),
        Text(String),
    }
    let mut tasks = vec![Task::Value(value)];
    let mut out = String::new();
    while let Some(task) = tasks.pop() {
        match task {
            Task::Text(s) => out.push_str(&s),
            Task::Value(v) => match v {
                WireValue::Missing | WireValue::Null => out.push_str("null"),
                WireValue::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
                WireValue::String(v) => out.push_str(&serde_json::to_string(v).unwrap()),
                WireValue::F64(_) => out.push_str(&crate::ordering::number_string(
                    crate::ordering::number(v).unwrap(),
                )),
                WireValue::BigIntString(_) => unreachable!("validated above"),
                WireValue::Array(a) => {
                    out.push('[');
                    tasks.push(Task::Text("]".into()));
                    for (i, v) in a.iter().enumerate().rev() {
                        tasks.push(Task::Value(v));
                        if i > 0 {
                            tasks.push(Task::Text(",".into()));
                        }
                    }
                }
                WireValue::Record(r) => {
                    let mut entries: Vec<_> = r
                        .iter()
                        .filter(|(_, v)| !matches!(v, WireValue::Missing))
                        .collect();
                    entries.sort_by_key(|e| crate::contract::js_key_order(&e.0));
                    out.push('{');
                    tasks.push(Task::Text("}".into()));
                    for (i, (k, v)) in entries.into_iter().enumerate().rev() {
                        tasks.push(Task::Value(v));
                        tasks.push(Task::Text(format!(
                            "{}:",
                            serde_json::to_string(k).unwrap()
                        )));
                        if i > 0 {
                            tasks.push(Task::Text(",".into()));
                        }
                    }
                }
            },
        }
        if out.len() > 8388608 {
            return Err(diagnostic(
                "INVALID_REQUEST",
                "analyticalRecipeSource",
                "Ordered recipe source exceeds its byte budget.",
            ));
        }
    }
    Ok(out)
}
#[allow(clippy::result_large_err)]
pub fn validate_recipe_source(source: &WireValue, model: &TableModel) -> Result<(), Diagnostic> {
    // Recipe JSON follows baseline JSON.stringify zero-sign normalization; the typed
    // definition retains its original signed-zero literal for evaluation.
    recipe_matches(
        source,
        model,
        "Ordered recipe source is not a supported analytical model.",
        "Ordered recipe source disagrees with the typed analytical definition.",
    )
}
/// Ordered recipe JSON decodes as `T` and re-encodes to the typed definition.
#[allow(clippy::result_large_err)]
fn recipe_matches<T: serde::de::DeserializeOwned + serde::Serialize>(
    source: &WireValue,
    typed: &T,
    undecodable: &str,
    mismatch: &str,
) -> Result<(), Diagnostic> {
    let invalid = |message| diagnostic("INVALID_REQUEST", "analyticalRecipeSource", message);
    let decoded: T =
        serde_json::from_str(&ordered_recipe_json(source)?).map_err(|_| invalid(undecodable))?;
    if serde_json::to_value(decoded).ok() != serde_json::to_value(typed).ok() {
        return Err(invalid(mismatch));
    }
    Ok(())
}

#[allow(clippy::result_large_err)]
pub fn validate_analytical_recipe_source(
    source: &WireValue,
    model: &AnalyticalDefinition,
) -> Result<(), Diagnostic> {
    match model {
        AnalyticalDefinition::Table(m) => validate_recipe_source(source, m),
        AnalyticalDefinition::Statement(m) => {
            let message = "Ordered recipe source does not match the analytical definition.";
            recipe_matches(source, m.as_ref(), message, message)
        }
    }
}
