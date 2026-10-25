#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    contract::*,
    ordering::{Comparison, ValueOrder},
    session::*,
};
use std::{cell::RefCell, cmp::Ordering};

/// Private proof over acquired input. The caller supplies the authoritative root definition/schema.
pub fn identity_witness(
    input: &SourceDataset,
    root_definition: &TableDefinition,
    root_columns: &[DatasetColumn],
    path: &[ValidatedDefinition],
    ids: &[String],
    order: &dyn ValueOrder,
) -> Result<Vec<IdentityWitness>, Diagnostic> {
    let unknown = || {
        ids.iter()
            .map(|id| IdentityWitness {
                id: id.clone(),
                state: WitnessState::Unknown,
            })
            .collect()
    };
    if root_definition.analytical.is_some()
        || root_definition
            .table
            .pivot
            .as_ref()
            .is_some_and(|p| p.enabled)
        || path.iter().any(|d| d.definition.analytical.is_some())
        || path
            .iter()
            .take(path.len().saturating_sub(1))
            .any(|d| d.definition.table.pivot.as_ref().is_some_and(|p| p.enabled))
        || input.provenance.input_may_contain_aggregates == Some(true)
    {
        return Ok(unknown());
    }
    let Some(target) = path.last() else {
        return Ok(unknown());
    };
    let hidden = root_definition
        .table
        .hidden
        .iter()
        .flatten()
        .chain(
            path.iter()
                .take(path.len().saturating_sub(1))
                .flat_map(|d| d.definition.table.hidden.iter().flatten()),
        )
        .collect::<Vec<_>>();
    let columns = root_columns
        .iter()
        .filter(|c| !hidden.contains(&&c.id))
        .cloned()
        .collect::<Vec<_>>();
    if let Some(p) = target.definition.table.pivot.as_ref().filter(|p| p.enabled) {
        for id in p.grouping.iter().chain(&p.split) {
            let Some(c) = columns.iter().find(|c| {
                &c.id == id
                    && !c.measure_id.is_some()
                    && !c.source_binding_id.is_some()
                    && !c.aggregation.is_some()
                    && c.split_path.as_ref().is_none_or(Vec::is_empty)
                    && c.source_field_id
                        .as_ref()
                        .is_none_or(|source| source == &c.id)
            }) else {
                return Ok(unknown());
            };
            if p.buckets
                .as_ref()
                .and_then(|b| b.get(id))
                .is_some_and(|b| *b != Bucket::Native)
                && c.dtype.is_none()
            {
                return Ok(unknown());
            }
        }
    }
    let mut d = target.clone();
    d.definition.search.clear();
    d.definition.table.sorting = None;
    d.definition.table.column_filters = None;
    let mut source = input.clone();
    source.columns = columns;
    let tracked = ProofOrder {
        host: order,
        failure: RefCell::new(None),
    };
    let prepared = crate::session::legacy::prepare(
        &source,
        &d,
        &SelectionSpec::None,
        &Revision {
            widget_id: input.provenance.source_widget_id.clone(),
            input: input.result_revision,
            model: input.result_revision,
            output: input.output_revision,
        },
        &tracked,
        true,
    );
    if let Some(error) = tracked.failure.into_inner() {
        return Err(error);
    }
    Ok(match prepared {
        Ok(v) => ids
            .iter()
            .map(|id| IdentityWitness {
                id: id.clone(),
                state: if v.identity_ids.contains(id) {
                    WitnessState::Present
                } else {
                    WitnessState::Absent
                },
            })
            .collect(),
        Err(_) => unknown(),
    })
}
/// Capture capability failures where they originate, without interpreting arbitrary codes.
struct ProofOrder<'a> {
    host: &'a dyn ValueOrder,
    failure: RefCell<Option<Diagnostic>>,
}
impl ProofOrder<'_> {
    fn record<T>(&self, result: Result<T, Diagnostic>) -> Result<T, Diagnostic> {
        if let Err(error) = &result {
            self.failure
                .borrow_mut()
                .get_or_insert_with(|| error.clone());
        }
        result
    }
}
impl ValueOrder for ProofOrder<'_> {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
        self.record(self.host.compare(a, b))
    }
    fn compare_raw(&self, a: &WireValue, b: &WireValue) -> Result<Comparison, Diagnostic> {
        self.record(self.host.compare_raw(a, b))
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<Ordering, Diagnostic> {
        self.record(self.host.compare_recipe(a, b))
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        self.record(self.host.sort_permutation(values, descending))
    }
}
