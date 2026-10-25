// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(clippy::result_large_err)]
//! Native ownership and atomic publication. Calculated state never appears in responses.
pub(crate) mod legacy;
mod operations;
mod prepare;
mod protocol;
mod transfer;
use prepare::prepare;
mod resource_types;
pub(crate) mod resources;
mod selection;
mod validation;
use crate::{
    analytical::{CalculatedView, LogicalGroup},
    contract::*,
    ordering::ValueOrder,
};
pub use protocol::*;
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceUsage {
    pub retained_estimated_bytes: usize,
    pub input_encoded_bytes: usize,
    pub input_rows: usize,
    pub output_rows: usize,
    pub output_columns: usize,
    pub active_transfers: usize,
}
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceLimits {
    pub input_bytes: Option<usize>,
    pub max_input_bytes: Option<usize>,
    pub max_rows: Option<usize>,
    pub max_pivot_columns: Option<usize>,
    pub max_batch_bytes: Option<usize>,
    pub max_cached_block_bytes: Option<usize>,
    pub max_concurrent_transfers: Option<usize>,
    pub max_state_bytes: Option<usize>,
    pub cache_bytes: Option<usize>,
    pub export_bytes: Option<usize>,
}
fn acquisition_diagnostics(input: &SourceDataset) -> Vec<Diagnostic> {
    input
        .freshness
        .diagnostics
        .iter()
        .flatten()
        .map(|message| {
            let mut d = problem("INPUT", message);
            d.severity = Severity::Warning;
            d.path = None;
            d
        })
        .collect()
}
pub(crate) fn problem(code: &str, message: &str) -> Diagnostic {
    crate::validation::diagnostic(code, "session", message)
}
#[derive(Clone, Debug)]
pub(crate) struct StoredView {
    pub saved: ValidatedDefinition,
    pub revision: Revision,
    pub analytical: Option<CalculatedView>,
    pub rows: Vec<DatasetRow>,
    pub groups: Vec<LogicalGroup>,
    pub eligible: Vec<DatasetRow>,
    pub columns: Vec<DatasetColumn>,
    pub chart_columns: Option<Vec<DatasetColumn>>,
    pub namespace: Option<String>,
    pub identity_ids: BTreeSet<String>,
    pub hierarchy: BTreeMap<String, Vec<String>>,
    pub selection: SelectionSpec,
    pub completeness: Completeness,
    pub diagnostics: Vec<Diagnostic>,
    pub totals: ScopedValues,
    pub facets: BTreeMap<String, ScopedValues>,
    pub provenance: Provenance,
    pub freshness: Freshness,
    pub input_columns: Vec<DatasetColumn>,
    pub input_periodicity: BTreeMap<String, String>,
}
#[derive(Debug)]
struct Transfer {
    request_id: String,
    revision: Revision,
    sequence: u64,
    offset: usize,
    ignore_selection: bool,
}
pub struct Session {
    locale: String,
    limits: ResourceLimits,
    input: Option<(u64, SourceDataset)>,
    view: Option<StoredView>,
    transfers: BTreeMap<String, Transfer>,
    batch_rows: u32,
    disposed: bool,
}
fn same(a: &Revision, b: &Revision) -> bool {
    a.widget_id == b.widget_id && a.input == b.input && a.model == b.model && a.output == b.output
}
pub(crate) fn project<'a>(
    rows: impl IntoIterator<Item = &'a DatasetRow>,
    fields: &[String],
) -> Vec<DatasetRow> {
    rows.into_iter()
        .map(|row| DatasetRow {
            id: row.id.clone(),
            values: row
                .values
                .iter()
                .filter(|(id, _)| fields.contains(id))
                .map(|(id, value)| (id.clone(), value.clone()))
                .collect(),
            group_path: row.group_path.clone(),
            cell_errors: row.cell_errors.as_ref().map(|errors| {
                errors
                    .iter()
                    .filter(|(id, _)| fields.contains(id))
                    .map(|(id, error)| (id.clone(), error.clone()))
                    .collect()
            }),
            cell_formats: row.cell_formats.as_ref().map(|formats| {
                formats
                    .iter()
                    .filter(|(id, _)| fields.contains(id) && row.values.contains_key(*id))
                    .map(|(id, format)| (id.clone(), format.clone()))
                    .collect()
            }),
        })
        .collect()
}

impl Session {
    pub fn new(locale: String, limits: ResourceLimits) -> Self {
        Self {
            locale,
            limits,
            input: None,
            view: None,
            transfers: BTreeMap::new(),
            batch_rows: 500,
            disposed: false,
        }
    }
    pub fn resource_usage(&self) -> ResourceUsage {
        ResourceUsage {
            retained_estimated_bytes: self.retained_bytes(),
            input_encoded_bytes: self
                .input
                .as_ref()
                .map_or(0, |(_, i)| resources::wire_size(i)),
            input_rows: self.input.as_ref().map_or(0, |(_, i)| i.rows.len()),
            output_rows: self.view.as_ref().map_or(0, |v| v.rows.len()),
            output_columns: self.view.as_ref().map_or(0, |v| v.columns.len()),
            active_transfers: self.transfers.len(),
        }
    }
    pub fn register(&mut self, input: SourceDataset, revision: u64) -> Result<(), Diagnostic> {
        self.check_registration(&input, revision)?;
        self.input = Some((revision, input));
        self.view = None;
        self.transfers.clear();
        Ok(())
    }
    fn check_registration(&self, input: &SourceDataset, revision: u64) -> Result<(), Diagnostic> {
        if self.disposed {
            return Err(problem("INVALID_REQUEST", "Session is disposed"));
        }
        resources::check(
            match (self.limits.input_bytes, self.limits.max_input_bytes) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            },
            resources::wire_size(&input),
            "Input admission budget exceeded",
        )?;
        resources::check(
            self.limits.max_rows,
            input.rows.len(),
            "Input row budget exceeded",
        )?;
        if self.limits.max_state_bytes.is_some() {
            resources::check(
                self.limits.max_state_bytes,
                self.retained_bytes()
                    .saturating_add(resources::estimated(input).saturating_mul(4))
                    .saturating_add(self.host_reservation(input)),
                "Input transient state budget exceeded",
            )?;
        }
        validation::dataset(input, revision)
    }
    pub fn set_batch_rows(&mut self, rows: u32) -> Result<(), Diagnostic> {
        if rows == 0 || rows > 500 {
            return Err(problem("INVALID_REQUEST", "Batch rows must be 1–500"));
        }
        self.batch_rows = rows;
        Ok(())
    }
    fn input(&self, r: &Revision) -> Result<&SourceDataset, Diagnostic> {
        self.input
            .as_ref()
            .filter(|(revision, _)| *revision == r.input)
            .map(|(_, i)| i)
            .ok_or_else(|| problem("REVISION_MISMATCH", "Input is not registered for revision"))
    }
    fn stored(&self, r: &Revision) -> Result<&StoredView, Diagnostic> {
        let v = self
            .view
            .as_ref()
            .ok_or_else(|| problem("INVALID_REQUEST", "No calculated view"))?;
        if !same(&v.revision, r) {
            return Err(problem(
                "REVISION_MISMATCH",
                "Requested revision does not match stored revision",
            ));
        }
        Ok(v)
    }
    pub fn dispatch(&mut self, request: CoreRequest, order: &dyn ValueOrder) -> CoreResponse {
        let result = if self.disposed {
            Err(problem("INVALID_REQUEST", "Session is disposed"))
        } else if request.request_id.is_empty() {
            Err(problem("INVALID_REQUEST", "Missing request ID"))
        } else {
            validation::request(&request, &self.locale).and_then(|()| self.execute(&request, order))
        };
        let (mut completeness, mut diagnostics) = if let Some(v) = &self.view {
            (v.completeness.clone(), v.diagnostics.clone())
        } else if let Some((_, i)) = &self.input {
            (
                i.completeness.clone(),
                i.diagnostics
                    .iter()
                    .flatten()
                    .cloned()
                    .chain(acquisition_diagnostics(i))
                    .collect(),
            )
        } else {
            (
                Completeness {
                    kind: CompletenessKind::Unknown,
                    warnings: vec!["Input has not been acquired".into()],
                    acquired_row_count: None,
                    total_row_count: None,
                    total_row_count_kind: None,
                },
                vec![],
            )
        };
        let (mut warnings, mut count) = if let (Some(v), Some((_, i))) = (&self.view, &self.input) {
            let own = v
                .analytical
                .as_ref()
                .map(|a| a.warnings.as_slice())
                .unwrap_or_default();
            let count = i
                .model_warning_count
                .unwrap_or(i.model_warnings.as_ref().map_or(0, |w| w.len()) as u64)
                + own.len() as u64;
            let warnings = i
                .model_warnings
                .iter()
                .flatten()
                .cloned()
                .chain(own.iter().map(|w| {
                    ModelWarning {
                        code: w.code.clone(),
                        message: crate::analytical::utf16_prefix(&w.message, 1000)
                            .expect(
                                "candidate warning scalar boundary validated before publication",
                            )
                            .to_owned(),
                        category_id: w.category_id.clone(),
                        period_count: w.periods.len() as u64,
                        origin: v.revision.clone(),
                    }
                }))
                .take(100)
                .collect();
            (
                (count > 0).then_some(warnings),
                (count > 0).then_some(count),
            )
        } else {
            (None, None)
        };
        if let Ok(Response::PreviewDefinition(preview)) = &result {
            completeness = preview.completeness.clone();
            diagnostics = preview.diagnostics.clone();
            warnings = None;
            count = None;
        }
        if result.is_ok()
            && matches!(
                request.operation,
                Operation::BindFormula { .. } | Operation::MemberDomain { .. }
            )
        {
            if let Some((_, input)) = &self.input {
                completeness = input.completeness.clone();
                diagnostics.clear();
                warnings = None;
                count = None;
            }
        }
        CoreResponse {
            request_id: request.request_id,
            revision: request.revision,
            completeness,
            diagnostics,
            model_warnings: warnings,
            model_warning_count: count,
            result: result.unwrap_or_else(Response::Error),
        }
    }
}
