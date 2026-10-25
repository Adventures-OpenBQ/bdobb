// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use serde_json::json;
#[allow(clippy::result_large_err)]
pub fn unpivot_dataset(
    input: &SourceDataset,
    spec: &UnpivotSpec,
) -> Result<(SourceDataset, BTreeMap<String, DatasetColumn>), Diagnostic> {
    let mut fields = spec.carry_field_ids.clone();
    fields.extend([spec.item_field_id.clone(), spec.value_field_id.clone()]);
    if fields
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        != fields.len()
    {
        return Err(problem(
            "duplicate-id",
            "unpivot",
            "Unpivot carry, item and value fields must be distinct",
        ));
    }
    // compile_statement already checked these fields exist and validate_intent that
    // mapping line IDs are unique.
    let mut out = input.clone();
    out.rows.clear();
    out.columns = spec
        .carry_field_ids
        .iter()
        .map(|id| input.columns.iter().find(|c| &c.id == id).unwrap().clone())
        .collect();
    for (id, dtype) in [
        (&spec.item_field_id, "text"),
        (&spec.value_field_id, "number"),
    ] {
        out.columns
            .push(serde_json::from_value(json!({"id":id,"label":id,"dtype":dtype})).unwrap());
    }
    let mut occurrences = BTreeMap::new();
    let mut descriptors = BTreeMap::new();
    for source in &input.rows {
        let occurrence = occurrences.entry(source.id.clone()).or_insert(0u64);
        let nth = *occurrence;
        *occurrence += 1;
        for m in &spec.mappings {
            let v = source.values.get(&m.source_field_id);
            if v.is_some_and(|v| {
                !matches!(v, WireValue::Missing | WireValue::Null)
                    && crate::validation::arithmetic_number(v).is_err()
            }) {
                return Err(problem(
                    "invalid-type",
                    &m.source_field_id,
                    &format!(
                        "Unpivot requires a finite number, null or missing value: {}",
                        m.source_field_id
                    ),
                ));
            }
            let mut values: ValueRecord = spec
                .carry_field_ids
                .iter()
                .filter_map(|id| source.values.get(id).map(|v| (id.clone(), v.clone())))
                .collect();
            values.insert(
                spec.item_field_id.clone(),
                WireValue::String(m.line_id.clone()),
            );
            if let Some(v) = v {
                values.insert(spec.value_field_id.clone(), v.clone());
            }
            let identity = json!([
                [
                    "sourceWidgetId",
                    ["string", input.provenance.source_widget_id]
                ],
                ["sourceRowId", ["string", source.id]],
                ["occurrence", ["number", nth]],
                ["transformId", ["string", spec.id]],
                ["lineId", ["string", m.line_id]]
            ]);
            let id =
                serde_json::to_string(&json!(["key", serde_json::to_string(&identity).unwrap()]))
                    .unwrap();
            let bindings: Vec<_> = spec
                .carry_field_ids
                .iter()
                .map(|s| (s, s))
                .chain(std::iter::once((&m.source_field_id, &spec.value_field_id)))
                .collect();
            let errors: BTreeMap<_, _> = bindings
                .iter()
                .filter_map(|(s, d)| {
                    source
                        .cell_errors
                        .as_ref()
                        .and_then(|e| e.get(*s))
                        .map(|v| ((*d).clone(), v.clone()))
                })
                .collect();
            let formats: BTreeMap<_, _> = bindings
                .iter()
                .filter_map(|(s, d)| {
                    source
                        .cell_formats
                        .as_ref()
                        .and_then(|e| e.get(*s))
                        .map(|v| ((*d).clone(), v.clone()))
                })
                .collect();
            descriptors.insert(
                id.clone(),
                input
                    .columns
                    .iter()
                    .find(|c| c.id == m.source_field_id)
                    .unwrap()
                    .clone(),
            );
            out.rows.push(DatasetRow {
                id,
                values,
                group_path: source.group_path.clone(),
                cell_errors: (!errors.is_empty()).then_some(errors),
                cell_formats: (!formats.is_empty()).then_some(formats),
            });
        }
    }
    Ok((out, descriptors))
}
