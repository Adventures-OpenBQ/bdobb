// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Provider declaration preflight. No acquisition, backend endpoints, or calculation fallback.
#![allow(clippy::result_large_err)]
use crate::contract::*;
fn refusal(capability: &str) -> Diagnostic {
    crate::validation::diagnostic(
        "UNSUPPORTED_CAPABILITY",
        "provider",
        &format!("Provider does not support {capability}"),
    )
}
fn aggregation(c: &CapabilityDeclaration, value: Aggregation) -> Result<(), Diagnostic> {
    if c.aggregations.contains(&value) {
        Ok(())
    } else {
        Err(refusal("aggregation"))
    }
}
fn formula(c: &CapabilityDeclaration, node: &FormulaAst) -> Result<(), Diagnostic> {
    match node {
        FormulaAst::Call { function, args } => {
            if !c.formula_functions.contains(function) {
                return Err(refusal("formula function"));
            }
            for arg in args {
                formula(c, arg)?;
            }
        }
        FormulaAst::Binary { left, right, .. } => {
            formula(c, left)?;
            formula(c, right)?;
        }
        FormulaAst::Unary { operand, .. } => formula(c, operand)?,
        FormulaAst::Member { value, .. } => formula(c, value)?,
        _ => {}
    }
    Ok(())
}
/// Called by an adapter BEFORE Session::dispatch(ApplyModel). Session keeps owning atomic publication.
pub fn preflight(
    c: &CapabilityDeclaration,
    d: &ValidatedDefinition,
    selection: &SelectionSpec,
) -> Result<(), Diagnostic> {
    if !c.protocol_versions.contains(&crate::PROTOCOL_VERSION) {
        return Err(refusal("protocol version"));
    }
    if !c.selection && !matches!(selection, SelectionSpec::None) {
        return Err(refusal("selection"));
    }
    let version = d
        .definition
        .analytical
        .as_ref()
        .map_or(1, AnalyticalDefinition::schema_version);
    if !c.definition_versions.contains(&version) {
        return Err(refusal("definition version"));
    }
    if let Some(p) = &d.definition.table.pivot {
        if p.enabled {
            for a in p.aggregation_fns.iter().flat_map(|m| m.values()) {
                aggregation(c, *a)?;
            }
            for a in p.measures.iter().flatten().filter_map(|m| m.aggregation) {
                aggregation(c, a)?;
            }
        }
    }
    match &d.definition.analytical {
        Some(AnalyticalDefinition::Table(model)) => {
            if !c.fiscal
                && model.categories.iter().any(|v| {
                    matches!(v.transform, Transform::FY | Transform::FQ)
                        || v.fiscal_binding.is_some()
                })
            {
                return Err(refusal("fiscal"));
            }
            for m in &model.measures {
                if let Some(a) = m.aggregation {
                    aggregation(c, a)?;
                }
            }
            for f in &model.formulas {
                formula(c, &f.ast)?;
            }
        }
        Some(AnalyticalDefinition::Statement(intent)) => {
            if !c.fiscal {
                return Err(refusal("fiscal"));
            }
            aggregation(c, Aggregation::Sum)?;
            for f in intent
                .template
                .lines
                .iter()
                .filter_map(|l| l.formula.as_ref())
                .chain(intent.overrides.formulas.iter())
            {
                formula(c, &f.ast)?;
            }
        }
        None => {}
    }
    Ok(())
}
