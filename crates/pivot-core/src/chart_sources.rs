// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! The host supplies coordinate declarations derived from its closed family decoder.
//! Project against all presented rows before a linked export is split into batches.
use crate::contract::{DatasetColumn, DatasetRow, Provenance, WireValue};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Group {
    fields: Vec<String>,
    points: Vec<Point>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Point {
    id: String,
    values: Vec<String>,
}

fn binding<'a>(columns: &'a [DatasetColumn], origin: &str) -> Option<&'a str> {
    let mut matches = columns.iter().filter(|col| {
        col.source_field_id.as_deref().unwrap_or(&col.id) == origin
            && col.analytical.is_none()
            && col.measure_id.is_none()
            && col.aggregation.is_none()
            && col.split_path.as_ref().is_none_or(Vec::is_empty)
    });
    let id = matches.next()?.id.as_str();
    matches.next().is_none().then_some(id)
}

impl Provenance {
    pub(crate) fn mark_chart_filtered(&mut self, filtered: bool) {
        if let Some(metadata) = self.metadata.as_mut() {
            if filtered && metadata.contains_key("chartSources") {
                metadata.insert("chartSourceFiltered".into(), WireValue::Bool(true));
            }
        }
    }

    pub(crate) fn project_chart_sources<'a, I: Iterator<Item = &'a DatasetRow>>(
        &mut self,
        rows: impl Fn() -> I,
        columns: &[DatasetColumn],
    ) {
        let Some(metadata) = self.metadata.as_mut() else {
            return;
        };
        let Some(WireValue::String(plan)) = metadata.remove("chartSourceCoordinatePlan") else {
            return;
        };
        let Ok(groups) = serde_json::from_str::<BTreeMap<String, Vec<Group>>>(&plan) else {
            metadata.remove("chartSources");
            metadata.remove("chartSourceFiltered");
            metadata.remove("chartSourceOmissions");
            return;
        };
        let previous = metadata.remove("chartSourceOmissions");
        let mut omissions = vec![];
        for (kind, groups) in groups {
            let mut absent = BTreeSet::new();
            if let Some(WireValue::Record(families)) = &previous {
                if let Some((_, WireValue::Array(prior))) =
                    families.iter().find(|(k, _)| k == &kind)
                {
                    absent.extend(prior.iter().filter_map(|v| match v {
                        WireValue::String(id) => Some(id.as_str()),
                        _ => None,
                    }));
                }
            }
            let mut omitted = vec![];
            for group in groups {
                let bindings: Option<Vec<_>> =
                    group.fields.iter().map(|f| binding(columns, f)).collect();
                let mut visible = BTreeSet::new();
                if self.input_may_contain_aggregates != Some(true) {
                    if let Some(fields) = bindings {
                        for row in rows() {
                            let tuple: Option<Vec<_>> = fields
                                .iter()
                                .map(|&f| {
                                    if row.cell_errors.as_ref().is_some_and(|e| e.contains_key(f)) {
                                        return None;
                                    }
                                    match row.values.get(f)? {
                                        WireValue::String(v) => Some(v.as_str()),
                                        _ => None,
                                    }
                                })
                                .collect();
                            if let Some(tuple) = tuple {
                                visible.insert(tuple);
                            }
                        }
                    }
                }
                for point in group.points {
                    let tuple = point.values.iter().map(String::as_str).collect::<Vec<_>>();
                    if absent.contains(point.id.as_str()) || !visible.contains(&tuple) {
                        omitted.push(WireValue::String(point.id));
                    }
                }
            }
            if !omitted.is_empty() {
                omissions.push((kind, WireValue::Array(omitted)));
            }
        }
        if !omissions.is_empty() {
            metadata.insert("chartSourceOmissions".into(), WireValue::Record(omissions));
        }
    }
}
