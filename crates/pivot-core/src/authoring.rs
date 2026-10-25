// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(clippy::result_large_err)]
//! Private acquired-input authoring; never publishes candidate rows or compiled models.
use crate::{
    contract::*,
    formulas::*,
    ordering::ValueOrder,
    scopes::*,
    session::{problem, BindingResult},
};
pub(crate) fn context(
    input: &SourceDataset,
    d: &ValidatedDefinition,
    order: &dyn ValueOrder,
) -> Result<(CompiledModel, EligiblePool), Diagnostic> {
    if !matches!(
        d.definition.analytical,
        Some(AnalyticalDefinition::Table(_))
    ) {
        return Err(problem(
            "INVALID_REQUEST",
            "Authoring requires an analytical table model",
        ));
    }
    if serde_json::to_vec(&d.definition).map_or(true, |v| v.len() > 8388608) {
        return Err(problem(
            "INVALID_REQUEST",
            "Formula authoring payload exceeds budget",
        ));
    }
    let fiscal = crate::fiscal::parse_fiscal_context(
        input
            .provenance
            .metadata
            .as_ref()
            .and_then(|m| m.get("fiscalContext"))
            .unwrap_or(&WireValue::Missing),
    )
    .map_err(|errors| problem(&errors[0].code, &errors[0].message))?;
    let compiled = compile_with_fiscal(d, &input.columns, fiscal);
    let evaluated = evaluate_source(&input.rows, &compiled);
    let pool = eligible_pool(&evaluated, &compiled, &RuntimeParams::new(), order);
    for recipe in pool.authoring_recipes.values() {
        recipe.as_ref().map_err(Clone::clone)?;
    }
    Ok((compiled, pool))
}
pub(crate) fn preview(text: &str, max: usize) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if out.len() + c.len_utf8() > max {
            break;
        }
        out.push(c)
    }
    out
}
pub(crate) fn bind(
    input: &SourceDataset,
    d: &ValidatedDefinition,
    draft: &FormulaDraft,
    bindings: &[ScopedBinding],
    order: &dyn ValueOrder,
) -> Result<BindingResult, Diagnostic> {
    if bindings.len() > 1024
        || [&draft.id, &draft.name, &draft.expression]
            .iter()
            .any(|s| s.len() > 16384)
        || bindings.iter().any(|b| {
            b.name.len() > 16384
                || serde_json::to_vec(&b.reference).map_or(true, |v| v.len() > 131072)
        })
    {
        return Err(problem(
            "INVALID_REQUEST",
            "Invalid bounded formula binding request",
        ));
    }
    if draft.id.is_empty()
        || draft.name.is_empty()
        || draft.format.as_ref().is_some_and(|f| f.len() > 16384)
    {
        return Err(problem(
            "INVALID_REQUEST",
            "Formula authoring text exceeds budget",
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut encoded = vec![];
    for b in bindings {
        let FormulaAst::Reference { id, .. } = &b.reference else {
            return Err(problem("INVALID_REQUEST", "Invalid scoped reference"));
        };
        if b.name.is_empty() || id.is_empty() || id.len() > 16384 {
            return Err(problem(
                "INVALID_REQUEST",
                "Formula authoring text exceeds budget",
            ));
        }
        let scope = serde_json::to_string(&b.scope).unwrap();
        if !seen.insert((scope, b.name.clone())) {
            return Err(problem("INVALID_REQUEST", "Duplicate scoped reference"));
        }
        encoded.push(serde_json::json!({"scope":b.scope,"name":b.name,"reference":b.reference}));
    }
    if serde_json::to_vec(&encoded).unwrap().len() > 131072 {
        return Err(problem("INVALID_REQUEST", "Scoped binding budget exceeded"));
    }
    let (mut compiled, pool) = context(input, d, order)?;
    compiled.symbols = observed_symbols(&compiled, &pool);
    let mut result = bind_formula(&compiled, draft, bindings);
    for diagnostic in &mut result.diagnostics {
        if diagnostic.code == "missing-member"
            && diagnostic.dependency_ids.first().is_some_and(|id| {
                pool.universe.evaluated.rows.iter().any(|r| {
                    !pool
                        .universe
                        .members
                        .get(&r.id)
                        .and_then(|m| m.get(id))
                        .is_some_and(Result::is_ok)
                })
            })
        {
            diagnostic.code = "blocked-dependency".into();
            diagnostic.message="Member identity is unknown because acquired category classification is incomplete.".into();
        }
    }
    let count = result.diagnostics.len();
    let mut size = 2;
    let diagnostics = result
        .diagnostics
        .into_iter()
        .filter(|d| {
            d.message.len() <= 1024
                && d.definition_id.as_ref().is_none_or(|s| s.len() <= 16384)
                && [&d.dependency_ids, &d.candidate_ids]
                    .iter()
                    .all(|ids| ids.len() <= 100 && ids.iter().all(|id| id.len() <= 16384))
        })
        .take(100)
        .take_while(|d| {
            size += serde_json::to_vec(d).unwrap().len() + 1;
            size <= 131072
        })
        .collect::<Vec<_>>();
    let mut warning_size = 2;
    let warnings = pool
        .universe
        .warnings
        .iter()
        .map(|w| {
            let mut d = problem(&w.code, &preview(&w.message, 1024));
            d.severity = Severity::Warning;
            d.path = None;
            d
        })
        .take(100)
        .take_while(|d| {
            warning_size += serde_json::to_vec(d).unwrap().len() + 1;
            warning_size <= 16384
        })
        .collect::<Vec<_>>();
    let warning_count = pool.universe.warnings.len();
    Ok(BindingResult {
        ast: result.ast,
        binding_diagnostics: diagnostics.clone(),
        diagnostic_count: count as u64,
        truncated: diagnostics.len() < count,
        resolved_operators: result.resolved_operators,
        authoring_warnings_truncated: warnings.len() < warning_count,
        authoring_warnings: warnings,
        authoring_warning_count: warning_count as u64,
    })
}
