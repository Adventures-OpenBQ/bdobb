// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Maintained Pivot hierarchy with scoped cells, identities and column metadata.
use super::*;
use super::{
    hierarchy::{sort_source, visit},
    projection_columns::*,
};
use crate::pivot::{self, FieldKind, PivotColumn, PivotInput, PivotRowMeta, KEY_SEP, LABEL_FIELD};
#[allow(clippy::result_large_err)]
pub(super) fn project(
    v: &mut CalculatedView,
    a: &TableModel,
    surviving: &[DatasetRow],
    page: &[DatasetRow],
    order: &dyn ValueOrder,
    scope_results: &mut totals::ScopeResults,
) -> Result<(), Diagnostic> {
    let grouped = !a.layout.rows.is_empty() || !a.layout.columns.is_empty();
    if !grouped {
        v.rows = surviving
            .iter()
            .map(|r| {
                let mut r = r.clone();
                for (id, c) in v.pool.formula_cells.get(&r.id).into_iter().flatten() {
                    if let CellResult::Error(e) = c {
                        r.values
                            .insert(id.clone(), WireValue::String("#ERROR".into()));
                        r.cell_errors
                            .get_or_insert_with(BTreeMap::new)
                            .insert(id.clone(), compact_cell_error(e)?);
                    }
                }
                Ok(r)
            })
            .collect::<Result<Vec<_>, Diagnostic>>()?;
        sort_source(&mut v.rows, &v.compiled, false, order)?;
        v.eligible_rows = v.rows.clone();
        finish_columns(v);
        return Ok(());
    }
    v.provenance.input_may_contain_aggregates = Some(true);
    let first_values = FirstValues::new(&v.pool, a);
    let signature = serde_json::to_string(
        &a.layout
            .rows
            .iter()
            .chain(&a.layout.columns)
            .map(|id| {
                let c = v.pool.categories.iter().find(|c| &c.id == id).unwrap();
                Ok((id, c.recipe.as_ref().map_err(Clone::clone)?))
            })
            .collect::<Result<Vec<_>, Diagnostic>>()?,
    )
    .unwrap();
    v.selection_namespace = Some(signature.clone());
    let mut columns = v.compiled.columns.clone();
    columns.extend(
        v.compiled
            .symbols
            .formulas
            .iter()
            .filter(|f| f.scope == FormulaScope::Source)
            .filter(|f| !columns.iter().any(|c| c.id == f.id))
            .map(|f| serde_json::from_value(serde_json::json!({"id":f.id,"label":f.name})).unwrap())
            .collect::<Vec<DatasetColumn>>(),
    );
    for f in v
        .compiled
        .symbols
        .formulas
        .iter()
        .filter(|f| f.scope == FormulaScope::Aggregate)
    {
        columns
            .push(serde_json::from_value(serde_json::json!({"id":f.id,"label":f.name})).unwrap());
    }
    for m in &a.measures {
        if !columns.iter().any(|c| c.id == m.source_field_id) {
            columns.push(
                serde_json::from_value(
                    serde_json::json!({"id":m.source_field_id,"label":m.source_field_id}),
                )
                .unwrap(),
            );
        }
    }
    let mut measures = vec![];
    let mut ids = a.layout.values.clone();
    ids.extend(a.measures.iter().map(|m| m.id.clone()));
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        if let Some(symbol) = v
            .compiled
            .symbols
            .measures
            .iter()
            .find(|m| m.value.id == id)
        {
            let mut m = symbol.value.clone();
            m.custom_label = Some(symbol.name.clone());
            measures.push(m);
        } else if let Some(f) = v
            .compiled
            .symbols
            .formulas
            .iter()
            .find(|f| f.id == id && f.scope == FormulaScope::Aggregate)
        {
            measures.push(Measure {
                id: id.clone(),
                source_field_id: id,
                aggregation: None,
                custom_label: Some(f.name.clone()),
            });
        }
    }
    let mut pivot_columns: Vec<_> = columns
        .iter()
        .map(|c| PivotColumn::source(&c.id, &c.label))
        .collect();
    for c in &v.pool.categories {
        if !pivot_columns.iter().any(|p| p.field == c.id) {
            pivot_columns.push(PivotColumn::source(&c.id, &c.name));
        }
    }
    let input = PivotInput {
        rows: surviving.iter().map(|r| r.values.clone()).collect(),
        order: pivot_columns.iter().map(|c| c.field.clone()).collect(),
        kinds: pivot_columns
            .iter()
            .map(|c| (c.field.clone(), FieldKind::Text))
            .collect(),
        columns: pivot_columns,
        config: PivotConfig {
            enabled: true,
            grouping: a.layout.rows.clone(),
            split: a.layout.columns.clone(),
            expanded: Some(Expanded::All(true)),
            key_encoding: Some(KeyEncoding::TypedV1),
            measures: Some(measures),
            ..Default::default()
        },
        sorting: vec![],
        aggregate_only: false,
        category_metadata: v
            .pool
            .categories
            .iter()
            .map(|c| {
                (
                    c.id.clone(),
                    pivot::CategoryMetadata {
                        source_field_id: c.source_field_id.clone(),
                        bucket: c.bucket,
                        periodicity: c.periodicity,
                    },
                )
            })
            .collect(),
    };
    let Some(pivot) = pivot::pivot(&input, order)? else {
        return Err(diagnostic("scope", "Category Pivot is unavailable."));
    };
    for meta in &pivot.meta {
        if let PivotRowMeta::Group {
            depth,
            label,
            incomplete: Some(gap),
            ..
        } = meta
        {
            v.warnings.push(crate::fiscal::ScopeWarning {
                code: "incomplete-period".into(),
                message: format!("{label}: {} of {} observations.", gap.have, gap.expected),
                category_id: a.layout.rows.get(*depth).cloned(),
                periods: vec![],
            });
        }
    }
    v.columns = pivot
        .columns
        .iter()
        .map(|c| {
            let mut column = columns
                .iter()
                .find(|s| Some(&s.id) == c.source.as_ref())
                .cloned()
                .unwrap_or_else(|| {
                    serde_json::from_value(serde_json::json!({"id":"","label":""})).unwrap()
                });
            column.id = c.field.clone();
            column.label = c.header.clone();
            column.source_binding_id = c.source.clone();
            let formula = c.measure_id.as_ref().and_then(|id| {
                v.compiled
                    .symbols
                    .formulas
                    .iter()
                    .find(|f| &f.id == id && f.scope == FormulaScope::Aggregate)
            });
            column.measure_id = if formula.is_some() {
                None
            } else {
                c.measure_id.clone()
            };
            column.aggregation = c.aggregation;
            if let Some(f) = formula {
                column
                    .metadata
                    .get_or_insert_with(BTreeMap::new)
                    .insert("formulaId".into(), WireValue::String(f.id.clone()));
            }
            column.split_path = (!c.split_keys.is_empty()).then(|| {
                c.split_keys
                    .iter()
                    .enumerate()
                    .map(|(i, k)| descriptor(v, &first_values, &a.layout.columns[i], k))
                    .collect()
            });
            column
        })
        .collect();
    let surviving_rows = ScopedRows::new(surviving, &v.pool);
    let page_rows = std::cell::OnceCell::new();
    let mut totals_values = BTreeMap::new();
    let mut total_errors = BTreeMap::new();
    for c in pivot.columns.iter().filter(|c| {
        c.field != LABEL_FIELD && (v.compiled.execution.is_none() || a.subtotals.grand_total)
    }) {
        let constraints = c
            .split_keys
            .iter()
            .enumerate()
            .map(|(i, k)| (a.layout.columns[i].clone(), k.clone()))
            .collect();
        let records = surviving_rows.select(&v.pool, &constraints);
        let result = scope_results.calculate(
            &v.pool,
            &scope_for(&v.pool, &records, &constraints, &v.compiled),
            &v.compiled,
            order,
        )?;
        if let Some(cell) = cell(result, c.measure_id.as_deref().unwrap_or(""), &v.compiled) {
            put_cell(&c.field, &cell, &mut totals_values, &mut total_errors)?;
        }
    }
    v.totals.values = totals_values;
    v.totals.cell_errors = (!total_errors.is_empty()).then_some(total_errors);
    // Paths are explicit category keys; declared Statement members never create facts.
    let mut paths: Vec<(Vec<String>, String)> = pivot
        .meta
        .iter()
        .filter_map(|m| {
            if let PivotRowMeta::Group { path, label, .. } = m {
                Some((
                    path.split(KEY_SEP).map(String::from).collect(),
                    label.clone(),
                ))
            } else {
                None
            }
        })
        .collect();
    if let Some(e) = &v.compiled.execution {
        if !surviving.is_empty() {
            for output in &e.output_members {
                let constraints: CategoryConstraints = output
                    .selectors
                    .iter()
                    .map(|s| (s.category_id.clone(), s.member_key.clone()))
                    .collect();
                if output.require_observed
                    && surviving_rows.select(&v.pool, &constraints).is_empty()
                {
                    continue;
                }
                for depth in 1..=a.layout.rows.len() {
                    let keys: Option<Vec<_>> = a.layout.rows[..depth]
                        .iter()
                        .map(|id| {
                            output
                                .selectors
                                .iter()
                                .find(|s| &s.category_id == id)
                                .map(|s| s.member_key.clone())
                        })
                        .collect();
                    if let Some(keys) = keys {
                        if !paths.iter().any(|(p, _)| p == &keys) {
                            paths.push((keys, String::new()));
                        }
                    }
                }
            }
        }
        paths.retain(|(keys, _)| {
            e.output_members.iter().any(|o| {
                keys.iter().enumerate().all(|(i, k)| {
                    o.selectors
                        .iter()
                        .any(|s| s.category_id == a.layout.rows[i] && &s.member_key == k)
                })
            })
        });
        paths.sort_by(|(aa, _), (bb, _)| {
            for i in 0..aa.len().min(bb.len()) {
                if aa[i] != bb[i] {
                    let order = &e.member_orders[&a.layout.rows[i]];
                    let rank = |k: &String| {
                        order
                            .iter()
                            .position(|s| s == k)
                            .map(|s| s as isize)
                            .unwrap_or(-1)
                    };
                    return rank(&aa[i]).cmp(&rank(&bb[i]));
                }
            }
            aa.len().cmp(&bb.len())
        });
    }
    let mut nodes: BTreeMap<String, LogicalGroup> = BTreeMap::new();
    let mut ordered_paths = vec![];
    for (keys, label) in paths {
        if surviving.is_empty() {
            continue;
        }
        let constraints: CategoryConstraints = keys
            .iter()
            .enumerate()
            .map(|(i, k)| (a.layout.rows[i].clone(), k.clone()))
            .collect();
        let records = surviving_rows.select(&v.pool, &constraints);
        let output = v.compiled.execution.as_ref().and_then(|e| {
            e.output_members.iter().find(|o| {
                o.selectors.iter().all(|s| {
                    constraints
                        .iter()
                        .any(|(id, k)| id == &s.category_id && k == &s.member_key)
                })
            })
        });
        let filters: Vec<_> = if v.compiled.execution.is_some() {
            a.result_filters
                .iter()
                .filter(|f| Some(&f.category_id) == a.layout.rows.get(keys.len().saturating_sub(1)))
                .cloned()
                .collect()
        } else {
            vec![]
        };
        if !filters.is_empty() {
            let mut original = page_rows
                .get_or_init(|| ScopedRows::new(page, &v.pool))
                .select(&v.pool, &constraints);
            if original.is_empty() {
                original = page.to_vec();
            }
            let result = scope_results.calculate(
                &v.pool,
                &scope_for(&v.pool, &original, &constraints, &v.compiled),
                &v.compiled,
                order,
            )?;
            if qualify_groups(
                &[group(
                    a.layout.rows[keys.len() - 1].clone(),
                    &v.pool,
                    result,
                )],
                &filters,
            )
            .record_ids
            .is_empty()
            {
                continue;
            }
        }
        let label = v
            .compiled
            .execution
            .as_ref()
            .and_then(|e| {
                a.layout
                    .rows
                    .get(keys.len().saturating_sub(1))
                    .and_then(|id| e.member_labels.get(id))
                    .and_then(|m| keys.last().and_then(|k| m.get(k)))
            })
            .cloned()
            .unwrap_or(label);
        let mut values = BTreeMap::from([(LABEL_FIELD.into(), WireValue::String(label))]);
        let mut errors = BTreeMap::new();
        let mut formats = BTreeMap::new();
        for c in pivot.columns.iter().filter(|c| {
            c.field != LABEL_FIELD
                && (v.compiled.execution.is_none()
                    || a.subtotals.groups
                    || keys.len() == a.layout.rows.len())
        }) {
            let mut full = constraints.clone();
            full.extend(
                c.split_keys
                    .iter()
                    .enumerate()
                    .map(|(i, k)| (a.layout.columns[i].clone(), k.clone())),
            );
            let mut inputs = scope_rows(&records, &v.pool, &full);
            if inputs.is_empty() {
                if let Some(o) = output {
                    let mut retained = full.clone();
                    retained.retain(|id, _| !o.selectors.iter().any(|s| &s.category_id == id));
                    inputs = surviving_rows.select(&v.pool, &retained);
                }
            }
            let result = scope_results.calculate(
                &v.pool,
                &scope_for(&v.pool, &inputs, &full, &v.compiled),
                &v.compiled,
                order,
            )?;
            if result.formulas.empty {
                continue;
            }
            if let Some(cell) = cell(result, c.measure_id.as_deref().unwrap_or(""), &v.compiled) {
                if output.is_some() && matches!(cell, CellResult::Value(WireValue::Null)) {
                    continue;
                }
                if let CellResult::Error(e) = &cell {
                    v.errors.push(e.clone());
                }
                put_cell(&c.field, &cell, &mut values, &mut errors)?;
                if let (Some(o), Some(execution)) = (output, v.compiled.execution.as_ref()) {
                    if c.measure_id.as_deref() == Some(&execution.policy.measure_id)
                        && matches!(cell, CellResult::Value(_))
                    {
                        let hints: Vec<_> = if o.formula_id.is_some() {
                            vec![]
                        } else {
                            inputs
                                .iter()
                                .map(|r| {
                                    r.cell_formats
                                        .as_ref()
                                        .and_then(|m| m.get(&execution.policy.value_field_id))
                                        .or_else(|| {
                                            execution
                                                .source_columns_by_row_id
                                                .get(&r.id)
                                                .and_then(|c| c.format.as_ref())
                                        })
                                        .or_else(|| {
                                            v.compiled
                                                .columns
                                                .iter()
                                                .find(|c| c.id == execution.policy.value_field_id)
                                                .and_then(|c| c.format.as_ref())
                                        })
                                })
                                .collect()
                        };
                        let same = hints.first().is_some_and(|first| {
                            hints.iter().all(|h| {
                                serde_json::to_value(h).ok() == serde_json::to_value(first).ok()
                            })
                        });
                        let format = o
                            .format
                            .as_ref()
                            .or_else(|| if same { hints[0] } else { None });
                        if let Some(f) = format {
                            formats.insert(c.field.clone(), f.clone());
                        }
                    }
                }
            }
        }
        let path: Vec<_> = (1..=keys.len())
            .map(|d| identity(&keys[..d].join(KEY_SEP), &signature))
            .collect();
        let id = path
            .last()
            .cloned()
            .unwrap_or_else(|| identity("", &signature));
        let row = DatasetRow {
            id: id.clone(),
            values,
            group_path: Some(
                keys.iter()
                    .enumerate()
                    .map(|(i, k)| descriptor(v, &first_values, &a.layout.rows[i], k))
                    .collect(),
            ),
            cell_errors: (!errors.is_empty()).then_some(errors),
            cell_formats: (!formats.is_empty()).then_some(formats),
        };
        let p = keys.join(KEY_SEP);
        ordered_paths.push(p.clone());
        nodes.insert(
            p,
            LogicalGroup {
                id,
                path,
                rows: vec![row],
                children: vec![],
            },
        );
    }
    // Source leaves only occur without column splits, as maintained by Pivot.
    for (i, meta) in pivot.meta.iter().enumerate() {
        if let PivotRowMeta::Leaf {
            source_index: Some(index),
            ..
        } = meta
        {
            if let Some(original) = surviving.get(*index) {
                let keys: Vec<_> = a
                    .layout
                    .rows
                    .iter()
                    .filter_map(|id| {
                        v.pool
                            .members
                            .get(&original.id)
                            .and_then(|m| m.get(id))
                            .and_then(|m| m.as_ref().ok())
                            .map(|m| m.key.clone())
                    })
                    .collect();
                let mut r = original.clone();
                r.values = pivot.rows[i].clone();
                for m in &a.measures {
                    if let Some(e) = v
                        .pool
                        .errors
                        .get(&r.id)
                        .and_then(|m2| m2.get(&m.source_field_id))
                    {
                        r.values
                            .insert(m.id.clone(), WireValue::String("#ERROR".into()));
                        r.cell_errors
                            .get_or_insert_with(BTreeMap::new)
                            .insert(m.id.clone(), compact_cell_error(e)?);
                    }
                }
                if let Some(node) = nodes.get_mut(&keys.join(KEY_SEP)) {
                    node.rows.push(r);
                }
            }
        }
    }
    // Build bottom-up, preserving each sibling's Pivot/declaration order. Nodes are
    // visited last-first, so each list collects in reverse and is prepended once.
    let mut pending: BTreeMap<String, Vec<LogicalGroup>> = BTreeMap::new();
    let prepend = |list: &mut Vec<LogicalGroup>, mut reversed: Vec<LogicalGroup>| {
        reversed.reverse();
        reversed.append(list);
        *list = reversed;
    };
    let mut top = vec![];
    for p in ordered_paths.iter().rev() {
        let Some(mut node) = nodes.remove(p) else {
            continue;
        };
        if let Some(children) = pending.remove(p) {
            prepend(&mut node.children, children);
        }
        if let Some((parent, _)) = p.rsplit_once(KEY_SEP) {
            if nodes.contains_key(parent) {
                pending.entry(parent.to_string()).or_default().push(node);
                continue;
            }
        }
        top.push(node);
    }
    prepend(&mut v.groups, top);
    v.rows.clear();
    visit(
        &mut v.groups,
        &mut v.rows,
        &mut v.eligible_rows,
        &v.compiled,
        a,
        order,
    )?;
    finish_columns(v);
    Ok(())
}
