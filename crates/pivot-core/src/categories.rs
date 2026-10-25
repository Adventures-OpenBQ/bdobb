// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Retain full structured cell-error evidence at the native stage boundary.
#![allow(clippy::result_large_err)]
use crate::{
    contract::*,
    fiscal::*,
    formulas::*,
    ordering::{number, value_string, ValueOrder},
    pivot::{bucket_key, pivot_value_key, Periodicity},
};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug)]
pub struct CategoryMember {
    pub category_id: String,
    pub key: String,
    pub label: String,
    pub value: WireValue,
    pub period: Option<(String, String)>,
    pub fiscal: Option<ResolvedFiscalPeriod>,
}
pub type CategoryMemberResult = Result<CategoryMember, ModelError>;
#[derive(Clone, Debug)]
pub struct CategoryMetadata {
    pub id: String,
    pub name: String,
    pub source_field_id: String,
    pub transform: Transform,
    pub recipe: Result<String, Diagnostic>,
    pub bucket: Bucket,
    pub periodicity: Periodicity,
}
#[derive(Clone, Debug)]
pub struct CategorizedRows {
    pub evaluated: EvaluatedRows,
    pub members: BTreeMap<String, BTreeMap<String, CategoryMemberResult>>,
    pub categories: Vec<CategoryMetadata>,
    pub warnings: Vec<ScopeWarning>,
}
pub fn category_bucket(c: &Category) -> Bucket {
    match c.legacy_bucket {
        Some(LegacyBucket::Week) => Bucket::Week,
        Some(LegacyBucket::Month) => Bucket::Month,
        None => match c.transform {
            Transform::Y => Bucket::Year,
            Transform::Q => Bucket::Quarter,
            Transform::M => Bucket::Month,
            _ => Bucket::Native,
        },
    }
}
pub fn category_recipe(c: &Category) -> String {
    let binding = c.fiscal_binding.as_ref().map(|b| {
        (
            &b.company_field_id,
            b.date_field_id.as_ref().unwrap_or(&c.source_field_id),
            &b.metadata_key,
            &b.period_start_field_id,
            &b.period_end_field_id,
            &b.fiscal_year_field_id,
            &b.fiscal_quarter_field_id,
            b.period_kind,
        )
    });
    serde_json::to_string(&(&c.source_field_id, c.transform, c.legacy_bucket, binding)).unwrap()
}
pub(crate) fn own<'a>(v: &'a WireValue, key: &str) -> &'a WireValue {
    match v {
        WireValue::Record(r) => r
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
            .unwrap_or(&WireValue::Missing),
        WireValue::Array(a) => {
            if key == "length" {
                return &WireValue::Missing;
            }
            if key == "0" || !key.starts_with('0') {
                key.parse::<usize>()
                    .ok()
                    .and_then(|i| a.get(i))
                    .unwrap_or(&WireValue::Missing)
            } else {
                &WireValue::Missing
            }
        }
        _ => &WireValue::Missing,
    }
}
pub fn derive_categories(
    input: &EvaluatedRows,
    model: &CompiledModel,
    order: &dyn ValueOrder,
) -> CategorizedRows {
    let mut result = CategorizedRows {
        evaluated: input.clone(),
        members: BTreeMap::new(),
        categories: vec![],
        warnings: vec![],
    };
    let empty = FiscalContext::default();
    let context = model.fiscal_context.as_ref().unwrap_or(&empty);
    let source_fields: BTreeSet<_> = input.rows.iter().flat_map(|r| r.values.keys()).collect();
    let mut fiscal_periods: BTreeMap<String, Vec<ResolvedFiscalPeriod>> = BTreeMap::new();
    for c in &model.categories {
        let bucket = category_bucket(c);
        let periodicity =
            crate::pivot::periodicity(input.rows.iter().map(|r| read(r, Some(&c.source_field_id))));
        let recipe = category_recipe(c);
        let recipe = if matches!(c.transform, Transform::FY | Transform::FQ) {
            fiscal_context_recipe(c.fiscal_binding.as_ref(), context, order)
                .map(|f| serde_json::to_string(&(recipe, f)).unwrap())
        } else {
            Ok(recipe)
        };
        result.categories.push(CategoryMetadata {
            id: c.id.clone(),
            name: c.name.clone(),
            source_field_id: c.source_field_id.clone(),
            transform: c.transform,
            recipe,
            bucket,
            periodicity,
        });
        if matches!(periodicity, Periodicity::Weekly)
            && matches!(bucket, Bucket::Month | Bucket::Quarter | Bucket::Year)
        {
            result.warnings.push(ScopeWarning{code:"approximate-period".into(),category_id:Some(c.id.clone()),message:"Weekly observations assigned to calendar buckets may straddle period boundaries; summing them is approximate.".into(),periods:vec![]})
        }
    }
    for (i, row) in input.rows.iter().enumerate() {
        let mut members = BTreeMap::new();
        for c in &model.categories {
            let fail = |code: &str, msg: String| Err(error(code, msg, &c.id, vec![row.id.clone()]));
            let mut member = (|| {
                if source_fields.contains(&c.id)
                    || model.categories.iter().filter(|o| o.id == c.id).count() > 1
                {
                    return fail(
                        "missing-reference",
                        "A category ID collides with another category or an input field.".into(),
                    );
                }
                if !row.values.contains_key(&c.source_field_id) {
                    return fail(
                        "missing-input",
                        format!("Source field {} is unavailable.", c.source_field_id),
                    );
                }
                let cell = read(row, Some(&c.source_field_id));
                let declared = input
                    .columns
                    .iter()
                    .find(|v| v.id == c.source_field_id)
                    .and_then(|v| v.metadata.as_ref())
                    .and_then(|m| m.get("cellField"))
                    .and_then(|v| {
                        if let WireValue::String(s) = v {
                            Some(s.as_str())
                        } else {
                            None
                        }
                    });
                let fallback = matches!(
                    own(cell, "value"),
                    WireValue::String(_)
                        | WireValue::F64(_)
                        | WireValue::Bool(_)
                        | WireValue::BigIntString(_)
                )
                .then_some("value");
                let field = declared.or(fallback);
                let mut value = if matches!(cell, WireValue::Record(_) | WireValue::Array(_)) {
                    if let Some(key) = field {
                        if let WireValue::Array(a) = cell {
                            if key == "length" {
                                WireValue::F64(WireNumber::Finite(a.len() as f64))
                            } else {
                                own(cell, key).clone()
                            }
                        } else {
                            own(cell, key).clone()
                        }
                    } else {
                        cell.clone()
                    }
                } else {
                    cell.clone()
                };
                if number(&value).is_some_and(|v| !v.is_finite()) {
                    return fail("nonfinite", "A category member must be finite.".into());
                }
                if matches!(value, WireValue::Record(_) | WireValue::Array(_)) {
                    return fail(
                        "missing-input",
                        if declared.is_none() {
                            format!("A category member must be a scalar value; {} holds objects and declares no display field.",c.source_field_id)
                        } else {
                            format!("A category member must be a scalar value; display field {} of {} is not one.",field.unwrap(),c.source_field_id)
                        },
                    );
                }
                let mut label = if blank(&value) {
                    "(blank)".into()
                } else {
                    value_string(&value)
                };
                let mut period = None;
                let mut fiscal = None;
                if matches!(c.transform, Transform::FY | Transform::FQ) {
                    let Some(binding) = &c.fiscal_binding else {
                        return fail("fiscal-context","Bind the category report date and company explicitly; conflicting date mappings cannot be applied.".into());
                    };
                    if binding
                        .date_field_id
                        .as_ref()
                        .is_some_and(|d| d != &c.source_field_id)
                    {
                        return fail("fiscal-context","Bind the category report date and company explicitly; conflicting date mappings cannot be applied.".into());
                    }
                    let mut binding = binding.clone();
                    binding.date_field_id = Some(c.source_field_id.clone());
                    let p = resolve_fiscal_period(row, &binding, context);
                    let p = if c.transform == Transform::FY {
                        p.year
                    } else {
                        p.quarter
                    }
                    .map_err(|mut e| {
                        e.definition_id = c.id.clone();
                        e
                    })?;
                    value = WireValue::String(p.key.clone());
                    label = p.label.clone();
                    period = Some((p.start.clone(), p.end.clone()));
                    fiscal = Some(p);
                } else if c.transform != Transform::Native || c.legacy_bucket.is_some() {
                    if blank(&value) {
                        value = WireValue::Null;
                    } else {
                        let Some(date) = period_date(&value) else {
                            return fail(
                                "invalid-date",
                                format!(
                                    "Source field {} is not a valid period date.",
                                    c.source_field_id
                                ),
                            );
                        };
                        let bucket = category_bucket(c);
                        let key = bucket_key(&date, bucket).unwrap();
                        label = if bucket == Bucket::Quarter {
                            key.replace("-Q", " Q")
                        } else {
                            key.clone()
                        };
                        value = WireValue::String(key);
                        let y = date[..4].parse().unwrap();
                        let m = date[5..7].parse().unwrap();
                        period = match bucket {
                            Bucket::Year => Some(month_bounds(y, 1, 12)),
                            Bucket::Quarter => Some(month_bounds(y, (m - 1) / 3 * 3 + 1, 3)),
                            Bucket::Month => Some(month_bounds(y, m, 1)),
                            Bucket::Week => {
                                let day = date_day(&date);
                                let monday = day - (day + 3).rem_euclid(7);
                                Some((day_date(monday), day_date(monday + 6)))
                            }
                            _ => None,
                        };
                    }
                }
                Ok(CategoryMember {
                    category_id: c.id.clone(),
                    key: pivot_value_key(&value),
                    label,
                    value,
                    period,
                    fiscal,
                })
            })();
            let dependency = input
                .formula_cells
                .get(&row.id)
                .and_then(|cells| cells.get(&c.source_field_id))
                .and_then(|cell| {
                    if let CellResult::Error(e) = cell {
                        Some(e.clone())
                    } else {
                        None
                    }
                })
                .or_else(|| {
                    row.cell_errors
                        .as_ref()
                        .and_then(|errors| errors.get(&c.source_field_id))
                        .map(|incoming| {
                            error(
                                "blocked-dependency",
                                incoming.message.clone(),
                                "",
                                vec![row.id.clone()],
                            )
                        })
                });
            if let Some(mut e) = dependency {
                e.code = "blocked-dependency".into();
                e.definition_id = c.id.clone();
                let mut ids = vec![c.source_field_id.clone()];
                for id in &e.dependency_ids {
                    if !ids.contains(id) {
                        ids.push(id.clone())
                    }
                }
                e.dependency_ids = ids;
                member = Err(e);
                if !row.values.contains_key(&c.id) {
                    result.evaluated.rows[i].values.remove(&c.id);
                }
            }
            match &member {
                Ok(m) => {
                    result.evaluated.rows[i]
                        .values
                        .insert(c.id.clone(), m.value.clone());
                    if let Some(p) = &m.fiscal {
                        fiscal_periods
                            .entry(c.id.clone())
                            .or_default()
                            .push(p.clone());
                    }
                }
                Err(e) => {
                    result
                        .evaluated
                        .errors
                        .entry(row.id.clone())
                        .or_default()
                        .insert(c.id.clone(), e.clone());
                }
            }
            members.insert(c.id.clone(), member);
        }
        result.members.insert(row.id.clone(), members);
    }
    for c in &model.categories {
        if let Some(periods) = fiscal_periods.get(&c.id) {
            result
                .warnings
                .extend(alignment_warnings(periods).into_iter().map(|mut w| {
                    w.category_id = Some(c.id.clone());
                    w
                }))
        }
    }
    result
}
pub(crate) fn blank(v: &WireValue) -> bool {
    matches!(v, WireValue::Missing | WireValue::Null)
        || matches!(v,WireValue::String(s) if s.is_empty())
}
/// Stable fallible sorting; a host error is propagated before any recipe is published.
#[allow(clippy::result_large_err)]
pub(crate) fn recipe_sort<T>(
    values: &mut [T],
    key: impl Fn(&T) -> String,
    order: &dyn ValueOrder,
) -> Result<(), Diagnostic> {
    let mut error = None;
    values.sort_by(|a, b| match order.compare_recipe(&key(a), &key(b)) {
        Ok(c) => c,
        Err(e) => {
            error = Some(e);
            std::cmp::Ordering::Equal
        }
    });
    if let Some(e) = error {
        Err(e)
    } else {
        Ok(())
    }
}
#[allow(clippy::result_large_err)]
pub fn fiscal_context_recipe(
    binding: Option<&FiscalBinding>,
    context: &FiscalContext,
    order: &dyn ValueOrder,
) -> Result<String, Diagnostic> {
    let metadata = if let Some(key) = binding.and_then(|b| b.metadata_key.as_ref()) {
        context.metadata.as_ref().and_then(|m| m.get(key))
    } else {
        context.companies.as_ref()
    };
    fn entries(
        map: Option<&FiscalCompanies>,
        order: &dyn ValueOrder,
    ) -> Result<String, Diagnostic> {
        let mut entries: Vec<_> = map.into_iter().flat_map(|m| m.iter()).collect();
        recipe_sort(&mut entries, |p| p.0.clone(), order)?;
        let mut rows = vec![];
        for (k, v) in entries {
            let mut periods = v
                .periods
                .iter()
                .map(|period| {
                    Ok(format!(
                        "[{},{},{},{},{},{}]",
                        serde_json::to_string(&period.kind).unwrap(),
                        period.year,
                        quarter_recipe_json(period)?,
                        serde_json::to_string(&period.start).unwrap(),
                        serde_json::to_string(&period.end).unwrap(),
                        serde_json::to_string(&period.source).unwrap()
                    ))
                })
                .collect::<Result<Vec<_>, Diagnostic>>()?;
            recipe_sort(&mut periods, String::clone, order)?;
            rows.push(format!(
                "[{},{},{},{},[{}]]",
                serde_json::to_string(k).unwrap(),
                serde_json::to_string(&v.year_end_month).unwrap(),
                serde_json::to_string(&v.calendar).unwrap(),
                serde_json::to_string(&v.source).unwrap(),
                periods.join(",")
            ));
        }
        Ok(format!("[{}]", rows.join(",")))
    }
    Ok(format!(
        "[{},{}]",
        entries(metadata, order)?,
        entries(context.overrides.as_ref(), order)?
    ))
}
