// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Records are ordered entries. Absence of an entry differs from an explicit Missing value.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "tag", content = "value", deny_unknown_fields)]
pub enum WireValue {
    #[serde(rename = "missing")]
    Missing,
    #[serde(rename = "null")]
    Null,
    #[serde(rename = "bool")]
    Bool(bool),
    #[serde(rename = "string")]
    String(String),
    #[serde(rename = "f64")]
    F64(WireNumber),
    #[serde(rename = "bigint-string")]
    BigIntString(String),
    #[serde(rename = "array")]
    Array(Vec<WireValue>),
    #[serde(rename = "record")]
    Record(Vec<(String, WireValue)>),
}
// Struct variants keep presence of `value` observable: serde's adjacent unit
// variants otherwise accept null content and erase it before validation.
impl<'de> Deserialize<'de> for WireValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(tag = "tag", deny_unknown_fields)]
        enum StrictValue {
            #[serde(rename = "missing")]
            Missing {},
            #[serde(rename = "null")]
            Null {},
            #[serde(rename = "bool")]
            Bool { value: bool },
            #[serde(rename = "string")]
            String { value: String },
            #[serde(rename = "f64")]
            F64 { value: WireNumber },
            #[serde(rename = "bigint-string")]
            BigIntString { value: String },
            #[serde(rename = "array")]
            Array { value: Vec<WireValue> },
            #[serde(rename = "record")]
            Record { value: Vec<(String, WireValue)> },
        }
        Ok(match StrictValue::deserialize(deserializer)? {
            StrictValue::Missing {} => Self::Missing,
            StrictValue::Null {} => Self::Null,
            StrictValue::Bool { value } => Self::Bool(value),
            StrictValue::String { value } => Self::String(value),
            StrictValue::F64 { value } => Self::F64(value),
            StrictValue::BigIntString { value } => Self::BigIntString(value),
            StrictValue::Array { value } => Self::Array(value),
            StrictValue::Record { value } => Self::Record(value),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WireNumber {
    Finite(f64),
    Special(SpecialNumber),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpecialNumber {
    #[serde(rename = "NaN")]
    Nan,
    #[serde(rename = "Infinity")]
    PositiveInfinity,
    #[serde(rename = "-Infinity")]
    NegativeInfinity,
    #[serde(rename = "-0")]
    NegativeZero,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WireDefinition {
    /// Ordered raw analytical source used only after typed semantic validation for recipe witnesses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analytical_recipe_source: Option<WireValue>,
    pub protocol_version: u32,
    pub locale: String,
    pub definition: TableDefinition,
}
#[derive(Clone, Debug)]
pub struct ValidatedDefinition {
    pub analytical_recipe_source: Option<WireValue>,
    pub locale: String,
    pub definition: TableDefinition,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableDefinition {
    pub table: TableState,
    pub search: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analytical: Option<AnalyticalDefinition>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pivot: Option<PivotConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sorting: Option<Vec<Sort>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_filters: Option<Vec<SourceFilter>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column_order: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widths: Option<BTreeMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<BTreeMap<String, Option<PinSide>>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sort {
    pub id: String,
    pub desc: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceFilter {
    pub id: String,
    pub value: WireValue,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PinSide {
    Left,
    Right,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PivotConfig {
    pub enabled: bool,
    pub grouping: Vec<String>,
    pub split: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<Expanded>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_encoding: Option<KeyEncoding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_expanded: Option<BTreeMap<String, bool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measures: Option<Vec<Measure>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregation_fns: Option<BTreeMap<String, Aggregation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buckets: Option<BTreeMap<String, Bucket>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Expanded {
    All(bool),
    Paths(BTreeMap<String, bool>),
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum KeyEncoding {
    #[serde(rename = "typed-v1")]
    TypedV1,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Aggregation {
    Sum,
    Min,
    Max,
    Mean,
    Median,
    Count,
    UniqueCount,
    First,
    Last,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Bucket {
    Native,
    Week,
    Month,
    Quarter,
    Year,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Measure {
    pub id: String,
    pub source_field_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregation: Option<Aggregation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_label: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableModel {
    pub schema_version: u32,
    pub enabled: bool,
    pub params: PivotParams,
    pub categories: Vec<Category>,
    pub measures: Vec<Measure>,
    pub formulas: Vec<Formula>,
    pub layout: Layout,
    pub checklists: Vec<MemberConstraint>,
    pub result_filters: Vec<ResultFilter>,
    pub subtotals: Subtotals,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_pivot: Option<PivotConfig>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub source_field_id: String,
    pub transform: Transform,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiscal_binding: Option<FiscalBinding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_bucket: Option<LegacyBucket>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Transform {
    #[serde(rename = "native")]
    Native,
    Y,
    Q,
    M,
    FY,
    FQ,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LegacyBucket {
    Week,
    Month,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiscalBinding {
    pub company_field_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_field_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_kind: Option<PeriodKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_start_field_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_end_field_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiscal_year_field_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiscal_quarter_field_id: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PeriodKind {
    FY,
    FQ,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaScope {
    Source,
    Aggregate,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Formula {
    pub id: String,
    pub name: String,
    pub scope: FormulaScope,
    pub expression: String,
    pub ast: FormulaAst,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FormulaAst {
    Literal {
        value: Literal,
    },
    Reference {
        target: ReferenceTarget,
        id: String,
    },
    Unary {
        operator: UnaryOperator,
        operand: Box<FormulaAst>,
    },
    Binary {
        operator: BinaryOperator,
        left: Box<FormulaAst>,
        right: Box<FormulaAst>,
    },
    Call {
        function: FormulaFunction,
        args: Vec<FormulaAst>,
    },
    Member {
        value: Box<FormulaAst>,
        selectors: Vec<MemberSelector>,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Literal {
    Number(f64),
    String(String),
    Bool(bool),
    Null,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceTarget {
    Field,
    Formula,
    Measure,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnaryOperator {
    #[serde(rename = "+")]
    Plus,
    #[serde(rename = "-")]
    Minus,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryOperator {
    #[serde(rename = "+")]
    Add,
    #[serde(rename = "-")]
    Subtract,
    #[serde(rename = "*")]
    Multiply,
    #[serde(rename = "/")]
    Divide,
    #[serde(rename = "=")]
    Equal,
    #[serde(rename = "!=")]
    NotEqual,
    #[serde(rename = "<")]
    Less,
    #[serde(rename = "<=")]
    LessEqual,
    #[serde(rename = ">")]
    Greater,
    #[serde(rename = ">=")]
    GreaterEqual,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaFunction {
    Sum,
    Min,
    Max,
    Mean,
    Median,
    Count,
    UniqueCount,
    First,
    Last,
    #[serde(rename = "IF")]
    If,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberSelector {
    pub category_id: String,
    pub member_key: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberConstraint {
    pub category_id: String,
    pub member_keys: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    pub rows: Vec<String>,
    pub columns: Vec<String>,
    pub values: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<MemberConstraint>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultFilter {
    pub id: String,
    pub category_id: String,
    pub target: ResultTarget,
    pub predicate: Predicate,
    pub value: Literal,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ResultTarget {
    Measure { id: String },
    Formula { id: String },
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Predicate {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PivotParams {
    pub promote_page: bool,
    pub filters: Vec<FilterParam>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilterParam {
    pub id: String,
    pub category_id: String,
    pub label: String,
    pub multi_select: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Subtotals {
    pub grand_total: bool,
    pub groups: bool,
}
/// Object.entries order: canonical integer indexes first, then insertion-ordered string keys.
#[derive(Clone, Debug, Default)]
pub struct RuntimeParams(Vec<(String, RuntimeParam)>);
impl RuntimeParams {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = (&String, &RuntimeParam)> {
        self.0.iter().map(|(k, v)| (k, v))
    }
    pub fn get(&self, key: &str) -> Option<&RuntimeParam> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
    pub fn insert(&mut self, key: String, value: RuntimeParam) -> Option<RuntimeParam> {
        if let Some((_, v)) = self.0.iter_mut().find(|(k, _)| k == &key) {
            return Some(std::mem::replace(v, value));
        }
        self.0.push((key, value));
        self.0.sort_by_key(|e| js_key_order(&e.0));
        None
    }
}
pub(crate) fn js_object_index(s: &str) -> Option<u32> {
    let n = s.parse::<u32>().ok()?;
    (n < u32::MAX && n.to_string() == s).then_some(n)
}
/// JS own-key order: integer indexes ascending first, then the rest in insertion order
/// (callers sort stably).
pub(crate) fn js_key_order(s: &str) -> (u8, u32) {
    js_object_index(s).map_or((1, 0), |i| (0, i))
}
impl<const N: usize> From<[(String, RuntimeParam); N]> for RuntimeParams {
    fn from(values: [(String, RuntimeParam); N]) -> Self {
        values.into_iter().collect()
    }
}
impl FromIterator<(String, RuntimeParam)> for RuntimeParams {
    fn from_iter<T: IntoIterator<Item = (String, RuntimeParam)>>(values: T) -> Self {
        let mut result = Self::new();
        for (k, v) in values {
            result.insert(k, v);
        }
        result
    }
}
impl<'a> IntoIterator for &'a RuntimeParams {
    type Item = (&'a String, &'a RuntimeParam);
    type IntoIter = std::iter::Map<
        std::slice::Iter<'a, (String, RuntimeParam)>,
        fn(&'a (String, RuntimeParam)) -> (&'a String, &'a RuntimeParam),
    >;
    fn into_iter(self) -> Self::IntoIter {
        self.0.iter().map(|(k, v)| (k, v))
    }
}
impl Serialize for RuntimeParams {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_map(self)
    }
}
impl<'de> Deserialize<'de> for RuntimeParams {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let entries = ordered_entries(
            d,
            "bounded runtime parameter map",
            "Duplicate runtime parameter key",
            Some((64, "Runtime parameter entries exceed limit")),
        )?;
        Ok(entries.into_iter().collect())
    }
}
/// Map entries in wire order; duplicate keys and entries past `limit` are refused.
pub(crate) fn ordered_entries<'de, D: serde::Deserializer<'de>, V: Deserialize<'de>>(
    d: D,
    expecting: &'static str,
    duplicate: &'static str,
    limit: Option<(usize, &'static str)>,
) -> Result<Vec<(String, V)>, D::Error> {
    struct Visitor<V>(
        &'static str,
        &'static str,
        Option<(usize, &'static str)>,
        std::marker::PhantomData<V>,
    );
    impl<'de, V: Deserialize<'de>> serde::de::Visitor<'de> for Visitor<V> {
        type Value = Vec<(String, V)>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str(self.0)
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut m: A,
        ) -> Result<Self::Value, A::Error> {
            let mut entries = vec![];
            let mut keys = std::collections::BTreeSet::new();
            while let Some((k, v)) = m.next_entry::<String, V>()? {
                if !keys.insert(k.clone()) {
                    return Err(serde::de::Error::custom(self.1));
                }
                if let Some((max, message)) = self.2 {
                    if entries.len() == max {
                        return Err(serde::de::Error::custom(message));
                    }
                }
                entries.push((k, v));
            }
            Ok(entries)
        }
    }
    d.deserialize_map(Visitor(
        expecting,
        duplicate,
        limit,
        std::marker::PhantomData,
    ))
}
fn required_nullable_keys<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<String>>, D::Error> {
    Option::<Vec<String>>::deserialize(d)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "camelCase", deny_unknown_fields)]
pub enum RuntimeParam {
    Viewer {
        #[serde(rename = "memberKeys", deserialize_with = "required_nullable_keys")]
        member_keys: Option<Vec<String>>,
    },
    Group {
        #[serde(rename = "groupId")]
        group_id: String,
        #[serde(rename = "transportValue")]
        transport_value: String,
    },
}

pub type ValueRecord = BTreeMap<String, WireValue>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Revision {
    pub widget_id: String,
    pub input: u64,
    pub model: u64,
    pub output: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub severity: Severity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependency_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_keys: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unmatched_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Info,
    Warning,
    Error,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependency_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_record_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_preview: Option<Vec<String>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CellFormat {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formatter_fn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decimal_places: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abbreviate: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupMember {
    pub field: String,
    pub value: WireValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_binding_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<Transform>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bucket: Option<Bucket>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetRow {
    pub id: String,
    pub values: ValueRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_path: Option<Vec<GroupMember>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_errors: Option<BTreeMap<String, CellError>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_formats: Option<BTreeMap<String, CellFormat>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyticalColumn {
    pub kind: AnalyticalKind,
    pub definition_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<FormulaScope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform: Option<Transform>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_kind: Option<ValueKind>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnalyticalKind {
    Formula,
    Category,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValueKind {
    Number,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatasetColumn {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dtype: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CellFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_field_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measure_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_binding_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_path: Option<Vec<GroupMember>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregation: Option<Aggregation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ValueRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analytical: Option<AnalyticalColumn>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Completeness {
    pub kind: CompletenessKind,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acquired_row_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_row_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_row_count_kind: Option<CountKind>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompletenessKind {
    Complete,
    Partial,
    Sample,
    Bounded,
    Paged,
    Unknown,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CountKind {
    Exact,
    Estimated,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Freshness {
    pub availability: Availability,
    pub stale: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_success_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<String>>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Availability {
    Available,
    Unavailable,
    Loading,
    Updating,
    Blocked,
    Error,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationProvenance {
    pub scope: PresentedScope,
    pub row_count: u64,
    pub revision: Revision,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresentedScope {
    Presented,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lineage {
    pub widget_id: String,
    pub result_revision: u64,
    pub output_revision: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provenance {
    pub source_widget_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_may_contain_aggregates: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineage: Option<Vec<Lineage>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presentation: Option<PresentationProvenance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receipt: Option<ValueRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<ValueRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ValueRecord>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelWarning {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    pub period_count: u64,
    pub origin: Revision,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceDataset {
    pub rows: Vec<DatasetRow>,
    pub columns: Vec<DatasetColumn>,
    pub result_revision: u64,
    pub output_revision: u64,
    pub provenance: Provenance,
    pub completeness: Completeness,
    pub freshness: Freshness,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<Diagnostic>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_warnings: Option<Vec<ModelWarning>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_warning_count: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityDeclaration {
    pub protocol_versions: Vec<u32>,
    pub definition_versions: Vec<u32>,
    pub aggregations: Vec<Aggregation>,
    pub formula_functions: Vec<FormulaFunction>,
    pub fiscal: bool,
    pub inspection: bool,
    pub selection: bool,
    pub identity_witness: bool,
    pub remote_acquisition: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SelectionSpec {
    None,
    Explicit {
        ids: Vec<String>,
    },
    AllMatching {
        #[serde(rename = "excludedIds")]
        excluded_ids: Vec<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SelectionAction {
    Summary,
    All,
    Clear,
    Toggle {
        #[serde(rename = "rowId")]
        row_id: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionRowState {
    pub row_id: String,
    pub selectable: bool,
    pub checked: bool,
    pub indeterminate: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionSummary {
    pub selection: SelectionSpec,
    pub selected_count: u64,
    pub eligible_count: u64,
    pub checked: bool,
    pub indeterminate: bool,
    pub rows: Vec<SelectionRowState>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    Input,
    Filtered,
    Selected,
    Presented,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedValues {
    pub scope: Scope,
    pub values: ValueRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_errors: Option<BTreeMap<String, CellError>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<FacetMember>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FacetMember {
    pub key: String,
    pub label: String,
    pub value: WireValue,
    pub count: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowRequest {
    pub group_path: Vec<String>,
    pub offset: u64,
    pub limit: u32,
}
/// These counts describe siblings at this parent, independent of other loaded blocks.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RowBlock {
    pub group_path: Vec<String>,
    pub offset: u64,
    pub rows: Vec<DatasetRow>,
    pub sibling_count: ResultCount,
    pub groups: Vec<GroupSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<SelectionSummary>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupSummary {
    pub row_id: String,
    pub path: Vec<String>,
    pub child_count: ResultCount,
}
/// Unknown/expired counts must never be rendered as an exact empty result.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ResultCount {
    Exact { value: u64 },
    Estimated { value: u64 },
    Unknown,
    SnapshotExpired,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubsetBatch {
    pub transfer_id: String,
    pub sequence: u64,
    pub rows: Vec<DatasetRow>,
    #[serde(rename = "final")]
    pub final_batch: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<DatasetColumn>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub freshness: Option<Freshness>,
}

/// Saved analytical intent. Version dispatch precedes variant decoding.
#[derive(Clone, Debug, Serialize)]
#[serde(untagged)]
pub enum AnalyticalDefinition {
    Table(Box<TableModel>),
    Statement(Box<crate::statement::StatementIntent>),
}
impl AnalyticalDefinition {
    pub fn table(&self) -> Option<&TableModel> {
        if let Self::Table(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn table_mut(&mut self) -> Option<&mut TableModel> {
        if let Self::Table(v) = self {
            Some(v)
        } else {
            None
        }
    }
    pub fn schema_version(&self) -> u32 {
        match self {
            Self::Table(v) => v.schema_version,
            Self::Statement(v) => v.schema_version,
        }
    }
}
impl<'de> Deserialize<'de> for AnalyticalDefinition {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        match v.get("schemaVersion").and_then(serde_json::Value::as_u64) {
            Some(1) => serde_json::from_value(v)
                .map(|v| Self::Table(Box::new(v)))
                .map_err(serde::de::Error::custom),
            Some(2) => serde_json::from_value(v)
                .map(|v| Self::Statement(Box::new(v)))
                .map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom(
                "unsupported-schema: Unsupported analytical saved schema",
            )),
        }
    }
}

impl crate::session::resources::HeapBytes for RuntimeParams {
    fn heap_bytes(&self) -> usize {
        crate::session::resources::HeapBytes::heap_bytes(&self.0)
    }
}
