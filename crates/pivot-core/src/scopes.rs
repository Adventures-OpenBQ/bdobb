// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Source qualification, typed member domains and retained calculation contexts.
use crate::{
    categories::*,
    contract::*,
    fiscal::*,
    formulas::*,
    ordering::{number, try_value_string, value_string, ValueOrder},
};
use std::collections::{BTreeMap, BTreeSet, HashMap};
mod numeric_bounds;
/// Insertion-ordered constraints: replacement updates a key without moving its position.
#[derive(Clone, Debug, PartialEq)]
pub struct ScopeConstraints<T>(Vec<(String, T)>);
impl<T> Default for ScopeConstraints<T> {
    fn default() -> Self {
        Self(vec![])
    }
}
impl<T> ScopeConstraints<T> {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn iter(&self) -> impl Iterator<Item = (&String, &T)> {
        self.0.iter().map(|(k, v)| (k, v))
    }
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.0.iter().map(|(k, _)| k)
    }
    pub fn values(&self) -> impl Iterator<Item = &T> {
        self.0.iter().map(|(_, v)| v)
    }
    pub fn insert(&mut self, k: String, v: T) -> Option<T> {
        if let Some((_, old)) = self.0.iter_mut().find(|(id, _)| id == &k) {
            Some(std::mem::replace(old, v))
        } else {
            self.0.push((k, v));
            None
        }
    }
    pub fn retain(&mut self, mut predicate: impl FnMut(&String, &T) -> bool) {
        self.0.retain(|(k, v)| predicate(k, v))
    }
}
impl<T> FromIterator<(String, T)> for ScopeConstraints<T> {
    fn from_iter<I: IntoIterator<Item = (String, T)>>(values: I) -> Self {
        let mut out = Self::new();
        out.extend(values);
        out
    }
}
impl<T> Extend<(String, T)> for ScopeConstraints<T> {
    fn extend<I: IntoIterator<Item = (String, T)>>(&mut self, values: I) {
        for (k, v) in values {
            self.insert(k, v);
        }
    }
}
impl<T, const N: usize> From<[(String, T); N]> for ScopeConstraints<T> {
    fn from(values: [(String, T); N]) -> Self {
        values.into_iter().collect()
    }
}
impl<T> IntoIterator for ScopeConstraints<T> {
    type Item = (String, T);
    type IntoIter = std::vec::IntoIter<Self::Item>;
    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}
impl<'a, T> IntoIterator for &'a ScopeConstraints<T> {
    type Item = (&'a String, &'a T);
    type IntoIter = std::iter::Map<
        std::slice::Iter<'a, (String, T)>,
        fn(&'a (String, T)) -> (&'a String, &'a T),
    >;
    fn into_iter(self) -> Self::IntoIter {
        self.0.iter().map(|(k, v)| (k, v))
    }
}
pub type CategoryConstraints = ScopeConstraints<String>;
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TemporalContext {
    pub date_field_id: Option<String>,
    pub company_field_id: Option<String>,
    pub company_ids: Option<Vec<WireValue>>,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ContextSlice {
    pub categories: CategoryConstraints,
    pub company_ids: Option<Vec<WireValue>>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct RequestedFiscalScope {
    pub category_id: String,
    pub dependent_category_ids: Vec<String>,
    pub periods: Vec<ResolvedFiscalPeriod>,
    pub errors: Vec<ModelError>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct DeclaredMember {
    pub selectors: Vec<MemberSelector>,
    pub formula_id: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CalculationScope {
    pub source_record_ids: BTreeSet<String>,
    pub category_constraints: CategoryConstraints,
    pub context_slices: Option<Vec<ContextSlice>>,
    pub page: Option<MemberConstraint>,
    pub requested_fiscal_scope: Option<RequestedFiscalScope>,
    pub field_constraints: BTreeMap<String, Vec<WireValue>>,
    pub temporal_context: TemporalContext,
    pub declared_members: Vec<DeclaredMember>,
}
impl CalculationScope {
    pub(crate) fn exact_eq(&self, other: &Self) -> bool {
        fn value(a: &WireValue, b: &WireValue) -> bool {
            match (a, b) {
                (WireValue::F64(WireNumber::Finite(a)), WireValue::F64(WireNumber::Finite(b))) => {
                    a.to_bits() == b.to_bits()
                }
                (WireValue::Array(a), WireValue::Array(b)) => {
                    a.len() == b.len() && a.iter().zip(b).all(|(a, b)| value(a, b))
                }
                (WireValue::Record(a), WireValue::Record(b)) => {
                    a.len() == b.len()
                        && a.iter()
                            .zip(b)
                            .all(|((ak, a), (bk, b))| ak == bk && value(a, b))
                }
                _ => a == b,
            }
        }
        fn values(s: &CalculationScope) -> impl Iterator<Item = &WireValue> {
            s.field_constraints
                .values()
                .flatten()
                .chain(s.temporal_context.company_ids.iter().flatten())
                .chain(
                    s.context_slices
                        .iter()
                        .flatten()
                        .flat_map(|s| s.company_ids.iter().flatten()),
                )
                .chain(
                    s.requested_fiscal_scope
                        .iter()
                        .flat_map(|s| s.periods.iter())
                        .filter_map(|p| p.period.quarter_evidence.as_ref()),
                )
        }
        self == other && values(self).zip(values(other)).all(|(a, b)| value(a, b))
    }
}
#[derive(Clone, Debug)]
pub struct MemberFacet {
    pub member: CategoryMember,
    pub count: usize,
}
#[derive(Clone, Debug)]
pub enum Exclusion {
    ColumnFilter,
    Search,
    Checklist(String),
    Error(ModelError),
}
#[derive(Clone, Debug)]
pub struct SourceConstraints {
    pub columns: Vec<DatasetColumn>,
    pub filters: Vec<SourceFilter>,
    pub search: String,
    pub checklists: Vec<MemberConstraint>,
}
#[derive(Clone, Debug)]
pub struct EligiblePool {
    pub rows: Vec<DatasetRow>,
    pub universe: CategorizedRows,
    pub columns: Vec<DatasetColumn>,
    pub members: BTreeMap<String, BTreeMap<String, CategoryMemberResult>>,
    pub categories: Vec<CategoryMetadata>,
    pub errors: BTreeMap<String, BTreeMap<String, ModelError>>,
    pub formula_cells: BTreeMap<String, BTreeMap<String, CellResult>>,
    pub source_dependencies: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    pub warnings: Vec<ScopeWarning>,
    pub constraints: SourceConstraints,
    pub excluded_record_ids: BTreeSet<String>,
    pub exclusions: BTreeMap<String, Vec<Exclusion>>,
    pub observed_members: BTreeMap<String, Vec<MemberFacet>>,
    pub eligible_members: BTreeMap<String, Vec<MemberFacet>>,
    pub page: Option<MemberConstraint>,
    pub classification_complete: bool,
    pub qualification_errors: Vec<ModelError>,
    pub group_resolutions: BTreeMap<String, GroupResolution>,
    pub param_matches: Vec<ParamMatch>,
    pub runtime_diagnostics: Vec<Diagnostic>,
    pub authoring_recipes: BTreeMap<String, Result<String, Diagnostic>>,
    /// Built by `index_rows` once the pool is final; absent means scan as before.
    pub(crate) index: std::sync::OnceLock<PoolIndex>,
}
/// Positions per classified member key, plus every position (or the unclassified ones).
type KeyBuckets = (HashMap<String, Vec<usize>>, Vec<usize>);
/// Row positions so per-scope work is proportional to the scope's rows, not the pool's.
#[derive(Clone, Debug, Default)]
pub(crate) struct PoolIndex {
    /// `rows` positions per record ID, ascending.
    by_id: HashMap<String, Vec<usize>>,
    /// First `universe` row position per record ID.
    universe_first: HashMap<String, usize>,
    /// Per category: `rows` positions per classified member key, and the positions
    /// whose member is an error or absent.
    members: HashMap<String, KeyBuckets>,
    /// `rows` positions whose ID has no `universe` row.
    not_in_universe: Vec<usize>,
}
impl EligiblePool {
    /// Freeze the pool's row index. Call only after the pool's last mutation.
    pub(crate) fn index_rows(&self) {
        self.index.get_or_init(|| {
            let mut index = PoolIndex::default();
            for (i, row) in self.universe.evaluated.rows.iter().enumerate() {
                index.universe_first.entry(row.id.clone()).or_insert(i);
            }
            let categories: BTreeSet<&String> = self
                .rows
                .iter()
                .filter_map(|r| self.members.get(&r.id))
                .flat_map(BTreeMap::keys)
                .collect();
            for (i, row) in self.rows.iter().enumerate() {
                index.by_id.entry(row.id.clone()).or_default().push(i);
                if !index.universe_first.contains_key(&row.id) {
                    index.not_in_universe.push(i);
                }
                for &c in &categories {
                    let (keys, unknown) = index.members.entry(c.clone()).or_default();
                    match member(self, &row.id, c) {
                        Some(Ok(m)) => keys.entry(m.key.clone()).or_default().push(i),
                        _ => unknown.push(i),
                    }
                }
            }
            index
        });
    }
    /// `rows` whose ID is in `ids`, in pool order (duplicate IDs kept).
    pub(crate) fn rows_in<'a>(&'a self, ids: &BTreeSet<String>) -> Vec<&'a DatasetRow> {
        let Some(index) = self.index.get() else {
            return self.rows.iter().filter(|r| ids.contains(&r.id)).collect();
        };
        let mut at: Vec<usize> = ids
            .iter()
            .filter_map(|id| index.by_id.get(id))
            .flatten()
            .copied()
            .collect();
        at.sort_unstable();
        at.into_iter().map(|i| &self.rows[i]).collect()
    }
    /// Ascending `rows` positions that can match some slice's category requirements
    /// (classified in a required key, or unclassified), plus IDs outside the universe.
    /// A superset of the rows `scope_errors` acts on; `None` without an index.
    fn scope_candidates(
        &self,
        slices: &[(Required, Option<Vec<WireValue>>)],
    ) -> Option<Vec<usize>> {
        let index = self.index.get()?;
        let mut at = index.not_in_universe.clone();
        for (required, _) in slices {
            if required.values().any(Vec::is_empty) {
                continue;
            }
            // The narrowest requirement bounds the slice; an unindexed category is all rows.
            let narrowest = required
                .iter()
                .map(|(id, keys)| {
                    index.members.get(id).map(|(by_key, unknown)| {
                        keys.iter()
                            .filter_map(|k| by_key.get(k))
                            .flatten()
                            .chain(unknown)
                            .copied()
                            .collect::<Vec<_>>()
                    })
                })
                .min_by_key(|c| c.as_ref().map_or(usize::MAX, Vec::len));
            match narrowest {
                Some(Some(c)) => at.extend(c),
                _ => return Some((0..self.rows.len()).collect()),
            }
        }
        at.sort_unstable();
        at.dedup();
        Some(at)
    }
}
#[derive(Clone, Debug)]
pub struct PageResult {
    pub rows: Vec<DatasetRow>,
    pub selection: Option<MemberConstraint>,
    pub errors: Vec<ModelError>,
    pub classification_complete: bool,
}
#[derive(Clone, Debug)]
pub struct GroupResolution {
    pub keys: Vec<String>,
    pub unmatched: Vec<String>,
    pub input_count: usize,
    pub classification_complete: bool,
    pub status: String,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamMatch {
    pub key: String,
    pub matched_keys: Vec<String>,
    pub matched: Vec<String>,
    pub unmatched: Vec<String>,
    pub matched_count: usize,
    pub unmatched_count: usize,
    pub excluded_count: usize,
    pub total_count: usize,
    pub classification_complete: bool,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
#[derive(Clone, Debug)]
pub struct FiscalEvidence {
    pub periods: Vec<ResolvedFiscalPeriod>,
    pub errors: Vec<ModelError>,
}
fn diagnostic(code: &str, message: &str) -> Diagnostic {
    crate::validation::diagnostic(code, "", message)
}
fn contains(values: &[WireValue], v: &WireValue) -> bool {
    values.iter().any(|a| {
        if let (Some(a), Some(b)) = (number(a), number(v)) {
            a == b || a.is_nan() && b.is_nan()
        } else {
            a == v
        }
    })
}
fn unique<T: PartialEq>(values: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut out = vec![];
    for v in values {
        if !out.contains(&v) {
            out.push(v)
        }
    }
    out
}
fn member<'a>(p: &'a EligiblePool, row: &str, cat: &str) -> Option<&'a CategoryMemberResult> {
    p.members.get(row).and_then(|m| m.get(cat))
}
fn facet<'a>(
    map: &'a BTreeMap<String, Vec<MemberFacet>>,
    cat: &str,
    key: &str,
) -> Option<&'a MemberFacet> {
    map.get(cat)
        .and_then(|m| m.iter().find(|m| m.member.key == key))
}
fn has_category(p: &EligiblePool, id: &str) -> bool {
    p.categories.iter().any(|c| c.id == id)
}
fn facets(input: &CategorizedRows, rows: &[DatasetRow]) -> BTreeMap<String, Vec<MemberFacet>> {
    let mut out: BTreeMap<String, Vec<MemberFacet>> = BTreeMap::new();
    // Facet position per (category, key): the first facet a linear find would hit.
    let mut at: HashMap<(String, String), usize> = HashMap::new();
    for row in rows {
        for c in &input.categories {
            if let Some(Ok(m)) = input.members.get(&row.id).and_then(|m| m.get(&c.id)) {
                let values = out.entry(c.id.clone()).or_default();
                let slot = (c.id.clone(), m.key.clone());
                if let Some(&i) = at.get(&slot) {
                    let old = &mut values[i];
                    old.member = m.clone();
                    old.count += 1
                } else {
                    at.insert(slot, values.len());
                    values.push(MemberFacet {
                        member: m.clone(),
                        count: 1,
                    })
                }
            }
        }
    }
    out
}
#[derive(Clone, Copy)]
enum FilterKind {
    Text,
    Number,
    Date,
    Boolean,
    None,
}
pub(crate) fn iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[..4]
            .iter()
            .chain(&b[5..7])
            .chain(&b[8..10])
            .all(u8::is_ascii_digit)
}
fn filter_kind(c: &DatasetColumn, rows: &[DatasetRow]) -> FilterKind {
    match c.dtype.as_deref() {
        Some("text") => return FilterKind::Text,
        Some("number") => return FilterKind::Number,
        Some("date" | "dateString") => return FilterKind::Date,
        Some("boolean") => return FilterKind::Boolean,
        Some("object") => return FilterKind::None,
        _ => {}
    }
    for row in rows {
        match read(row, Some(&c.id)) {
            WireValue::Missing | WireValue::Null => {}
            WireValue::F64(_) => return FilterKind::Number,
            WireValue::Bool(_) => return FilterKind::Boolean,
            WireValue::String(s) => {
                return if iso_date(s) {
                    FilterKind::Date
                } else {
                    FilterKind::Text
                }
            }
            _ => return FilterKind::None,
        }
    }
    FilterKind::None
}
fn truthy(v: &WireValue) -> bool {
    !matches!(
        v,
        WireValue::Missing | WireValue::Null | WireValue::Bool(false)
    ) && !matches!(v,WireValue::String(s) if s.is_empty())
        && !number(v).is_some_and(|n| n == 0. || n.is_nan())
}
fn active_filter(f: &SourceFilter, kind: FilterKind) -> bool {
    if matches!(f.value, WireValue::Missing)
        || matches!(&f.value,WireValue::String(s) if s.is_empty())
    {
        return false;
    }
    if matches!(f.value, WireValue::Record(_) | WireValue::Array(_)) {
        match kind {
            FilterKind::Number => {
                return !matches!(own(&f.value, "min"), WireValue::Missing)
                    || !matches!(own(&f.value, "max"), WireValue::Missing)
            }
            FilterKind::Date => {
                return truthy(own(&f.value, "from")) || truthy(own(&f.value, "to"))
            }
            _ => {}
        }
    }
    true
}
fn filter_matches(v: &WireValue, f: &WireValue, kind: FilterKind) -> Result<bool, &'static str> {
    Ok(match kind {
        FilterKind::None => true,
        FilterKind::Text => {
            let term = if matches!(f, WireValue::Null | WireValue::Missing) {
                "undefined".to_owned()
            } else {
                try_value_string(f)?
            }
            .to_lowercase();
            !matches!(v, WireValue::Missing | WireValue::Null)
                && try_value_string(v)?.to_lowercase().contains(&term)
        }
        FilterKind::Boolean => {
            let value = try_value_string(v)?;
            matches!(f, WireValue::String(s) if &value == s)
        }
        FilterKind::Number => {
            let Some(n) = number(v) else { return Ok(false) };
            if matches!(f, WireValue::Null) {
                return Err("Cannot destructure property 'min' of 'value' as it is null.");
            }
            let min = own(f, "min");
            let max = own(f, "max");
            (matches!(min, WireValue::Missing)
                || numeric_bounds::compare_bound(n, min)? != Some(std::cmp::Ordering::Less))
                && (matches!(max, WireValue::Missing)
                    || numeric_bounds::compare_bound(n, max)? != Some(std::cmp::Ordering::Greater))
        }
        FilterKind::Date => {
            let WireValue::String(s) = v else {
                return Ok(false);
            };
            if matches!(f, WireValue::Null) {
                return Err("Cannot destructure property 'from' of 'value' as it is null.");
            }
            let day = s.chars().take(10).collect::<String>();
            let from = own(f, "from");
            let to = own(f, "to");
            (!truthy(from) || day >= try_value_string(from)?)
                && (!truthy(to) || day <= try_value_string(to)?)
        }
    })
}
struct Qualified {
    failure: Option<Diagnostic>,
    rows: Vec<DatasetRow>,
    exclusions: BTreeMap<String, Vec<Exclusion>>,
    errors: Vec<ModelError>,
}
fn qualify(input: &CategorizedRows, c: &SourceConstraints, excluding: Option<&str>) -> Qualified {
    qualify_with_identity_policy(input, c, excluding, true)
}
fn qualify_with_identity_policy(
    input: &CategorizedRows,
    c: &SourceConstraints,
    excluding: Option<&str>,
    deduplicate: bool,
) -> Qualified {
    let mut seen = BTreeSet::new();
    let rows: Vec<_> = input
        .evaluated
        .rows
        .iter()
        .filter(|r| !deduplicate || seen.insert(r.id.clone()))
        .cloned()
        .collect();
    let filters: Vec<_> = c
        .filters
        .iter()
        .filter_map(|f| {
            let col = c.columns.iter().find(|col| col.id == f.id);
            let kind = col
                .map(|col| filter_kind(col, &rows))
                .unwrap_or(FilterKind::None);
            active_filter(f, kind).then_some((f, col, kind))
        })
        .collect();
    let mut out = Qualified {
        failure: None,
        rows: vec![],
        exclusions: BTreeMap::new(),
        errors: vec![],
    };
    for (f, col, _) in &filters {
        if col.is_none() {
            out.errors.push(error(
                "missing-reference",
                format!("Filtered field {} is unavailable.", f.id),
                &f.id,
                vec![],
            ))
        }
    }
    let search = c.search.to_lowercase();
    for row in rows {
        let mut reasons = vec![];
        let mut filtered = false;
        for (f, col, kind) in &filters {
            if let Some(col) = col {
                if let Some(e) = input
                    .evaluated
                    .errors
                    .get(&row.id)
                    .and_then(|m| m.get(&f.id))
                {
                    reasons.push(Exclusion::Error(e.clone()));
                    out.errors.push(e.clone())
                }
                match filter_matches(read(&row, Some(&col.id)), &f.value, *kind) {
                    Ok(false) => filtered = true,
                    Ok(true) => {}
                    Err(message) => {
                        let error = error("invalid-type", message, &f.id, vec![row.id.clone()]);
                        reasons.push(Exclusion::Error(error.clone()));
                        out.errors.push(error);
                        out.failure
                            .get_or_insert_with(|| diagnostic("INVALID_REQUEST", message));
                    }
                }
            } else {
                let e = error(
                    "missing-reference",
                    format!("Filtered field {} is unavailable.", f.id),
                    &f.id,
                    vec![row.id.clone()],
                );
                reasons.push(Exclusion::Error(e.clone()));
                out.errors.push(e)
            }
        }
        if filtered {
            reasons.push(Exclusion::ColumnFilter)
        }
        let mut search_failure = None;
        if !search.is_empty()
            && !c.columns.iter().any(|col| {
                let v = read(&row, Some(&col.id)).clone();
                let text = if matches!(v, WireValue::Missing | WireValue::Null) {
                    String::new()
                } else {
                    match try_value_string(&v) {
                        Ok(text) => text,
                        Err(message) => {
                            search_failure = Some(message);
                            return true;
                        }
                    }
                };
                text.to_lowercase().contains(&search)
            })
        {
            let failed: Vec<_> = c
                .columns
                .iter()
                .filter_map(|col| {
                    input
                        .evaluated
                        .errors
                        .get(&row.id)
                        .and_then(|m| m.get(&col.id))
                })
                .collect();
            if failed.is_empty() {
                reasons.push(Exclusion::Search)
            } else {
                for e in failed {
                    reasons.push(Exclusion::Error(e.clone()));
                    out.errors.push(e.clone())
                }
            }
        }
        if let Some(message) = search_failure {
            out.failure = Some(crate::validation::diagnostic(
                "INVALID_REQUEST",
                "search",
                message,
            ));
            return out;
        }

        for list in &c.checklists {
            if excluding == Some(&list.category_id) {
                continue;
            }
            match input
                .members
                .get(&row.id)
                .and_then(|m| m.get(&list.category_id))
            {
                Some(Ok(m)) => {
                    if !list.member_keys.contains(&m.key) {
                        reasons.push(Exclusion::Checklist(list.category_id.clone()))
                    }
                }
                other => {
                    let e = other
                        .and_then(|m| m.as_ref().err())
                        .cloned()
                        .unwrap_or_else(|| {
                            error(
                                "missing-reference",
                                format!("Category {} is unavailable.", list.category_id),
                                &list.category_id,
                                vec![row.id.clone()],
                            )
                        });
                    out.errors.push(e.clone());
                    reasons.push(Exclusion::Error(e));
                }
            }
        }
        if reasons.is_empty() {
            out.rows.push(row)
        } else {
            out.exclusions.insert(row.id.clone(), reasons);
        }
    }
    if out.failure.is_some() {
        out.rows.clear();
    }
    out
}
pub fn category_facets(pool: &EligiblePool, category_id: &str) -> Vec<MemberFacet> {
    let q = qualify(&pool.universe, &pool.constraints, Some(category_id));
    facets(&pool.universe, &q.rows)
        .remove(category_id)
        .unwrap_or_default()
}
#[allow(clippy::result_large_err)]
pub fn eligible_pool(
    input: &EvaluatedRows,
    model: &CompiledModel,
    runtime: &RuntimeParams,
    order: &dyn ValueOrder,
) -> EligiblePool {
    if let Err(d) = validate_runtime_params(runtime, Some(model)) {
        return refused_pool(input, d);
    }
    let universe = derive_categories(input, model, order);
    let authored = model
        .definition
        .definition
        .analytical
        .as_ref()
        .and_then(AnalyticalDefinition::table);
    let mut checklists = authored.map(|m| m.checklists.clone()).unwrap_or_default();
    let mut page = authored
        .filter(|m| m.enabled)
        .and_then(|m| m.layout.page.clone());
    let mut group_resolutions = BTreeMap::new();
    let mut diagnostics = vec![];
    let active = active_runtime_keys(model);
    for (key, param) in runtime {
        let Some(cat) = active.get(key) else {
            diagnostics.push(diagnostic(
                "INVALID_REQUEST",
                "Unknown or dormant promoted runtime key",
            ));
            continue;
        };
        let keys = match param {
            RuntimeParam::Viewer { member_keys } => Some(member_keys.clone()),
            RuntimeParam::Group {
                transport_value, ..
            } => {
                let g = observed_group_resolution(transport_value, &universe, cat, model);
                let keys = (g.status == "resolved").then(|| Some(g.keys.clone()));
                if g.status == "refused" || !g.classification_complete {
                    let mut d = diagnostic(
                        "PIVOT_PARAM_REFUSED",
                        &if let Some(reason) = &g.reason {
                            format!("Group filter refused: {reason}. Authored selection retained.")
                        } else {
                            "Group domain is incomplete; unobserved values are unknown.".into()
                        },
                    );
                    d.key = Some(key.clone());
                    d.member_keys = Some(vec![]);
                    d.unmatched_count = Some(0);
                    d.truncated = Some(false);
                    d.path = None;
                    d.severity = Severity::Warning;
                    diagnostics.push(d)
                }
                if g.status == "resolved" && g.classification_complete && !g.unmatched.is_empty() {
                    let values = g
                        .unmatched
                        .iter()
                        .take(8)
                        .map(|v| utf16_preview(v, 256))
                        .collect::<Result<Vec<_>, _>>();
                    match values {
                        Ok(values) => {
                            let mut d = diagnostic(
                                "PIVOT_PARAM_UNMATCHED",
                                &format!(
                                    "{} group values are absent from acquired input.",
                                    g.unmatched.len()
                                ),
                            );
                            d.key = Some(key.clone());
                            d.member_keys = Some(values);
                            d.unmatched_count = Some(g.unmatched.len() as u64);
                            d.truncated = Some(
                                g.unmatched.len() > 8
                                    || g.unmatched.iter().any(|s| s.encode_utf16().count() > 256),
                            );
                            d.severity = Severity::Warning;
                            d.path = None;
                            diagnostics.push(d)
                        }
                        Err(d) => diagnostics.push(d),
                    }
                }
                group_resolutions.insert(key.clone(), g);
                keys
            }
        };
        if let Some(keys) = keys {
            if key == "pivot:page" {
                page = keys.map(|keys| MemberConstraint {
                    category_id: cat.clone(),
                    member_keys: unique(keys),
                });
            } else {
                let index = checklists
                    .iter()
                    .position(|c| &c.category_id == cat)
                    .unwrap_or(checklists.len());
                checklists.retain(|c| &c.category_id != cat);
                if let Some(keys) = keys {
                    checklists.insert(
                        index.min(checklists.len()),
                        MemberConstraint {
                            category_id: cat.clone(),
                            member_keys: keys,
                        },
                    );
                }
            }
        }
    }
    let mut columns = input.columns.clone();
    for c in &model.categories {
        if authored.is_some_and(|m| m.enabled)
            || model
                .definition
                .definition
                .table
                .column_filters
                .as_ref()
                .is_some_and(|fs| fs.iter().any(|f| f.id == c.id))
        {
            columns.push(DatasetColumn {
                id: c.id.clone(),
                label: c.name.clone(),
                ..Default::default()
            })
        }
    }
    let constraints = SourceConstraints {
        columns: columns.clone(),
        filters: model
            .definition
            .definition
            .table
            .column_filters
            .clone()
            .unwrap_or_default(),
        search: model.definition.definition.search.clone(),
        checklists,
    };
    let q = qualify(&universe, &constraints, None);
    if let Some(failure) = q.failure {
        diagnostics.push(failure);
    }
    let mut seen = BTreeSet::new();
    let rows: Vec<_> = universe
        .evaluated
        .rows
        .iter()
        .filter(|r| seen.insert(r.id.clone()))
        .cloned()
        .collect();
    let observed_members = facets(&universe, &rows);
    let eligible_members = facets(&universe, &q.rows);
    let authoring_recipes = model
        .categories
        .iter()
        .map(|c| {
            (
                c.id.clone(),
                category_authoring_recipe(model, &c.id, order).map(|v| v.unwrap()),
            )
        })
        .collect();
    let mut pool = EligiblePool {
        rows: q.rows,
        columns,
        members: universe.members.clone(),
        categories: universe.categories.clone(),
        errors: universe.evaluated.errors.clone(),
        formula_cells: input.formula_cells.clone(),
        source_dependencies: input.source_dependencies.clone(),
        warnings: universe.warnings.clone(),
        excluded_record_ids: q.exclusions.keys().cloned().collect(),
        exclusions: q.exclusions,
        observed_members,
        eligible_members,
        page,
        classification_complete: q.errors.is_empty(),
        qualification_errors: q.errors,
        group_resolutions,
        param_matches: vec![],
        runtime_diagnostics: diagnostics,
        authoring_recipes,
        constraints,
        universe,
        index: Default::default(),
    };
    pool.runtime_diagnostics
        .extend(selection_diagnostics(&pool, model));
    pool.param_matches = runtime_matches(runtime, model, &pool);
    pool
}
fn active_runtime_keys(model: &CompiledModel) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    if let Some(m) = model
        .definition
        .definition
        .analytical
        .as_ref()
        .and_then(AnalyticalDefinition::table)
    {
        if m.enabled && m.params.promote_page {
            if let Some(p) = &m.layout.page {
                result.insert("pivot:page".into(), p.category_id.clone());
            }
        }
        for f in &m.params.filters {
            result.insert(
                format!("pivot:filter:{}", f.category_id),
                f.category_id.clone(),
            );
        }
    }
    result
}
pub fn active_page(p: &EligiblePool, selection: Option<&MemberConstraint>) -> PageResult {
    let Some(selection) = selection else {
        return PageResult {
            rows: p.rows.clone(),
            selection: None,
            errors: vec![],
            classification_complete: p.classification_complete,
        };
    };
    let complete = classified(p, &selection.category_id);
    let mut result = PageResult {
        rows: vec![],
        selection: Some(selection.clone()),
        errors: vec![],
        classification_complete: p.classification_complete && complete,
    };
    if selection.member_keys.is_empty() {
        result.classification_complete = p.classification_complete;
        return result;
    }
    let errors: Vec<_> = p
        .qualification_errors
        .iter()
        .filter(|e| e.definition_id == selection.category_id)
        .cloned()
        .chain(p.rows.iter().filter_map(|r| {
            member(p, &r.id, &selection.category_id)
                .and_then(|m| m.as_ref().err())
                .cloned()
        }))
        .collect();
    if !errors.is_empty() {
        result.errors = errors;
        result.classification_complete = false;
        return result;
    }
    if !has_category(p, &selection.category_id) {
        result.errors.push(error(
            "missing-reference",
            "Page category is unavailable.",
            &selection.category_id,
            vec![],
        ));
        return result;
    }
    for key in unique(selection.member_keys.clone()) {
        if facet(&p.eligible_members, &selection.category_id, &key).is_none() {
            let excluded = facet(&p.observed_members, &selection.category_id, &key).is_some();
            if !excluded && !complete {
                result
                    .errors
                    .extend(p.universe.evaluated.rows.iter().filter_map(|r| {
                        member(p, &r.id, &selection.category_id)
                            .and_then(|m| m.as_ref().err())
                            .cloned()
                    }));
            } else {
                result.errors.push(error(
                    if excluded {
                        "excluded-member"
                    } else {
                        "missing-member"
                    },
                    if excluded {
                        "The selected Page member is excluded by source constraints."
                    } else {
                        "The selected Page member is absent from acquired input."
                    },
                    &selection.category_id,
                    vec![],
                ));
            }
        }
    }
    result.errors = unique(result.errors);
    result.rows = p
        .rows
        .iter()
        .filter(|r| {
            member(p, &r.id, &selection.category_id).is_some_and(|m| {
                m.as_ref()
                    .is_ok_and(|m| selection.member_keys.contains(&m.key))
            })
        })
        .cloned()
        .collect();
    result
}
#[allow(clippy::result_large_err)]
pub fn category_authoring_recipe(
    model: &CompiledModel,
    id: &str,
    order: &dyn ValueOrder,
) -> Result<Option<String>, Diagnostic> {
    let Some(c) = model.categories.iter().find(|c| c.id == id) else {
        return Ok(None);
    };
    let raw = model
        .definition
        .analytical_recipe_source
        .as_ref()
        .ok_or_else(|| {
            diagnostic(
                "ordering-compatibility-unavailable",
                "Authoring recipe requires the validated ordered analytical source.",
            )
        })?;
    let analytical = model
        .definition
        .definition
        .analytical
        .as_ref()
        .and_then(AnalyticalDefinition::table)
        .ok_or_else(|| {
            diagnostic(
                "INVALID_REQUEST",
                "Authoring recipe requires an analytical model.",
            )
        })?;
    crate::validation::validate_recipe_source(raw, analytical)?;
    let json = crate::validation::ordered_recipe_json;
    let WireValue::Array(categories) = own(raw, "categories") else {
        return Err(diagnostic(
            "INVALID_REQUEST",
            "Authoring recipe categories are unavailable.",
        ));
    };
    let raw_category = categories
        .iter()
        .find(|v| matches!(own(v,"id"),WireValue::String(s)if s==id))
        .ok_or_else(|| {
            diagnostic(
                "INVALID_REQUEST",
                "Authoring recipe category is unavailable.",
            )
        })?;
    let WireValue::Array(formulas) = own(raw, "formulas") else {
        return Err(diagnostic(
            "INVALID_REQUEST",
            "Authoring recipe formulas are unavailable.",
        ));
    };
    let formula = |id: &str| {
        formulas.iter().rev().find(|f| {
            matches!(own(f,"scope"),WireValue::String(s)if s=="source")
                && matches!(own(f,"id"),WireValue::String(s)if s==id)
        })
    };
    let mut source = "null".to_owned();
    if formula(&c.source_field_id).is_some() {
        let mut pending = vec![c.source_field_id.clone()];
        let mut seen = BTreeSet::new();
        let mut pairs = vec![];
        while let Some(id) = pending.pop() {
            if !seen.insert(id.clone()) {
                continue;
            }
            let f = formula(&id);
            let ast = f.map(|f| own(f, "ast")).unwrap_or(&WireValue::Missing);
            pairs.push((id.clone(), ast));
            let mut nodes = vec![ast];
            while let Some(n) = nodes.pop() {
                if let WireValue::String(kind) = own(n, "kind") {
                    match kind.as_str() {
                        "reference" => {
                            if matches!(own(n,"target"),WireValue::String(t)if t=="formula") {
                                if let WireValue::String(id) = own(n, "id") {
                                    pending.push(id.clone())
                                }
                            }
                        }
                        "unary" => nodes.push(own(n, "operand")),
                        "binary" => {
                            nodes.push(own(n, "left"));
                            nodes.push(own(n, "right"))
                        }
                        "call" => {
                            if let WireValue::Array(args) = own(n, "args") {
                                nodes.extend(args)
                            }
                        }
                        "member" => nodes.push(own(n, "value")),
                        _ => {}
                    }
                }
            }
        }
        recipe_sort(&mut pairs, |p| p.0.clone(), order)?;
        let rows = pairs
            .into_iter()
            .map(|(id, ast)| {
                json(ast).map(|ast| format!("[{},{}]", serde_json::to_string(&id).unwrap(), ast))
            })
            .collect::<Result<Vec<_>, _>>()?;
        source = format!("[{}]", rows.join(","));
    }
    Ok(Some(format!(
        "[{},{},{},{},{},{}]",
        json(own(raw_category, "id"))?,
        json(own(raw_category, "sourceFieldId"))?,
        json(own(raw_category, "transform"))?,
        json(own(raw_category, "legacyBucket"))?,
        json(own(raw_category, "fiscalBinding"))?,
        source
    )))
}
#[allow(clippy::result_large_err)]
pub fn member_domain(
    p: &EligiblePool,
    category_id: &str,
    category_recipe: &str,
    offset: u64,
    limit: u32,
    search: Option<&String>,
) -> Result<crate::session::MemberDomainResult, Diagnostic> {
    let mut result = crate::session::MemberDomainResult {
        category_id: category_id.into(),
        category_recipe: category_recipe.into(),
        offset,
        limit,
        search: search.cloned(),
        rows: vec![],
        total: 0,
        next_offset: None,
        truncated: false,
        scanned: 0,
        omitted_count: 0,
        classification_complete: false,
        category_error_count: 0,
        authoring_warnings: vec![],
        authoring_warning_count: p.warnings.len() as u64,
        authoring_warnings_truncated: false,
    };
    if let Some(error) = p
        .runtime_diagnostics
        .iter()
        .find(|d| matches!(d.severity, Severity::Error))
    {
        return Err(error.clone());
    }
    if category_id.is_empty()
        || category_id.len() > 16384
        || category_recipe.is_empty()
        || category_recipe.len() > 16384
        || !(1..=100).contains(&limit)
        || search.is_some_and(|s| s.len() > 256)
    {
        return Err(diagnostic(
            "INVALID_REQUEST",
            "Invalid bounded member domain request",
        ));
    }
    match p.authoring_recipes.get(category_id) {
        Some(Ok(recipe)) if recipe == category_recipe => {}
        Some(Err(e)) => return Err(e.clone()),
        _ => {
            return Err(diagnostic(
                "INVALID_REQUEST",
                "Member domain requires the exact saved category recipe",
            ))
        }
    }
    let mut warning_size = 2;
    for w in &p.warnings {
        let mut d = diagnostic(&w.code, &preview(&w.message, 1024));
        d.severity = Severity::Warning;
        d.path = None;
        let size = serde_json::to_string(&d).unwrap().len() + 1;
        if result.authoring_warnings.len() >= 100 || warning_size + size > 16384 {
            break;
        }
        result.authoring_warnings.push(d);
        warning_size += size
    }
    result.authoring_warnings_truncated = result.authoring_warnings.len() < p.warnings.len();
    let search = search.map(|s| s.to_lowercase());
    let source: Vec<_> = p
        .observed_members
        .get(category_id)
        .into_iter()
        .flatten()
        .filter(|f| {
            search
                .as_ref()
                .is_none_or(|s| f.member.label.to_lowercase().contains(s))
        })
        .collect();
    result.total = source.len() as u64;
    let projected: Vec<_> = source
        .iter()
        .map(|f| {
            let m = &f.member;
            let scalar = matches!(
                m.value,
                WireValue::Null | WireValue::Bool(_) | WireValue::String(_)
            ) || number(&m.value).is_some_and(|n| n.is_finite());
            if !scalar || m.key.len() > 16384 || scalar_json(&m.value).len() > 16384 {
                result.omitted_count += 1;
                return None;
            }
            let label = preview(&m.label, 256);
            Some(crate::session::ObservedMember {
                key: m.key.clone(),
                label_truncated: label != m.label,
                label,
                value: m.value.clone(),
                observed_count: f.count as u64,
                eligible_count: facet(&p.eligible_members, category_id, &m.key)
                    .map_or(0, |f| f.count as u64),
            })
        })
        .collect();
    let mut index = (offset.min(projected.len() as u64)) as usize;
    let mut size = 2;
    while index < projected.len() && result.scanned < limit as u64 {
        let row = &projected[index];
        let bytes = row.as_ref().map(observed_json_size).unwrap_or(0);
        if size + bytes > 131072 {
            break;
        }
        index += 1;
        result.scanned += 1;
        if let Some(row) = row {
            result.rows.push(row.clone());
            size += bytes;
        }
    }
    result.truncated = index < projected.len();
    result.next_offset = result.truncated.then_some(index as u64);
    result.category_error_count = p
        .universe
        .evaluated
        .rows
        .iter()
        .filter(|r| !member(p, &r.id, category_id).is_some_and(Result::is_ok))
        .count() as u64;
    result.classification_complete = result.category_error_count == 0 && p.classification_complete;
    Ok(result)
}
fn scalar_json(v: &WireValue) -> String {
    match v {
        WireValue::String(s) => serde_json::to_string(s).unwrap(),
        WireValue::Bool(b) => b.to_string(),
        WireValue::Null => "null".into(),
        WireValue::F64(_) => crate::ordering::number_string(number(v).unwrap()),
        _ => String::new(),
    }
}
fn observed_json_size(r: &crate::session::ObservedMember) -> usize {
    format!("{{\"key\":{},\"label\":{},\"labelTruncated\":{},\"value\":{},\"observedCount\":{},\"eligibleCount\":{}}}",serde_json::to_string(&r.key).unwrap(),serde_json::to_string(&r.label).unwrap(),r.label_truncated,scalar_json(&r.value),r.observed_count,r.eligible_count).len()+1
}
fn preview(s: &str, limit: usize) -> String {
    let mut bytes = 0;
    s.chars()
        .take_while(|c| {
            bytes += c.len_utf8();
            bytes <= limit
        })
        .collect()
}
type Required = ScopeConstraints<Vec<String>>;
fn constraints(scope: &CalculationScope) -> Vec<(Required, Option<Vec<WireValue>>)> {
    let default = vec![ContextSlice::default()];
    scope
        .context_slices
        .as_ref()
        .unwrap_or(&default)
        .iter()
        .map(|slice| {
            let mut categories = scope.category_constraints.clone();
            categories.extend(slice.categories.clone());
            let mut required: Required = categories
                .into_iter()
                .map(|(id, k)| (id, vec![k]))
                .collect();
            if let Some(p) = &scope.page {
                required.insert(p.category_id.clone(), p.member_keys.clone());
            }
            (
                required,
                slice
                    .company_ids
                    .clone()
                    .or_else(|| scope.temporal_context.company_ids.clone()),
            )
        })
        .collect()
}
fn matches(
    p: &EligiblePool,
    row: &DatasetRow,
    required: &Required,
    scope: &CalculationScope,
    unknown: bool,
    companies: Option<&[WireValue]>,
) -> bool {
    if required.values().any(Vec::is_empty) {
        return false;
    }
    for (id, keys) in required {
        match member(p, &row.id, id) {
            Some(Ok(m)) => {
                if !keys.contains(&m.key) {
                    return false;
                }
            }
            _ => {
                if !unknown {
                    return false;
                }
            }
        }
    }
    for (field, values) in &scope.field_constraints {
        if let Some(v) = row.values.get(field) {
            if !contains(values, v) {
                return false;
            }
        } else if !unknown {
            return false;
        }
    }
    let companies = companies.or(scope.temporal_context.company_ids.as_deref());
    if let Some(companies) = companies {
        let Some(field) = scope.temporal_context.company_field_id.as_ref() else {
            return unknown;
        };
        let Some(company) = row.values.get(field) else {
            return unknown;
        };
        if p.errors.get(&row.id).is_some_and(|m| m.contains_key(field)) {
            return unknown;
        }
        if !contains(companies, company) {
            return false;
        }
    }
    true
}
/// Slices bucketed by their first requirement, so a row is only tested against the
/// slices its member could satisfy (a superset, in slice order; `matches` decides).
struct SliceIndex {
    always: Vec<usize>,
    by_category: HashMap<String, KeyBuckets>,
}
impl SliceIndex {
    fn new(slices: &[(Required, Option<Vec<WireValue>>)]) -> Self {
        let mut index = Self {
            always: vec![],
            by_category: HashMap::new(),
        };
        for (i, (required, _)) in slices.iter().enumerate() {
            let Some((id, keys)) = required.iter().next() else {
                index.always.push(i);
                continue;
            };
            let (by_key, all) = index.by_category.entry(id.clone()).or_default();
            for key in keys.iter().collect::<BTreeSet<_>>() {
                by_key.entry(key.clone()).or_default().push(i);
            }
            all.push(i);
        }
        index
    }
    fn for_row(&self, p: &EligiblePool, id: &str) -> Vec<usize> {
        let mut at = self.always.clone();
        for (category, (by_key, all)) in &self.by_category {
            match member(p, id, category) {
                // Classified: only slices requiring this key can match.
                Some(Ok(m)) => at.extend(by_key.get(&m.key).into_iter().flatten()),
                // Unclassified rows match any requirement (`unknown`).
                _ => at.extend(all),
            }
        }
        at.sort_unstable();
        at
    }
}
#[cfg(test)]
thread_local! { static SCOPE_LOOKUP_WORK: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
pub fn scope_errors(p: &EligiblePool, scope: &CalculationScope) -> Vec<ModelError> {
    if scope
        .page
        .as_ref()
        .is_some_and(|p| p.member_keys.is_empty())
    {
        return vec![];
    }
    let slices = constraints(scope);
    // Preserve the original FIRST-universe-row behavior even with duplicate IDs.
    // Borrow rows/IDs: no source or metadata clones and no per-row universe scan.
    let mut first_by_id = BTreeMap::new();
    if p.index.get().is_none() {
        for row in &p.universe.evaluated.rows {
            #[cfg(test)]
            SCOPE_LOOKUP_WORK.with(|n| n.set(n.get() + 1));
            first_by_id.entry(row.id.as_str()).or_insert(row);
        }
    }
    let first = |id: &str| match p.index.get() {
        Some(index) => index
            .universe_first
            .get(id)
            .map(|&i| &p.universe.evaluated.rows[i]),
        None => first_by_id.get(id).copied(),
    };
    let by_slice = SliceIndex::new(&slices);
    let could_affect = |id: &str| {
        #[cfg(test)]
        SCOPE_LOOKUP_WORK.with(|n| n.set(n.get() + 1));
        first(id).is_none_or(|row| {
            by_slice.for_row(p, &row.id).into_iter().any(|i| {
                let (req, companies) = &slices[i];
                matches(p, row, req, scope, true, companies.as_deref())
            })
        })
    };
    let mut errors = vec![];
    for e in &p.qualification_errors {
        if e.record_ids.is_empty() {
            errors.push(e.clone())
        } else {
            let ids: Vec<_> = e
                .record_ids
                .iter()
                .filter(|id| could_affect(id))
                .cloned()
                .collect();
            if !ids.is_empty() {
                let mut e = e.clone();
                e.record_ids = ids;
                errors.push(e)
            }
        }
    }
    let candidates = p.scope_candidates(&slices);
    let rows: Vec<&DatasetRow> = match &candidates {
        Some(at) => at.iter().map(|&i| &p.rows[i]).collect(),
        None => p.rows.iter().collect(),
    };
    for row in rows {
        if !could_affect(&row.id) {
            continue;
        }
        for i in by_slice.for_row(p, &row.id) {
            let (req, companies) = &slices[i];
            if !matches(p, row, req, scope, true, companies.as_deref()) {
                continue;
            }
            for id in req.keys() {
                match member(p, &row.id, id) {
                    Some(Ok(_)) => {}
                    Some(Err(e)) => errors.push(e.clone()),
                    None => errors.push(error(
                        "missing-reference",
                        "Scope category is unavailable.",
                        id,
                        vec![row.id.clone()],
                    )),
                }
            }
        }
        if scope.temporal_context.company_ids.is_some() {
            let field = scope.temporal_context.company_field_id.as_deref();
            if field.is_none()
                || field.is_some_and(|f| {
                    !row.values.contains_key(f)
                        || p.errors.get(&row.id).is_some_and(|e| e.contains_key(f))
                })
            {
                errors.push(
                    field
                        .and_then(|f| p.errors.get(&row.id).and_then(|e| e.get(f)))
                        .cloned()
                        .unwrap_or_else(|| {
                            error(
                                "missing-input",
                                "Company scope binding is unavailable.",
                                "",
                                vec![row.id.clone()],
                            )
                        }),
                )
            }
        }
    }
    unique(errors)
}
pub fn collect_fiscal_evidence(
    p: &EligiblePool,
    ids: &BTreeSet<String>,
    category_id: &str,
) -> FiscalEvidence {
    let mut result = FiscalEvidence {
        periods: vec![],
        errors: vec![],
    };
    for row in p.rows_in(ids) {
        match member(p, &row.id, category_id) {
            Some(Ok(m))
                if m.fiscal
                    .as_ref()
                    .is_some_and(|f| f.precision == "authoritative") =>
            {
                let f = m.fiscal.as_ref().unwrap();
                if !result.periods.iter().any(|o| {
                    o.company_key == f.company_key
                        && format!("{:?}", o.period.kind) == format!("{:?}", f.period.kind)
                        && o.period.year == f.period.year
                        && quarter_recipe_json(&o.period).ok()
                            == quarter_recipe_json(&f.period).ok()
                        && o.start == f.start
                        && o.end == f.end
                }) {
                    result.periods.push(f.clone())
                }
            }
            Some(Err(e)) => result.errors.push(e.clone()),
            _ => result.errors.push(error(
                "fiscal-context",
                "The requested fiscal scope requires authoritative period evidence.",
                "",
                vec![row.id.clone()],
            )),
        }
    }
    result
}
fn replace_requested_fiscal(
    p: &EligiblePool,
    scope: &CalculationScope,
    selectors: &[MemberSelector],
) -> Option<RequestedFiscalScope> {
    let requested = scope.requested_fiscal_scope.as_ref()?;
    if !selectors
        .iter()
        .any(|s| s.category_id == requested.category_id)
    {
        return Some(requested.clone());
    }
    let dependent = &requested.dependent_category_ids;
    let mut evidence_scope = scope.clone();
    drop_categories(&mut evidence_scope, |id| dependent.contains(id));
    let mut ids = BTreeSet::new();
    let mut errors = scope_errors(p, &evidence_scope);
    for (required, companies) in constraints(&evidence_scope) {
        let rows: Vec<_> = p
            .rows
            .iter()
            .filter(|r| {
                matches(
                    p,
                    r,
                    &required,
                    &evidence_scope,
                    false,
                    companies.as_deref(),
                )
            })
            .collect();
        ids.extend(rows.iter().map(|r| r.id.clone()));
        if rows.is_empty() {
            errors.push(error("missing-member","The requested fiscal member has no authoritative evidence in the retained source context.","",vec![]))
        }
    }
    let evidence = collect_fiscal_evidence(p, &ids, &requested.category_id);
    errors.extend(evidence.errors);
    Some(RequestedFiscalScope {
        category_id: requested.category_id.clone(),
        dependent_category_ids: dependent.clone(),
        periods: evidence.periods,
        errors,
    })
}
/// Removes the category constraints, context-slice categories and page the predicate names.
fn drop_categories(scope: &mut CalculationScope, drop: impl Fn(&String) -> bool) {
    scope.category_constraints.retain(|id, _| !drop(id));
    for s in scope.context_slices.iter_mut().flatten() {
        s.categories.retain(|id, _| !drop(id));
    }
    if scope.page.as_ref().is_some_and(|p| drop(&p.category_id)) {
        scope.page = None
    }
}
/// Every universe row has a classified member for `category`.
fn classified(p: &EligiblePool, category: &str) -> bool {
    let rows = &p.universe.evaluated.rows;
    rows.iter()
        .all(|r| member(p, &r.id, category).is_some_and(Result::is_ok))
}
pub fn resolve_member(
    p: &EligiblePool,
    current: &CalculationScope,
    selectors: &[MemberSelector],
) -> Result<CalculationScope, Vec<ModelError>> {
    if let Some(declared) = current.declared_members.iter().find(|m| {
        m.formula_id.is_some()
            && m.selectors.iter().all(|s| {
                selectors
                    .iter()
                    .any(|o| o.category_id == s.category_id && o.member_key == s.member_key)
            })
    }) {
        let replaced: BTreeSet<_> = declared.selectors.iter().map(|s| &s.category_id).collect();
        let mut anchor = current.clone();
        anchor.declared_members.clear();
        drop_categories(&mut anchor, |id| replaced.contains(id));
        let retained: Vec<_> = selectors
            .iter()
            .filter(|s| !replaced.contains(&s.category_id))
            .cloned()
            .collect();
        let mut resolved = resolve_member(p, &anchor, &retained)?;
        for s in selectors {
            resolved
                .category_constraints
                .insert(s.category_id.clone(), s.member_key.clone());
            if let Some(slices) = &mut resolved.context_slices {
                for slice in slices {
                    slice
                        .categories
                        .insert(s.category_id.clone(), s.member_key.clone());
                }
            }
        }
        resolved.declared_members = current.declared_members.clone();
        return Ok(resolved);
    }
    let mut slices = constraints(current);
    for s in selectors {
        if !has_category(p, &s.category_id) {
            return Err(vec![error(
                "missing-reference",
                "Member category is unavailable.",
                &s.category_id,
                vec![],
            )]);
        }
        for (req, _) in &mut slices {
            req.insert(s.category_id.clone(), vec![s.member_key.clone()]);
        }
    }
    let mut scope = current.clone();
    scope.source_record_ids.clear();
    for s in selectors {
        scope
            .category_constraints
            .insert(s.category_id.clone(), s.member_key.clone());
    }
    if let Some(page) = &mut scope.page {
        if let Some(s) = selectors.iter().find(|s| s.category_id == page.category_id) {
            page.member_keys = vec![s.member_key.clone()]
        }
    }
    let mut contexts = current
        .context_slices
        .clone()
        .unwrap_or_else(|| vec![ContextSlice::default()]);
    for c in &mut contexts {
        for s in selectors {
            c.categories
                .insert(s.category_id.clone(), s.member_key.clone());
        }
    }
    scope.context_slices = Some(contexts);
    if current.source_record_ids.is_empty() {
        return Ok(scope);
    }
    scope.requested_fiscal_scope = replace_requested_fiscal(p, &scope, selectors);
    let mut errors = scope_errors(p, &scope);
    for s in selectors {
        if facet(&p.observed_members, &s.category_id, &s.member_key).is_none() {
            errors.extend(p.universe.evaluated.rows.iter().filter_map(|r| {
                member(p, &r.id, &s.category_id)
                    .and_then(|m| m.as_ref().err())
                    .cloned()
            }));
        }
    }
    for (req, companies) in &slices {
        let rows: Vec<_> = p
            .rows
            .iter()
            .filter(|r| matches(p, r, req, &scope, false, companies.as_deref()))
            .collect();
        scope
            .source_record_ids
            .extend(rows.iter().map(|r| r.id.clone()));
        if rows.is_empty() && errors.is_empty() {
            let observed = p
                .universe
                .evaluated
                .rows
                .iter()
                .any(|r| matches(p, r, req, &scope, false, companies.as_deref()));
            let eligible = selectors
                .iter()
                .all(|s| facet(&p.eligible_members, &s.category_id, &s.member_key).is_some());
            let excluded = selectors.iter().any(|s| {
                facet(&p.observed_members, &s.category_id, &s.member_key).is_some()
                    && facet(&p.eligible_members, &s.category_id, &s.member_key).is_none()
            });
            let (code, message) = if observed || excluded {
                (
                    "excluded-member",
                    "The requested member context is excluded by source constraints.",
                )
            } else if eligible {
                ("no-counterpart","No counterpart records exist for this group in the retained company and category context.")
            } else {
                (
                    "missing-member",
                    "The requested member context is absent from acquired input.",
                )
            };
            errors.push(error(code, message, "", vec![]));
        }
    }
    if errors.is_empty() {
        Ok(scope)
    } else {
        Err(errors)
    }
}
#[derive(Clone)]
struct Interpretation {
    tokens: Vec<String>,
    keys: Vec<String>,
}
#[derive(Clone)]
enum ParseAction {
    Scan,
    Apply(String, usize),
    Absent,
    Done,
}
struct ParseFrame {
    start: usize,
    end: usize,
    text: String,
    answers: Vec<Interpretation>,
    signatures: Vec<Vec<String>>,
    action: ParseAction,
}
impl ParseFrame {
    fn new(start: usize) -> Self {
        Self {
            start,
            end: start,
            text: String::new(),
            answers: vec![],
            signatures: vec![],
            action: ParseAction::Scan,
        }
    }
    fn hits(&self) -> usize {
        self.answers.iter().filter(|a| !a.keys.is_empty()).count()
    }
}
fn parse_group(
    parts: &[&str],
    domain: &BTreeMap<&str, &Vec<String>>,
    absent: bool,
    work: &mut usize,
) -> Result<Vec<Interpretation>, ()> {
    let mut memo = BTreeMap::from([(
        parts.len(),
        vec![Interpretation {
            tokens: vec![],
            keys: vec![],
        }],
    )]);
    let mut stack = vec![ParseFrame::new(0)];
    let spend = |work: &mut usize| {
        if *work == 0 {
            Err(())
        } else {
            *work -= 1;
            Ok(())
        }
    };
    while let Some(mut f) = stack.pop() {
        match f.action.clone() {
            ParseAction::Scan => {
                if f.end == parts.len() {
                    f.action = ParseAction::Absent;
                    stack.push(f);
                    continue;
                }
                spend(work)?;
                if f.end != f.start {
                    f.text.push(',')
                }
                f.text.push_str(parts[f.end]);
                f.end += 1;
                if domain.contains_key(f.text.as_str()) {
                    let token = f.text.clone();
                    let end = f.end;
                    f.action = ParseAction::Apply(token, end);
                    stack.push(f);
                    if !memo.contains_key(&end) {
                        stack.push(ParseFrame::new(end));
                    }
                } else {
                    stack.push(f)
                }
            }
            ParseAction::Apply(token, end) => {
                for tail in &memo[&end] {
                    spend(work)?;
                    let keys = unique(
                        domain
                            .get(token.as_str())
                            .into_iter()
                            .flat_map(|k| k.iter())
                            .cloned()
                            .chain(tail.keys.clone()),
                    );
                    let mut signature = keys.clone();
                    signature.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                    if f.signatures.contains(&signature) {
                        continue;
                    }
                    f.signatures.push(signature);
                    let mut tokens = vec![token.clone()];
                    tokens.extend(tail.tokens.clone());
                    f.answers.push(Interpretation { tokens, keys });
                    if f.hits() == 2 {
                        break;
                    }
                }
                f.action = if f.hits() == 2
                    || end == f.start + 1
                        && token == parts[f.start]
                        && !domain.contains_key(token.as_str())
                {
                    ParseAction::Done
                } else {
                    ParseAction::Scan
                };
                stack.push(f)
            }
            ParseAction::Absent => {
                if absent && !domain.contains_key(parts[f.start]) && f.hits() < 2 {
                    let end = f.start + 1;
                    f.action = ParseAction::Apply(parts[f.start].into(), end);
                    stack.push(f);
                    if !memo.contains_key(&end) {
                        stack.push(ParseFrame::new(end));
                    }
                } else {
                    f.action = ParseAction::Done;
                    stack.push(f)
                }
            }
            ParseAction::Done => {
                memo.insert(f.start, f.answers);
            }
        }
    }
    Ok(memo.remove(&0).unwrap_or_default())
}
pub fn resolve_group_transport(
    raw: &str,
    domain: &[(String, Vec<String>)],
    complete: bool,
    mut work: usize,
) -> GroupResolution {
    let parts: Vec<_> = if raw.is_empty() {
        vec![]
    } else {
        raw.split(',').collect()
    };
    let mut base = GroupResolution {
        keys: vec![],
        unmatched: vec![],
        input_count: parts.len(),
        classification_complete: complete,
        status: "resolved".into(),
        reason: None,
    };
    let refuse = |mut base: GroupResolution, reason: &str| {
        base.status = "refused".into();
        base.reason = Some(reason.into());
        base
    };
    if parts.len() > 1024 {
        return refuse(base, "budget");
    }
    if parts.len() > 1 && !complete {
        return refuse(base, "partial");
    }
    if parts.is_empty() {
        return base;
    }
    let map: BTreeMap<_, _> = domain.iter().map(|(k, v)| (k.as_str(), v)).collect();
    if parts.len() == 1 {
        base.keys = map.get(raw).map(|k| (*k).clone()).unwrap_or_default();
        if complete && !map.contains_key(raw) {
            base.unmatched.push(raw.into())
        }
        return base;
    }
    let mut comma_domain = false;
    for (label, _) in domain {
        if work == 0 {
            return refuse(base, "budget");
        }
        work -= 1;
        if label.contains(',') {
            comma_domain = true;
            break;
        }
    }
    if !comma_domain {
        if work < parts.len() {
            return refuse(base, "budget");
        }
        base.keys = unique(
            parts
                .iter()
                .flat_map(|p| map.get(p).into_iter().flat_map(|k| k.iter()))
                .cloned(),
        );
        if complete {
            base.unmatched = parts
                .iter()
                .filter(|p| !map.contains_key(**p))
                .map(|p| (*p).into())
                .collect()
        }
        return base;
    }
    let Ok(mut interpretations) = parse_group(&parts, &map, false, &mut work) else {
        return refuse(base, "budget");
    };
    if interpretations.len() > 1 {
        return refuse(base, "ambiguous");
    }
    if interpretations.is_empty() {
        let Ok(values) = parse_group(&parts, &map, true, &mut work) else {
            return refuse(base, "budget");
        };
        interpretations = values.into_iter().filter(|a| !a.keys.is_empty()).collect();
        if interpretations.len() > 1 {
            return refuse(base, "ambiguous");
        }
    }
    let tokens = interpretations
        .first()
        .map(|a| a.tokens.clone())
        .unwrap_or_else(|| parts.iter().map(|s| (*s).into()).collect());
    base.keys = unique(
        tokens
            .iter()
            .flat_map(|p| map.get(p.as_str()).into_iter().flat_map(|k| k.iter()))
            .cloned(),
    );
    if complete {
        base.unmatched = tokens
            .iter()
            .filter(|p| !map.contains_key(p.as_str()))
            .cloned()
            .collect()
    }
    base.input_count = tokens.len();
    base
}
pub fn observed_group_resolution(
    raw: &str,
    input: &CategorizedRows,
    id: &str,
    model: &CompiledModel,
) -> GroupResolution {
    let c = model.categories.iter().find(|c| c.id == id);
    let mut domain: Vec<(String, Vec<String>)> = vec![];
    let mut at: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut complete = c.is_some();
    for row in &input.evaluated.rows {
        let Some(Ok(member)) = input.members.get(&row.id).and_then(|m| m.get(id)) else {
            complete = false;
            continue;
        };
        let text =
            if c.is_some_and(|c| c.transform == Transform::Native && c.legacy_bucket.is_none()) {
                value_string(&member.value)
            } else {
                member.label.clone()
            };
        if let Some(&i) = at.get(&text) {
            let keys = &mut domain[i].1;
            if !keys.contains(&member.key) {
                keys.push(member.key.clone())
            }
        } else {
            at.insert(text.clone(), domain.len());
            domain.push((text, vec![member.key.clone()]))
        }
    }
    resolve_group_transport(raw, &domain, complete, 100000)
}
pub fn runtime_matches(
    runtime: &RuntimeParams,
    model: &CompiledModel,
    p: &EligiblePool,
) -> Vec<ParamMatch> {
    let active = active_runtime_keys(model);
    let mut budget = 131072usize.saturating_sub(runtime.len() * 8);
    runtime
        .iter()
        .filter_map(|(key, entry)| {
            let category = active.get(key)?;
            let group = p.group_resolutions.get(key);
            let complete =
                p.classification_complete && has_category(p, category) && classified(p, category);
            let keys = match entry {
                RuntimeParam::Viewer { member_keys } => member_keys.clone().unwrap_or_else(|| {
                    p.observed_members
                        .get(category)
                        .into_iter()
                        .flatten()
                        .map(|f| f.member.key.clone())
                        .collect()
                }),
                RuntimeParam::Group { .. } => group.map(|g| g.keys.clone()).unwrap_or_default(),
            };
            let mut result = ParamMatch {
                key: key.clone(),
                matched_keys: vec![],
                matched: vec![],
                unmatched: vec![],
                matched_count: 0,
                unmatched_count: 0,
                excluded_count: 0,
                total_count: keys.len() + group.map(|g| g.unmatched.len()).unwrap_or(0),
                classification_complete: complete,
                truncated: !complete,
                source: None,
                group_id: None,
                input_count: None,
                status: None,
                reason: None,
            };
            for key in keys {
                if let Some(m) = facet(&p.observed_members, category, &key) {
                    result.matched_count += 1;
                    if facet(&p.eligible_members, category, &key).is_none() {
                        result.excluded_count += 1
                    }
                    let label = preview(&m.member.label, 256);
                    let size = serde_json::to_string(&(&key, &label)).unwrap().len() + 2;
                    if key.len() <= 16384 && result.matched_keys.len() < 8 && size <= budget {
                        budget -= size;
                        result.matched_keys.push(key);
                        result.matched.push(label.clone());
                        if label != m.member.label {
                            result.truncated = true
                        }
                    } else {
                        result.truncated = true
                    }
                } else if complete {
                    result.unmatched_count += 1;
                    let size = serde_json::to_string(&key).unwrap().len() + 1;
                    if result.unmatched.len() < 8 && size <= budget {
                        budget -= size;
                        result.unmatched.push(key)
                    } else {
                        result.truncated = true
                    }
                }
            }
            if let Some(g) = group {
                for v in &g.unmatched {
                    result.unmatched_count += 1;
                    let size = serde_json::to_string(v).unwrap().len() + 1;
                    if result.unmatched.len() < 8 && size <= budget {
                        budget -= size;
                        result.unmatched.push(v.clone())
                    } else {
                        result.truncated = true
                    }
                }
            }
            if let RuntimeParam::Group { group_id, .. } = entry {
                result.source = Some("group".into());
                result.group_id = Some(group_id.clone());
                result.input_count = Some(group.map(|g| g.input_count).unwrap_or(0));
                result.status = Some(group.map(|g| g.status.clone()).unwrap_or("refused".into()));
                result.reason = group.and_then(|g| g.reason.clone());
            }
            Some(result)
        })
        .collect()
}
/// Existing runtime protocol budgets, evaluated before any category or source computation.
#[allow(clippy::result_large_err)]
pub fn validate_runtime_params(
    params: &RuntimeParams,
    model: Option<&CompiledModel>,
) -> Result<(), Diagnostic> {
    let invalid = |message: &str| diagnostic("INVALID_REQUEST", message);
    if params.len() > 64 {
        return Err(invalid("Runtime object exceeds entry limit"));
    }
    let active = model.map(active_runtime_keys);
    for (key, entry) in params {
        if key.is_empty()
            || key.len() > 512
            || active.as_ref().is_some_and(|a| !a.contains_key(key))
        {
            return Err(invalid("Unknown or dormant promoted runtime key"));
        }
        match entry {
            RuntimeParam::Viewer {
                member_keys: Some(keys),
            } => {
                if keys.len() > 1024 || keys.iter().any(|k| k.is_empty() || k.len() > 16384) {
                    return Err(invalid("Invalid bounded runtime values"));
                }
            }
            RuntimeParam::Viewer { member_keys: None } => {}
            RuntimeParam::Group {
                group_id,
                transport_value,
            } => {
                if group_id.is_empty() || group_id.len() > 256 {
                    return Err(invalid("Invalid group runtime entry"));
                }
                if transport_value.len() > 16384
                    || !transport_value.is_empty() && transport_value.split(',').count() > 1024
                {
                    return Err(invalid("Invalid group transport value"));
                }
            }
        }
    }
    if serde_json::to_string(params).unwrap().len() > 1048576 {
        return Err(invalid("Runtime payload exceeds byte limit"));
    }
    Ok(())
}
fn refused_pool(input: &EvaluatedRows, d: Diagnostic) -> EligiblePool {
    let e = error("INVALID_REQUEST", d.message.clone(), "", vec![]);
    EligiblePool {
        rows: vec![],
        universe: CategorizedRows {
            evaluated: input.clone(),
            members: BTreeMap::new(),
            categories: vec![],
            warnings: vec![],
        },
        columns: input.columns.clone(),
        members: BTreeMap::new(),
        categories: vec![],
        errors: input.errors.clone(),
        formula_cells: input.formula_cells.clone(),
        source_dependencies: input.source_dependencies.clone(),
        warnings: vec![],
        constraints: SourceConstraints {
            columns: input.columns.clone(),
            filters: vec![],
            search: String::new(),
            checklists: vec![],
        },
        excluded_record_ids: BTreeSet::new(),
        exclusions: BTreeMap::new(),
        observed_members: BTreeMap::new(),
        eligible_members: BTreeMap::new(),
        page: None,
        classification_complete: false,
        qualification_errors: vec![e],
        group_resolutions: BTreeMap::new(),
        param_matches: vec![],
        runtime_diagnostics: vec![d],
        authoring_recipes: BTreeMap::new(),
        index: Default::default(),
    }
}
/// Preserve legacy code-unit preview boundaries; unsupported lone-surrogate results refuse.
#[allow(clippy::result_large_err)]
fn utf16_preview(s: &str, limit: usize) -> Result<String, Diagnostic> {
    let units = s.encode_utf16().take(limit).collect::<Vec<_>>();
    String::from_utf16(&units).map_err(|_| {
        diagnostic(
            "unsupported-string",
            "Unicode-scalar wire strings cannot represent this UTF-16 preview boundary.",
        )
    })
}
fn member_label(key: &str) -> String {
    serde_json::from_str::<(String, Literal)>(key)
        .ok()
        .map(|(_, v)| match v {
            Literal::Null => "(Blank)".into(),
            Literal::String(s) => s,
            Literal::Bool(b) => b.to_string(),
            Literal::Number(n) => crate::ordering::number_string(n),
        })
        .unwrap_or_else(|| key.into())
}
#[allow(clippy::result_large_err)]
fn selection_diagnostics(p: &EligiblePool, model: &CompiledModel) -> Vec<Diagnostic> {
    let mut selections = p.constraints.checklists.clone();
    if let Some(page) = &p.page {
        selections.push(page.clone())
    }
    let mut output = vec![];
    for (selection_index, selection) in selections.iter().take(64).enumerate() {
        let Some(observed) = p.observed_members.get(&selection.category_id) else {
            continue;
        };
        if !p.classification_complete {
            continue;
        }
        let membership_complete = classified(p, &selection.category_id);
        let absent: Vec<_> = if membership_complete {
            selection
                .member_keys
                .iter()
                .filter(|k| !observed.iter().any(|m| m.member.key == **k))
                .collect()
        } else {
            vec![]
        };
        let excluded: Vec<_> = selection
            .member_keys
            .iter()
            .filter(|k| {
                observed.iter().any(|m| m.member.key == **k)
                    && facet(&p.eligible_members, &selection.category_id, k).is_none()
            })
            .collect();
        let missing = if !absent.is_empty() {
            &absent
        } else {
            &excluded
        };
        let code = if !absent.is_empty() {
            "PIVOT_PARAM_UNMATCHED"
        } else if selection.member_keys.is_empty() {
            "PIVOT_PARAM_EMPTY"
        } else if excluded.len() == selection.member_keys.len() {
            "PIVOT_PARAM_EXCLUDED"
        } else {
            continue;
        };
        let key = if selection_index == p.constraints.checklists.len() && p.page.is_some() {
            "pivot:page".into()
        } else {
            format!("pivot:filter:{}", selection.category_id)
        };
        let label = model
            .definition
            .definition
            .analytical
            .as_ref()
            .and_then(AnalyticalDefinition::table)
            .and_then(|m| {
                m.params
                    .filters
                    .iter()
                    .find(|f| f.category_id == selection.category_id)
            })
            .map(|p| p.label.as_str())
            .or_else(|| {
                model
                    .categories
                    .iter()
                    .find(|c| c.id == selection.category_id)
                    .map(|c| c.name.as_str())
            })
            .unwrap_or(&selection.category_id);
        let projected = (|| {
            let label = utf16_preview(label, 128)?;
            let values = missing
                .iter()
                .take(3)
                .map(|key| utf16_preview(&member_label(key), 128))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            let message = match code {
                "PIVOT_PARAM_EMPTY" => format!("No rows: {label} has no selected values."),
                "PIVOT_PARAM_EXCLUDED" => {
                    format!("No rows: {label} = {values} is excluded by source constraints.")
                }
                _ => format!(
                    "{label} = {values}{} is not in this data.",
                    if missing.len() > 3 { "…" } else { "" }
                ),
            };
            let mut d = diagnostic(code, &message);
            d.key = Some(utf16_preview(&key, 512)?);
            d.member_keys = Some(
                missing
                    .iter()
                    .take(8)
                    .map(|s| utf16_preview(s, 256))
                    .collect::<Result<Vec<_>, _>>()?,
            );
            d.unmatched_count = Some(missing.len() as u64);
            d.truncated = Some(
                key.encode_utf16().count() > 512
                    || missing.len() > 8
                    || missing.iter().any(|s| s.encode_utf16().count() > 256),
            );
            d.severity = Severity::Warning;
            d.path = None;
            Ok::<_, Diagnostic>(d)
        })();
        match projected {
            Ok(d) => output.push(d),
            Err(d) => output.push(d),
        }
    }
    output
}

/// Populate authoring symbols from the observed typed domain, without mutating compiled identities.
pub fn observed_symbols(model: &CompiledModel, pool: &EligiblePool) -> ModelSymbols {
    let mut symbols = model.symbols.clone();
    for category in &mut symbols.categories {
        category.members = pool
            .observed_members
            .get(&category.value.id)
            .into_iter()
            .flatten()
            .filter_map(|facet| {
                let member = &facet.member;
                let value = match &member.value {
                    WireValue::String(text) => Literal::String(text.clone()),
                    WireValue::Bool(value) => Literal::Bool(*value),
                    WireValue::Null => Literal::Null,
                    WireValue::F64(_) => {
                        Literal::Number(number(&member.value).filter(|value| value.is_finite())?)
                    }
                    _ => return None,
                };
                Some((member.key.clone(), value))
            })
            .collect();
    }
    symbols
}
/// Shared source qualification for ordinary/legacy sessions, without analytical categories.
#[allow(clippy::result_large_err)]
pub(crate) fn qualify_source(
    input: &SourceDataset,
    filters: &[SourceFilter],
    search: &str,
) -> Result<Vec<DatasetRow>, Diagnostic> {
    let universe = CategorizedRows {
        evaluated: EvaluatedRows {
            rows: input.rows.clone(),
            columns: input.columns.clone(),
            formula_cells: BTreeMap::new(),
            source_dependencies: BTreeMap::new(),
            errors: BTreeMap::new(),
        },
        members: BTreeMap::new(),
        categories: vec![],
        warnings: vec![],
    };
    let constraints = SourceConstraints {
        columns: input.columns.clone(),
        filters: filters.to_vec(),
        search: search.into(),
        checklists: vec![],
    };
    let result = qualify_with_identity_policy(&universe, &constraints, None, false);
    if let Some(d) = result.failure {
        Err(d)
    } else {
        Ok(result.rows)
    }
}
pub(crate) fn inferred_filter_kind(column: &DatasetColumn, rows: &[DatasetRow]) -> &'static str {
    match filter_kind(column, rows) {
        FilterKind::Text => "text",
        FilterKind::Number => "number",
        FilterKind::Date => "date",
        FilterKind::Boolean => "boolean",
        FilterKind::None => "none",
    }
}

impl<T: crate::session::resources::HeapBytes> crate::session::resources::HeapBytes
    for ScopeConstraints<T>
{
    fn heap_bytes(&self) -> usize {
        crate::session::resources::HeapBytes::heap_bytes(&self.0)
    }
}

#[cfg(test)]
mod lookup_work_tests {
    use super::*;
    #[test]
    fn boolean_filter_coerces_the_cell_before_comparing_the_filter_type() {
        let bad = WireValue::Record(vec![("toString".into(), WireValue::String("bad".into()))]);
        assert!(filter_matches(&bad, &WireValue::Bool(false), FilterKind::Boolean).is_err());
    }
    #[test]
    fn scope_errors_build_one_index_and_lookup_once_per_row() {
        for count in [100, 1000, 5000] {
            let rows: Vec<_> = (0..count)
                .map(|i| DatasetRow {
                    id: format!("row-{i}"),
                    values: BTreeMap::new(),
                    group_path: None,
                    cell_errors: None,
                    cell_formats: None,
                })
                .collect();
            let evaluated = EvaluatedRows {
                rows: rows.clone(),
                columns: vec![],
                formula_cells: BTreeMap::new(),
                source_dependencies: BTreeMap::new(),
                errors: BTreeMap::new(),
            };
            let mut pool = refused_pool(&evaluated, diagnostic("test", "test"));
            pool.rows = rows;
            pool.qualification_errors.clear();
            SCOPE_LOOKUP_WORK.with(|n| n.set(0));
            assert!(scope_errors(&pool, &CalculationScope::default()).is_empty());
            assert_eq!(SCOPE_LOOKUP_WORK.with(|n| n.get()), 2 * count);
        }
    }
}
