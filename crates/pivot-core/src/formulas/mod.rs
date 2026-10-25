// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Bound formula compilation and source evaluation. Category derivation and aggregate
//! evaluation consume this typed stage in subsequent modules.
pub mod aggregate;
mod binding;
mod graph;
mod source;
pub(crate) use source::literal;
mod syntax;
use crate::contract::*;
pub use binding::bind_formula;
pub use source::{evaluate_expression, evaluate_source};
use std::collections::BTreeMap;
pub(crate) use syntax::ecmascript_whitespace;
pub use syntax::{parse_formula, validate_ast};
pub type Column = DatasetColumn;
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaDiagnostic {
    pub code: String,
    pub message: String,
    /// UTF-16 position, matching browser parser diagnostics.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dependency_ids: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub candidate_ids: Vec<String>,
}
impl FormulaDiagnostic {
    pub(crate) fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            position: None,
            definition_id: None,
            dependency_ids: vec![],
            candidate_ids: vec![],
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct ModelError {
    /// Presence of optional baseline error evidence is distinct from an empty list.
    pub record_ids_present: bool,
    pub dependency_ids_present: bool,
    pub code: String,
    pub message: String,
    pub definition_id: String,
    pub record_ids: Vec<String>,
    pub dependency_ids: Vec<String>,
}
#[derive(Clone, Debug, PartialEq)]
pub enum CellResult {
    Value(WireValue),
    Error(ModelError),
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormulaDraft {
    pub id: String,
    pub name: String,
    pub scope: FormulaScope,
    pub expression: String,
    pub format: Option<String>,
}
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScopedBinding {
    pub scope: FormulaScope,
    pub name: String,
    pub reference: FormulaAst,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FormulaDependency {
    pub kind: String,
    pub id: String,
    pub category_id: Option<String>,
}
#[derive(Clone, Debug)]
pub struct FormulaBindResult {
    pub ast: Option<FormulaAst>,
    pub diagnostics: Vec<FormulaDiagnostic>,
    pub dependencies: Vec<FormulaDependency>,
    pub resolved_operators: Vec<Aggregation>,
}
#[derive(Clone, Debug)]
pub enum SyntaxSelector {
    Bound(MemberSelector),
    Named {
        category_name: String,
        value: Literal,
    },
}
#[derive(Clone, Debug)]
pub enum SyntaxAst {
    Literal {
        value: Literal,
    },
    Name {
        name: String,
    },
    Reference {
        target: ReferenceTarget,
        id: String,
    },
    Unary {
        operator: UnaryOperator,
        operand: Box<SyntaxAst>,
    },
    Binary {
        operator: BinaryOperator,
        left: Box<SyntaxAst>,
        right: Box<SyntaxAst>,
    },
    Call {
        function: FormulaFunction,
        args: Vec<SyntaxAst>,
    },
    Member {
        value: Box<SyntaxAst>,
        selectors: Vec<SyntaxSelector>,
    },
}
#[derive(Clone, Debug)]
pub struct ParseResult {
    pub ast: Option<SyntaxAst>,
    pub diagnostics: Vec<FormulaDiagnostic>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphNode {
    pub kind: String,
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug)]
pub struct GraphEntry {
    pub raw: Formula,
    pub value: Option<Formula>,
    pub diagnostics: Vec<FormulaDiagnostic>,
}
#[derive(Clone, Debug, Default)]
pub struct FormulaGraph {
    pub entries: Vec<GraphEntry>,
    pub order: Vec<String>,
    pub blocked_ids: Vec<String>,
    pub diagnostics: Vec<FormulaDiagnostic>,
}
#[derive(Clone, Debug)]
pub struct FieldSymbol {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug)]
pub struct MeasureSymbol {
    pub value: Measure,
    pub name: String,
    pub aliases: Vec<String>,
}
#[derive(Clone, Debug)]
pub struct CategorySymbol {
    pub value: Category,
    pub members: Vec<(String, Literal)>,
}
#[derive(Clone, Debug, Default)]
pub struct ModelSymbols {
    pub fields: Vec<FieldSymbol>,
    pub formulas: Vec<FormulaDraft>,
    pub measures: Vec<MeasureSymbol>,
    pub categories: Vec<CategorySymbol>,
}
#[derive(Clone, Debug)]
pub struct CompiledModel {
    pub fiscal_context: Option<crate::fiscal::FiscalContext>,
    pub execution: Option<crate::statement::ExecutionDescriptor>,
    pub definition: ValidatedDefinition,
    pub columns: Vec<Column>,
    pub graph: FormulaGraph,
    pub symbols: ModelSymbols,
    pub categories: Vec<Category>,
}
#[derive(Clone, Debug)]
pub struct EvaluatedRows {
    pub rows: Vec<DatasetRow>,
    pub columns: Vec<Column>,
    pub formula_cells: BTreeMap<String, BTreeMap<String, CellResult>>,
    pub source_dependencies: BTreeMap<String, BTreeMap<String, Vec<String>>>,
    pub errors: BTreeMap<String, BTreeMap<String, ModelError>>,
}
/// Committed definitions use their bound ASTs; display expression text is never reparsed.
pub fn compile(definition: &ValidatedDefinition, columns: &[Column]) -> CompiledModel {
    let model = definition
        .definition
        .analytical
        .as_ref()
        .and_then(AnalyticalDefinition::table);
    let formulas = model.map(|m| m.formulas.as_slice()).unwrap_or(&[]);
    let categories = model.map(|m| m.categories.clone()).unwrap_or_default();
    let measures = model.map(|m| m.measures.as_slice()).unwrap_or(&[]);
    let symbols = ModelSymbols {
        fields: columns
            .iter()
            .map(|c| FieldSymbol {
                id: c.id.clone(),
                name: c.label.clone(),
            })
            .collect(),
        formulas: formulas
            .iter()
            .map(|f| FormulaDraft {
                id: f.id.clone(),
                name: f.name.clone(),
                scope: f.scope,
                expression: f.expression.clone(),
                format: f.format.clone(),
            })
            .collect(),
        measures: measures
            .iter()
            .map(|m| {
                let base = columns
                    .iter()
                    .find(|c| c.id == m.source_field_id)
                    .map(|c| c.label.clone())
                    .or_else(|| {
                        formulas
                            .iter()
                            .find(|f| f.id == m.source_field_id)
                            .map(|f| f.name.clone())
                    })
                    .unwrap_or(m.source_field_id.clone());
                let name = m.custom_label.clone().unwrap_or_else(|| {
                    let label = m
                        .aggregation
                        .map(|op| format!("{} — {}", base, aggregation_name(op)))
                        .unwrap_or_else(|| base.clone());
                    let index = measures
                        .iter()
                        .filter(|other| {
                            other.custom_label.is_none()
                                && other.source_field_id == m.source_field_id
                                && other.aggregation == m.aggregation
                        })
                        .position(|other| other.id == m.id)
                        .unwrap_or(0);
                    if index > 0 {
                        format!("{} ({})", label, index + 1)
                    } else {
                        label
                    }
                });
                let mut aliases = vec![base];
                if let Some(label) = &m.custom_label {
                    aliases.push(label.clone());
                }
                MeasureSymbol {
                    value: m.clone(),
                    name,
                    aliases,
                }
            })
            .collect(),
        categories: categories
            .iter()
            .map(|c| CategorySymbol {
                value: c.clone(),
                members: vec![],
            })
            .collect(),
    };
    let graph = graph::compile_graph(formulas, &symbols);
    CompiledModel {
        fiscal_context: None,
        execution: None,
        definition: definition.clone(),
        columns: columns.to_vec(),
        graph,
        symbols,
        categories,
    }
}
pub(crate) fn aggregation_name(op: Aggregation) -> &'static str {
    match op {
        Aggregation::Sum => "Total",
        Aggregation::Min => "Min",
        Aggregation::Max => "Max",
        Aggregation::Mean => "Average",
        Aggregation::Median => "Median",
        Aggregation::Count => "Count",
        Aggregation::UniqueCount => "Unique Count",
        Aggregation::First => "First",
        Aggregation::Last => "Last",
    }
}
pub(crate) fn function_aggregation(function: FormulaFunction) -> Option<Aggregation> {
    Some(match function {
        FormulaFunction::Sum => Aggregation::Sum,
        FormulaFunction::Min => Aggregation::Min,
        FormulaFunction::Max => Aggregation::Max,
        FormulaFunction::Mean => Aggregation::Mean,
        FormulaFunction::Median => Aggregation::Median,
        FormulaFunction::Count => Aggregation::Count,
        FormulaFunction::UniqueCount => Aggregation::UniqueCount,
        FormulaFunction::First => Aggregation::First,
        FormulaFunction::Last => Aggregation::Last,
        FormulaFunction::If => return None,
    })
}

/// Compile with explicit acquired fiscal metadata; callers validate raw metadata first.
pub fn compile_with_fiscal(
    definition: &ValidatedDefinition,
    columns: &[Column],
    context: crate::fiscal::FiscalContext,
) -> CompiledModel {
    let mut model = compile(definition, columns);
    model.fiscal_context = Some(context);
    model
}
