#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::pivot::*;
pub(crate) fn kind(
    id: &str,
    rows: &[DatasetRow],
    column: Option<&DatasetColumn>,
) -> (String, FieldKind) {
    let fallback = DatasetColumn {
        id: id.into(),
        label: id.into(),
        ..Default::default()
    };
    let text = crate::scopes::inferred_filter_kind(column.unwrap_or(&fallback), rows);
    (
        text.into(),
        match text {
            "text" => FieldKind::Text,
            "number" => FieldKind::Number,
            "date" => FieldKind::Date,
            "boolean" => FieldKind::Boolean,
            _ => FieldKind::None,
        },
    )
}
fn identity(path: &str, signature: &str) -> String {
    serde_json::to_string(&("group", signature, path)).unwrap()
}
fn member(key: &str, field: &str, bucket: Option<Bucket>) -> GroupMember {
    let a: serde_json::Value = serde_json::from_str(key).unwrap_or(serde_json::Value::Null);
    let tag = a[0].as_str().unwrap_or_default();
    let value = match tag {
        "blank" => WireValue::Null,
        "string" | "object" => WireValue::String(a[1].as_str().unwrap_or_default().into()),
        "boolean" => WireValue::Bool(a[1].as_bool().unwrap_or_default()),
        "bigint" => WireValue::BigIntString(a[1].as_str().unwrap_or_default().into()),
        "number" => {
            if let Some(n) = a[1].as_f64() {
                WireValue::F64(WireNumber::Finite(n))
            } else {
                WireValue::F64(WireNumber::Special(match a[1].as_str() {
                    Some("NaN") => SpecialNumber::Nan,
                    Some("Infinity") => SpecialNumber::PositiveInfinity,
                    _ => SpecialNumber::NegativeInfinity,
                }))
            }
        }
        _ => WireValue::Missing,
    };
    GroupMember {
        field: field.into(),
        value,
        bucket,
        category_id: None,
        source_binding_id: None,
        transform: None,
        member_key: Some(key.into()),
        label: None,
    }
}
fn count_values(values: &mut ValueRecord, columns: &[DatasetColumn]) {
    for c in columns {
        if matches!(
            c.aggregation,
            Some(Aggregation::Count | Aggregation::UniqueCount)
        ) {
            if let Some(WireValue::String(s)) = values.get(&c.id) {
                if let Ok(n) = s.parse::<f64>() {
                    values.insert(c.id.clone(), WireValue::F64(WireNumber::Finite(n)));
                }
            }
        }
    }
}
fn columns(
    input: &SourceDataset,
    result: &PivotResult,
    config: &PivotConfig,
    kinds: &BTreeMap<String, FieldKind>,
) -> Vec<DatasetColumn> {
    result
        .columns
        .iter()
        .map(|c| {
            let mut out = input
                .columns
                .iter()
                .find(|s| s.id == c.source.as_deref().unwrap_or(&c.field))
                .cloned()
                .unwrap_or(DatasetColumn {
                    id: c.field.clone(),
                    label: c.header.clone(),
                    ..Default::default()
                });
            out.id = c.field.clone();
            out.label = c.header.clone();
            if out.source_field_id.is_none() {
                out.source_field_id = c.source.clone();
            }
            out.aggregation = c.aggregation;
            out.measure_id = c.measure_id.clone();
            out.source_binding_id = c.source.clone();
            if !c.split_keys.is_empty() {
                out.split_path = Some(
                    c.split_keys
                        .iter()
                        .enumerate()
                        .map(|(i, k)| {
                            member(
                                k,
                                &config.split[i],
                                config
                                    .buckets
                                    .as_ref()
                                    .and_then(|b| b.get(&config.split[i]))
                                    .copied(),
                            )
                        })
                        .collect(),
                );
            }
            if matches!(
                c.aggregation,
                Some(Aggregation::Count | Aggregation::UniqueCount)
            ) {
                out.dtype = Some("number".into());
                out.format = Some(CellFormat {
                    formatter_fn: Some("int".into()),
                    decimal_places: None,
                    abbreviate: None,
                });
            } else if out.dtype.is_none() {
                let source = c.source.as_deref().unwrap_or(&c.field);
                out.dtype = match kinds.get(source) {
                    Some(FieldKind::Text) => Some("text".into()),
                    Some(FieldKind::Number) => Some("number".into()),
                    Some(FieldKind::Date) => Some("date".into()),
                    Some(FieldKind::Boolean) => Some("boolean".into()),
                    _ => None,
                };
            }
            out
        })
        .collect()
}
fn build(
    result: &PivotResult,
    filtered: &[DatasetRow],
    columns: &[DatasetColumn],
    config: &PivotConfig,
    signature: &str,
    namespace: &str,
) -> (Vec<DatasetRow>, Vec<LogicalGroup>, Vec<DatasetRow>) {
    fn insert(nodes: &mut Vec<LogicalGroup>, node: LogicalGroup, depth: usize) {
        if depth == 0 {
            nodes.push(node)
        } else if let Some(parent) = nodes.last_mut() {
            insert(&mut parent.children, node, depth - 1)
        }
    }
    fn leaf(nodes: &mut [LogicalGroup], row: DatasetRow) {
        if let Some(parent) = nodes.last_mut() {
            if parent.children.is_empty() {
                parent.rows.push(row)
            } else {
                leaf(&mut parent.children, row)
            }
        }
    }
    let mut groups = vec![];
    let mut rows = vec![];
    let mut eligible = vec![];
    for ((values, meta), ordinal) in result
        .rows
        .iter()
        .zip(&result.meta)
        .zip(&result.leaf_ordinals)
    {
        let mut values = values.clone();
        if !matches!(meta, PivotRowMeta::Leaf { .. }) {
            count_values(&mut values, columns);
        }
        match meta {
            PivotRowMeta::Group { depth, path, .. } => {
                let keys = path.split(KEY_SEP).collect::<Vec<_>>();
                let ids = keys
                    .iter()
                    .enumerate()
                    .map(|(i, _)| identity(&keys[..=i].join(KEY_SEP), signature))
                    .collect::<Vec<_>>();
                let row = DatasetRow {
                    id: ids.last().unwrap().clone(),
                    values,
                    group_path: Some(
                        keys.iter()
                            .enumerate()
                            .map(|(i, k)| {
                                member(
                                    k,
                                    &config.grouping[i],
                                    config
                                        .buckets
                                        .as_ref()
                                        .and_then(|b| b.get(&config.grouping[i]))
                                        .copied(),
                                )
                            })
                            .collect(),
                    ),
                    cell_errors: None,
                    cell_formats: None,
                };
                let node = LogicalGroup {
                    id: row.id.clone(),
                    path: ids,
                    rows: vec![row.clone()],
                    children: vec![],
                };
                insert(&mut groups, node, *depth);
                rows.push(row)
            }
            PivotRowMeta::Leaf { .. } => {
                if let Some(original) = ordinal.and_then(|i| filtered.get(i)) {
                    let mut row = original.clone();
                    row.values = values;
                    rows.push(row.clone());
                    leaf(&mut groups, row)
                }
            }
            PivotRowMeta::Total { .. } => {
                let row = DatasetRow {
                    id: identity("", namespace),
                    values,
                    group_path: None,
                    cell_errors: None,
                    cell_formats: None,
                };
                rows.push(row.clone());
                eligible.push(row)
            }
        }
    }
    fn deepest(g: &LogicalGroup, out: &mut Vec<DatasetRow>) {
        if g.children.is_empty() {
            out.push(g.rows[0].clone())
        } else {
            for c in &g.children {
                deepest(c, out)
            }
        }
    }
    for g in &groups {
        deepest(g, &mut eligible)
    }
    (rows, groups, eligible)
}
pub(crate) fn prepare(
    input: &SourceDataset,
    d: &ValidatedDefinition,
    s: &SelectionSpec,
    revision: &Revision,
    order: &dyn ValueOrder,
    universe: bool,
) -> Result<StoredView, Diagnostic> {
    let state = &d.definition.table;
    let config = state.pivot.clone().unwrap_or_default();
    let known: BTreeSet<_> = input.columns.iter().map(|c| c.id.clone()).collect();
    let required = if config.enabled {
        config
            .grouping
            .iter()
            .chain(&config.split)
            .chain(config.measures.iter().flatten().map(|m| &m.source_field_id))
            .chain(config.aggregation_fns.iter().flat_map(|m| m.keys()))
            .chain(state.column_filters.iter().flatten().map(|f| &f.id))
            .collect::<Vec<_>>()
    } else {
        state
            .column_filters
            .iter()
            .flatten()
            .map(|f| &f.id)
            .collect()
    };
    let missing = required
        .iter()
        .filter(|f| !known.contains(**f))
        .map(|f| f.as_str())
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(problem(
            "MISSING_FIELD",
            &format!(
                "Missing source field: {}; restore field or edit definition",
                missing.join(", ")
            ),
        ));
    }
    // Ordinary sorts bind to declared source columns, never undeclared row keys.
    if !config.enabled || config.grouping.is_empty() && config.split.is_empty() {
        let missing_sort = state
            .sorting
            .iter()
            .flatten()
            .filter(|sort| !known.contains(&sort.id))
            .map(|sort| sort.id.as_str())
            .collect::<Vec<_>>();
        if !missing_sort.is_empty() {
            return Err(problem(
                "MISSING_FIELD",
                &format!(
                "Missing source field or output sort binding: {}; restore field or edit definition",
                missing_sort.join(", ")
            ),
            ));
        }
    }
    let filtered = crate::scopes::qualify_source(
        input,
        state.column_filters.as_deref().unwrap_or_default(),
        &d.definition.search,
    )?;
    let kinds = input
        .columns
        .iter()
        .map(|c| (c.id.clone(), kind(&c.id, &input.rows, Some(c)).1))
        .collect::<BTreeMap<_, _>>();
    let mut display_order = vec![];
    for id in state
        .column_order
        .iter()
        .flatten()
        .chain(input.columns.iter().map(|c| &c.id))
    {
        if known.contains(id)
            && !state.hidden.as_ref().is_some_and(|h| h.contains(id))
            && !display_order.contains(id)
        {
            display_order.push(id.clone());
        }
    }
    let base = PivotInput {
        rows: filtered.iter().map(|r| r.values.clone()).collect(),
        columns: input
            .columns
            .iter()
            .map(|c| PivotColumn::source(&c.id, &c.label))
            .collect(),
        kinds: kinds.clone(),
        order: display_order.clone(),
        config: PivotConfig {
            expanded: Some(Expanded::All(true)),
            ..config.clone()
        },
        sorting: state.sorting.clone().unwrap_or_default(),
        aggregate_only: false,
        category_metadata: BTreeMap::new(),
    };
    let result = pivot(&base, order)?;
    let signature = serde_json::to_string(
        &config
            .grouping
            .iter()
            .map(|id| {
                (
                    id,
                    config
                        .buckets
                        .as_ref()
                        .and_then(|b| b.get(id))
                        .copied()
                        .unwrap_or(Bucket::Native),
                )
            })
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let namespace = result.as_ref().map(|_| {
        if !config.grouping.is_empty() {
            signature.clone()
        } else {
            serde_json::to_string(&(
                serde_json::json!({"grouping":config.grouping,"split":config.split}),
                config.buckets.clone().unwrap_or_default(),
            ))
            .unwrap()
        }
    });
    let (mut rows, groups, mut eligible, mut output) = if let Some(result) = &result {
        let cols = columns(input, result, &config, &kinds);
        let (rows, groups, eligible) = build(
            result,
            &filtered,
            &cols,
            &config,
            &signature,
            namespace.as_deref().unwrap(),
        );
        (rows, groups, eligible, cols)
    } else {
        let mut rows = filtered.clone();
        let sorts = state.sorting.as_deref().unwrap_or_default();
        let keys = rows
            .iter()
            .map(|r| {
                sorts
                    .iter()
                    .map(|s| r.values.get(&s.id).cloned().unwrap_or(WireValue::Missing))
                    .collect()
            })
            .collect::<Vec<_>>();
        crate::ordering::sort_by_keys(
            &mut rows,
            &keys,
            &sorts.iter().map(|s| s.desc).collect::<Vec<_>>(),
            order,
        )?;
        let cols = display_order
            .iter()
            .filter_map(|id| input.columns.iter().find(|c| &c.id == id).cloned())
            .collect();
        (rows.clone(), vec![], rows, cols)
    };
    for c in &mut output {
        if c.dtype.is_none() {
            let (t, _) = kind(
                c.source_binding_id.as_deref().unwrap_or(&c.id),
                &input.rows,
                input.columns.iter().find(|i| i.id == c.id),
            );
            if t != "none" {
                c.dtype = Some(t)
            }
        }
    }
    if filtered.is_empty() {
        rows.clear();
        eligible.clear();
    }
    let total = pivot(
        &PivotInput {
            aggregate_only: true,
            config: PivotConfig {
                enabled: true,
                grouping: vec![],
                ..base.config.clone()
            },
            sorting: vec![],
            ..base.clone()
        },
        order,
    )?;
    let mut values = total
        .as_ref()
        .and_then(|t| t.rows.first())
        .cloned()
        .unwrap_or_default();
    values.remove(LABEL_FIELD);
    if filtered.is_empty() {
        values.clear()
    }
    if let Some(t) = &total {
        count_values(&mut values, &columns(input, t, &config, &kinds));
    }
    let mut facets = BTreeMap::new();
    for c in &input.columns {
        let mut counts = BTreeMap::<String, u64>::new();
        for r in &filtered {
            let key = r
                .values
                .get(&c.id)
                .map(crate::ordering::string_value)
                .transpose()?
                .unwrap_or_default();
            *counts.entry(key).or_default() += 1;
        }
        facets.insert(
            c.id.clone(),
            ScopedValues {
                scope: Scope::Filtered,
                values: counts
                    .into_iter()
                    .map(|(k, n)| (k, WireValue::F64(WireNumber::Finite(n as f64))))
                    .collect(),
                empty: None,
                cell_errors: None,
                members: None,
            },
        );
    }
    let mut hierarchy = selection::hierarchy(&groups);
    let mut identity_ids = if groups.is_empty() {
        eligible.iter().map(|r| r.id.clone()).collect()
    } else {
        hierarchy.keys().cloned().collect()
    };
    let mut chart_columns = None;
    if !universe
        && (!d.definition.search.is_empty()
            || state.column_filters.as_ref().is_some_and(|f| !f.is_empty()))
    {
        let mut raw = d.clone();
        raw.definition.search.clear();
        raw.definition.table.column_filters = None;
        let all = prepare(input, &raw, &SelectionSpec::None, revision, order, true)?;
        identity_ids = all.identity_ids;
        hierarchy = all.hierarchy;
        if !config.split.is_empty() {
            chart_columns = Some(all.columns);
        }
    } else if !config.split.is_empty() {
        chart_columns = Some(output.clone());
    }
    let mut provenance = input.provenance.clone();
    if result.is_some() {
        provenance.input_may_contain_aggregates = Some(true)
    }
    let input_columns = input
        .columns
        .iter()
        .map(|c| {
            let mut c = c.clone();
            if c.dtype.is_none() {
                let (t, _) = kind(&c.id, &input.rows, Some(&c));
                if t != "none" {
                    c.dtype = Some(t)
                }
            }
            c
        })
        .collect();
    let input_periodicity = input
        .columns
        .iter()
        .filter(|c| kinds.get(&c.id) == Some(&FieldKind::Date))
        .map(|c| {
            (
                c.id.clone(),
                format!(
                    "{:?}",
                    crate::pivot::periodicity(
                        input
                            .rows
                            .iter()
                            .map(|r| crate::fiscal::read(r, Some(&c.id)))
                    )
                )
                .to_lowercase(),
            )
        })
        .collect();
    Ok(StoredView {
        saved: d.clone(),
        revision: revision.clone(),
        analytical: None,
        rows,
        groups,
        eligible,
        columns: output,
        chart_columns,
        namespace,
        identity_ids,
        hierarchy,
        selection: s.clone(),
        completeness: input.completeness.clone(),
        diagnostics: input.diagnostics.clone().unwrap_or_default(),
        totals: ScopedValues {
            scope: Scope::Filtered,
            values,
            empty: None,
            cell_errors: None,
            members: None,
        },
        facets,
        provenance,
        freshness: input.freshness.clone(),
        input_columns,
        input_periodicity,
    })
}
