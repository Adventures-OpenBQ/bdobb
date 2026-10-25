// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Explicit owned-field traversal; additions to owned structs require updating this accounting.
use super::resources::{plain, HeapBytes};
macro_rules! struct_heap { ($t:ty; $($field:ident),* ) => { impl HeapBytes for $t { fn heap_bytes(&self)->usize { let Self {$($field),*}=self; 0usize$(.saturating_add($field.heap_bytes()))* } } }; }
impl HeapBytes for crate::contract::WireValue {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Missing => 0usize,
            Self::Null => 0usize,
            Self::Bool(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::String(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::F64(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::BigIntString(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Array(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Record(v0) => 0usize.saturating_add(v0.heap_bytes()),
        }
    }
}
impl HeapBytes for crate::contract::WireNumber {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Finite(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Special(v0) => 0usize.saturating_add(v0.heap_bytes()),
        }
    }
}
struct_heap!(crate::contract::WireDefinition; analytical_recipe_source,protocol_version,locale,definition);
struct_heap!(crate::contract::ValidatedDefinition; analytical_recipe_source,locale,definition);
struct_heap!(crate::contract::TableDefinition; table,search,analytical);
struct_heap!(crate::contract::TableState; pivot,sorting,column_filters,column_order,hidden,widths,pinned);
struct_heap!(crate::contract::Sort; id,desc);
struct_heap!(crate::contract::SourceFilter; id,value);
struct_heap!(crate::contract::PivotConfig; enabled,grouping,split,expanded,key_encoding,legacy_expanded,measures,aggregation_fns,buckets);
impl HeapBytes for crate::contract::Expanded {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::All(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Paths(v0) => 0usize.saturating_add(v0.heap_bytes()),
        }
    }
}
struct_heap!(crate::contract::Measure; id,source_field_id,aggregation,custom_label);
struct_heap!(crate::contract::TableModel; schema_version,enabled,params,categories,measures,formulas,layout,checklists,result_filters,subtotals,legacy_pivot);
struct_heap!(crate::contract::Category; id,name,source_field_id,transform,fiscal_binding,legacy_bucket);
struct_heap!(crate::contract::FiscalBinding; company_field_id,date_field_id,metadata_key,period_kind,period_start_field_id,period_end_field_id,fiscal_year_field_id,fiscal_quarter_field_id);
struct_heap!(crate::contract::Formula; id,name,scope,expression,ast,format);
impl HeapBytes for crate::contract::FormulaAst {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Literal { value } => 0usize.saturating_add(value.heap_bytes()),
            Self::Reference { target, id } => 0usize
                .saturating_add(target.heap_bytes())
                .saturating_add(id.heap_bytes()),
            Self::Unary { operator, operand } => 0usize
                .saturating_add(operator.heap_bytes())
                .saturating_add(operand.heap_bytes()),
            Self::Binary {
                operator,
                left,
                right,
            } => 0usize
                .saturating_add(operator.heap_bytes())
                .saturating_add(left.heap_bytes())
                .saturating_add(right.heap_bytes()),
            Self::Call { function, args } => 0usize
                .saturating_add(function.heap_bytes())
                .saturating_add(args.heap_bytes()),
            Self::Member { value, selectors } => 0usize
                .saturating_add(value.heap_bytes())
                .saturating_add(selectors.heap_bytes()),
        }
    }
}
impl HeapBytes for crate::contract::Literal {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Number(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::String(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Bool(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Null => 0usize,
        }
    }
}
struct_heap!(crate::contract::MemberSelector; category_id,member_key);
struct_heap!(crate::contract::MemberConstraint; category_id,member_keys);
struct_heap!(crate::contract::Layout; rows,columns,values,page);
struct_heap!(crate::contract::ResultFilter; id,category_id,target,predicate,value);
impl HeapBytes for crate::contract::ResultTarget {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Measure { id } => 0usize.saturating_add(id.heap_bytes()),
            Self::Formula { id } => 0usize.saturating_add(id.heap_bytes()),
        }
    }
}
struct_heap!(crate::contract::PivotParams; promote_page,filters);
struct_heap!(crate::contract::FilterParam; id,category_id,label,multi_select);
struct_heap!(crate::contract::Subtotals; grand_total,groups);
impl HeapBytes for crate::contract::RuntimeParam {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Viewer { member_keys } => 0usize.saturating_add(member_keys.heap_bytes()),
            Self::Group {
                group_id,
                transport_value,
            } => 0usize
                .saturating_add(group_id.heap_bytes())
                .saturating_add(transport_value.heap_bytes()),
        }
    }
}
struct_heap!(crate::contract::Revision; widget_id,input,model,output);
struct_heap!(crate::contract::Diagnostic; code,message,severity,path,definition_id,dependency_id,key,member_keys,unmatched_count,truncated);
struct_heap!(crate::contract::CellError; code,message,definition_id,dependency_ids,affected_record_count,record_preview);
struct_heap!(crate::contract::CellFormat; formatter_fn,decimal_places,abbreviate);
struct_heap!(crate::contract::GroupMember; field,value,category_id,source_binding_id,transform,member_key,label,bucket);
struct_heap!(crate::contract::DatasetRow; id,values,group_path,cell_errors,cell_formats);
struct_heap!(crate::contract::AnalyticalColumn; kind,definition_id,name,scope,transform,value_kind);
struct_heap!(crate::contract::DatasetColumn; id,label,dtype,format,source_field_id,measure_id,source_binding_id,split_path,aggregation,metadata,analytical);
struct_heap!(crate::contract::Completeness; kind,warnings,acquired_row_count,total_row_count,total_row_count_kind);
struct_heap!(crate::contract::Freshness; availability,stale,last_success_at,error,diagnostics);
struct_heap!(crate::contract::PresentationProvenance; scope,row_count,revision);
struct_heap!(crate::contract::Lineage; widget_id,result_revision,output_revision);
struct_heap!(crate::contract::Provenance; source_widget_id,source_kind,input_may_contain_aggregates,sample,lineage,presentation,receipt,parameters,metadata);
struct_heap!(crate::contract::ModelWarning; code,message,category_id,period_count,origin);
struct_heap!(crate::contract::SourceDataset; rows,columns,result_revision,output_revision,provenance,completeness,freshness,diagnostics,model_warnings,model_warning_count);
impl HeapBytes for crate::contract::SelectionSpec {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::None => 0usize,
            Self::Explicit { ids } => 0usize.saturating_add(ids.heap_bytes()),
            Self::AllMatching { excluded_ids } => 0usize.saturating_add(excluded_ids.heap_bytes()),
        }
    }
}
impl HeapBytes for crate::contract::SelectionAction {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Summary => 0usize,
            Self::All => 0usize,
            Self::Clear => 0usize,
            Self::Toggle { row_id } => 0usize.saturating_add(row_id.heap_bytes()),
        }
    }
}
struct_heap!(crate::contract::SelectionRowState; row_id,selectable,checked,indeterminate);
struct_heap!(crate::contract::SelectionSummary; selection,selected_count,eligible_count,checked,indeterminate,rows);
struct_heap!(crate::contract::ScopedValues; scope,values,empty,cell_errors,members);
struct_heap!(crate::contract::FacetMember; key,label,value,count);
struct_heap!(crate::contract::RowRequest; group_path,offset,limit);
struct_heap!(crate::contract::RowBlock; group_path,offset,rows,sibling_count,groups,selection);
struct_heap!(crate::contract::GroupSummary; row_id,path,child_count);
impl HeapBytes for crate::contract::ResultCount {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Exact { value } => 0usize.saturating_add(value.heap_bytes()),
            Self::Estimated { value } => 0usize.saturating_add(value.heap_bytes()),
            Self::Unknown => 0usize,
            Self::SnapshotExpired => 0usize,
        }
    }
}
struct_heap!(crate::contract::SubsetBatch; transfer_id,sequence,rows,final_batch,columns,provenance,freshness);
impl HeapBytes for crate::contract::AnalyticalDefinition {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Table(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Statement(v0) => 0usize.saturating_add(v0.heap_bytes()),
        }
    }
}
struct_heap!(crate::analytical::LogicalGroup; id,path,rows,children);
struct_heap!(crate::analytical::CalculatedView; diagnostics,top_level_count,model_warnings,model_warning_count,compiled,pool,record_ids,groups,rows,columns,totals,calculated_totals,eligible_rows,errors,warnings,complete,provenance,completeness,freshness,selection,selection_namespace);
struct_heap!(crate::analytical::CalculatedTotals; scope,formulas);
struct_heap!(crate::categories::CategoryMember; category_id,key,label,value,period,fiscal);
struct_heap!(crate::categories::CategoryMetadata; id,name,source_field_id,transform,recipe,bucket,periodicity);
struct_heap!(crate::categories::CategorizedRows; evaluated,members,categories,warnings);
struct_heap!(crate::fiscal::FiscalContext; companies,metadata,overrides);
struct_heap!(crate::fiscal::FiscalCompanyContext; year_end_month,calendar,source,periods);
struct_heap!(crate::fiscal::FiscalPeriod; kind,year,quarter,quarter_evidence,start,end,source);
struct_heap!(crate::fiscal::ResolvedFiscalPeriod; period,company_key,label,key,precision,start,end);
struct_heap!(crate::fiscal::FiscalPeriodResult; year,quarter);
struct_heap!(crate::fiscal::PeriodEvidence; company_key,start,end,source);
struct_heap!(crate::fiscal::ScopeWarning; code,message,category_id,periods);
struct_heap!(crate::scopes::TemporalContext; date_field_id,company_field_id,company_ids);
struct_heap!(crate::scopes::ContextSlice; categories,company_ids);
struct_heap!(crate::scopes::RequestedFiscalScope; category_id,dependent_category_ids,periods,errors);
struct_heap!(crate::scopes::DeclaredMember; selectors,formula_id);
struct_heap!(crate::scopes::CalculationScope; source_record_ids,category_constraints,context_slices,page,requested_fiscal_scope,field_constraints,temporal_context,declared_members);
struct_heap!(crate::scopes::MemberFacet; member,count);
impl HeapBytes for crate::scopes::Exclusion {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::ColumnFilter => 0usize,
            Self::Search => 0usize,
            Self::Checklist(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Error(v0) => 0usize.saturating_add(v0.heap_bytes()),
        }
    }
}
struct_heap!(crate::scopes::SourceConstraints; columns,filters,search,checklists);
struct_heap!(crate::scopes::EligiblePool; rows,universe,columns,members,categories,errors,formula_cells,source_dependencies,warnings,constraints,excluded_record_ids,exclusions,observed_members,eligible_members,page,classification_complete,qualification_errors,group_resolutions,param_matches,runtime_diagnostics,authoring_recipes,index);
// ponytail: the derived row index is not charged, so session budgets match the
// unindexed pool exactly; charge it here if index memory ever needs to count.
impl HeapBytes for std::sync::OnceLock<crate::scopes::PoolIndex> {
    fn heap_bytes(&self) -> usize {
        0
    }
}
struct_heap!(crate::scopes::GroupResolution; keys,unmatched,input_count,classification_complete,status,reason);
struct_heap!(crate::scopes::ParamMatch; key,matched_keys,matched,unmatched,matched_count,unmatched_count,excluded_count,total_count,classification_complete,truncated,source,group_id,input_count,status,reason);
struct_heap!(crate::statement::StatementIntent; schema_version,kind,template,bindings,overrides,period_kind,page,checklists,result_filters);
struct_heap!(crate::statement::StatementTemplate; schema_version,id,version,sections,lines);
struct_heap!(crate::statement::StatementSection; id,label,line_ids);
struct_heap!(crate::statement::StatementLine; id,label,required,policy,formula,format,unit);
struct_heap!(crate::statement::StatementBindings; shape,company_field_id,period_kind_field_id,currency_field_id,unit_field_id,fiscal,mappings,long_fields);
struct_heap!(crate::statement::LongFields; item_field_id,value_field_id);
struct_heap!(crate::statement::Mapping; source_field_id,line_id);
struct_heap!(crate::statement::UnpivotSpec; id,carry_field_ids,mappings,item_field_id,value_field_id);
struct_heap!(crate::statement::StatementOverrides; labels,section_order,line_order,hidden_ids,formulas);
struct_heap!(crate::statement::OutputMember; selectors,formula_id,require_observed,format);
struct_heap!(crate::statement::StatementPolicy; category_id,dependent_category_ids,measure_id,value_field_id,members,formulas,required,period_kind,company_field_id,currency_field_id,unit_field_id,fiscal);
struct_heap!(crate::statement::ExecutionDescriptor; member_orders,member_labels,scope_members,output_members,policy,source_columns_by_row_id);
struct_heap!(crate::statement::EffectiveStatement; model,execution,unpivot,section_field,section_by_line);
struct_heap!(crate::formulas::FormulaDiagnostic; code,message,position,definition_id,dependency_ids,candidate_ids);
struct_heap!(crate::formulas::ModelError; record_ids_present,dependency_ids_present,code,message,definition_id,record_ids,dependency_ids);
impl HeapBytes for crate::formulas::CellResult {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Value(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Error(v0) => 0usize.saturating_add(v0.heap_bytes()),
        }
    }
}
struct_heap!(crate::formulas::FormulaDraft; id,name,scope,expression,format);
struct_heap!(crate::formulas::ScopedBinding; scope,name,reference);
struct_heap!(crate::formulas::FormulaDependency; kind,id,category_id);
struct_heap!(crate::formulas::FormulaBindResult; ast,diagnostics,dependencies,resolved_operators);
impl HeapBytes for crate::formulas::SyntaxSelector {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Bound(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Named {
                category_name,
                value,
            } => 0usize
                .saturating_add(category_name.heap_bytes())
                .saturating_add(value.heap_bytes()),
        }
    }
}
impl HeapBytes for crate::formulas::SyntaxAst {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Literal { value } => 0usize.saturating_add(value.heap_bytes()),
            Self::Name { name } => 0usize.saturating_add(name.heap_bytes()),
            Self::Reference { target, id } => 0usize
                .saturating_add(target.heap_bytes())
                .saturating_add(id.heap_bytes()),
            Self::Unary { operator, operand } => 0usize
                .saturating_add(operator.heap_bytes())
                .saturating_add(operand.heap_bytes()),
            Self::Binary {
                operator,
                left,
                right,
            } => 0usize
                .saturating_add(operator.heap_bytes())
                .saturating_add(left.heap_bytes())
                .saturating_add(right.heap_bytes()),
            Self::Call { function, args } => 0usize
                .saturating_add(function.heap_bytes())
                .saturating_add(args.heap_bytes()),
            Self::Member { value, selectors } => 0usize
                .saturating_add(value.heap_bytes())
                .saturating_add(selectors.heap_bytes()),
        }
    }
}
struct_heap!(crate::formulas::ParseResult; ast,diagnostics);
struct_heap!(crate::formulas::GraphEntry; raw,value,diagnostics);
struct_heap!(crate::formulas::FormulaGraph; entries,order,blocked_ids,diagnostics);
struct_heap!(crate::formulas::FieldSymbol; id,name);
struct_heap!(crate::formulas::MeasureSymbol; value,name,aliases);
struct_heap!(crate::formulas::CategorySymbol; value,members);
struct_heap!(crate::formulas::ModelSymbols; fields,formulas,measures,categories);
struct_heap!(crate::formulas::CompiledModel; fiscal_context,execution,definition,columns,graph,symbols,categories);
struct_heap!(crate::formulas::EvaluatedRows; rows,columns,formula_cells,source_dependencies,errors);
struct_heap!(crate::formulas::aggregate::FormulaMetadata; source_columns,scopes,value_kind,format,statement_record_ids);
struct_heap!(crate::formulas::aggregate::FormulaValues; cells,metadata,measure_cells,measure_metadata,scope_errors,warnings,empty);
struct_heap!(crate::session::CoreRequest; request_id,revision,operation);
impl HeapBytes for crate::session::Operation {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::RegisterInput {
                input,
                input_revision,
            } => 0usize
                .saturating_add(input.heap_bytes())
                .saturating_add(input_revision.heap_bytes()),
            Self::ImportFile {
                name,
                bytes,
                input_revision,
            } => 0usize
                .saturating_add(name.heap_bytes())
                .saturating_add(bytes.heap_bytes())
                .saturating_add(input_revision.heap_bytes()),
            Self::ApplyModel {
                definition,
                selection,
                reconcile_missing,
                previous_selection_namespace,
                proven_absent_ids,
                runtime_params,
            } => 0usize
                .saturating_add(definition.heap_bytes())
                .saturating_add(selection.heap_bytes())
                .saturating_add(reconcile_missing.heap_bytes())
                .saturating_add(previous_selection_namespace.heap_bytes())
                .saturating_add(proven_absent_ids.heap_bytes())
                .saturating_add(runtime_params.heap_bytes()),
            Self::InputSchema => 0usize,
            Self::PreviewDefinition(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::BindFormula {
                definition,
                draft,
                bindings,
            } => 0usize
                .saturating_add(definition.heap_bytes())
                .saturating_add(draft.heap_bytes())
                .saturating_add(bindings.heap_bytes()),
            Self::MemberDomain {
                definition,
                category_id,
                category_recipe,
                offset,
                limit,
                search,
            } => 0usize
                .saturating_add(definition.heap_bytes())
                .saturating_add(category_id.heap_bytes())
                .saturating_add(category_recipe.heap_bytes())
                .saturating_add(offset.heap_bytes())
                .saturating_add(limit.heap_bytes())
                .saturating_add(search.heap_bytes()),
            Self::ColumnProfile {
                definition,
                scope,
                offset,
                limit,
                fields,
            } => 0usize
                .saturating_add(definition.heap_bytes())
                .saturating_add(scope.heap_bytes())
                .saturating_add(offset.heap_bytes())
                .saturating_add(limit.heap_bytes())
                .saturating_add(fields.heap_bytes()),
            Self::IdentityWitness { path, ids } => 0usize
                .saturating_add(path.heap_bytes())
                .saturating_add(ids.heap_bytes()),
            Self::Selection {
                action,
                visible_ids,
            } => 0usize
                .saturating_add(action.heap_bytes())
                .saturating_add(visible_ids.heap_bytes()),
            Self::Rows(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Facets { category_id } => 0usize.saturating_add(category_id.heap_bytes()),
            Self::Inspect(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Totals => 0usize,
            Self::ChartData { fields } => 0usize.saturating_add(fields.heap_bytes()),
            Self::Presented {
                transfer_id,
                ignore_selection,
            } => 0usize
                .saturating_add(transfer_id.heap_bytes())
                .saturating_add(ignore_selection.heap_bytes()),
            Self::NextSubset {
                transfer_id,
                sequence,
            } => 0usize
                .saturating_add(transfer_id.heap_bytes())
                .saturating_add(sequence.heap_bytes()),
            Self::Cancel { target_request_id } => {
                0usize.saturating_add(target_request_id.heap_bytes())
            }
            Self::Dispose => 0usize,
        }
    }
}
struct_heap!(crate::session::CoreResponse; request_id,revision,completeness,diagnostics,model_warnings,model_warning_count,result);
impl HeapBytes for crate::session::Response {
    fn heap_bytes(&self) -> usize {
        match self {
            Self::Registered => 0usize,
            Self::InputSchema(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::ViewReady(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Rows(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Totals(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Facets {
                category_id,
                values,
            } => 0usize
                .saturating_add(category_id.heap_bytes())
                .saturating_add(values.heap_bytes()),
            Self::Selection(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::ChartData(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Subset(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::PreviewDefinition(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::BindFormula(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::MemberDomain(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::ColumnProfile(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Inspect(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::IdentityWitness(v0) => 0usize.saturating_add(v0.heap_bytes()),
            Self::Cancelled => 0usize,
            Self::Disposed => 0usize,
            Self::Error(v0) => 0usize.saturating_add(v0.heap_bytes()),
        }
    }
}
struct_heap!(crate::session::ViewReady; columns,chart_columns,top_level_count,selection,selection_namespace,inspection);
struct_heap!(crate::session::ReadyInspection; input_columns,input_periodicity,definition,aggregations,counts,param_matches);
struct_heap!(crate::session::DefinitionPreview; completeness,diagnostics,columns,rows,total);
struct_heap!(crate::session::BindingResult; ast,binding_diagnostics,diagnostic_count,truncated,resolved_operators,authoring_warnings,authoring_warning_count,authoring_warnings_truncated);
struct_heap!(crate::session::ObservedMember; key,label,label_truncated,value,observed_count,eligible_count);
struct_heap!(crate::session::MemberDomainResult; category_id,category_recipe,offset,limit,search,rows,total,next_offset,truncated,scanned,omitted_count,classification_complete,category_error_count,authoring_warnings,authoring_warning_count,authoring_warnings_truncated);
struct_heap!(crate::session::ColumnProfile; id,kind,count,missing,distinct,distinct_capped,min,max,samples,periodicity,cell_errors);
struct_heap!(crate::session::ColumnProfileResult; scope,offset,limit,fields,total,rows_profiled,next_offset,filters_active,filtered_rows);
struct_heap!(crate::session::IdentityWitness; id,state);
struct_heap!(crate::session::InspectionRequest; collection,offset,limit,definition_id,param_key,category_id,category_recipe,group_evidence);
struct_heap!(crate::session::InspectionCounts; definitions,warnings,period_bounds);
impl HeapBytes for crate::session::InspectionRow {
    fn heap_bytes(&self) -> usize {
        match self {
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
            } => 0usize
                .saturating_add(kind.heap_bytes())
                .saturating_add(id.heap_bytes())
                .saturating_add(name.heap_bytes())
                .saturating_add(reference_ids.heap_bytes())
                .saturating_add(reference_count.heap_bytes())
                .saturating_add(truncated_references.heap_bytes())
                .saturating_add(resolved_operators.heap_bytes())
                .saturating_add(scope.heap_bytes())
                .saturating_add(source_filter_kind.heap_bytes()),
            Self::Warning {
                id,
                code,
                message,
                category_id,
                period_count,
            } => 0usize
                .saturating_add(id.heap_bytes())
                .saturating_add(code.heap_bytes())
                .saturating_add(message.heap_bytes())
                .saturating_add(category_id.heap_bytes())
                .saturating_add(period_count.heap_bytes()),
            Self::PeriodBounds {
                warning_id,
                category_id,
                company_key,
                start,
                end,
                source,
                period,
                context,
            } => 0usize
                .saturating_add(warning_id.heap_bytes())
                .saturating_add(category_id.heap_bytes())
                .saturating_add(company_key.heap_bytes())
                .saturating_add(start.heap_bytes())
                .saturating_add(end.heap_bytes())
                .saturating_add(source.heap_bytes())
                .saturating_add(period.heap_bytes())
                .saturating_add(context.heap_bytes()),
            Self::GroupMember {
                key,
                label,
                transport,
                label_truncated,
                observed_count,
                eligible_count,
                matched,
            } => 0usize
                .saturating_add(key.heap_bytes())
                .saturating_add(label.heap_bytes())
                .saturating_add(transport.heap_bytes())
                .saturating_add(label_truncated.heap_bytes())
                .saturating_add(observed_count.heap_bytes())
                .saturating_add(eligible_count.heap_bytes())
                .saturating_add(matched.heap_bytes()),
        }
    }
}
struct_heap!(crate::session::InspectionPage; request,rows,total,next_offset,truncated,domain);
struct_heap!(crate::session::GroupDomainSummary; classification_complete,category_error_count,omitted_count,scanned,status,reason,input_count,matched_key_count,unmatched,unmatched_count);

impl HeapBytes for crate::pivot::Periodicity {
    fn heap_bytes(&self) -> usize {
        0
    }
}

struct_heap!(super::StoredView; saved,revision,analytical,rows,groups,eligible,columns,chart_columns,namespace,identity_ids,hierarchy,selection,completeness,diagnostics,totals,facets,provenance,freshness,input_columns,input_periodicity);
struct_heap!(super::Transfer; request_id,revision,sequence,offset,ignore_selection);
struct_heap!(super::ResourceLimits; input_bytes,max_input_bytes,max_rows,max_pivot_columns,max_batch_bytes,max_cached_block_bytes,max_concurrent_transfers,max_state_bytes,cache_bytes,export_bytes);
// Data-less enums own no heap.
use crate::contract as c;
plain!(
    c::SpecialNumber,
    c::PinSide,
    c::KeyEncoding,
    c::Aggregation,
    c::Bucket,
    c::Transform,
    c::LegacyBucket,
    c::PeriodKind,
    c::FormulaScope,
    c::ReferenceTarget,
    c::UnaryOperator,
    c::BinaryOperator,
    c::FormulaFunction,
    c::Predicate,
    c::Severity,
    c::AnalyticalKind,
    c::ValueKind,
    c::CompletenessKind,
    c::CountKind,
    c::Availability,
    c::PresentedScope,
    c::Scope,
    crate::statement::LinePolicy,
    crate::statement::StatementShape,
    crate::session::WitnessState,
    crate::session::InspectionCollection,
    crate::session::ProfileScope
);
