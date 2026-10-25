// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{contract::*, session::*};
use support::*;
fn rev(n: u64) -> Revision {
    Revision {
        widget_id: "oracle".into(),
        input: 1,
        model: n,
        output: n,
    }
}
fn call(s: &mut Session, n: u64, operation: Operation) -> Response {
    s.dispatch(
        CoreRequest {
            request_id: "q".into(),
            revision: rev(n),
            operation,
        },
        &Host,
    )
    .result
}
fn raw() -> (SourceDataset, ValidatedDefinition) {
    let (_, mut input, mut d, _) = fixture("ratio-source-scope");
    d.definition.analytical = None;
    d.definition.table = TableState::default();
    d.analytical_recipe_source = None;
    input.rows.truncate(3);
    (input, d)
}
fn apply(s: &mut Session, d: ValidatedDefinition, n: u64) -> Response {
    call(
        s,
        n,
        Operation::ApplyModel {
            definition: d,
            selection: SelectionSpec::None,
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: RuntimeParams::new(),
        },
    )
}
fn resource(r: Response) {
    let Response::Error(d) = r else {
        panic!("expected recoverable refusal: {r:?}")
    };
    assert_eq!(d.code, "RESOURCE_LIMIT");
}
#[test]
fn rows_refuse_reacquisition_and_keep_old_publication() {
    let (i, d) = raw();
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_rows: Some(i.rows.len()),
            ..Default::default()
        },
    );
    s.register(i.clone(), 1).unwrap();
    assert!(matches!(apply(&mut s, d, 1), Response::ViewReady(_)));
    let mut large = i;
    large.rows.push(DatasetRow {
        id: "extra".into(),
        ..large.rows[0].clone()
    });
    assert_eq!(s.register(large, 2).unwrap_err().code, "RESOURCE_LIMIT");
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
}
#[test]
fn output_width_refusal_keeps_old_schema() {
    let (i, mut d) = raw();
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_pivot_columns: Some(i.columns.len()),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    assert!(matches!(
        apply(&mut s, d.clone(), 1),
        Response::ViewReady(_)
    ));
    d.definition.table.pivot = Some(PivotConfig {
        enabled: true,
        grouping: vec!["region".into()],
        split: vec!["x".into()],
        expanded: None,
        key_encoding: None,
        aggregation_fns: None,
        buckets: None,
        measures: None,
        legacy_expanded: None,
    });
    resource(apply(&mut s, d, 2));
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
}
#[test]
fn hidden_source_and_compound_metadata_count_toward_state() {
    let (mut i, d) = raw();
    i.rows[0].values.insert(
        "hidden".into(),
        WireValue::Array(vec![WireValue::Record(vec![(
            "deep".into(),
            WireValue::String("x".repeat(20_000)),
        )])]),
    );
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_state_bytes: Some(200_000_000),
            ..Default::default()
        },
    );
    assert_eq!(s.register(i, 1).unwrap_err().code, "RESOURCE_LIMIT");
    let (i, _) = raw();
    s.register(i, 1).unwrap();
    assert!(matches!(apply(&mut s, d, 1), Response::ViewReady(_)));
}
#[test]
fn model_and_transient_reservation_refuse_before_ordering_and_keep_old_result() {
    let (i, d) = raw();
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_state_bytes: Some(200_000_000),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    assert!(matches!(
        apply(&mut s, d.clone(), 1),
        Response::ViewReady(_)
    ));
    let mut huge = d;
    huge.definition.search = "x".repeat(100_000);
    resource(apply(&mut s, huge, 2));
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
}
#[test]
fn row_block_and_export_include_metadata_and_transfer_slots_release() {
    let (mut i, d) = raw();
    i.columns[0].label = "x".repeat(5000);
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_batch_bytes: Some(2000),
            max_cached_block_bytes: Some(1),
            max_concurrent_transfers: Some(1),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    assert!(matches!(apply(&mut s, d, 1), Response::ViewReady(_)));
    resource(call(
        &mut s,
        1,
        Operation::Rows(RowRequest {
            group_path: vec![],
            offset: 0,
            limit: 1,
        }),
    ));
    for _ in 0..2 {
        resource(call(
            &mut s,
            1,
            Operation::Presented {
                transfer_id: "same".into(),
                ignore_selection: false,
            },
        ));
    }
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
}
#[test]
fn pull_backpressure_limit_is_recoverable_and_cancel_releases_slot() {
    let (i, d) = raw();
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_concurrent_transfers: Some(1),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    s.set_batch_rows(1).unwrap();
    apply(&mut s, d, 1);
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::Presented {
                transfer_id: "a".into(),
                ignore_selection: false
            }
        ),
        Response::Subset(_)
    ));
    resource(call(
        &mut s,
        1,
        Operation::Presented {
            transfer_id: "b".into(),
            ignore_selection: false,
        },
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
                transfer_id: "b".into(),
                ignore_selection: false
            }
        ),
        Response::Subset(_)
    ));
}
#[test]
fn retained_cache_counts_full_model_pools_instead_of_only_display_rows() {
    let (_, i, d, p) = fixture("ratio-source-scope");
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            cache_bytes: Some(10_000),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    resource(call(
        &mut s,
        1,
        Operation::ApplyModel {
            definition: d,
            selection: SelectionSpec::None,
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: p,
        },
    ));
}
#[test]
fn resource_usage_tracks_transfer_release_and_disposal() {
    let (i, d) = raw();
    let mut s = Session::new("en-US".into(), Default::default());
    s.register(i, 1).unwrap();
    s.set_batch_rows(1).unwrap();
    apply(&mut s, d, 1);
    let retained = s.resource_usage().retained_estimated_bytes;
    assert!(retained > 0);
    assert_eq!(s.resource_usage().input_rows, 2);
    call(
        &mut s,
        1,
        Operation::Presented {
            transfer_id: "active".into(),
            ignore_selection: false,
        },
    );
    assert_eq!(s.resource_usage().active_transfers, 1);
    assert!(s.resource_usage().retained_estimated_bytes > retained);
    call(
        &mut s,
        1,
        Operation::Cancel {
            target_request_id: "q".into(),
        },
    );
    assert_eq!(s.resource_usage().active_transfers, 0);
    call(&mut s, 1, Operation::Dispose);
    assert_eq!(s.resource_usage().input_rows, 0);
    assert_eq!(s.resource_usage().output_columns, 0);
}
#[test]
fn unsupported_state_profile_refuses_before_preparation_without_disabling_other_caps() {
    let (i, d) = raw();
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_state_bytes: Some(4_000_000_000),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    apply(&mut s, d, 1);
    let (_, _, member, _) = fixture("member-missing");
    resource(apply(&mut s, member, 2));
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
    let (_, _, statement, _) = fixture("statement-income-long");
    resource(apply(&mut s, statement, 2));
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
}
#[test]
fn reserved_capacity_and_nonascii_compound_values_cannot_hide_behind_encoded_rows() {
    let (mut i, _) = raw();
    i.rows.reserve(100_000);
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_state_bytes: Some(200_000_000),
            ..Default::default()
        },
    );
    assert_eq!(s.register(i, 1).unwrap_err().code, "RESOURCE_LIMIT");
    let (mut i, _) = raw();
    i.rows[0].values.insert(
        "hidden".into(),
        WireValue::Record(vec![(
            "深".into(),
            WireValue::Array(vec![WireValue::String("𝄞é".repeat(20_000))]),
        )]),
    );
    assert_eq!(s.register(i, 1).unwrap_err().code, "RESOURCE_LIMIT");
}
#[test]
fn failing_later_export_batch_does_not_advance_sequence() {
    let (mut i, d) = raw();
    i.rows[1]
        .values
        .insert("x".into(), WireValue::String("x".repeat(20_000)));
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_batch_bytes: Some(3000),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    s.set_batch_rows(1).unwrap();
    apply(&mut s, d, 1);
    assert!(matches!(
        call(
            &mut s,
            1,
            Operation::Presented {
                transfer_id: "stream".into(),
                ignore_selection: false
            }
        ),
        Response::Subset(_)
    ));
    for _ in 0..2 {
        resource(call(
            &mut s,
            1,
            Operation::NextSubset {
                transfer_id: "stream".into(),
                sequence: 1,
            },
        ));
    }
}
#[test]
fn exported_batch_accounts_for_completeness_diagnostic_envelope() {
    let (mut i, d) = raw();
    i.completeness.warnings = vec!["x".repeat(5000)];
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_batch_bytes: Some(3000),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    apply(&mut s, d, 1);
    resource(call(
        &mut s,
        1,
        Operation::Presented {
            transfer_id: "envelope".into(),
            ignore_selection: false,
        },
    ));
}
// An oversized chart must be a recoverable refusal, not a frame the worker cannot write.
#[test]
fn chart_data_refuses_over_batch_wire_budget() {
    let (mut i, d) = raw();
    i.rows[1]
        .values
        .insert("x".into(), WireValue::String("x".repeat(20_000)));
    let mut s = Session::new(
        "en-US".into(),
        ResourceLimits {
            max_batch_bytes: Some(3000),
            ..Default::default()
        },
    );
    s.register(i, 1).unwrap();
    let Response::ViewReady(v) = apply(&mut s, d, 1) else {
        panic!("apply")
    };
    let fields: Vec<String> = v.columns.iter().map(|c| c.id.clone()).collect();
    assert!(fields.iter().any(|f| f == "x"));
    resource(call(&mut s, 1, Operation::ChartData { fields }));
    assert!(matches!(
        call(&mut s, 1, Operation::Totals),
        Response::Totals(_)
    ));
}
