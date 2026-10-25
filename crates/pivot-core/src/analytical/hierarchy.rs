// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use crate::pivot::LABEL_FIELD;
#[allow(clippy::result_large_err)]
pub(super) fn sort_source(
    rows: &mut [DatasetRow],
    m: &CompiledModel,
    bindings: bool,
    order: &dyn ValueOrder,
) -> Result<(), Diagnostic> {
    let sorts = m
        .definition
        .definition
        .table
        .sorting
        .clone()
        .unwrap_or_default();
    if sorts.is_empty() {
        return Ok(());
    }
    let a = model(m);
    let values: Vec<_> = rows
        .iter()
        .map(|r| {
            sorts
                .iter()
                .map(|s| {
                    let field = if bindings
                        && !a.layout.rows.contains(&s.id)
                        && !a.layout.columns.contains(&s.id)
                    {
                        a.measures
                            .iter()
                            .find(|v| v.id == s.id)
                            .map(|m| m.source_field_id.as_str())
                            .unwrap_or(&s.id)
                    } else {
                        &s.id
                    };
                    r.values.get(field).cloned().unwrap_or(WireValue::Missing)
                })
                .collect()
        })
        .collect();
    crate::ordering::sort_by_keys(
        rows,
        &values,
        &sorts.iter().map(|s| s.desc).collect::<Vec<_>>(),
        order,
    )
}
#[allow(clippy::result_large_err)]
pub(super) fn visit(
    nodes: &mut Vec<LogicalGroup>,
    rows: &mut Vec<DatasetRow>,
    eligible: &mut Vec<DatasetRow>,
    m: &CompiledModel,
    a: &TableModel,
    order: &dyn ValueOrder,
) -> Result<(), Diagnostic> {
    let sorts = m
        .definition
        .definition
        .table
        .sorting
        .clone()
        .unwrap_or_default();
    if !sorts.is_empty() {
        let values = nodes
            .iter()
            .map(|n| {
                sorts
                    .iter()
                    .map(|s| {
                        let member = n.rows[0].group_path.as_ref().and_then(|p| p.last());
                        if s.id == LABEL_FIELD
                            || a.layout.rows.contains(&s.id)
                            || a.layout.columns.contains(&s.id)
                        {
                            member
                                .filter(|p| s.id == LABEL_FIELD || p.field == s.id)
                                .map(|m| m.value.clone())
                                .unwrap_or(WireValue::Missing)
                        } else {
                            n.rows[0]
                                .values
                                .get(&s.id)
                                .cloned()
                                .unwrap_or(WireValue::Missing)
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        crate::ordering::sort_by_keys(
            nodes,
            &values,
            &sorts.iter().map(|s| s.desc).collect::<Vec<_>>(),
            order,
        )?;
    }
    if m.execution.is_some() && !a.result_filters.is_empty() {
        nodes.retain(|n| {
            n.rows[0].group_path.as_ref().map(|p| p.len()).unwrap_or(0) == a.layout.rows.len()
                || !n.children.is_empty()
        });
    }
    for node in nodes {
        rows.push(node.rows[0].clone());
        if !node.children.is_empty() {
            visit(&mut node.children, rows, eligible, m, a, order)?;
        } else {
            let mut leaves = node.rows.split_off(1);
            sort_source(&mut leaves, m, true, order)?;
            rows.extend(leaves.clone());
            node.rows.extend(leaves);
            eligible.push(node.rows[0].clone());
        }
    }
    Ok(())
}
