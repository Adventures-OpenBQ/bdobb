// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(clippy::result_large_err)]
use super::*;
impl Session {
    pub(super) fn execute(
        &mut self,
        q: &CoreRequest,
        order: &dyn ValueOrder,
    ) -> Result<Response, Diagnostic> {
        match &q.operation {
            Operation::RegisterInput {
                input,
                input_revision,
            } => {
                // validation::request already matched the input revision; register checks limits.
                self.register(input.clone(), *input_revision)?;
                Ok(Response::Registered)
            }
            Operation::ImportFile { .. } => Err(problem(
                "UNSUPPORTED_OPERATION",
                "File acquisition must supply a validated Dataset to registerInput",
            )),
            Operation::InputSchema => Ok(Response::InputSchema(
                self.input(&q.revision)?.columns.clone(),
            )),
            Operation::ApplyModel {
                definition,
                selection,
                reconcile_missing,
                previous_selection_namespace,
                proven_absent_ids,
                runtime_params,
            } => {
                if let Some(v) = &self.view {
                    if q.revision.widget_id != v.revision.widget_id
                        || q.revision.model <= v.revision.model
                        || q.revision.output <= v.revision.output
                    {
                        return Err(problem(
                            "REVISION_MISMATCH",
                            "Requested revision is not newer than stored revision",
                        ));
                    }
                }
                let input = self.input(&q.revision)?;
                self.reserve(input, definition, resources::estimated(q))?;
                let mut candidate = prepare(
                    input,
                    definition,
                    selection,
                    runtime_params,
                    &q.revision,
                    order,
                )?;
                candidate.diagnostics = acquisition_diagnostics(input)
                    .into_iter()
                    .chain(candidate.diagnostics)
                    .collect();
                selection::reconcile(
                    &mut candidate,
                    *reconcile_missing,
                    previous_selection_namespace.as_deref(),
                    proven_absent_ids,
                );
                self.check_candidate(&candidate)?;
                self.view = Some(candidate);
                self.transfers.clear();
                Ok(Response::ViewReady(self.ready()?))
            }
            Operation::PreviewDefinition(d) => {
                self.reserve(self.input(&q.revision)?, d, resources::estimated(q))?;
                let v = prepare(
                    self.input(&q.revision)?,
                    d,
                    &SelectionSpec::None,
                    &RuntimeParams::new(),
                    &q.revision,
                    order,
                )?;
                self.check_candidate(&v)?;
                let total = selection::presented(&v, &v.selection).count() as u64;
                let rows = selection::presented(&v, &v.selection)
                    .take(100)
                    .cloned()
                    .collect();
                Ok(Response::PreviewDefinition(DefinitionPreview {
                    completeness: v.completeness,
                    diagnostics: v.diagnostics,
                    columns: v.columns,
                    rows,
                    total,
                }))
            }
            Operation::Dispose => {
                self.input = None;
                self.view = None;
                self.transfers.clear();
                self.disposed = true;
                Ok(Response::Disposed)
            }
            Operation::Cancel { target_request_id } => {
                self.transfers
                    .retain(|_, t| &t.request_id != target_request_id);
                Ok(Response::Cancelled)
            }
            Operation::NextSubset {
                transfer_id,
                sequence,
            } => self.next(q, transfer_id, *sequence),
            Operation::Presented {
                transfer_id,
                ignore_selection,
            } => {
                self.stored(&q.revision)?;
                if transfer_id.is_empty() {
                    return Err(problem(
                        "INVALID_REQUEST",
                        "Transfer ID and positive safe batch size required",
                    ));
                }
                if self.transfers.contains_key(transfer_id) {
                    return Err(problem("INVALID_REQUEST", "Transfer ID is already active"));
                }
                if self.transfers.len() >= 32 {
                    return Err(problem("INVALID_REQUEST", "Too many transfers"));
                }
                resources::check(
                    self.limits.max_concurrent_transfers,
                    self.transfers.len().saturating_add(1),
                    "Concurrent transfer budget exceeded",
                )?;
                resources::check(
                    self.limits.max_state_bytes,
                    self.retained_bytes()
                        .saturating_add(resources::estimated(q)),
                    "Transfer state budget exceeded",
                )?;
                self.transfers.insert(
                    transfer_id.clone(),
                    Transfer {
                        request_id: q.request_id.clone(),
                        revision: q.revision.clone(),
                        sequence: 0,
                        offset: 0,
                        ignore_selection: *ignore_selection,
                    },
                );
                let first = self.next(q, transfer_id, 0);
                if first.is_err() {
                    self.transfers.remove(transfer_id);
                }
                first
            }
            Operation::Rows(r) => {
                let v = self.stored(&q.revision)?;
                if r.limit > 1200 {
                    return Err(problem("INVALID_REQUEST", "Row block limit exceeded"));
                }
                let mut children = &v.groups;
                let mut group = None;
                for id in &r.group_path {
                    let node = children
                        .iter()
                        .find(|g| &g.id == id)
                        .ok_or_else(|| problem("INVALID_REQUEST", "Unknown group path"))?;
                    children = &node.children;
                    group = Some(node)
                }
                let (siblings, count): (Box<dyn Iterator<Item = &DatasetRow>>, usize) =
                    if let Some(g) = group {
                        if g.children.is_empty() {
                            (
                                Box::new(g.rows.iter().skip(1)),
                                g.rows.len().saturating_sub(1),
                            )
                        } else {
                            (
                                Box::new(g.children.iter().map(|c| &c.rows[0])),
                                g.children.len(),
                            )
                        }
                    } else if v.groups.is_empty() {
                        (Box::new(v.rows.iter()), v.rows.len())
                    } else {
                        (
                            Box::new(v.groups.iter().map(|g| &g.rows[0])),
                            v.groups.len(),
                        )
                    };
                let offset = r.offset.min(count as u64) as usize;
                let (reservation, siblings) =
                    resources::bounded_rows(siblings.skip(offset).take(r.limit as usize));
                resources::check(
                    self.limits.max_state_bytes,
                    self.retained_bytes().saturating_add(reservation),
                    "Row block transient state budget exceeded",
                )?;
                resources::check(
                    self.limits.max_cached_block_bytes,
                    reservation,
                    "Row block transient budget exceeded",
                )?;
                let rows = project(
                    siblings,
                    &v.columns.iter().map(|c| c.id.clone()).collect::<Vec<_>>(),
                );
                let visible = rows.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
                let block = RowBlock {
                    group_path: r.group_path.clone(),
                    offset: r.offset,
                    rows,
                    sibling_count: ResultCount::Exact {
                        value: count as u64,
                    },
                    groups: children
                        .iter()
                        .skip(offset)
                        .take(r.limit as usize)
                        .map(|g| GroupSummary {
                            row_id: g.rows[0].id.clone(),
                            path: g.path.clone(),
                            child_count: ResultCount::Exact {
                                value: if g.children.is_empty() {
                                    g.rows.len() - 1
                                } else {
                                    g.children.len()
                                } as u64,
                            },
                        })
                        .collect(),
                    selection: Some(selection::summary(v, &SelectionAction::Summary, &visible)?),
                };
                resources::check(
                    self.limits.max_cached_block_bytes,
                    resources::estimated(&block).saturating_add(self.envelope_state_bytes()),
                    "Row block cache budget exceeded",
                )?;
                resources::check(
                    self.limits.max_batch_bytes,
                    resources::wire_size(&block).saturating_add(self.envelope_wire_bytes(q)),
                    "Row block wire budget exceeded",
                )?;
                Ok(Response::Rows(block))
            }
            Operation::Totals => Ok(Response::Totals(self.stored(&q.revision)?.totals.clone())),
            Operation::Facets { category_id } => {
                let v = self.stored(&q.revision)?;
                let values = v.facets.get(category_id).ok_or_else(|| {
                    problem("INVALID_REQUEST", &format!("Unknown facet {category_id}"))
                })?;
                Ok(Response::Facets {
                    category_id: category_id.clone(),
                    values: values.clone(),
                })
            }
            Operation::Selection {
                action,
                visible_ids,
            } => Ok(Response::Selection(selection::summary(
                self.stored(&q.revision)?,
                action,
                visible_ids,
            )?)),
            Operation::ChartData { fields } => {
                let v = self.stored(&q.revision)?;
                if fields
                    .iter()
                    .any(|id| !v.columns.iter().any(|c| &c.id == id))
                {
                    return Err(problem("INVALID_REQUEST", "Unknown chart field"));
                }
                let dataset = SourceDataset {
                    rows: project(selection::presented(v, &v.selection), fields),
                    columns: v
                        .columns
                        .iter()
                        .filter(|c| fields.contains(&c.id))
                        .cloned()
                        .collect(),
                    result_revision: q.revision.model,
                    output_revision: q.revision.output,
                    provenance: v.provenance.clone(),
                    completeness: v.completeness.clone(),
                    freshness: v.freshness.clone(),
                    diagnostics: Some(v.diagnostics.clone()),
                    model_warnings: None,
                    model_warning_count: None,
                };
                resources::check(
                    self.limits.max_batch_bytes,
                    resources::wire_size(&dataset).saturating_add(self.envelope_wire_bytes(q)),
                    "Chart data wire budget exceeded",
                )?;
                Ok(Response::ChartData(dataset))
            }
            Operation::Inspect(r) => Ok(Response::Inspect(crate::inspection::page(
                self.stored(&q.revision)?,
                r,
            )?)),
            Operation::BindFormula {
                definition,
                draft,
                bindings,
            } => {
                self.reserve(
                    self.input(&q.revision)?,
                    definition,
                    resources::estimated(q),
                )?;
                Ok(Response::BindFormula(crate::authoring::bind(
                    self.input(&q.revision)?,
                    definition,
                    draft,
                    bindings,
                    order,
                )?))
            }
            Operation::MemberDomain {
                definition,
                category_id,
                category_recipe,
                offset,
                limit,
                search,
            } => {
                self.reserve(
                    self.input(&q.revision)?,
                    definition,
                    resources::estimated(q),
                )?;
                let (_, pool) =
                    crate::authoring::context(self.input(&q.revision)?, definition, order)?;
                Ok(Response::MemberDomain(crate::scopes::member_domain(
                    &pool,
                    category_id,
                    category_recipe,
                    *offset,
                    *limit,
                    search.as_ref(),
                )?))
            }
            Operation::IdentityWitness { path, ids } => {
                if self.limits.max_state_bytes.is_some() {
                    return Err(problem(
                        "RESOURCE_LIMIT",
                        "State budget cannot bound chained witness contexts",
                    ));
                }
                if ids.len() > 1200 || !(2..=64).contains(&path.len()) {
                    return Err(problem(
                        "INVALID_REQUEST",
                        "Identity witness budget exceeded",
                    ));
                }
                Ok(Response::IdentityWitness(crate::witness::identity_witness(
                    self.input(&q.revision)?,
                    &self.stored(&q.revision)?.saved.definition,
                    &self.stored(&q.revision)?.columns,
                    path,
                    ids,
                    order,
                )?))
            }
        }
    }
    pub(super) fn ready(&self) -> Result<ViewReady, Diagnostic> {
        let v = self
            .view
            .as_ref()
            .ok_or_else(|| problem("INVALID_REQUEST", "No calculated view"))?;
        let aggregations = v
            .saved
            .definition
            .table
            .pivot
            .as_ref()
            .map(|p| {
                p.measures
                    .as_ref()
                    .map(|ms| {
                        ms.iter()
                            .filter_map(|m| m.aggregation.map(|a| (m.id.clone(), a)))
                            .collect()
                    })
                    .unwrap_or_else(|| p.aggregation_fns.clone().unwrap_or_default())
            })
            .unwrap_or_default();
        Ok(ViewReady {
            columns: v.columns.clone(),
            chart_columns: v.chart_columns.clone(),
            top_level_count: ResultCount::Exact {
                value: if v.groups.is_empty() {
                    v.rows.len()
                } else {
                    v.groups.len()
                } as u64,
            },
            selection: v.selection.clone(),
            selection_namespace: v.namespace.clone(),
            inspection: ReadyInspection {
                input_columns: v.input_columns.clone(),
                input_periodicity: v.input_periodicity.clone(),
                definition: v.saved.definition.clone(),
                aggregations,
                counts: crate::inspection::counts(v),
                param_matches: v
                    .analytical
                    .as_ref()
                    .map(|a| a.pool.param_matches.clone())
                    .unwrap_or_default(),
            },
        })
    }
}
