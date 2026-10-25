#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    analytical::CalculatedView,
    contract::*,
    formulas::CompiledModel,
    ordering::value_string,
    session::{StoredView, *},
};
use std::collections::BTreeSet;
pub(crate) fn counts(v: &StoredView) -> InspectionCounts {
    v.analytical
        .as_ref()
        .map(|a| {
            let m = crate::analytical::model(&a.compiled);
            InspectionCounts {
                definitions: (m.categories.len() + m.measures.len() + m.formulas.len()) as u64,
                warnings: a.warnings.len() as u64,
                period_bounds: a.warnings.iter().map(|w| w.periods.len() as u64).sum(),
            }
        })
        .unwrap_or_default()
}
fn bound(
    kind: &str,
    id: &str,
    name: &str,
    ast: Option<&FormulaAst>,
    source: Option<&str>,
    operator: Option<Aggregation>,
    m: &CompiledModel,
) -> InspectionRow {
    let mut references = source.map(|s| vec![s.to_string()]).unwrap_or_default();
    let mut operators = operator.into_iter().collect::<Vec<_>>();
    let mut visited = BTreeSet::new();
    let mut nodes = ast.map(|a| vec![(a, true)]).unwrap_or_default();
    while let Some((node, direct)) = nodes.pop() {
        match node {
            FormulaAst::Reference { target, id } => {
                if direct && !references.contains(id) {
                    references.push(id.clone())
                }
                match target {
                    ReferenceTarget::Measure => {
                        if let Some(op) = m
                            .symbols
                            .measures
                            .iter()
                            .find(|m| m.value.id == *id)
                            .and_then(|m| m.value.aggregation)
                        {
                            if !operators.contains(&op) {
                                operators.push(op)
                            }
                        }
                    }
                    ReferenceTarget::Formula if visited.insert(id) => {
                        if let Some(f) = m
                            .graph
                            .entries
                            .iter()
                            .find_map(|e| e.value.as_ref().filter(|f| f.id == *id))
                        {
                            nodes.push((&f.ast, false))
                        }
                    }
                    _ => {}
                }
            }
            FormulaAst::Unary { operand, .. } => nodes.push((operand, direct)),
            FormulaAst::Binary { left, right, .. } => {
                nodes.push((right, direct));
                nodes.push((left, direct));
            }
            FormulaAst::Call { function, args } => {
                let op = crate::formulas::function_aggregation(*function);
                if let Some(op) = op {
                    if !operators.contains(&op) {
                        operators.push(op)
                    }
                }
                for arg in args.iter().rev() {
                    nodes.push((arg, direct))
                }
            }
            FormulaAst::Member { value, selectors } => {
                if direct {
                    for s in selectors {
                        if !references.contains(&s.category_id) {
                            references.push(s.category_id.clone())
                        }
                    }
                }
                nodes.push((value, direct))
            }
            _ => {}
        }
    }
    let count = references.len();
    references.truncate(100);
    InspectionRow::Definition {
        kind: kind.into(),
        id: id.into(),
        name: name.into(),
        reference_ids: references,
        reference_count: count as u64,
        truncated_references: count > 100,
        resolved_operators: operators,
        scope: None,
        source_filter_kind: None,
    }
}
pub(crate) fn page(v: &StoredView, r: &InspectionRequest) -> Result<InspectionPage, Diagnostic> {
    if !(1..=100).contains(&r.limit) {
        return Err(problem(
            "INVALID_REQUEST",
            "Inspection page must have a nonnegative offset and limit 1–100",
        ));
    }
    if matches!(r.collection, InspectionCollection::GroupDomain) {
        return domain(v, r);
    }
    if r.definition_id.as_ref().is_some_and(|id| {
        !matches!(r.collection, InspectionCollection::Definitions)
            || id.is_empty()
            || id.len() > 16384
    }) {
        return Err(problem("INVALID_REQUEST", "Invalid definition selector"));
    }
    let mut rows = vec![];
    if let Some(a) = &v.analytical {
        let m = crate::analytical::model(&a.compiled);
        match r.collection {
            InspectionCollection::Definitions => {
                let mut matches = 0;
                for c in &m.categories {
                    if r.definition_id.as_ref().is_none_or(|id| id == &c.id) {
                        matches += 1;
                        rows.push(bound(
                            "category",
                            &c.id,
                            &c.name,
                            None,
                            Some(&c.source_field_id),
                            None,
                            &a.compiled,
                        ))
                    }
                }
                for measure in &m.measures {
                    if r.definition_id.as_ref().is_none_or(|id| id == &measure.id) {
                        matches += 1;
                        rows.push(bound(
                            "measure",
                            &measure.id,
                            measure
                                .custom_label
                                .as_deref()
                                .unwrap_or(&measure.source_field_id),
                            None,
                            Some(&measure.source_field_id),
                            measure.aggregation,
                            &a.compiled,
                        ))
                    }
                }
                for f in &m.formulas {
                    if r.definition_id.as_ref().is_none_or(|id| id == &f.id) {
                        matches += 1;
                        let mut row = bound(
                            "formula",
                            &f.id,
                            &f.name,
                            Some(&f.ast),
                            None,
                            None,
                            &a.compiled,
                        );
                        if f.scope == FormulaScope::Source {
                            if let InspectionRow::Definition {
                                scope,
                                source_filter_kind,
                                ..
                            } = &mut row
                            {
                                *scope = Some(f.scope);
                                *source_filter_kind = Some(
                                    crate::session::legacy::kind(
                                        &f.id,
                                        &a.pool.universe.evaluated.rows,
                                        None,
                                    )
                                    .0,
                                );
                            }
                        }
                        rows.push(row)
                    }
                }
                if r.definition_id.is_some() && matches > 1 {
                    return Err(problem(
                        "INVALID_REQUEST",
                        "Definition selector is ambiguous",
                    ));
                }
            }
            InspectionCollection::Warnings => {
                for (i, w) in a.warnings.iter().enumerate() {
                    rows.push(InspectionRow::Warning {
                        id: format!("warning:{i}"),
                        code: w.code.clone(),
                        message: w.message.clone(),
                        category_id: w.category_id.clone(),
                        period_count: w.periods.len() as u64,
                    })
                }
            }
            InspectionCollection::PeriodBounds => {
                for (i, w) in a.warnings.iter().enumerate() {
                    for p in &w.periods {
                        rows.push(InspectionRow::PeriodBounds {
                            warning_id: format!("warning:{i}"),
                            category_id: w.category_id.clone(),
                            company_key: p.company_key.clone(),
                            start: p.start.clone(),
                            end: p.end.clone(),
                            source: p.source.clone(),
                            period: m
                                .categories
                                .iter()
                                .find(|c| Some(&c.id) == w.category_id.as_ref())
                                .map(|c| {
                                    serde_json::to_value(c.transform)
                                        .unwrap()
                                        .as_str()
                                        .unwrap()
                                        .to_string()
                                })
                                .unwrap_or("native".into()),
                            context: w.message.clone(),
                        })
                    }
                }
            }
            _ => {}
        }
    }
    let total = rows.len() as u64;
    let rows = rows
        .into_iter()
        .skip(r.offset as usize)
        .take(r.limit as usize)
        .collect::<Vec<_>>();
    let next = r.offset + rows.len() as u64;
    Ok(InspectionPage {
        request: r.clone(),
        rows,
        total,
        next_offset: (next < total).then_some(next),
        truncated: next < total,
        domain: None,
    })
}
fn category_errors(a: &CalculatedView, id: &str) -> u64 {
    a.pool
        .universe
        .evaluated
        .rows
        .iter()
        .filter(|r| {
            !a.pool
                .universe
                .members
                .get(&r.id)
                .and_then(|m| m.get(id))
                .is_some_and(Result::is_ok)
        })
        .count() as u64
}
fn domain(v: &StoredView, r: &InspectionRequest) -> Result<InspectionPage, Diagnostic> {
    let a = v.analytical.as_ref().ok_or_else(|| {
        problem(
            "INVALID_REQUEST",
            "Group domain requires the exact active saved category identity",
        )
    })?;
    let m = crate::analytical::model(&a.compiled);
    let id = r.category_id.as_deref().unwrap_or_default();
    let c = m.categories.iter().find(|c| c.id == id).ok_or_else(|| {
        problem(
            "INVALID_REQUEST",
            "Group domain requires the exact active saved category identity",
        )
    })?;
    let active = m.params.filters.iter().any(|f| {
        f.category_id == id && r.param_key.as_deref() == Some(&format!("pivot:filter:{id}"))
    }) || m.params.promote_page
        && m.layout
            .page
            .as_ref()
            .is_some_and(|page| page.category_id == id)
        && r.param_key.as_deref() == Some("pivot:page");
    if !active
        || r.category_recipe.as_deref() != Some(crate::categories::category_recipe(c).as_str())
    {
        return Err(problem(
            "INVALID_REQUEST",
            "Group domain requires the exact active saved category identity",
        ));
    }
    if let Some((group, transport)) = &r.group_evidence {
        let mut params = RuntimeParams::new();
        params.insert(
            r.param_key.clone().unwrap(),
            RuntimeParam::Group {
                group_id: group.clone(),
                transport_value: transport.clone(),
            },
        );
        crate::scopes::validate_runtime_params(&params, Some(&a.compiled))?;
    }
    let transport = r
        .group_evidence
        .as_ref()
        .map(|(_, s)| s.as_str())
        .unwrap_or_default();
    let resolution =
        crate::scopes::observed_group_resolution(transport, &a.pool.universe, id, &a.compiled);
    let source = a
        .pool
        .observed_members
        .get(id)
        .map(Vec::as_slice)
        .unwrap_or_default();
    // Index once: first facet per key, as the former linear finds returned.
    fn counts(facets: &[crate::scopes::MemberFacet]) -> std::collections::HashMap<&str, u64> {
        let mut by_key = std::collections::HashMap::new();
        for f in facets {
            by_key
                .entry(f.member.key.as_str())
                .or_insert(f.count as u64);
        }
        by_key
    }
    let observed_counts = counts(source);
    let eligible_counts = counts(
        a.pool
            .eligible_members
            .get(id)
            .map(Vec::as_slice)
            .unwrap_or_default(),
    );
    let matched_keys: std::collections::HashSet<_> =
        resolution.keys.iter().map(String::as_str).collect();
    let mut omitted = 0;
    let mut projected = vec![];
    for member in source {
        let member = &member.member;
        let transport = if c.transform == Transform::Native && c.legacy_bucket.is_none() {
            value_string(&member.value)
        } else {
            member.label.clone()
        };
        let label = crate::authoring::preview(&member.label, 256);
        if member.key.len() > 16384 || transport.len() > 16384 {
            omitted += 1;
            projected.push(None)
        } else {
            projected.push(Some(InspectionRow::GroupMember {
                key: member.key.clone(),
                label: label.clone(),
                transport,
                label_truncated: label != member.label,
                observed_count: observed_counts[member.key.as_str()],
                eligible_count: eligible_counts
                    .get(member.key.as_str())
                    .copied()
                    .unwrap_or(0),
                matched: matched_keys.contains(member.key.as_str()),
            }));
        }
    }
    let start = (r.offset as usize).min(projected.len());
    let mut end = start;
    let mut rows = vec![];
    let mut bytes: usize = 2;
    while end < projected.len() && end - start < r.limit as usize {
        if let Some(row) = &projected[end] {
            let size = serde_json::to_vec(row).map_or(usize::MAX, |v| v.len())
                + usize::from(!rows.is_empty());
            if bytes.saturating_add(size) > 131072 {
                break;
            }
            bytes += size;
            rows.push(row.clone());
        }
        end += 1;
    }
    let errors = category_errors(a, id);
    Ok(InspectionPage {
        request: r.clone(),
        rows,
        total: projected.len() as u64,
        next_offset: (end < projected.len()).then_some(end as u64),
        truncated: end < projected.len(),
        domain: Some(GroupDomainSummary {
            classification_complete: errors == 0 && resolution.classification_complete,
            category_error_count: errors,
            omitted_count: omitted,
            scanned: (end - start) as u64,
            status: resolution.status,
            reason: resolution.reason,
            input_count: resolution.input_count as u64,
            matched_key_count: resolution.keys.len() as u64,
            unmatched: resolution
                .unmatched
                .iter()
                .take(8)
                .map(|s| crate::authoring::preview(s, 256))
                .collect(),
            unmatched_count: resolution.unmatched.len() as u64,
        }),
    })
}
