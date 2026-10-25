// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(clippy::result_large_err)]
use super::*;

pub(super) fn prepare(
    input: &SourceDataset,
    d: &ValidatedDefinition,
    s: &SelectionSpec,
    runtime: &RuntimeParams,
    revision: &Revision,
    order: &dyn ValueOrder,
) -> Result<StoredView, Diagnostic> {
    if d.definition.analytical.is_none() {
        return legacy::prepare(input, d, s, revision, order, false);
    }
    let a = crate::analytical::calculate_view(input, d, s, runtime, order)?;
    let mut hierarchy = selection::hierarchy(&a.groups);
    let mut identities = BTreeSet::new();
    let model = a
        .compiled
        .definition
        .definition
        .analytical
        .as_ref()
        .and_then(AnalyticalDefinition::table)
        .unwrap();
    let categories = if model.enabled {
        &model.layout.rows[..]
    } else {
        &[]
    };
    if !categories.is_empty() {
        for row in &a.pool.universe.evaluated.rows {
            let mut keys = vec![];
            let mut path: Vec<String> = vec![];
            for category in categories {
                let Some(Ok(member)) = a.pool.members.get(&row.id).and_then(|m| m.get(category))
                else {
                    break;
                };
                keys.push(member.key.clone());
                let id = serde_json::to_string(&(
                    "group",
                    a.selection_namespace.as_deref().unwrap_or_default(),
                    keys.join(crate::pivot::KEY_SEP),
                ))
                .unwrap();
                identities.insert(id.clone());
                for ancestor in &path {
                    let children = hierarchy.entry(ancestor.clone()).or_default();
                    if !children.contains(&id) {
                        children.push(id.clone());
                    }
                }
                path.push(id);
            }
        }
    } else if a.selection_namespace.is_none() {
        identities.extend(a.pool.universe.evaluated.rows.iter().map(|r| r.id.clone()));
    } else {
        identities.extend(a.eligible_rows.iter().map(|r| r.id.clone()));
    }
    if a.compiled.execution.is_some() {
        identities.extend(a.eligible_rows.iter().map(|r| r.id.clone()));
        hierarchy = selection::hierarchy(&a.groups);
    }
    let facets = a
        .compiled
        .categories
        .iter()
        .map(|category| {
            let id = &category.id;
            let members = crate::scopes::category_facets(&a.pool, id);
            let members = members
                .iter()
                .map(|m| FacetMember {
                    key: m.member.key.clone(),
                    label: m.member.label.clone(),
                    value: m.member.value.clone(),
                    count: m.count as u64,
                })
                .collect::<Vec<_>>();
            (
                id.clone(),
                ScopedValues {
                    scope: Scope::Filtered,
                    values: members
                        .iter()
                        .map(|m| {
                            (
                                m.key.clone(),
                                WireValue::F64(WireNumber::Finite(m.count as f64)),
                            )
                        })
                        .collect(),
                    empty: None,
                    cell_errors: None,
                    members: Some(members),
                },
            )
        })
        .collect();
    let chart_columns = if model.enabled && !model.layout.columns.is_empty() {
        let constrained = !d.definition.search.is_empty()
            || d.definition
                .table
                .column_filters
                .as_ref()
                .is_some_and(|f| !f.is_empty())
            || !model.checklists.is_empty()
            || !model.result_filters.is_empty()
            || model.layout.page.is_some()
            || !runtime.is_empty();
        if constrained {
            let mut unfiltered = a.compiled.definition.clone();
            unfiltered.definition.search.clear();
            unfiltered.definition.table.column_filters = None;
            let model = unfiltered
                .definition
                .analytical
                .as_mut()
                .and_then(AnalyticalDefinition::table_mut)
                .unwrap();
            model.checklists.clear();
            model.result_filters.clear();
            model.layout.page = None;
            if let Some(WireValue::Record(raw)) = &mut unfiltered.analytical_recipe_source {
                for (k, v) in raw {
                    if k == "checklists" || k == "resultFilters" {
                        *v = WireValue::Array(vec![])
                    } else if k == "layout" {
                        if let WireValue::Record(layout) = v {
                            layout.retain(|(k, _)| k != "page");
                        }
                    }
                }
            }
            Some(
                crate::analytical::calculate_view(
                    input,
                    &unfiltered,
                    &SelectionSpec::None,
                    &RuntimeParams::new(),
                    order,
                )?
                .columns,
            )
        } else {
            Some(a.columns.clone())
        }
    } else {
        None
    };
    let v = StoredView {
        saved: d.clone(),
        revision: revision.clone(),
        rows: a.rows.clone(),
        groups: a.groups.clone(),
        eligible: a.eligible_rows.clone(),
        columns: a.columns.clone(),
        chart_columns,
        namespace: a.selection_namespace.clone(),
        identity_ids: identities,
        hierarchy,
        selection: s.clone(),
        completeness: a.completeness.clone(),
        diagnostics: a.diagnostics.clone(),
        totals: a.totals.clone(),
        facets,
        provenance: a.provenance.clone(),
        freshness: a.freshness.clone(),
        input_columns: {
            let columns = if matches!(
                d.definition.analytical,
                Some(AnalyticalDefinition::Statement(_))
            ) {
                &input.columns
            } else {
                &a.compiled.columns
            };
            columns
                .iter()
                .map(|c| {
                    let mut c = c.clone();
                    if c.dtype.is_none() {
                        let (kind, _) =
                            legacy::kind(&c.id, &a.pool.universe.evaluated.rows, Some(&c));
                        if kind != "none" {
                            c.dtype = Some(if kind == "date" {
                                "dateString".into()
                            } else {
                                kind
                            });
                        }
                    }
                    c
                })
                .collect()
        },
        input_periodicity: BTreeMap::new(),
        analytical: Some(a),
    };
    Ok(v)
}
