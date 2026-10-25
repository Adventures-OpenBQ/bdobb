// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::contract::*;
use std::cmp::Ordering;
/// A negotiated ascending, missing-last baseline order. No default bytewise text implementation.
/// Comparisons must be deterministic for the lifetime of an execution stage.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Comparison {
    Ordered(Ordering),
    Unordered,
}
impl Comparison {
    pub fn sort_order(self) -> Ordering {
        match self {
            Self::Ordered(order) => order,
            Self::Unordered => Ordering::Equal,
        }
    }
    pub fn is_zero(self) -> bool {
        self == Self::Ordered(Ordering::Equal)
    }
    fn reversed(self) -> Self {
        match self {
            Self::Ordered(order) => Self::Ordered(order.reverse()),
            Self::Unordered => Self::Unordered,
        }
    }
}
#[allow(clippy::result_large_err)]
pub trait ValueOrder {
    /// Default-options locale collation for recipe fingerprints, distinct from Pivot order.
    #[allow(clippy::result_large_err)]
    fn compare_recipe(&self, _a: &str, _b: &str) -> Result<Ordering, Diagnostic> {
        Err(crate::validation::diagnostic(
            "ordering-compatibility-unavailable",
            "categories.recipe",
            "Category recipes require the negotiated host recipe collation adapter.",
        ))
    }
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic>;
    /// Unordered numeric subtraction must terminate multi-key comparison.
    fn compare_raw(&self, a: &WireValue, b: &WireValue) -> Result<Comparison, Diagnostic> {
        if let (Some(a), Some(b)) = (number(a), number(b)) {
            return Ok((a - b)
                .partial_cmp(&0.)
                .map(Comparison::Ordered)
                .unwrap_or(Comparison::Unordered));
        }
        Ok(Comparison::Ordered(self.compare(a, b)?))
    }
    /// The current platform's actual baseline Array.sort, over prevalidated keys only.
    /// Return indexes into the input matrix; no application formulas execute here.
    #[allow(clippy::result_large_err)]
    fn sort_permutation(
        &self,
        _values: &[Vec<WireValue>],
        _descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        Err(crate::validation::diagnostic(
            "ordering-compatibility-unavailable",
            "table.sorting",
            "This ordering requires the negotiated host sort-permutation adapter.",
        ))
    }
}
pub fn missing(value: &WireValue) -> bool {
    matches!(value, WireValue::Missing | WireValue::Null)
        || matches!(value,WireValue::String(s) if s.is_empty())
}
pub fn number(value: &WireValue) -> Option<f64> {
    match value {
        WireValue::F64(WireNumber::Finite(x)) => Some(*x),
        WireValue::F64(WireNumber::Special(x)) => Some(match x {
            SpecialNumber::Nan => f64::NAN,
            SpecialNumber::PositiveInfinity => f64::INFINITY,
            SpecialNumber::NegativeInfinity => f64::NEG_INFINITY,
            SpecialNumber::NegativeZero => -0.,
        }),
        _ => None,
    }
}
/// JavaScript Number.toString notation thresholds, including normalized negative zero.
pub fn number_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == f64::INFINITY {
        return "Infinity".into();
    }
    if x == f64::NEG_INFINITY {
        return "-Infinity".into();
    }
    if x == 0. {
        return "0".into();
    }
    ryu_js::Buffer::new().format(x).to_owned()
}
/// ECMAScript String(value) for supported wire values (array join treats blanks specially).
pub fn value_string(value: &WireValue) -> String {
    match value {
        WireValue::Missing => "undefined".into(),
        WireValue::Null => "null".into(),
        WireValue::String(x) | WireValue::BigIntString(x) => x.clone(),
        WireValue::Bool(x) => x.to_string(),
        WireValue::F64(_) => number_string(number(value).unwrap()),
        WireValue::Record(_) => "[object Object]".into(),
        WireValue::Array(xs) => xs
            .iter()
            .map(|v| {
                if matches!(v, WireValue::Missing | WireValue::Null) {
                    String::new()
                } else {
                    value_string(v)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
    }
}
/// Ordinary inert records cannot provide a callable own toString/valueOf.
/// Array join recursively performs this same conversion only for present values.
pub fn try_value_string(value: &WireValue) -> Result<String, &'static str> {
    match value {
        WireValue::Record(fields) if fields.iter().any(|(key, _)| key == "toString") => {
            Err("Cannot convert object to primitive value")
        }
        WireValue::Array(values) => values
            .iter()
            .map(|value| {
                if matches!(value, WireValue::Missing | WireValue::Null) {
                    Ok(String::new())
                } else {
                    try_value_string(value)
                }
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|parts| parts.join(",")),
        _ => Ok(value_string(value)),
    }
}
#[allow(clippy::result_large_err)]
pub fn string_value(value: &WireValue) -> Result<String, Diagnostic> {
    try_value_string(value)
        .map_err(|message| crate::validation::diagnostic("INVALID_REQUEST", "value", message))
}
#[allow(clippy::result_large_err)]
pub fn compare_sorted_raw(
    a: &WireValue,
    b: &WireValue,
    desc: bool,
    order: &dyn ValueOrder,
) -> Result<Comparison, Diagnostic> {
    let comparison = order.compare_raw(a, b)?;
    if desc && !missing(a) && !missing(b) {
        Ok(comparison.reversed())
    } else {
        Ok(comparison)
    }
}
/// Missing values do not change domain; homogeneous finite numerics or one
/// primitive text-converted type have the baseline's total preorder. Mixing
/// numeric/text domains can create cycles; nonfinite values produce unordered
/// subtraction; opaque arrays/records can have host coercion behavior.
fn proven_total(values: &[Vec<WireValue>], width: usize) -> bool {
    (0..width).all(|column| {
        let mut domain = None;
        for row in values {
            let value = &row[column];
            if missing(value) {
                continue;
            }
            let kind = match value {
                WireValue::F64(_) if number(value).is_some_and(f64::is_finite) => 0,
                WireValue::String(_) => 1,
                WireValue::Bool(_) => 2,
                WireValue::BigIntString(_) => 3,
                _ => return false,
            };
            if domain.is_some_and(|domain| domain != kind) {
                return false;
            }
            domain = Some(kind);
        }
        true
    })
}
/// Sort proven-total domains in scalable stable Rust sort; all other domains
/// require the current host's complete permutation, at every input size.
#[allow(clippy::result_large_err)]
pub fn sort_by_keys<T>(
    items: &mut [T],
    values: &[Vec<WireValue>],
    descending: &[bool],
    order: &dyn ValueOrder,
) -> Result<(), Diagnostic> {
    if values.len() != items.len() || values.iter().any(|row| row.len() != descending.len()) {
        return Err(crate::validation::diagnostic(
            "invalid-order-keys",
            "table.sorting",
            "Sort keys must match the items and sort dimensions.",
        ));
    }
    if items.len() < 2 || descending.is_empty() {
        return Ok(());
    }
    let permutation = if proven_total(values, descending.len()) {
        let mut indexes: Vec<_> = (0..items.len()).collect();
        let mut failure = None;
        indexes.sort_by(|a, b| {
            for (column, desc) in descending.iter().enumerate() {
                let comparison = match compare_sorted_raw(
                    &values[*a][column],
                    &values[*b][column],
                    *desc,
                    order,
                ) {
                    Ok(value) => value,
                    Err(error) => {
                        failure.get_or_insert(error);
                        return Ordering::Equal;
                    }
                };
                if !comparison.is_zero() {
                    return comparison.sort_order();
                }
            }
            Ordering::Equal
        });
        if let Some(error) = failure {
            return Err(error);
        }
        indexes
    } else {
        order.sort_permutation(values, descending)?
    };
    let mut seen = vec![false; items.len()];
    if permutation.len() != items.len()
        || permutation.iter().any(|index| {
            if *index >= seen.len() || seen[*index] {
                true
            } else {
                seen[*index] = true;
                false
            }
        })
    {
        return Err(crate::validation::diagnostic(
            "invalid-order-permutation",
            "table.sorting",
            "Host sort must return each source index exactly once.",
        ));
    }
    // Invert destination->source to source->destination, then move each cycle.
    let mut destinations = vec![0; items.len()];
    for (destination, source) in permutation.into_iter().enumerate() {
        destinations[source] = destination;
    }
    for index in 0..items.len() {
        while destinations[index] != index {
            let destination = destinations[index];
            items.swap(index, destination);
            destinations.swap(index, destination);
        }
    }
    Ok(())
}
/// Bounded per-stage host comparison cache; keys retain types and opaque record order.
/// Scalar and raw modes use distinct keys under one combined entry limit.
/// Stage lifetime and cache limits bound memory; eviction only changes callback frequency.
pub struct CachedOrder<'a> {
    host: &'a dyn ValueOrder,
    limit: usize,
    entries: std::cell::RefCell<std::collections::BTreeMap<(u8, String, String), Comparison>>,
}
impl<'a> CachedOrder<'a> {
    pub fn new(host: &'a dyn ValueOrder, limit: usize) -> Self {
        Self {
            host,
            limit,
            entries: std::cell::RefCell::new(std::collections::BTreeMap::new()),
        }
    }
    pub fn cache_size(&self) -> usize {
        self.entries.borrow().len()
    }
    #[allow(clippy::result_large_err)]
    fn cached(
        &self,
        mode: u8,
        a: &WireValue,
        b: &WireValue,
        f: impl FnOnce() -> Result<Comparison, Diagnostic>,
    ) -> Result<Comparison, Diagnostic> {
        let key = (mode, format!("{a:?}"), format!("{b:?}"));
        if let Some(value) = self.entries.borrow().get(&key) {
            return Ok(*value);
        }
        let value = f()?;
        let mut entries = self.entries.borrow_mut();
        if entries.len() >= self.limit {
            entries.pop_first();
        }
        entries.insert(key, value);
        Ok(value)
    }
}
#[allow(clippy::result_large_err)]
impl ValueOrder for CachedOrder<'_> {
    fn compare_recipe(&self, a: &str, b: &str) -> Result<Ordering, Diagnostic> {
        self.host.compare_recipe(a, b)
    }
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
        self.cached(0, a, b, || self.host.compare(a, b).map(Comparison::Ordered))
            .map(Comparison::sort_order)
    }
    fn compare_raw(&self, a: &WireValue, b: &WireValue) -> Result<Comparison, Diagnostic> {
        self.cached(1, a, b, || self.host.compare_raw(a, b))
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        self.host.sort_permutation(values, descending)
    }
}
