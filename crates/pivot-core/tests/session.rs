// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{contract::*, session::*};
use support::*;
fn revision(model: u64) -> Revision {
    Revision {
        widget_id: "oracle".into(),
        input: 1,
        model,
        output: model,
    }
}
fn call(s: &mut Session, model: u64, operation: Operation) -> Response {
    s.dispatch(
        CoreRequest {
            request_id: "q".into(),
            revision: revision(model),
            operation,
        },
        &Host,
    )
    .result
}
fn session(name: &str) -> (Session, ValidatedDefinition, RuntimeParams) {
    let (_, input, d, runtime) = fixture(name);
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    (s, d, runtime)
}
fn apply(s: &mut Session, d: ValidatedDefinition, runtime: RuntimeParams, model: u64) -> Response {
    call(
        s,
        model,
        Operation::ApplyModel {
            definition: d,
            selection: SelectionSpec::None,
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: runtime,
        },
    )
}
#[test]
fn failed_candidate_preserves_active_schema_and_refuses_failed_revision() {
    let (mut s, d, runtime) = session("ratio-source-scope");
    assert!(matches!(
        apply(&mut s, d.clone(), runtime.clone(), 1),
        Response::ViewReady(_)
    ));
    let mut invalid = d;
    invalid
        .definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .schema_version = 99;
    assert!(matches!(
        apply(&mut s, invalid, runtime, 2),
        Response::Error(_)
    ));
    assert!(matches!(
        call(
            &mut s,
            2,
            Operation::Rows(RowRequest {
                group_path: vec![],
                offset: 0,
                limit: 1
            })
        ),
        Response::Error(_)
    ));
    let Response::Rows(block) = call(
        &mut s,
        1,
        Operation::Rows(RowRequest {
            group_path: vec![],
            offset: 0,
            limit: 1,
        }),
    ) else {
        panic!("old active result must remain usable")
    };
    assert_eq!(block.rows.len(), 1);
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
}
#[test]
fn reversed_bounded_blocks_preserve_frozen_rows_and_counts() {
    let (root, _, _, _) = fixture("ratio-source-scope");
    let (mut s, d, runtime) = session("ratio-source-scope");
    apply(&mut s, d, runtime, 1);
    let expected = arr(get(get(get(&root, "result"), "chart"), "rows"));
    for offset in (0..expected.len()).rev() {
        let Response::Rows(block) = call(
            &mut s,
            1,
            Operation::Rows(RowRequest {
                group_path: vec![],
                offset: offset as u64,
                limit: 1,
            }),
        ) else {
            panic!("rows")
        };
        assert_eq!(block.rows[0].id, text(get(&expected[offset], "id")));
        assert_values(
            &block.rows[0].values,
            get(&expected[offset], "values"),
            "row block",
        );
    }
}
#[test]
fn pull_transfers_reject_out_of_order_and_disposal_cannot_be_reused() {
    let (mut s, d, runtime) = session("ratio-source-scope");
    s.set_batch_rows(1).unwrap();
    apply(&mut s, d, runtime, 1);
    let Response::Subset(first) = call(
        &mut s,
        1,
        Operation::Presented {
            transfer_id: "t".into(),
            ignore_selection: false,
        },
    ) else {
        panic!("subset")
    };
    assert_eq!(first.sequence, 0);
    assert_eq!(first.rows.len(), 1);
    assert!(!first.final_batch);
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::NextSubset {
                transfer_id: "t".into(),
                sequence: 2
            }
        ),
        Response::Error(_)
    ));
    let Response::Subset(second) = call(
        &mut s,
        1,
        Operation::NextSubset {
            transfer_id: "t".into(),
            sequence: 1,
        },
    ) else {
        panic!("next")
    };
    assert_eq!(second.sequence, 1);
    call(&mut s, 1, Operation::Dispose);
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Error(_)
    ));
    let (_, input, _, _) = fixture("ratio-source-scope");
    assert!(s.register(input, 1).is_err());
}
fn inspection(collection: InspectionCollection) -> InspectionRequest {
    InspectionRequest {
        collection,
        offset: 0,
        limit: 100,
        definition_id: None,
        param_key: None,
        category_id: None,
        category_recipe: None,
        group_evidence: None,
    }
}
#[test]
fn native_authoring_domains_binding_and_inspection_match_frozen_trace() {
    let (root, input, d, _) = fixture("runtime-authoring-linked");
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    let ops = arr(get(get(&root, "case"), "operations"));
    let _ = ops;
    let recipe = "[\"regionCategory\",\"region\",\"native\",null,null,null]";
    let Response::MemberDomain(domain) = call(
        &mut s,
        1,
        Operation::MemberDomain {
            definition: d.clone(),
            category_id: "regionCategory".into(),
            category_recipe: recipe.into(),
            offset: 0,
            limit: 50,
            search: None,
        },
    ) else {
        panic!("member domain")
    };
    assert_eq!(domain.rows.len(), 2);
    assert_eq!(domain.rows[0].label, "A");
    assert_eq!(domain.rows[0].observed_count, 2);
    assert_eq!(domain.rows[1].eligible_count, 1);
    let Response::BindFormula(binding) = call(
        &mut s,
        1,
        Operation::BindFormula {
            definition: d.clone(),
            draft: pivot_core::formulas::FormulaDraft {
                id: "new".into(),
                name: "New".into(),
                scope: FormulaScope::Aggregate,
                expression: "SUM(Revenue)".into(),
                format: None,
            },
            bindings: vec![],
        },
    ) else {
        panic!("bind")
    };
    assert!(
        binding.binding_diagnostics.is_empty(),
        "{:?}",
        binding.binding_diagnostics
    );
    assert_eq!(binding.resolved_operators, vec![Aggregation::Sum]);
    apply(&mut s, d, RuntimeParams::new(), 1);
    let Response::Inspect(page) = call(
        &mut s,
        1,
        Operation::Inspect(inspection(InspectionCollection::Definitions)),
    ) else {
        panic!("inspect")
    };
    assert_eq!(page.total, 2);
    assert_eq!(page.rows.len(), 2);
}
#[test]
fn all_matching_chart_and_export_share_selection_but_totals_keep_source_scope() {
    let (root, _, _, _) = fixture("ratio-source-scope");
    let (mut s, d, runtime) = session("ratio-source-scope");
    let first = text(get(
        &arr(get(get(get(&root, "result"), "chart"), "rows"))[0],
        "id",
    ))
    .to_string();
    let response = call(
        &mut s,
        1,
        Operation::ApplyModel {
            definition: d,
            selection: SelectionSpec::AllMatching {
                excluded_ids: vec![first.clone()],
            },
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: runtime,
        },
    );
    assert!(matches!(response, Response::ViewReady(_)));
    let Response::Selection(selection) = call(
        &mut s,
        1,
        Operation::Selection {
            action: SelectionAction::Summary,
            visible_ids: vec![first],
        },
    ) else {
        panic!("selection")
    };
    assert_eq!(selection.selected_count, 1);
    assert!(!selection.rows[0].checked);
    let Response::ChartData(chart) = call(
        &mut s,
        1,
        Operation::ChartData {
            fields: vec!["ratio".into()],
        },
    ) else {
        panic!("chart")
    };
    assert_eq!(chart.rows.len(), 1);
    assert_values(
        &chart.rows[0].values,
        &WireValue::Record(vec![(
            "ratio".into(),
            WireValue::F64(WireNumber::Finite(0.5)),
        )]),
        "selected chart",
    );
    let Response::Totals(totals) = call(&mut s, 1, Operation::Totals) else {
        panic!("totals")
    };
    assert_values(
        &totals.values,
        get(get(get(&root, "result"), "totals"), "values"),
        "totals",
    );
    let Response::Subset(export) = call(
        &mut s,
        1,
        Operation::Presented {
            transfer_id: "export".into(),
            ignore_selection: true,
        },
    ) else {
        panic!("export")
    };
    assert_eq!(export.rows.len(), 2);
}
#[test]
fn witness_refuses_transformed_ancestry_and_proves_ordinary_absence() {
    let (mut s, d, runtime) = session("ratio-source-scope");
    apply(&mut s, d.clone(), runtime, 1);
    let Response::IdentityWitness(identities) = call(
        &mut s,
        1,
        Operation::IdentityWitness {
            path: vec![d.clone(), d],
            ids: vec!["a".into()],
        },
    ) else {
        panic!("witness")
    };
    assert_eq!(identities[0].state, WitnessState::Unknown);
    let (_, input, mut d, _) = fixture("ratio-source-scope");
    d.definition.analytical = None;
    d.analytical_recipe_source = None;
    s.register(input, 1).unwrap();
    apply(&mut s, d.clone(), RuntimeParams::new(), 2);
    let Response::IdentityWitness(identities) = call(
        &mut s,
        2,
        Operation::IdentityWitness {
            path: vec![d.clone(), d],
            ids: vec!["a".into(), "missing".into()],
        },
    ) else {
        panic!("witness")
    };
    assert_eq!(identities[0].state, WitnessState::Present);
    assert_eq!(identities[1].state, WitnessState::Absent);
}
#[path = "session/oracle.rs"]
mod oracle;
#[test]
fn stale_apply_and_mismatched_registration_cannot_replace_active_revision() {
    let (mut s, d, runtime) = session("ratio-source-scope");
    apply(&mut s, d.clone(), runtime.clone(), 2);
    assert!(matches!(apply(&mut s, d, runtime, 1), Response::Error(_)));
    assert!(matches!(
        call(&mut s, 2, Operation::Totals),
        Response::Totals(_)
    ));
    let (_, input, _, _) = fixture("ratio-source-scope");
    assert!(matches!(
        call(
            &mut s,
            2,
            Operation::RegisterInput {
                input,
                input_revision: 9
            }
        ),
        Response::Error(_)
    ));
    assert!(matches!(
        call(&mut s, 2, Operation::Totals),
        Response::Totals(_)
    ));
}
#[test]
fn admission_export_and_cache_limits_refuse_without_corrupting_publication() {
    let (_, input, d, runtime) = fixture("ratio-source-scope");
    let mut input_limited = Session::new(
        "en-US".into(),
        ResourceLimits {
            input_bytes: Some(1),
            ..ResourceLimits::default()
        },
    );
    assert!(input_limited.register(input.clone(), 1).is_err());
    let mut export_limited = Session::new(
        "en-US".into(),
        ResourceLimits {
            export_bytes: Some(1),
            ..ResourceLimits::default()
        },
    );
    export_limited.register(input.clone(), 1).unwrap();
    apply(&mut export_limited, d.clone(), runtime.clone(), 1);
    assert!(matches!(
        call(
            &mut export_limited,
            1,
            Operation::Presented {
                transfer_id: "x".into(),
                ignore_selection: false
            }
        ),
        Response::Error(_)
    ));
    assert!(matches!(
        call(&mut export_limited, 1, Operation::Totals),
        Response::Totals(_)
    ));
    let mut cache_limited = Session::new(
        "en-US".into(),
        ResourceLimits {
            cache_bytes: Some(1),
            ..ResourceLimits::default()
        },
    );
    cache_limited.register(input, 1).unwrap();
    assert!(matches!(
        apply(&mut cache_limited, d, runtime, 1),
        Response::Error(_)
    ));
    assert!(matches!(
        call(
            &mut cache_limited,
            1,
            Operation::Rows(RowRequest {
                group_path: vec![],
                offset: 0,
                limit: 1
            })
        ),
        Response::Error(_)
    ));
}
#[test]
fn transfers_enforce_ceiling_and_cancel_releases_slot() {
    let (mut s, d, runtime) = session("ratio-source-scope");
    s.set_batch_rows(1).unwrap();
    apply(&mut s, d, runtime, 1);
    for i in 0..32 {
        assert!(matches!(
            call(
                &mut s,
                1,
                Operation::Presented {
                    transfer_id: format!("t{i}"),
                    ignore_selection: false
                }
            ),
            Response::Subset(_)
        ))
    }
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::Presented {
                transfer_id: "overflow".into(),
                ignore_selection: false
            }
        ),
        Response::Error(_)
    ));
    call(
        &mut s,
        1,
        Operation::Cancel {
            target_request_id: "q".into(),
        },
    );
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::Presented {
                transfer_id: "new".into(),
                ignore_selection: false
            }
        ),
        Response::Subset(_)
    ));
}
#[test]
fn witness_and_visible_selection_enforce_existing_identity_budget() {
    let (mut s, d, runtime) = session("ratio-source-scope");
    apply(&mut s, d.clone(), runtime, 1);
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::IdentityWitness {
                path: vec![d.clone()],
                ids: vec!["x".into()]
            }
        ),
        Response::Error(_)
    ));
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::IdentityWitness {
                path: vec![d.clone(), d],
                ids: vec!["x".into(); 1201]
            }
        ),
        Response::Error(_)
    ));
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::Selection {
                action: SelectionAction::Summary,
                visible_ids: vec!["x".into(); 1201]
            }
        ),
        Response::Error(_)
    ));
}
struct FailedOrder;
impl pivot_core::ordering::ValueOrder for FailedOrder {
    fn compare(&self, _a: &WireValue, _b: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        Err(pivot_core::validation::diagnostic(
            "HOST_ORDER_FAILED",
            "order",
            "Host ordering failed",
        ))
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<std::cmp::Ordering, Diagnostic> {
        Host.compare_recipe(a, b)
    }
    fn sort_permutation(
        &self,
        _v: &[Vec<WireValue>],
        _d: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        Err(pivot_core::validation::diagnostic(
            "HOST_ORDER_FAILED",
            "order",
            "Host ordering failed",
        ))
    }
}
#[test]
fn host_ordering_failure_leaves_published_revision_and_schema_usable() {
    use pivot_core::ordering::ValueOrder;
    let (mut s, d, runtime) = session("ratio-source-scope");
    apply(&mut s, d.clone(), runtime.clone(), 1);
    let mut sorted = d.clone();
    sorted.definition.table.sorting = Some(vec![Sort {
        id: "ratio".into(),
        desc: false,
    }]);
    let q = CoreRequest {
        request_id: "badorder".into(),
        revision: revision(2),
        operation: Operation::ApplyModel {
            definition: sorted,
            selection: SelectionSpec::None,
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: runtime,
        },
    };
    let Response::Error(e) = s.dispatch(q, &FailedOrder).result else {
        panic!("host refusal")
    };
    assert_eq!(e.code, "HOST_ORDER_FAILED");
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
    assert!(
        FailedOrder
            .compare_raw(
                &WireValue::F64(WireNumber::Special(SpecialNumber::Nan)),
                &WireValue::F64(WireNumber::Finite(1.))
            )
            .unwrap()
            == pivot_core::ordering::Comparison::Unordered
    );
}
#[test]
fn group_domain_obeys_encoded_preview_budget_and_progresses() {
    let (_, mut input, d, _) = fixture("runtime-authoring-linked");
    input.rows = (0..10)
        .map(|i| {
            let mut r = input.rows[0].clone();
            r.id = format!("r{i}");
            r.values.insert(
                "region".into(),
                WireValue::String(format!("{}-{i}", "é".repeat(7500))),
            );
            r
        })
        .collect();
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    apply(&mut s, d, RuntimeParams::new(), 1);
    let mut request = inspection(InspectionCollection::GroupDomain);
    request.param_key = Some("pivot:filter:regionCategory".into());
    request.category_id = Some("regionCategory".into());
    request.category_recipe = Some("[\"region\",\"native\",null,null]".into());
    let Response::Inspect(page) = call(&mut s, 1, Operation::Inspect(request.clone())) else {
        panic!("domain")
    };
    assert!(serde_json::to_vec(&page.rows).unwrap().len() <= 131072);
    assert!(page.truncated);
    assert!(page.next_offset.is_some_and(|n| n > 0 && n < 10));
    request.offset = page.next_offset.unwrap();
    let Response::Inspect(next) = call(&mut s, 1, Operation::Inspect(request)) else {
        panic!("domain next")
    };
    assert!(!next.rows.is_empty());
}
#[test]
fn native_request_validation_rejects_empty_ids_and_unsafe_coordinates() {
    let (mut s, d, runtime) = session("ratio-source-scope");
    apply(&mut s, d, runtime, 1);
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::Selection {
                action: SelectionAction::Summary,
                visible_ids: vec!["".into()]
            }
        ),
        Response::Error(_)
    ));
    let response = s.dispatch(
        CoreRequest {
            request_id: "q".into(),
            revision: Revision {
                input: 9007199254740992,
                ..revision(1)
            },
            operation: Operation::InputSchema,
        },
        &Host,
    );
    let Response::Error(error) = response.result else {
        panic!("invalid coordinate")
    };
    assert_eq!(error.code, "INVALID_REQUEST");
}
struct RawFailedOrder;
impl pivot_core::ordering::ValueOrder for RawFailedOrder {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        Host.compare(a, b)
    }
    fn compare_raw(
        &self,
        _a: &WireValue,
        _b: &WireValue,
    ) -> Result<pivot_core::ordering::Comparison, Diagnostic> {
        Err(pivot_core::validation::diagnostic(
            "RAW_ORDER_FAILED",
            "order",
            "Raw host ordering failed",
        ))
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<std::cmp::Ordering, Diagnostic> {
        Host.compare_recipe(a, b)
    }
}
#[test]
fn scalar_aggregate_and_raw_sort_order_failures_refuse_atomic_candidates() {
    for (name, order, code) in [
        (
            "legacy-all-operators",
            &FailedOrder as &dyn pivot_core::ordering::ValueOrder,
            "HOST_ORDER_FAILED",
        ),
        (
            "locale-numeric-order",
            &RawFailedOrder as &dyn pivot_core::ordering::ValueOrder,
            "RAW_ORDER_FAILED",
        ),
    ] {
        let (mut s, d, runtime) = session(name);
        assert!(matches!(
            apply(&mut s, d.clone(), runtime.clone(), 1),
            Response::ViewReady(_)
        ));
        let q = CoreRequest {
            request_id: "bad".into(),
            revision: revision(2),
            operation: Operation::ApplyModel {
                definition: d,
                selection: SelectionSpec::None,
                reconcile_missing: false,
                previous_selection_namespace: None,
                proven_absent_ids: vec![],
                runtime_params: runtime,
            },
        };
        let Response::Error(e) = s.dispatch(q, order).result else {
            panic!("{name} ordering failed")
        };
        assert_eq!(e.code, code);
        assert!(matches!(
            call(&mut s, 1, Operation::Totals),
            Response::Totals(_)
        ));
        assert!(matches!(
            call(
                &mut s,
                2,
                Operation::Rows(RowRequest {
                    group_path: vec![],
                    offset: 0,
                    limit: 1
                })
            ),
            Response::Error(_)
        ));
    }
}
#[test]
fn authoring_and_preview_use_candidate_context_instead_of_active_runtime_warnings() {
    let (_, input, d, _) = fixture("runtime-authoring-linked");
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    let runtime:RuntimeParams=serde_json::from_value(serde_json::json!({"pivot:filter:regionCategory":{"source":"group","groupId":"g","transportValue":"A,missing"}})).unwrap();
    apply(&mut s, d.clone(), runtime, 1);
    let request = CoreRequest {
        request_id: "candidate".into(),
        revision: revision(1),
        operation: Operation::PreviewDefinition(d.clone()),
    };
    let preview = s.dispatch(request, &Host);
    assert!(matches!(preview.result, Response::PreviewDefinition(_)));
    assert!(preview.diagnostics.is_empty());
    let request = CoreRequest {
        request_id: "candidate".into(),
        revision: revision(1),
        operation: Operation::BindFormula {
            definition: d,
            draft: pivot_core::formulas::FormulaDraft {
                id: "new".into(),
                name: "New".into(),
                scope: FormulaScope::Aggregate,
                expression: "SUM(Revenue)".into(),
                format: None,
            },
            bindings: vec![],
        },
    };
    let bind = s.dispatch(request, &Host);
    assert!(matches!(bind.result, Response::BindFormula(_)));
    assert!(bind.diagnostics.is_empty());
    let still = s.dispatch(
        CoreRequest {
            request_id: "active".into(),
            revision: revision(1),
            operation: Operation::Totals,
        },
        &Host,
    );
    assert_eq!(still.diagnostics[0].code, "PIVOT_PARAM_UNMATCHED");
}
#[test]
fn duplicate_scoped_binding_refuses_at_authoring_boundary() {
    let (mut s, d, _) = session("runtime-authoring-linked");
    let binding = pivot_core::formulas::ScopedBinding {
        scope: FormulaScope::Source,
        name: "Revenue".into(),
        reference: FormulaAst::Reference {
            target: ReferenceTarget::Field,
            id: "revenue".into(),
        },
    };
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::BindFormula {
                definition: d,
                draft: pivot_core::formulas::FormulaDraft {
                    id: "new".into(),
                    name: "New".into(),
                    scope: FormulaScope::Aggregate,
                    expression: "SUM(Revenue)".into(),
                    format: None
                },
                bindings: vec![binding.clone(), binding]
            }
        ),
        Response::Error(_)
    ));
}
#[test]
fn filtered_split_retains_unfiltered_chart_binding_columns() {
    let (_, input, mut d, runtime) = fixture("analytical-source-split");
    d.definition.search = "A".into();
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    let Response::ViewReady(ready) = apply(&mut s, d, runtime, 1) else {
        panic!("ready")
    };
    assert_eq!(ready.columns.len(), 3);
    assert_eq!(ready.chart_columns.unwrap().len(), 4);
}
#[test]
// Was legacy_count_metadata_does_not_coerce_source_leaf_values: a leaf carried
// its raw "001" under Count. Since the v4 RC Count fix (990b6bc, pivotTable.ts
// leafValue) a leaf is one row and a count counts it, so it reads "1".
fn legacy_count_leaf_counts_the_row_not_its_value() {
    let (_, mut input, mut d, _) = fixture("legacy-all-operators");
    input.rows = vec![input.rows[0].clone()];
    input.rows[0]
        .values
        .insert("revenue".into(), WireValue::String("001".into()));
    d.definition.table.pivot.as_mut().unwrap().measures = Some(vec![Measure {
        id: "revenue".into(),
        source_field_id: "revenue".into(),
        aggregation: Some(Aggregation::Count),
        custom_label: None,
    }]);
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    let Response::ViewReady(_) = apply(&mut s, d, RuntimeParams::new(), 1) else {
        panic!("ready")
    };
    let Response::Rows(root) = call(
        &mut s,
        1,
        Operation::Rows(RowRequest {
            group_path: vec![],
            offset: 0,
            limit: 1,
        }),
    ) else {
        panic!("root")
    };
    let Response::Rows(leaf) = call(
        &mut s,
        1,
        Operation::Rows(RowRequest {
            group_path: root.groups[0].path.clone(),
            offset: 0,
            limit: 1,
        }),
    ) else {
        panic!("leaf")
    };
    assert_eq!(
        leaf.rows[0].values["revenue"],
        WireValue::String("1".into())
    );
}
#[test]
fn acquired_freshness_diagnostics_survive_registration_and_publication() {
    let (_, mut input, d, runtime) = fixture("ratio-source-scope");
    input.freshness.diagnostics = Some(vec!["Acquisition warning".into()]);
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    let registered = s.dispatch(
        CoreRequest {
            request_id: "register".into(),
            revision: revision(1),
            operation: Operation::RegisterInput {
                input,
                input_revision: 1,
            },
        },
        &Host,
    );
    assert_eq!(
        registered
            .diagnostics
            .iter()
            .map(|d| d.code.as_str())
            .collect::<Vec<_>>(),
        vec!["INPUT"]
    );
    apply(&mut s, d, runtime, 1);
    let totals = s.dispatch(
        CoreRequest {
            request_id: "total".into(),
            revision: revision(1),
            operation: Operation::Totals,
        },
        &Host,
    );
    assert_eq!(
        totals
            .diagnostics
            .iter()
            .map(|d| d.message.as_str())
            .collect::<Vec<_>>(),
        vec!["Acquisition warning"]
    );
}
#[path = "session/review_round1.rs"]
mod review_round1;

#[test]
fn ordinary_sort_requires_declared_column_even_when_row_values_retain_it() {
    let (_, mut input, mut d, _) = fixture("legacy-all-operators");
    d.definition.analytical = None;
    d.definition.table =
        serde_json::from_value(serde_json::json!({"sorting":[{"id":"region","desc":false}]}))
            .unwrap();
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input.clone(), 1).unwrap();
    assert!(matches!(
        apply(&mut s, d.clone(), RuntimeParams::default(), 1),
        Response::ViewReady(_)
    ));
    input.columns.retain(|column| column.id != "region");
    assert!(input
        .rows
        .iter()
        .all(|row| row.values.contains_key("region")));
    s.register(input, 1).unwrap();
    let Response::Error(error) = apply(&mut s, d, RuntimeParams::default(), 2) else {
        panic!("Undeclared row fields must not create sort bindings")
    };
    assert_eq!(error.code, "MISSING_FIELD");
    assert_eq!(
        error.message,
        "Missing source field or output sort binding: region; restore field or edit definition"
    );
}

#[test]
fn known_ast_missing_formula_reference_preserves_independent_values() {
    let (_, input, _, _) = fixture("legacy-all-operators");
    let mut d = pivot_core::validation::validate_definition(&WireDefinition {
        protocol_version: 1,
        locale: "en-US".into(),
        analytical_recipe_source: None,
        definition: serde_json::from_value(serde_json::json!({"table":{},"search":"","analytical":{
            "schemaVersion":1,"enabled":true,"params":{"promotePage":true,"filters":[]},
            "categories":[{"id":"regionCategory","name":"Region","sourceFieldId":"region","transform":"native"}],
            "measures":[{"id":"dependent","sourceFieldId":"f","aggregation":"sum"},{"id":"valid","sourceFieldId":"revenue","aggregation":"sum"}],
            "formulas":[{"id":"f","name":"F","scope":"source","expression":"Missing","ast":{"kind":"reference","target":"formula","id":"missing"}}],
            "layout":{"rows":["regionCategory"],"columns":[],"values":[]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":false}
        }})).unwrap(),
    }).expect("Known reference ASTs are structurally valid; evaluation owns missing references");
    d.analytical_recipe_source = Some(tag(&serde_json::to_value(
        d.definition.analytical.as_ref().unwrap(),
    )
    .unwrap()));
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    let ready = apply(&mut s, d, RuntimeParams::default(), 1);
    assert!(matches!(ready, Response::ViewReady(_)), "{ready:?}");
    let rows = call(
        &mut s,
        1,
        Operation::Rows(RowRequest {
            group_path: vec![],
            offset: 0,
            limit: 10,
        }),
    );
    let Response::Rows(rows) = rows else {
        panic!("Expected independent output")
    };
    assert_eq!(rows.rows.len(), 1);
    assert!(rows.rows[0]
        .cell_errors
        .as_ref()
        .unwrap()
        .contains_key("dependent"));
    assert!(matches!(
        rows.rows[0].values.get("valid"),
        Some(WireValue::F64(WireNumber::Finite(42.0)))
    ));
}

#[test]
fn native_inspection_rejects_unrelated_optional_selectors() {
    let (mut s, d, p) = session("ratio-source-scope");
    assert!(matches!(apply(&mut s, d, p, 1), Response::ViewReady(_)));
    for field in ["param", "category", "recipe", "evidence"] {
        let r = InspectionRequest {
            collection: InspectionCollection::Warnings,
            offset: 0,
            limit: 1,
            definition_id: None,
            param_key: (field == "param").then(|| "x".into()),
            category_id: (field == "category").then(|| "x".into()),
            category_recipe: (field == "recipe").then(|| "x".into()),
            group_evidence: (field == "evidence").then(|| ("g".into(), "x".into())),
        };
        assert!(
            matches!(call(&mut s, 1, Operation::Inspect(r)), Response::Error(_)),
            "{field}"
        );
    }
}

#[test]
fn legacy_equal_values_keep_ordinal_identity_and_metadata() {
    let (_, mut input, mut d, _) = fixture("raw");
    input.columns = ["region", "team", "value"]
        .into_iter()
        .map(|id| serde_json::from_value(serde_json::json!({"id":id,"label":id})).unwrap())
        .collect();
    let mut row = input.rows[0].clone();
    row.id = "a".into();
    row.values = std::collections::BTreeMap::from([
        ("region".into(), WireValue::String("A".into())),
        ("team".into(), WireValue::String("T".into())),
        ("value".into(), WireValue::F64(WireNumber::Finite(1.))),
    ]);
    row.cell_errors = Some(
        serde_json::from_value(serde_json::json!({"value":{"code":"upstream","message":"a"}}))
            .unwrap(),
    );
    row.cell_formats =
        Some(serde_json::from_value(serde_json::json!({"value":{"formatterFn":"int"}})).unwrap());
    let mut other = row.clone();
    other.id = "b".into();
    other
        .cell_errors
        .as_mut()
        .unwrap()
        .get_mut("value")
        .unwrap()
        .message = "b".into();
    other.cell_formats = Some(
        serde_json::from_value(serde_json::json!({"value":{"formatterFn":"percent"}})).unwrap(),
    );
    input.rows = vec![row, other];
    d.definition.table.pivot=Some(serde_json::from_value(serde_json::json!({"enabled":true,"grouping":["region","team"],"split":[],"aggregationFns":{"value":"sum"}})).unwrap());
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input.clone(), 1).unwrap();
    assert!(matches!(
        apply(&mut s, d, RuntimeParams::new(), 1),
        Response::ViewReady(_)
    ));
    let mut path = vec![];
    for _ in 0..2 {
        let Response::Rows(block) = call(
            &mut s,
            1,
            Operation::Rows(RowRequest {
                group_path: path.clone(),
                offset: 0,
                limit: 1,
            }),
        ) else {
            panic!("group")
        };
        path.push(block.rows[0].id.clone());
    }
    for offset in [1, 0] {
        let Response::Rows(block) = call(
            &mut s,
            1,
            Operation::Rows(RowRequest {
                group_path: path.clone(),
                offset,
                limit: 1,
            }),
        ) else {
            panic!("leaf")
        };
        let expected = &input.rows[offset as usize];
        assert_eq!(block.rows[0].id, expected.id);
        assert_eq!(
            serde_json::to_value(&block.rows[0].cell_formats).unwrap(),
            serde_json::to_value(&expected.cell_formats).unwrap()
        );
        assert_eq!(
            block.rows[0].cell_errors.as_ref().unwrap()["value"].message,
            expected.id
        );
    }
}
#[test]
fn group_domain_inspection_scales_linearly_with_members() {
    // Review R1: per-member linear finds made this O(members²).
    let session = |n: usize| {
        let (_, mut input, d, _) = fixture("runtime-authoring-linked");
        distinct_regions(&mut input.rows, n);
        let mut s = Session::new("en-US".into(), ResourceLimits::default());
        s.register(input, 1).unwrap();
        let applied = dispatch(
            &mut s,
            Operation::ApplyModel {
                definition: d,
                selection: SelectionSpec::None,
                reconcile_missing: false,
                previous_selection_namespace: None,
                proven_absent_ids: vec![],
                runtime_params: RuntimeParams::new(),
            },
        );
        assert!(matches!(applied, Response::ViewReady(_)));
        s
    };
    fn dispatch(s: &mut Session, operation: Operation) -> Response {
        s.dispatch(
            CoreRequest {
                request_id: "q".into(),
                revision: revision(1),
                operation,
            },
            &PlainOrder,
        )
        .result
    }
    let mut request = inspection(InspectionCollection::GroupDomain);
    request.param_key = Some("pivot:filter:regionCategory".into());
    request.category_id = Some("regionCategory".into());
    request.category_recipe = Some("[\"region\",\"native\",null,null]".into());
    let mut sessions = std::collections::BTreeMap::new();
    assert_linear("group-domain inspection", 1000, |n| {
        let s = sessions.entry(n).or_insert_with(|| session(n));
        let t = std::time::Instant::now();
        assert!(matches!(
            dispatch(s, Operation::Inspect(request.clone())),
            Response::Inspect(_)
        ));
        t.elapsed()
    });
}
