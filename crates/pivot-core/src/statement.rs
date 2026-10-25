// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Native compilation of saved schema 2 Statement intents.
use crate::{contract::*, scopes::DeclaredMember};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
mod compile;
mod policy;
mod presentation;
mod unpivot;
mod validation;
pub use compile::compile_statement;
pub use policy::evaluate_statement_line;
pub use presentation::statement_presentation;
pub use unpivot::unpivot_dataset;
pub use validation::validate_intent;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementIntent {
    pub schema_version: u32,
    pub kind: String,
    pub template: StatementTemplate,
    pub bindings: StatementBindings,
    pub overrides: StatementOverrides,
    pub period_kind: PeriodKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<MemberConstraint>,
    pub checklists: Vec<MemberConstraint>,
    pub result_filters: Vec<ResultFilter>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementTemplate {
    pub schema_version: u32,
    pub id: String,
    pub version: String,
    pub sections: Vec<StatementSection>,
    pub lines: Vec<StatementLine>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementSection {
    pub id: String,
    pub label: String,
    pub line_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementLine {
    pub id: String,
    pub label: String,
    pub required: bool,
    pub policy: LinePolicy,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<Formula>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinePolicy {
    Single,
    Flow,
    Stock,
    Formula,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatementShape {
    Wide,
    Long,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementBindings {
    pub shape: StatementShape,
    pub company_field_id: String,
    pub period_kind_field_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_field_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_field_id: Option<String>,
    pub fiscal: FiscalBinding,
    pub mappings: Vec<Mapping>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long_fields: Option<LongFields>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LongFields {
    pub item_field_id: String,
    pub value_field_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mapping {
    pub source_field_id: String,
    pub line_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnpivotSpec {
    pub id: String,
    pub carry_field_ids: Vec<String>,
    pub mappings: Vec<Mapping>,
    pub item_field_id: String,
    pub value_field_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementOverrides {
    pub labels: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_order: Option<Vec<String>>,
    pub line_order: BTreeMap<String, Vec<String>>,
    pub hidden_ids: Vec<String>,
    pub formulas: Vec<Formula>,
}
#[derive(Clone, Debug)]
pub struct OutputMember {
    pub selectors: Vec<MemberSelector>,
    pub formula_id: Option<String>,
    pub require_observed: bool,
    pub format: Option<CellFormat>,
}
#[derive(Clone, Debug)]
pub struct StatementPolicy {
    pub category_id: String,
    pub dependent_category_ids: Vec<String>,
    pub measure_id: String,
    pub value_field_id: String,
    pub members: BTreeMap<String, LinePolicy>,
    pub formulas: BTreeMap<String, String>,
    pub required: BTreeMap<String, bool>,
    pub period_kind: PeriodKind,
    pub company_field_id: String,
    pub currency_field_id: Option<String>,
    pub unit_field_id: Option<String>,
    pub fiscal: FiscalBinding,
}
#[derive(Clone, Debug)]
pub struct ExecutionDescriptor {
    pub member_orders: BTreeMap<String, Vec<String>>,
    pub member_labels: BTreeMap<String, BTreeMap<String, String>>,
    pub scope_members: Vec<DeclaredMember>,
    pub output_members: Vec<OutputMember>,
    pub policy: StatementPolicy,
    pub source_columns_by_row_id: BTreeMap<String, DatasetColumn>,
}
#[derive(Clone, Debug)]
pub struct EffectiveStatement {
    pub model: TableModel,
    pub execution: ExecutionDescriptor,
    pub unpivot: Option<UnpivotSpec>,
    pub section_field: String,
    pub section_by_line: BTreeMap<String, String>,
}
pub(crate) fn problem(code: &str, path: &str, message: &str) -> Diagnostic {
    Diagnostic {
        code: code.into(),
        message: message.into(),
        severity: Severity::Error,
        path: Some(path.into()),
        definition_id: None,
        dependency_id: None,
        key: None,
        member_keys: None,
        unmatched_count: None,
        truncated: None,
    }
}
pub(crate) fn key(s: &str) -> String {
    crate::pivot::pivot_value_key(&WireValue::String(s.into()))
}
pub(crate) fn prefix(i: &StatementIntent) -> String {
    format!("statement/{}/{}/", i.template.id, i.template.version)
}
pub(crate) fn fiscal_fields(b: &FiscalBinding) -> Vec<String> {
    [
        Some(&b.company_field_id),
        b.date_field_id.as_ref(),
        b.period_start_field_id.as_ref(),
        b.period_end_field_id.as_ref(),
        b.fiscal_year_field_id.as_ref(),
        b.fiscal_quarter_field_id.as_ref(),
    ]
    .into_iter()
    .flatten()
    .cloned()
    .collect()
}
