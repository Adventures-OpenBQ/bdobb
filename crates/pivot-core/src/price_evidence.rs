// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

use crate::contract::{DatasetColumn, DatasetRow, Provenance, WireNumber, WireValue};
use serde::Deserialize;
use std::collections::BTreeSet;

type Coordinate = (String, String);

/// The host validates the acquired daily scope and normalizes coordinates in input row order.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PriceCoordinatePlan {
    acquired: usize,
    date_field: String,
    symbol_fields: Vec<String>,
    prices: Vec<String>,
    single: bool,
    previous: Vec<Coordinate>,
    points: Vec<Coordinate>,
}

impl Provenance {
    pub(crate) fn project_price_omissions<'a>(
        &mut self,
        input: &[DatasetRow],
        presented: impl Iterator<Item = &'a DatasetRow>,
        columns: &[DatasetColumn],
    ) {
        let Some(metadata) = self.metadata.as_mut() else {
            return;
        };
        let plan = metadata.remove("priceCoordinatePlan");
        metadata.remove("priceOmissions");
        let Some(WireValue::String(plan)) = plan else {
            return;
        };
        let Ok(plan) = serde_json::from_str::<PriceCoordinatePlan>(&plan) else {
            return;
        };
        let includes = |id: &str| columns.iter().any(|column| column.id == id);
        if self.input_may_contain_aggregates == Some(true)
            || plan.points.len() != input.len()
            || plan.points.len().checked_add(plan.previous.len()) != Some(plan.acquired)
            || !includes(&plan.date_field)
            || !plan.prices.iter().any(|field| includes(field))
        {
            return;
        }
        let symbol_fields: Vec<_> = plan
            .symbol_fields
            .into_iter()
            .filter(|field| includes(field))
            .map(WireValue::String)
            .collect();
        if symbol_fields.is_empty() && !plan.single {
            return;
        }
        let retained: BTreeSet<_> = presented.map(|row| row.id.as_str()).collect();
        let points: Vec<_> =
            plan.previous
                .into_iter()
                .chain(input.iter().zip(plan.points).filter_map(|(row, point)| {
                    (!retained.contains(row.id.as_str())).then_some(point)
                }))
                .map(|(symbol, date)| {
                    WireValue::Array(vec![WireValue::String(symbol), WireValue::String(date)])
                })
                .collect();
        if points.is_empty() || points.len().checked_add(retained.len()) != Some(plan.acquired) {
            return;
        }
        metadata.insert(
            "priceOmissions".into(),
            WireValue::Record(vec![
                (
                    "acquired".into(),
                    WireValue::F64(WireNumber::Finite(plan.acquired as f64)),
                ),
                (
                    "delivered".into(),
                    WireValue::F64(WireNumber::Finite(retained.len() as f64)),
                ),
                ("dateField".into(), WireValue::String(plan.date_field)),
                ("symbolFields".into(), WireValue::Array(symbol_fields)),
                ("points".into(), WireValue::Array(points)),
            ]),
        );
    }
}
