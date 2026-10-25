// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Rich structured diagnostics are part of the public execution contract.
#![allow(clippy::result_large_err)]
use crate::{contract::*, ordering::*};
use std::collections::BTreeMap;
pub const LABEL_FIELD: &str = "\u{1e}group";
#[derive(Debug, Clone)]
pub struct PivotColumn {
    pub field: String,
    pub header: String,
    /// Opaque renderer metadata; explicit Missing differs from an absent property.
    pub properties: ValueRecord,
    pub group_path: Vec<String>,
    pub split_keys: Vec<String>,
    pub source: Option<String>,
    pub measure_id: Option<String>,
    pub aggregation: Option<Aggregation>,
}
impl PivotColumn {
    pub fn source(field: &str, header: &str) -> Self {
        Self {
            field: field.into(),
            header: header.into(),
            properties: BTreeMap::new(),
            group_path: vec![],
            split_keys: vec![],
            source: None,
            measure_id: None,
            aggregation: None,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    Text,
    Number,
    Date,
    Boolean,
    None,
}
#[derive(Debug, Clone)]
pub struct CategoryMetadata {
    pub source_field_id: String,
    pub bucket: Bucket,
    pub periodicity: Periodicity,
}
#[derive(Debug, Clone, Copy)]
pub enum Periodicity {
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Annual,
    Irregular,
}
#[derive(Debug, Clone)]
pub struct PivotInput {
    /// Row positions are source ordinals; values-map iteration never defines an axis.
    pub rows: Vec<ValueRecord>,
    pub columns: Vec<PivotColumn>,
    pub kinds: BTreeMap<String, FieldKind>,
    pub order: Vec<String>,
    pub config: PivotConfig,
    pub sorting: Vec<Sort>,
    pub aggregate_only: bool,
    pub category_metadata: BTreeMap<String, CategoryMetadata>,
}
#[derive(Debug, Clone)]
pub struct Incomplete {
    pub have: usize,
    pub expected: usize,
}
#[derive(Debug, Clone)]
pub enum PivotRowMeta {
    Group {
        depth: usize,
        path: String,
        label: String,
        count: usize,
        expandable: bool,
        open: bool,
        incomplete: Option<Incomplete>,
    },
    Leaf {
        depth: usize,
        source_index: Option<usize>,
    },
    Total {
        depth: usize,
        label: String,
        count: usize,
    },
}
#[derive(Debug, Clone)]
pub struct PivotResult {
    pub rows: Vec<ValueRecord>,
    pub meta: Vec<PivotRowMeta>,
    pub columns: Vec<PivotColumn>,
    /// Internal row identity; never part of low-level metadata or serialized output.
    pub leaf_ordinals: Vec<Option<usize>>,
}

pub const KEY_SEP: &str = "\u{1f}";
pub const MAX_PIVOT_COLUMNS: usize = 500;
fn read<'a>(row: &'a ValueRecord, field: &str) -> &'a WireValue {
    row.get(field).unwrap_or(&WireValue::Missing)
}
pub(crate) fn scalar_number(x: f64) -> WireValue {
    WireValue::F64(if x.is_nan() {
        WireNumber::Special(SpecialNumber::Nan)
    } else if x == f64::INFINITY {
        WireNumber::Special(SpecialNumber::PositiveInfinity)
    } else if x == f64::NEG_INFINITY {
        WireNumber::Special(SpecialNumber::NegativeInfinity)
    } else if x == 0. && x.is_sign_negative() {
        WireNumber::Special(SpecialNumber::NegativeZero)
    } else {
        WireNumber::Finite(x)
    })
}
pub fn aggregate(
    op: Aggregation,
    rows: &[ValueRecord],
    field: &str,
    date: Option<&str>,
    order: &dyn ValueOrder,
) -> Result<WireValue, Diagnostic> {
    let cache = CachedOrder::new(order, 4096);
    aggregate_indices(
        op,
        rows,
        &(0..rows.len()).collect::<Vec<_>>(),
        field,
        date,
        &cache,
    )
}
fn aggregate_indices(
    op: Aggregation,
    rows: &[ValueRecord],
    indices: &[usize],
    field: &str,
    date: Option<&str>,
    order: &dyn ValueOrder,
) -> Result<WireValue, Diagnostic> {
    if matches!(op, Aggregation::First | Aggregation::Last) {
        let Some(date) = date else {
            return Ok(WireValue::Missing);
        };
        let mut dated: Vec<_> = indices
            .iter()
            .copied()
            .filter(|i| !missing(read(&rows[*i], field)) && !missing(read(&rows[*i], date)))
            .collect();
        // Source ordinal is retained through filtering and stable date ties.
        let keys = dated
            .iter()
            .map(|i| vec![read(&rows[*i], date).clone()])
            .collect::<Vec<_>>();
        sort_by_keys(&mut dated, &keys, &[false], order)?;
        return Ok(if op == Aggregation::First {
            dated.first()
        } else {
            dated.last()
        }
        .map(|i| read(&rows[*i], field).clone())
        .unwrap_or(WireValue::Missing));
    }
    let values: Vec<_> = indices
        .iter()
        .map(|i| read(&rows[*i], field))
        .filter(|v| !missing(v))
        .collect();
    if op == Aggregation::Count {
        return Ok(WireValue::String(values.len().to_string()));
    }
    if op == Aggregation::UniqueCount {
        return Ok(WireValue::String(
            values
                .iter()
                .map(|v| string_value(v))
                .collect::<Result<std::collections::BTreeSet<_>, _>>()?
                .len()
                .to_string(),
        ));
    }
    if values.is_empty() {
        return Ok(WireValue::Missing);
    }
    if matches!(op, Aggregation::Min | Aggregation::Max) {
        let mut answer = values[0];
        for v in &values[1..] {
            let c = order.compare(v, answer)?;
            if (op == Aggregation::Min && c == std::cmp::Ordering::Less)
                || (op == Aggregation::Max && c == std::cmp::Ordering::Greater)
            {
                answer = v;
            }
        }
        return Ok(answer.clone());
    }
    let mut numbers: Vec<_> = values
        .iter()
        .filter_map(|v| number(v))
        .filter(|v| v.is_finite())
        .collect();
    if numbers.is_empty() {
        return Ok(WireValue::Missing);
    }
    let result = match op {
        Aggregation::Sum => numbers.iter().fold(0., |sum, x| sum + x),
        Aggregation::Mean => numbers.iter().fold(0., |sum, x| sum + x) / numbers.len() as f64,
        Aggregation::Median => {
            numbers.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let m = numbers.len() / 2;
            if numbers.len() % 2 == 1 {
                numbers[m]
            } else {
                (numbers[m - 1] + numbers[m]) / 2.
            }
        }
        _ => unreachable!(),
    };
    Ok(scalar_number(result))
}
pub fn pivot_value_key(value: &WireValue) -> String {
    if missing(value) {
        return "[\"blank\",null]".into();
    }
    let quote = |x: &str| serde_json::to_string(x).unwrap();
    match value {
        WireValue::String(x) => format!("[\"string\",{}]", quote(x)),
        WireValue::Bool(x) => format!("[\"boolean\",{x}]"),
        WireValue::BigIntString(x) => format!("[\"bigint\",{}]", quote(x)),
        WireValue::F64(_) => {
            let x = number(value).unwrap();
            let text = number_string(x);
            format!(
                "[\"number\",{}]",
                if x.is_finite() { text } else { quote(&text) }
            )
        }
        _ => format!("[\"object\",{}]", quote(&value_string(value))),
    }
}
pub(crate) fn date_parts(date: &str) -> Option<(i64, i64, i64)> {
    let b = date.as_bytes();
    if b.len() < 10
        || b[4] != b'-'
        || b[7] != b'-'
        || !b[..4]
            .iter()
            .chain(&b[5..7])
            .chain(&b[8..10])
            .all(u8::is_ascii_digit)
    {
        return None;
    }
    Some((
        date[..4].parse().ok()?,
        date[5..7].parse().ok()?,
        date[8..10].parse().ok()?,
    ))
}
fn civil_year(day: i64) -> i64 {
    let z = day + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    y + i64::from(mp >= 10)
}
fn utc_day(y: i64, m: i64, d: i64) -> i64 {
    crate::fiscal::civil_day(if (0..=99).contains(&y) { y + 1900 } else { y }, m, d)
}
pub fn bucket_key(date: &str, bucket: Bucket) -> Option<String> {
    let (y, m, d) = date_parts(date)?;
    Some(match bucket {
        Bucket::Native => date.into(),
        Bucket::Year => date[..4].into(),
        Bucket::Quarter => format!("{}-Q{}", &date[..4], (m - 1).div_euclid(3) + 1),
        Bucket::Month => date[..7].into(),
        Bucket::Week => {
            let day = utc_day(y, m, d);
            let weekday = (day + 3).rem_euclid(7) + 1;
            let thursday = day + 4 - weekday;
            let year = civil_year(thursday);
            let week = (thursday - utc_day(year, 1, 1) + 7) / 7;
            format!("{year}-W{week:02}")
        }
    })
}
pub(crate) fn periodicity<'a>(values: impl Iterator<Item = &'a WireValue>) -> Periodicity {
    let days: std::collections::BTreeSet<_> = values
        .filter_map(|v| {
            if let WireValue::String(s) = v {
                date_parts(s).map(|(y, m, d)| utc_day(y, m, d))
            } else {
                None
            }
        })
        .collect();
    let days: Vec<_> = days.into_iter().collect();
    if days.len() < 3 {
        return Periodicity::Irregular;
    }
    let mut gaps: Vec<_> = days.windows(2).map(|p| p[1] - p[0]).collect();
    gaps.sort_unstable();
    match gaps[gaps.len() / 2] {
        1 => Periodicity::Daily,
        6..=8 => Periodicity::Weekly,
        28..=31 => Periodicity::Monthly,
        89..=92 => Periodicity::Quarterly,
        365..=366 => Periodicity::Annual,
        _ => Periodicity::Irregular,
    }
}
#[derive(Clone)]
struct Group {
    key: String,
    raw: WireValue,
    indices: Vec<usize>,
}
#[derive(Clone)]
struct Combo {
    id: String,
    labels: Vec<String>,
}
struct Engine<'a> {
    input: &'a PivotInput,
    order: &'a dyn ValueOrder,
    grouping: Vec<String>,
    split: Vec<String>,
    measures: Vec<Measure>,
    date: Option<String>,
    combos: Vec<Combo>,
    periodicity: BTreeMap<String, Periodicity>,
}
impl Engine<'_> {
    fn column(&self, field: &str) -> &PivotColumn {
        self.input
            .columns
            .iter()
            .find(|c| c.field == field)
            .unwrap()
    }
    fn bucket(&self, field: &str) -> Bucket {
        if self.input.kinds.get(field) == Some(&FieldKind::Date) {
            self.input
                .config
                .buckets
                .as_ref()
                .and_then(|b| b.get(field))
                .copied()
                .unwrap_or(Bucket::Native)
        } else {
            Bucket::Native
        }
    }
    fn key(&self, index: usize, field: &str) -> Result<(String, WireValue), Diagnostic> {
        let cell = read(&self.input.rows[index], field);
        let shown = if matches!(cell, WireValue::Record(_) | WireValue::Array(_)) {
            if let Some(WireValue::Record(hover)) = self.column(field).properties.get("hoverCard") {
                if let Some((_, WireValue::String(key))) =
                    hover.iter().find(|(k, _)| k == "cellField")
                {
                    property(cell, key)
                } else {
                    std::borrow::Cow::Borrowed(cell)
                }
            } else {
                std::borrow::Cow::Borrowed(cell)
            }
        } else {
            std::borrow::Cow::Borrowed(cell)
        };
        let inner = property(&shown, "value");
        let value = if matches!(
            inner.as_ref(),
            WireValue::String(_)
                | WireValue::F64(_)
                | WireValue::Bool(_)
                | WireValue::BigIntString(_)
        ) {
            inner.as_ref()
        } else {
            shown.as_ref()
        };
        if missing(value) {
            return Ok((pivot_value_key(&WireValue::Null), WireValue::Missing));
        }
        let bucket = self.bucket(field);
        if bucket != Bucket::Native {
            if let Some(key) = bucket_key(&string_value(value)?, bucket) {
                let raw = WireValue::String(key);
                return Ok((pivot_value_key(&raw), raw));
            }
        }
        string_value(value)?;
        Ok((pivot_value_key(value), value.clone()))
    }
    fn partition(&self, indices: &[usize], field: &str) -> Result<Vec<Group>, Diagnostic> {
        let mut groups: Vec<Group> = vec![];
        let mut positions = BTreeMap::new();
        for i in indices {
            let (key, raw) = self.key(*i, field)?;
            if let Some(index) = positions.get(&key).copied() {
                let group: &mut Group = &mut groups[index];
                group.indices.push(*i);
            } else {
                positions.insert(key.clone(), groups.len());
                groups.push(Group {
                    key,
                    raw,
                    indices: vec![*i],
                });
            }
        }
        let keys = groups
            .iter()
            .map(|g| vec![g.raw.clone()])
            .collect::<Vec<_>>();
        sort_by_keys(&mut groups, &keys, &[false], self.order)?;
        Ok(groups)
    }
    fn describe(
        &self,
        field: &str,
        group: &Group,
    ) -> Result<(String, Option<Incomplete>), Diagnostic> {
        if missing(&group.raw) {
            return Ok(("(blank)".into(), None));
        }
        let category = self.input.category_metadata.get(field);
        let bucket = category.map(|c| c.bucket).unwrap_or(self.bucket(field));
        let label = string_value(&group.raw)?;
        let label = if bucket == Bucket::Quarter {
            label.replacen("-Q", " Q", 1)
        } else {
            label
        };
        let expected = match (self.periodicity.get(field), bucket) {
            (Some(Periodicity::Monthly), Bucket::Quarter) => Some(3),
            (Some(Periodicity::Monthly), Bucket::Year) => Some(12),
            (Some(Periodicity::Quarterly), Bucket::Year) => Some(4),
            _ => None,
        };
        let incomplete = if let Some(expected) = expected {
            let field = category
                .map(|c| c.source_field_id.as_str())
                .unwrap_or(field);
            let have = group
                .indices
                .iter()
                .map(|i| read(&self.input.rows[*i], field))
                .filter(|v| !missing(v))
                .map(|v| string_value(v).map(|s| s.chars().take(10).collect::<String>()))
                .collect::<Result<std::collections::BTreeSet<_>, _>>()?
                .len();
            (have < expected).then_some(Incomplete { have, expected })
        } else {
            None
        };
        Ok((label, incomplete))
    }
    fn walk_split(
        &self,
        indices: &[usize],
        depth: usize,
        id: String,
        labels: Vec<String>,
        combos: &mut Vec<Combo>,
    ) -> Result<(), Diagnostic> {
        if depth == self.split.len() {
            combos.push(Combo { id, labels });
            return Ok(());
        }
        for group in self.partition(indices, &self.split[depth])? {
            let (label, incomplete) = self.describe(&self.split[depth], &group)?;
            let text = if let Some(i) = incomplete {
                format!("{label} ({} of {})", i.have, i.expected)
            } else {
                label
            };
            let mut labels = labels.clone();
            labels.push(text);
            let id = if depth == 0 {
                group.key
            } else {
                format!("{id}{KEY_SEP}{}", group.key)
            };
            self.walk_split(&group.indices, depth + 1, id, labels, combos)?;
        }
        Ok(())
    }
    fn combo_id(&self, index: usize) -> Result<String, Diagnostic> {
        self.split
            .iter()
            .map(|f| self.key(index, f).map(|(key, _)| key))
            .collect::<Result<Vec<_>, _>>()
            .map(|keys| keys.join(KEY_SEP))
    }
    fn values(&self, indices: &[usize], label: &str) -> Result<ValueRecord, Diagnostic> {
        let mut values = BTreeMap::from([(LABEL_FIELD.into(), WireValue::String(label.into()))]);
        let fill =
            |indices: &[usize], prefix: &str, values: &mut ValueRecord| -> Result<(), Diagnostic> {
                for measure in &self.measures {
                    if let Some(op) = measure.aggregation {
                        let value = aggregate_indices(
                            op,
                            &self.input.rows,
                            indices,
                            &measure.source_field_id,
                            self.date.as_deref(),
                            self.order,
                        )?;
                        if value != WireValue::Missing {
                            values.insert(format!("{prefix}{}", measure.id), value);
                        }
                    }
                }
                Ok(())
            };
        if self.split.is_empty() {
            fill(indices, "", &mut values)?;
        } else {
            let mut by_combo: BTreeMap<String, Vec<usize>> = BTreeMap::new();
            for i in indices {
                by_combo.entry(self.combo_id(*i)?).or_default().push(*i);
            }
            for combo in &self.combos {
                if let Some(indices) = by_combo.get(&combo.id) {
                    fill(indices, &format!("{}{KEY_SEP}", combo.id), &mut values)?;
                }
            }
        }
        Ok(values)
    }
    fn emit(
        &self,
        indices: &[usize],
        depth: usize,
        parent: Option<&str>,
        rows: &mut Vec<ValueRecord>,
        meta: &mut Vec<PivotRowMeta>,
    ) -> Result<(), Diagnostic> {
        if depth == self.grouping.len() {
            if self.split.is_empty() {
                let mut leaves = indices.to_vec();
                let keys = leaves
                    .iter()
                    .map(|index| {
                        self.input
                            .sorting
                            .iter()
                            .map(|sort| {
                                let field = if self.input.config.measures.is_some()
                                    && (self.grouping.contains(&sort.id)
                                        || self.split.contains(&sort.id))
                                {
                                    sort.id.as_str()
                                } else {
                                    self.measures
                                        .iter()
                                        .find(|m| m.id == sort.id)
                                        .map(|m| m.source_field_id.as_str())
                                        .unwrap_or(&sort.id)
                                };
                                read(&self.input.rows[*index], field).clone()
                            })
                            .collect::<Vec<_>>()
                    })
                    .collect::<Vec<_>>();
                let descending = self
                    .input
                    .sorting
                    .iter()
                    .map(|s| s.desc)
                    .collect::<Vec<_>>();
                sort_by_keys(&mut leaves, &keys, &descending, self.order)?;
                for index in leaves {
                    let mut row = self.input.rows[index].clone();
                    if self.input.config.measures.is_some() {
                        for measure in &self.measures {
                            // A leaf is one row: a count counts it (1, or 0 for a
                            // missing value), every other measure carries the raw
                            // value. Mirrors pivotTable.ts leafValue (990b6bc).
                            let value = match measure.aggregation {
                                Some(op @ (Aggregation::Count | Aggregation::UniqueCount)) => {
                                    aggregate_indices(
                                        op,
                                        &self.input.rows,
                                        &[index],
                                        &measure.source_field_id,
                                        self.date.as_deref(),
                                        self.order,
                                    )?
                                }
                                _ => read(&self.input.rows[index], &measure.source_field_id).clone(),
                            };
                            row.insert(measure.id.clone(), value);
                        }
                    }
                    rows.push(row);
                    meta.push(PivotRowMeta::Leaf {
                        depth,
                        source_index: Some(index),
                    });
                }
            }
            return Ok(());
        }
        let field = &self.grouping[depth];
        let mut nodes: Vec<_> = self
            .partition(indices, field)?
            .into_iter()
            .map(|g| {
                let (label, incomplete) = self.describe(field, &g)?;
                let values = self.values(&g.indices, &label)?;
                Ok((g, label, incomplete, values))
            })
            .collect::<Result<Vec<_>, Diagnostic>>()?;
        if !self.input.sorting.is_empty() {
            let keys = nodes
                .iter()
                .map(|node| {
                    self.input
                        .sorting
                        .iter()
                        .map(|sort| {
                            if sort.id == LABEL_FIELD
                                || (self.input.config.measures.is_some()
                                    && (self.grouping.contains(&sort.id)
                                        || self.split.contains(&sort.id))
                                    && sort.id == *field)
                            {
                                node.0.raw.clone()
                            } else if self.input.config.measures.is_some()
                                && (self.grouping.contains(&sort.id)
                                    || self.split.contains(&sort.id))
                            {
                                WireValue::Missing
                            } else {
                                read(&node.3, &sort.id).clone()
                            }
                        })
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>();
            let descending = self
                .input
                .sorting
                .iter()
                .map(|s| s.desc)
                .collect::<Vec<_>>();
            sort_by_keys(&mut nodes, &keys, &descending, self.order)?;
        }
        for (group, label, incomplete, values) in nodes {
            let path = parent
                .map(|p| format!("{p}{KEY_SEP}{}", group.key))
                .unwrap_or(group.key);
            let expandable = depth + 1 < self.grouping.len() || self.split.is_empty();
            let open = expandable
                && match (&self.input.config.key_encoding, &self.input.config.expanded) {
                    (Some(KeyEncoding::TypedV1), Some(Expanded::Paths(p))) => {
                        p.get(&path) != Some(&false)
                    }
                    _ => true,
                };
            rows.push(values);
            meta.push(PivotRowMeta::Group {
                depth,
                path: path.clone(),
                label,
                count: group.indices.len(),
                expandable,
                open,
                incomplete,
            });
            if open {
                self.emit(&group.indices, depth + 1, Some(&path), rows, meta)?;
            }
        }
        Ok(())
    }
}
fn property<'a>(v: &'a WireValue, key: &str) -> std::borrow::Cow<'a, WireValue> {
    use std::borrow::Cow;
    match v {
        WireValue::Record(xs) => Cow::Borrowed(
            xs.iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v)
                .unwrap_or(&WireValue::Missing),
        ),
        WireValue::Array(xs) if key == "length" => Cow::Owned(scalar_number(xs.len() as f64)),
        WireValue::Array(xs) => Cow::Borrowed(
            key.parse::<usize>()
                .ok()
                .filter(|index| index.to_string() == key)
                .and_then(|index| xs.get(index))
                .unwrap_or(&WireValue::Missing),
        ),
        _ => Cow::Borrowed(&WireValue::Missing),
    }
}
fn measure_label(measure: &Measure, column: &PivotColumn, measures: &[Measure]) -> String {
    if let Some(label) = &measure.custom_label {
        return label.clone();
    }
    let label = if let Some(op) = measure.aggregation {
        format!(
            "{} — {}",
            column.header,
            crate::formulas::aggregation_name(op)
        )
    } else {
        column.header.clone()
    };
    let position = measures
        .iter()
        .filter(|m| {
            m.custom_label.is_none()
                && m.source_field_id == measure.source_field_id
                && m.aggregation == measure.aggregation
        })
        .position(|m| m.id == measure.id)
        .unwrap_or(0);
    if position > 0 {
        format!("{label} ({})", position + 1)
    } else {
        label
    }
}
#[allow(clippy::result_large_err)]
pub fn pivot(
    input: &PivotInput,
    order: &dyn ValueOrder,
) -> Result<Option<PivotResult>, Diagnostic> {
    let cache = CachedOrder::new(order, 4096);
    let known: std::collections::BTreeSet<_> =
        input.columns.iter().map(|c| c.field.as_str()).collect();
    let mut taken = std::collections::BTreeSet::new();
    let mut keep = |fields: &[String]| {
        fields
            .iter()
            .filter(|f| known.contains(f.as_str()) && taken.insert((*f).clone()))
            .cloned()
            .collect::<Vec<_>>()
    };
    let grouping = keep(&input.config.grouping);
    let split = keep(&input.config.split);
    if !input.config.enabled || (grouping.is_empty() && split.is_empty() && !input.aggregate_only) {
        return Ok(None);
    }
    let measures = if let Some(ms) = &input.config.measures {
        ms.iter()
            .filter(|m| known.contains(m.source_field_id.as_str()))
            .cloned()
            .collect()
    } else {
        let mut seen = std::collections::BTreeSet::new();
        input
            .order
            .iter()
            .filter(|f| {
                known.contains(f.as_str())
                    && !grouping.contains(f)
                    && !split.contains(f)
                    && seen.insert((*f).clone())
            })
            .map(|f| Measure {
                id: f.clone(),
                source_field_id: f.clone(),
                aggregation: input
                    .config
                    .aggregation_fns
                    .as_ref()
                    .and_then(|m| m.get(f))
                    .copied(),
                custom_label: None,
            })
            .collect()
    };
    let mut e = Engine {
        input,
        order: &cache,
        grouping,
        split,
        measures,
        date: input
            .columns
            .iter()
            .find(|c| input.kinds.get(&c.field) == Some(&FieldKind::Date))
            .map(|c| c.field.clone()),
        combos: vec![],
        periodicity: BTreeMap::new(),
    };
    for field in e.grouping.iter().chain(&e.split) {
        let category = input.category_metadata.get(field);
        let bucket = category.map(|c| c.bucket).unwrap_or(e.bucket(field));
        if bucket != Bucket::Native {
            e.periodicity.insert(
                field.clone(),
                category
                    .map(|c| c.periodicity)
                    .unwrap_or_else(|| periodicity(input.rows.iter().map(|r| read(r, field)))),
            );
        }
    }
    let indices: Vec<_> = (0..input.rows.len()).collect();
    if !e.split.is_empty() {
        let mut combos = vec![];
        e.walk_split(&indices, 0, String::new(), vec![], &mut combos)?;
        e.combos = combos;
    }
    let count = 1 + if e.split.is_empty() {
        e.measures.len()
    } else {
        e.combos.len().saturating_mul(e.measures.len())
    };
    if count > MAX_PIVOT_COLUMNS {
        let message = if e.split.is_empty() {
            format!("Row Groups would make {count} columns (the limit is {MAX_PIVOT_COLUMNS}). Hide or remove data columns.")
        } else {
            format!("Column Groups on {} would make {count} columns (the limit is {MAX_PIVOT_COLUMNS}). Pick a coarser bucket, or move a field to Row Groups.",e.split.iter().map(|f|e.column(f).header.as_str()).collect::<Vec<_>>().join(", "))
        };
        return Err(crate::validation::diagnostic(
            "pivot-column-limit",
            "table.pivot",
            &message,
        ));
    }
    let mut rows = vec![];
    let mut meta = vec![];
    if e.grouping.is_empty() {
        rows.push(e.values(&indices, "Total")?);
        meta.push(PivotRowMeta::Total {
            depth: 0,
            label: "Total".into(),
            count: indices.len(),
        });
    } else {
        e.emit(&indices, 0, None, &mut rows, &mut meta)?;
    }
    let mut label = PivotColumn::source(
        LABEL_FIELD,
        &e.grouping
            .iter()
            .map(|f| e.column(f).header.as_str())
            .collect::<Vec<_>>()
            .join(" › "),
    );
    label.properties = BTreeMap::from([
        ("renderFn".into(), WireValue::Array(vec![])),
        ("colorRules".into(), WireValue::Array(vec![])),
        ("hiddenByDefault".into(), WireValue::Bool(false)),
        ("pinned".into(), WireValue::String("left".into())),
        ("isLogo".into(), WireValue::Bool(false)),
        ("flash".into(), WireValue::Bool(false)),
        ("editable".into(), WireValue::Bool(false)),
    ]);
    let mut columns = vec![label];
    let sources: Vec<_> = e
        .measures
        .iter()
        .map(|m| {
            let mut c = e.column(&m.source_field_id).clone();
            c.field = m.id.clone();
            c.source = Some(m.source_field_id.clone());
            c.measure_id = Some(m.id.clone());
            c.aggregation = m.aggregation;
            if input.config.measures.is_some() {
                c.header = measure_label(m, &c, &e.measures);
            }
            c
        })
        .collect();
    if e.split.is_empty() {
        for mut c in sources {
            c.group_path = vec![];
            c.split_keys = vec![];
            columns.push(c);
        }
    } else {
        for combo in &e.combos {
            for c in &sources {
                let mut c = c.clone();
                c.field = format!("{}{KEY_SEP}{}", combo.id, c.field);
                for key in [
                    "pinned",
                    "cellClick",
                    "rangeBar",
                    "rangeMeter",
                    "percentKey",
                ] {
                    c.properties.insert(key.into(), WireValue::Missing);
                }
                c.properties
                    .insert("editable".into(), WireValue::Bool(false));
                c.properties.insert("isLogo".into(), WireValue::Bool(false));
                c.group_path = combo.labels.clone();
                c.split_keys = combo.id.split(KEY_SEP).map(str::to_owned).collect();
                columns.push(c);
            }
        }
    }
    let leaf_ordinals = meta
        .iter_mut()
        .map(|meta| match meta {
            PivotRowMeta::Leaf { source_index, .. } => {
                let ordinal = *source_index;
                if input.config.measures.is_none() {
                    *source_index = None;
                }
                ordinal
            }
            _ => None,
        })
        .collect();
    Ok(Some(PivotResult {
        leaf_ordinals,
        rows,
        meta,
        columns,
    }))
}
