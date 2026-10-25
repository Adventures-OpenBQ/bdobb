// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    contract::*,
    formulas::{FormulaDraft, ScopedBinding},
};
use serde::Serialize;
#[derive(Clone, Debug)]
pub struct CoreRequest {
    pub request_id: String,
    pub revision: Revision,
    pub operation: Operation,
}
#[derive(Clone, Debug)]
pub enum Operation {
    RegisterInput {
        input: SourceDataset,
        input_revision: u64,
    },
    ImportFile {
        name: String,
        bytes: Vec<u8>,
        input_revision: u64,
    },
    ApplyModel {
        definition: ValidatedDefinition,
        selection: SelectionSpec,
        reconcile_missing: bool,
        previous_selection_namespace: Option<String>,
        proven_absent_ids: Vec<String>,
        runtime_params: RuntimeParams,
    },
    InputSchema,
    PreviewDefinition(ValidatedDefinition),
    BindFormula {
        definition: ValidatedDefinition,
        draft: FormulaDraft,
        bindings: Vec<ScopedBinding>,
    },
    MemberDomain {
        definition: ValidatedDefinition,
        category_id: String,
        category_recipe: String,
        offset: u64,
        limit: u32,
        search: Option<String>,
    },
    IdentityWitness {
        path: Vec<ValidatedDefinition>,
        ids: Vec<String>,
    },
    Selection {
        action: SelectionAction,
        visible_ids: Vec<String>,
    },
    Rows(RowRequest),
    Facets {
        category_id: String,
    },
    Inspect(InspectionRequest),
    Totals,
    ChartData {
        fields: Vec<String>,
    },
    Presented {
        transfer_id: String,
        ignore_selection: bool,
    },
    NextSubset {
        transfer_id: String,
        sequence: u64,
    },
    Cancel {
        target_request_id: String,
    },
    Dispose,
}
#[derive(Clone, Debug)]
pub struct CoreResponse {
    pub request_id: String,
    pub revision: Revision,
    pub completeness: Completeness,
    pub diagnostics: Vec<Diagnostic>,
    pub model_warnings: Option<Vec<ModelWarning>>,
    pub model_warning_count: Option<u64>,
    pub result: Response,
}
#[derive(Clone, Debug)]
pub enum Response {
    Registered,
    InputSchema(Vec<DatasetColumn>),
    ViewReady(ViewReady),
    Rows(RowBlock),
    Totals(ScopedValues),
    Facets {
        category_id: String,
        values: ScopedValues,
    },
    Selection(SelectionSummary),
    ChartData(SourceDataset),
    Subset(SubsetBatch),
    PreviewDefinition(DefinitionPreview),
    BindFormula(BindingResult),
    MemberDomain(MemberDomainResult),
    Inspect(InspectionPage),
    IdentityWitness(Vec<IdentityWitness>),
    Cancelled,
    Disposed,
    Error(Diagnostic),
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewReady {
    pub columns: Vec<DatasetColumn>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_columns: Option<Vec<DatasetColumn>>,
    pub top_level_count: ResultCount,
    pub selection: SelectionSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_namespace: Option<String>,
    pub inspection: ReadyInspection,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyInspection {
    pub input_columns: Vec<DatasetColumn>,
    pub input_periodicity: std::collections::BTreeMap<String, String>,
    pub definition: TableDefinition,
    pub aggregations: std::collections::BTreeMap<String, Aggregation>,
    pub counts: InspectionCounts,
    pub param_matches: Vec<crate::scopes::ParamMatch>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionPreview {
    #[serde(skip)]
    pub(crate) completeness: Completeness,
    #[serde(skip)]
    pub(crate) diagnostics: Vec<Diagnostic>,
    pub columns: Vec<DatasetColumn>,
    pub rows: Vec<DatasetRow>,
    pub total: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ast: Option<FormulaAst>,
    pub binding_diagnostics: Vec<crate::formulas::FormulaDiagnostic>,
    pub diagnostic_count: u64,
    pub truncated: bool,
    pub resolved_operators: Vec<Aggregation>,
    pub authoring_warnings: Vec<Diagnostic>,
    pub authoring_warning_count: u64,
    pub authoring_warnings_truncated: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedMember {
    pub key: String,
    pub label: String,
    pub label_truncated: bool,
    pub value: WireValue,
    pub observed_count: u64,
    pub eligible_count: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDomainResult {
    pub category_id: String,
    pub category_recipe: String,
    pub offset: u64,
    pub limit: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    pub rows: Vec<ObservedMember>,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<u64>,
    pub truncated: bool,
    pub scanned: u64,
    pub omitted_count: u64,
    pub classification_complete: bool,
    pub category_error_count: u64,
    pub authoring_warnings: Vec<Diagnostic>,
    pub authoring_warning_count: u64,
    pub authoring_warnings_truncated: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityWitness {
    pub id: String,
    pub state: WitnessState,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WitnessState {
    Present,
    Absent,
    Unknown,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InspectionCollection {
    Definitions,
    Warnings,
    PeriodBounds,
    GroupDomain,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionRequest {
    pub collection: InspectionCollection,
    pub offset: u64,
    pub limit: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub param_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_recipe: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_evidence: Option<(String, String)>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionCounts {
    pub definitions: u64,
    pub warnings: u64,
    pub period_bounds: u64,
}
#[derive(Clone, Debug)]
pub enum InspectionRow {
    Definition {
        kind: String,
        id: String,
        name: String,
        reference_ids: Vec<String>,
        reference_count: u64,
        truncated_references: bool,
        resolved_operators: Vec<Aggregation>,
        scope: Option<FormulaScope>,
        source_filter_kind: Option<String>,
    },
    Warning {
        id: String,
        code: String,
        message: String,
        category_id: Option<String>,
        period_count: u64,
    },
    PeriodBounds {
        warning_id: String,
        category_id: Option<String>,
        company_key: String,
        start: String,
        end: String,
        source: String,
        period: String,
        context: String,
    },
    GroupMember {
        key: String,
        label: String,
        transport: String,
        label_truncated: bool,
        observed_count: u64,
        eligible_count: u64,
        matched: bool,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionPage {
    #[serde(flatten)]
    pub request: InspectionRequest,
    pub rows: Vec<InspectionRow>,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<u64>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<GroupDomainSummary>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDomainSummary {
    pub classification_complete: bool,
    pub category_error_count: u64,
    pub omitted_count: u64,
    pub scanned: u64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub input_count: u64,
    pub matched_key_count: u64,
    pub unmatched: Vec<String>,
    pub unmatched_count: u64,
}
impl Serialize for InspectionRow {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde_json::json;
        let value = match self {
            Self::Definition {
                kind,
                id,
                name,
                reference_ids,
                reference_count,
                truncated_references,
                resolved_operators,
                scope,
                source_filter_kind,
            } => {
                let mut v = json!({"kind":kind,"id":id,"name":name,"referenceIds":reference_ids,"referenceCount":reference_count,"truncatedReferences":truncated_references,"resolvedOperators":resolved_operators});
                if let Some(s) = scope {
                    v["scope"] = json!(s)
                }
                if let Some(s) = source_filter_kind {
                    v["sourceFilterKind"] = json!(s)
                }
                v
            }
            Self::Warning {
                id,
                code,
                message,
                category_id,
                period_count,
            } => {
                let mut v = json!({"kind":"warning","id":id,"code":code,"message":message,"periodCount":period_count});
                if let Some(c) = category_id {
                    v["categoryId"] = json!(c)
                }
                v
            }
            Self::PeriodBounds {
                warning_id,
                category_id,
                company_key,
                start,
                end,
                source,
                period,
                context,
            } => {
                let mut v = json!({"kind":"periodBounds","warningId":warning_id,"companyKey":company_key,"start":start,"end":end,"source":source,"period":period,"context":context});
                if let Some(c) = category_id {
                    v["categoryId"] = json!(c)
                }
                v
            }
            Self::GroupMember {
                key,
                label,
                transport,
                label_truncated,
                observed_count,
                eligible_count,
                matched,
            } => {
                json!({"kind":"groupMember","key":key,"label":label,"transport":transport,"labelTruncated":label_truncated,"observedCount":observed_count,"eligibleCount":eligible_count,"matched":matched})
            }
        };
        value.serialize(serializer)
    }
}
