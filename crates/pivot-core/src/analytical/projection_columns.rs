// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
pub(super) fn identity(path: &str, signature: &str) -> String {
    serde_json::to_string(&("group", signature, path)).unwrap()
}
/// Per layout category, each member key's value from the first record (in record-ID
/// order) classified with it: one pass instead of a scan per descriptor.
pub(super) struct FirstValues(HashMap<String, HashMap<String, WireValue>>);
impl FirstValues {
    pub(super) fn new(pool: &EligiblePool, a: &TableModel) -> Self {
        let mut out: HashMap<String, HashMap<String, WireValue>> = HashMap::new();
        for id in a.layout.rows.iter().chain(&a.layout.columns) {
            out.entry(id.clone()).or_default();
        }
        for members in pool.members.values() {
            for (id, values) in &mut out {
                if let Some(Ok(m)) = members.get(id) {
                    values
                        .entry(m.key.clone())
                        .or_insert_with(|| m.value.clone());
                }
            }
        }
        Self(out)
    }
}
pub(super) fn descriptor(
    v: &CalculatedView,
    first: &FirstValues,
    id: &str,
    key: &str,
) -> GroupMember {
    let c = v.compiled.categories.iter().find(|c| c.id == id).unwrap();
    let member = first.0.get(id).and_then(|m| m.get(key));
    let value = member.cloned().unwrap_or_else(|| {
        serde_json::from_str::<serde_json::Value>(key)
            .ok()
            .and_then(|v| v.get(1).map(tag_json))
            .unwrap_or(WireValue::Missing)
    });
    GroupMember {
        field: id.into(),
        value,
        category_id: Some(id.into()),
        source_binding_id: Some(c.source_field_id.clone()),
        transform: Some(c.transform),
        member_key: Some(key.into()),
        label: v
            .compiled
            .execution
            .as_ref()
            .and_then(|e| e.member_labels.get(id))
            .and_then(|m| m.get(key))
            .cloned(),
        bucket: c.legacy_bucket.map(|b| match b {
            LegacyBucket::Week => Bucket::Week,
            LegacyBucket::Month => Bucket::Month,
        }),
    }
}
pub(super) fn cell(t: &CalculatedTotals, id: &str, m: &CompiledModel) -> Option<CellResult> {
    if m.symbols
        .formulas
        .iter()
        .any(|f| f.id == id && f.scope == FormulaScope::Aggregate)
    {
        t.formulas.cells.get(id)
    } else {
        t.formulas.measure_cells.get(id)
    }
    .cloned()
}
#[allow(clippy::result_large_err)]
pub(super) fn put_cell(
    id: &str,
    c: &CellResult,
    values: &mut ValueRecord,
    errors: &mut BTreeMap<String, CellError>,
) -> Result<(), Diagnostic> {
    match c {
        CellResult::Value(v) => {
            values.insert(id.into(), v.clone());
        }
        CellResult::Error(e) => {
            values.insert(id.into(), WireValue::String("#ERROR".into()));
            errors.insert(id.into(), compact_cell_error(e)?);
        }
    }
    Ok(())
}
pub(super) fn finish_columns(v: &mut CalculatedView) {
    for c in &mut v.columns {
        let id = c
            .measure_id
            .as_deref()
            .or_else(|| {
                c.metadata
                    .as_ref()
                    .and_then(|m| m.get("formulaId"))
                    .and_then(|v| {
                        if let WireValue::String(s) = v {
                            Some(s.as_str())
                        } else {
                            None
                        }
                    })
            })
            .unwrap_or(&c.id)
            .to_string();
        let f = v.compiled.symbols.formulas.iter().find(|f| f.id == id);
        let format = f.and_then(|f| f.format.as_ref());
        let meta = if f.is_some() {
            v.calculated_totals.formulas.metadata.get(&id)
        } else {
            v.calculated_totals.formulas.measure_metadata.get(&id)
        };
        if let Some(f) = f {
            c.analytical = Some(AnalyticalColumn {
                kind: AnalyticalKind::Formula,
                definition_id: id.clone(),
                name: f.name.clone(),
                scope: Some(f.scope),
                transform: None,
                value_kind: meta.and_then(|m| m.value_kind),
            });
            let metadata = c.metadata.get_or_insert_with(BTreeMap::new);
            metadata.insert("formulaId".into(), WireValue::String(id));
            if let Some(f) = format {
                metadata.insert("formulaFormat".into(), WireValue::String(f.clone()));
            }
        }
        if meta.is_some_and(|m| m.value_kind.is_some()) {
            c.dtype = Some("number".into());
            c.format = Some(CellFormat {
                formatter_fn: Some("none".into()),
                decimal_places: None,
                abbreviate: None,
            });
        }
        if let Some(f) = format {
            let formatter = match f.as_str() {
                "decimal" | "number" => "none",
                "integer" => "int",
                s => s,
            };
            if [
                "int",
                "none",
                "percent",
                "normalized",
                "normalizedPercent",
                "dateToYear",
            ]
            .contains(&formatter)
            {
                c.format = Some(CellFormat {
                    formatter_fn: Some(formatter.into()),
                    decimal_places: None,
                    abbreviate: None,
                });
            }
        }
    }
    let table = &v.compiled.definition.definition.table;
    v.columns
        .retain(|c| !table.hidden.as_ref().is_some_and(|h| h.contains(&c.id)));
    let order = table.column_order.as_deref().unwrap_or(&[]);
    v.columns
        .sort_by_key(|c| order.iter().position(|s| s == &c.id).unwrap_or(order.len()));
}
