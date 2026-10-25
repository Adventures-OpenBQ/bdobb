// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use std::{
    alloc::{GlobalAlloc, Layout, System},
    cell::Cell,
};
const PAYLOAD_BYTES: usize = 8193;
thread_local! {static PAYLOAD_COPIES:Cell<Option<usize>>=const{Cell::new(None)};}
struct CountingAllocator;
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if layout.size() == PAYLOAD_BYTES {
            let _ = PAYLOAD_COPIES.try_with(|counter| {
                if let Some(n) = counter.get() {
                    counter.set(Some(n + 1))
                }
            });
        }
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if size == PAYLOAD_BYTES {
            let _ = PAYLOAD_COPIES.try_with(|counter| {
                if let Some(n) = counter.get() {
                    counter.set(Some(n + 1))
                }
            });
        }
        unsafe { System.realloc(ptr, layout, size) }
    }
}
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;
fn copies<T>(f: impl FnOnce() -> T) -> (T, usize) {
    PAYLOAD_COPIES.with(|n| n.set(Some(0)));
    let result = f();
    let count = PAYLOAD_COPIES.with(|n| n.replace(None)).unwrap();
    (result, count)
}
fn large_session(limits: ResourceLimits) -> Session {
    let (_, mut input, d, _) = fixture("raw");
    let mut template = input.rows[0].clone();
    template.values.insert(
        "payload".into(),
        WireValue::String("x".repeat(PAYLOAD_BYTES)),
    );
    let mut column = input.columns[0].clone();
    column.id = "payload".into();
    column.label = "Payload".into();
    column.dtype = Some("text".into());
    input.columns.push(column);
    input.rows = (0..200)
        .map(|i| {
            let mut row = template.clone();
            row.id = format!("large-{i}");
            row
        })
        .collect();
    let mut session = Session::new("en-US".into(), limits);
    session.register(input, 1).unwrap();
    session.set_batch_rows(3).unwrap();
    let response = call(
        &mut session,
        1,
        Operation::ApplyModel {
            definition: d,
            selection: SelectionSpec::AllMatching {
                excluded_ids: vec!["large-0".into()],
            },
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: RuntimeParams::new(),
        },
    );
    assert!(matches!(response, Response::ViewReady(_)));
    session
}
#[test]
fn bounded_rows_and_identity_summary_copy_only_requested_payloads() {
    let mut session = large_session(ResourceLimits::default());
    let (response, n) = copies(|| {
        call(
            &mut session,
            1,
            Operation::Rows(RowRequest {
                group_path: vec![],
                offset: 150,
                limit: 3,
            }),
        )
    });
    let Response::Rows(block) = response else {
        panic!("rows")
    };
    assert_eq!(block.rows.len(), 3);
    assert_eq!(block.rows[0].id, "large-150");
    eprintln!("bounded rows: N=200 B=3 payload copies={n}");
    assert!(n <= 3, "bounded rows copied {n} payloads for a 3-row block");
    let (response, n) = copies(|| {
        call(
            &mut session,
            1,
            Operation::Selection {
                action: SelectionAction::Summary,
                visible_ids: vec!["large-199".into()],
            },
        )
    });
    let Response::Selection(summary) = response else {
        panic!("summary")
    };
    assert_eq!(summary.selected_count, 199);
    eprintln!("selection summary: N=200 payload copies={n}");
    assert_eq!(n, 0, "ID-only selection copied payloads");
}
#[test]
fn bounded_export_and_linked_pulls_copy_only_each_batch() {
    for ignore_selection in [true, false] {
        let mut session = large_session(ResourceLimits::default());
        let (response, n) = copies(|| {
            call(
                &mut session,
                1,
                Operation::Presented {
                    transfer_id: "bounded".into(),
                    ignore_selection,
                },
            )
        });
        let Response::Subset(batch) = response else {
            panic!("batch")
        };
        assert_eq!(batch.rows.len(), 3);
        assert_eq!(
            batch.rows[0].id,
            if ignore_selection {
                "large-0"
            } else {
                "large-1"
            }
        );
        eprintln!("subset ignoreSelection={ignore_selection}: N=200 B=3 first payload copies={n}");
        assert!(n <= 3, "first batch copied {n} payloads");
        let (response, n) = copies(|| {
            call(
                &mut session,
                1,
                Operation::NextSubset {
                    transfer_id: "bounded".into(),
                    sequence: 1,
                },
            )
        });
        let Response::Subset(batch) = response else {
            panic!("next")
        };
        assert_eq!(batch.rows.len(), 3);
        eprintln!("subset ignoreSelection={ignore_selection}: N=200 B=3 next payload copies={n}");
        assert!(n <= 3, "next batch copied {n} payloads");
    }
}
#[test]
fn tiny_export_budget_never_copies_all_payloads_before_refusal() {
    let mut session = large_session(ResourceLimits {
        export_bytes: Some(1),
        ..ResourceLimits::default()
    });
    let (response, n) = copies(|| {
        call(
            &mut session,
            1,
            Operation::Presented {
                transfer_id: "tiny".into(),
                ignore_selection: true,
            },
        )
    });
    assert!(matches!(response, Response::Error(_)));
    assert!(
        n <= 3,
        "refused batch copied {n} payloads before byte admission"
    );
}
#[derive(Clone, Copy)]
enum Failure {
    Scalar,
    Raw,
    Permutation,
}
struct WitnessFailure(Failure);
fn host_failure() -> Diagnostic {
    pivot_core::validation::diagnostic(
        "MISSING_FIELD",
        "host.order",
        "Explicit host failure, not a missing analytical field",
    )
}
impl pivot_core::ordering::ValueOrder for WitnessFailure {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        if matches!(self.0, Failure::Scalar) {
            Err(host_failure())
        } else {
            Host.compare(a, b)
        }
    }
    fn compare_raw(
        &self,
        a: &WireValue,
        b: &WireValue,
    ) -> Result<pivot_core::ordering::Comparison, Diagnostic> {
        if matches!(self.0, Failure::Raw) {
            Err(host_failure())
        } else {
            self.compare(a, b)
                .map(pivot_core::ordering::Comparison::Ordered)
        }
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<std::cmp::Ordering, Diagnostic> {
        Host.compare_recipe(a, b)
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        desc: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        if matches!(self.0, Failure::Permutation) {
            Err(host_failure())
        } else {
            Host.sort_permutation(values, desc)
        }
    }
}
#[test]
fn witness_propagates_host_failure_without_guessing_diagnostic_codes() {
    for failure in [Failure::Scalar, Failure::Raw, Failure::Permutation] {
        let (_, mut input, mut root, _) = fixture("legacy-all-operators");
        input.rows.truncate(2);
        root.definition.table.pivot = None;
        root.definition.table.sorting = None;
        root.analytical_recipe_source = None;
        let mut target = root.clone();
        target.definition.table.pivot = Some(PivotConfig {
            enabled: true,
            grouping: vec!["region".into()],
            split: vec![],
            expanded: None,
            key_encoding: None,
            legacy_expanded: None,
            buckets: None,
            aggregation_fns: None,
            measures: Some(vec![Measure {
                id: "max".into(),
                source_field_id: "revenue".into(),
                aggregation: Some(Aggregation::Max),
                custom_label: None,
            }]),
        });
        if matches!(failure, Failure::Scalar) {
            for (i, row) in input.rows.iter_mut().enumerate() {
                row.values
                    .insert("region".into(), WireValue::String("A".into()));
                row.values
                    .insert("revenue".into(), WireValue::String(format!("value-{i}")));
            }
        } else {
            input.rows[1].values.insert(
                "region".into(),
                if matches!(failure, Failure::Permutation) {
                    WireValue::F64(WireNumber::Finite(1.))
                } else {
                    WireValue::String("B".into())
                },
            );
        }
        let mut session = Session::new("en-US".into(), ResourceLimits::default());
        session.register(input, 1).unwrap();
        assert!(matches!(
            apply(&mut session, root.clone(), RuntimeParams::new(), 1),
            Response::ViewReady(_)
        ));
        let response = session.dispatch(
            CoreRequest {
                request_id: "proof".into(),
                revision: revision(1),
                operation: Operation::IdentityWitness {
                    path: vec![root, target],
                    ids: vec!["absent".into()],
                },
            },
            &WitnessFailure(failure),
        );
        let Response::Error(error) = response.result else {
            panic!("host failure must refuse proof")
        };
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::to_value(host_failure()).unwrap()
        );
        assert_eq!(error.code, "MISSING_FIELD");
        assert_eq!(
            error.message,
            "Explicit host failure, not a missing analytical field"
        );
        assert!(matches!(
            call(&mut session, 1, Operation::Totals),
            Response::Totals(_)
        ));
    }
}
#[test]
fn witness_keeps_safe_missing_binding_as_successful_unknown() {
    let (mut session, mut root, runtime) = session("raw");
    apply(&mut session, root.clone(), runtime, 1);
    root.definition.table.pivot = Some(PivotConfig {
        enabled: true,
        grouping: vec!["unavailable".into()],
        split: vec![],
        expanded: None,
        key_encoding: None,
        legacy_expanded: None,
        buckets: None,
        aggregation_fns: None,
        measures: None,
    });
    let mut ancestor = root.clone();
    ancestor.definition.table.pivot = None;
    let Response::IdentityWitness(ids) = call(
        &mut session,
        1,
        Operation::IdentityWitness {
            path: vec![ancestor, root],
            ids: vec!["absent".into()],
        },
    ) else {
        panic!("safe unknown")
    };
    assert_eq!(ids[0].state, WitnessState::Unknown);
}
