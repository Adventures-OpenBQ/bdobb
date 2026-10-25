#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
const MAX_SAFE: u64 = 9007199254740991;
fn ids(values: &[String]) -> Result<(), Diagnostic> {
    if values.iter().any(String::is_empty) {
        Err(problem("INVALID_REQUEST", "Expected nonempty ID"))
    } else {
        Ok(())
    }
}
fn definition(d: &ValidatedDefinition, locale: &str) -> Result<(), Diagnostic> {
    if d.locale != locale {
        return Err(problem(
            "INVALID_REQUEST",
            "Definition locale does not match session",
        ));
    }
    crate::validation::validate_definition(&WireDefinition {
        protocol_version: crate::PROTOCOL_VERSION,
        locale: d.locale.clone(),
        definition: d.definition.clone(),
        analytical_recipe_source: d.analytical_recipe_source.clone(),
    })?;
    Ok(())
}
pub(super) fn request(q: &CoreRequest, locale: &str) -> Result<(), Diagnostic> {
    if q.request_id.is_empty() || q.revision.widget_id.is_empty() {
        return Err(problem("INVALID_REQUEST", "Expected nonempty ID"));
    }
    if [q.revision.input, q.revision.model, q.revision.output]
        .iter()
        .any(|n| *n > MAX_SAFE)
    {
        return Err(problem(
            "INVALID_REQUEST",
            "Expected nonnegative safe integer",
        ));
    }
    match &q.operation {
        Operation::RegisterInput { input_revision, .. }
        | Operation::ImportFile { input_revision, .. } => {
            if *input_revision != q.revision.input {
                return Err(problem("INVALID_REQUEST", "Input revision mismatch"));
            }
        }
        Operation::ApplyModel {
            definition: d,
            selection,
            proven_absent_ids,
            previous_selection_namespace,
            runtime_params,
            ..
        } => {
            definition(d, locale)?;
            ids(proven_absent_ids)?;
            if previous_selection_namespace
                .as_ref()
                .is_some_and(String::is_empty)
            {
                return Err(problem("INVALID_REQUEST", "Expected nonempty ID"));
            }
            match selection {
                SelectionSpec::Explicit { ids: values }
                | SelectionSpec::AllMatching {
                    excluded_ids: values,
                } => ids(values)?,
                _ => {}
            }
            crate::scopes::validate_runtime_params(runtime_params, None)?;
        }
        Operation::PreviewDefinition(d)
        | Operation::BindFormula { definition: d, .. }
        | Operation::MemberDomain { definition: d, .. } => definition(d, locale)?,
        Operation::IdentityWitness { path, ids: values } => {
            ids(values)?;
            for d in path {
                definition(d, locale)?
            }
        }
        Operation::Selection {
            action,
            visible_ids,
        } => {
            ids(visible_ids)?;
            if let SelectionAction::Toggle { row_id } = action {
                if row_id.is_empty() {
                    return Err(problem("INVALID_REQUEST", "Expected nonempty ID"));
                }
            }
        }
        Operation::Rows(r) => {
            ids(&r.group_path)?;
            if r.offset > MAX_SAFE {
                return Err(problem(
                    "INVALID_REQUEST",
                    "Expected nonnegative safe integer",
                ));
            }
        }
        Operation::ChartData { fields } => ids(fields)?,
        Operation::Facets { category_id } => ids(std::slice::from_ref(category_id))?,
        Operation::Presented { transfer_id, .. } | Operation::NextSubset { transfer_id, .. } => {
            ids(std::slice::from_ref(transfer_id))?
        }
        Operation::Cancel { target_request_id } => ids(std::slice::from_ref(target_request_id))?,
        Operation::Inspect(r) => {
            if r.offset > MAX_SAFE || !(1..=100).contains(&r.limit) {
                return Err(problem("INVALID_REQUEST", "Invalid inspection page bounds"));
            }
            if let Some(id) = &r.definition_id {
                if !matches!(r.collection, InspectionCollection::Definitions)
                    || id.is_empty()
                    || id.len() > 16384
                {
                    return Err(problem("INVALID_REQUEST", "Invalid definition selector"));
                }
            }
            if matches!(r.collection, InspectionCollection::GroupDomain) {
                for (value, maximum) in [
                    (&r.param_key, 512),
                    (&r.category_id, 16384),
                    (&r.category_recipe, 16384),
                ] {
                    if value
                        .as_ref()
                        .is_none_or(|value| value.is_empty() || value.len() > maximum)
                    {
                        return Err(problem("INVALID_REQUEST", "Invalid domain identity"));
                    }
                }
                if let Some((group_id, transport_value)) = &r.group_evidence {
                    let params = RuntimeParams::from([(
                        r.param_key.clone().unwrap(),
                        RuntimeParam::Group {
                            group_id: group_id.clone(),
                            transport_value: transport_value.clone(),
                        },
                    )]);
                    crate::scopes::validate_runtime_params(&params, None)?;
                }
            } else if r.param_key.is_some()
                || r.category_id.is_some()
                || r.category_recipe.is_some()
                || r.group_evidence.is_some()
            {
                return Err(problem("INVALID_REQUEST", "Unexpected group evidence"));
            }
        }
        _ => {}
    }
    if let Operation::NextSubset { sequence, .. } = &q.operation {
        if *sequence > MAX_SAFE {
            return Err(problem(
                "INVALID_REQUEST",
                "Expected nonnegative safe integer",
            ));
        }
    }
    if let Operation::MemberDomain { offset, .. } = &q.operation {
        if *offset > MAX_SAFE {
            return Err(problem("INVALID_REQUEST", "Invalid authoring count"));
        }
    }
    Ok(())
}
pub(super) fn dataset(input: &SourceDataset, revision: u64) -> Result<(), Diagnostic> {
    if revision > MAX_SAFE
        || input.result_revision > MAX_SAFE
        || input.output_revision > MAX_SAFE
        || input.provenance.source_widget_id.is_empty()
        || input.columns.iter().any(|c| c.id.is_empty())
        || input.rows.iter().any(|r| r.id.is_empty())
    {
        return Err(problem(
            "INVALID_REQUEST",
            "Invalid dataset identity or revision",
        ));
    }
    if input
        .freshness
        .last_success_at
        .is_some_and(|t| !t.is_finite())
    {
        return Err(problem("INVALID_REQUEST", "Expected finite number"));
    }
    for row in &input.rows {
        for v in row.values.values() {
            crate::validation::validate_wire_value(v)?;
        }
        for m in row.group_path.iter().flatten() {
            crate::validation::validate_wire_value(&m.value)?;
        }
    }
    for c in &input.columns {
        for v in c.metadata.iter().flat_map(|m| m.values()) {
            crate::validation::validate_wire_value(v)?;
        }
        for m in c.split_path.iter().flatten() {
            crate::validation::validate_wire_value(&m.value)?;
        }
    }
    for v in input
        .provenance
        .metadata
        .iter()
        .chain(&input.provenance.parameters)
        .chain(&input.provenance.receipt)
        .flat_map(|m| m.values())
    {
        crate::validation::validate_wire_value(v)?;
    }
    Ok(())
}
