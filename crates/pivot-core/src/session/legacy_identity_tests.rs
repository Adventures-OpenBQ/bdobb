// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
#[path = "../../tests/support/mod.rs"]
mod support;
fn check(name: &str, axes: &[&str], enabled: bool, buckets: Option<BTreeMap<String, Bucket>>) {
    let (_, input, mut definition, _) = support::fixture(name);
    let config = definition.definition.table.pivot.as_mut().unwrap();
    config.enabled = enabled;
    config.grouping = axes.iter().map(|x| x.to_string()).collect();
    config.split.clear();
    config.buckets = buckets;
    definition.definition.search.clear();
    definition.definition.table.column_filters = None;
    let config = definition.definition.table.pivot.clone().unwrap();
    let base = PivotInput {
        rows: vec![], // Identity construction must use borrowed SOURCE rows, not filtered rows.
        columns: input
            .columns
            .iter()
            .map(|c| PivotColumn::source(&c.id, &c.label))
            .collect(),
        kinds: input
            .columns
            .iter()
            .map(|c| (c.id.clone(), kind(&c.id, &input.rows, Some(c)).1))
            .collect(),
        order: input.columns.iter().map(|c| c.id.clone()).collect(),
        config: config.clone(),
        sorting: vec![],
        aggregate_only: false,
        category_metadata: BTreeMap::new(),
    };
    let signature = serde_json::to_string(
        &config
            .grouping
            .iter()
            .map(|id| {
                (
                    id,
                    config
                        .buckets
                        .as_ref()
                        .and_then(|b| b.get(id))
                        .copied()
                        .unwrap_or(Bucket::Native),
                )
            })
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let revision = Revision {
        widget_id: "test".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    let expected = prepare(
        &input,
        &definition,
        &SelectionSpec::None,
        &revision,
        &support::Host,
        true,
    )
    .unwrap();
    let (ids, hierarchy) = identity_universe(&input, &base, &signature).unwrap();
    assert_eq!(ids, expected.identity_ids, "identity set");
    let sets = |map: BTreeMap<String, Vec<String>>| {
        map.into_iter()
            .map(|(id, values)| (id, values.into_iter().collect::<BTreeSet<_>>()))
            .collect::<BTreeMap<_, _>>()
    };
    assert_eq!(sets(hierarchy), sets(expected.hierarchy), "all descendants");
}
#[test]
fn universe_matches_full_preparation_for_nested_typed_calendar_and_raw_views() {
    check("legacy-all-operators", &["region", "team"], true, None);
    check(
        "legacy-all-operators",
        &["date", "region"],
        true,
        Some(BTreeMap::from([("date".into(), Bucket::Month)])),
    );
    check("typed-blanks", &["dimension"], true, None);
    check("typed-blanks", &["dimension"], false, None);
    check("legacy-all-operators", &[], true, None);
}
#[test]
fn universe_retains_group_key_conversion_errors() {
    let (_, mut input, definition, _) = support::fixture("typed-blanks");
    input.rows[0].values.insert(
        "dimension".into(),
        WireValue::Record(vec![("toString".into(), WireValue::Null)]),
    );
    let mut config = definition.definition.table.pivot.unwrap();
    config.grouping = vec!["dimension".into()];
    config.split.clear();
    let base = PivotInput {
        rows: vec![],
        columns: input
            .columns
            .iter()
            .map(|c| PivotColumn::source(&c.id, &c.label))
            .collect(),
        kinds: BTreeMap::new(),
        order: vec![],
        config,
        sorting: vec![],
        aggregate_only: false,
        category_metadata: BTreeMap::new(),
    };
    assert!(identity_universe(&input, &base, "test").is_err());
}

#[test]
fn filtered_out_invalid_unique_count_still_refuses_candidate() {
    let (_, mut input, mut definition, _) = support::fixture("typed-blanks");
    let config = definition.definition.table.pivot.as_mut().unwrap();
    config.grouping = vec!["dimension".into()];
    config.split.clear();
    config.measures.as_mut().unwrap()[0].aggregation = Some(Aggregation::UniqueCount);
    input.rows[0].values.insert(
        "revenue".into(),
        WireValue::Record(vec![("toString".into(), WireValue::Null)]),
    );
    definition.definition.table.column_filters = Some(vec![SourceFilter {
        id: "revenue".into(),
        value: WireValue::Record(vec![(
            "min".into(),
            WireValue::F64(WireNumber::Finite(100000.)),
        )]),
    }]);
    let revision = Revision {
        widget_id: "test".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    assert!(prepare(
        &input,
        &definition,
        &SelectionSpec::None,
        &revision,
        &support::Host,
        false
    )
    .is_err());
}

// Production's host adapter converts JavaScript ordering exceptions to diagnostics.
// The fixture Host panics on a Node exception, so model that boundary explicitly.
struct FallibleHost;
impl ValueOrder for FallibleHost {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        support::Host.compare(a, b)
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        if values.iter().flatten().any(|v| matches!(v, WireValue::Record(fields) if fields.iter().any(|(k, _)| k == "toString"))) {
            return Err(problem("HOST_ORDER_FAILURE", "Cannot convert object to primitive value"));
        }
        support::Host.sort_permutation(values, descending)
    }
}

#[test]
fn hidden_invalid_leaf_sort_value_still_refuses_measure_alias_sort() {
    let (_, mut input, mut definition, _) = support::fixture("typed-blanks");
    let config = definition.definition.table.pivot.as_mut().unwrap();
    config.grouping = vec!["dimension".into()];
    config.split.clear();
    // The measure is named sum, but sorting its leaves reads the source revenue.
    definition.definition.table.sorting = Some(vec![Sort {
        id: "sum".into(),
        desc: true,
    }]);
    input.rows[0].values.insert(
        "revenue".into(),
        WireValue::Record(vec![("toString".into(), WireValue::Null)]),
    );
    // Put a second value in this same group so the unfiltered leaf sort compares it.
    let mut second = input.rows[0].clone();
    second.id = "second".into();
    second
        .values
        .insert("revenue".into(), WireValue::F64(WireNumber::Finite(7.)));
    input.rows.push(second);
    definition.definition.table.column_filters = Some(vec![SourceFilter {
        id: "revenue".into(),
        value: WireValue::Record(vec![(
            "min".into(),
            WireValue::F64(WireNumber::Finite(100000.)),
        )]),
    }]);
    let revision = Revision {
        widget_id: "test".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    assert!(prepare(
        &input,
        &definition,
        &SelectionSpec::None,
        &revision,
        &FallibleHost,
        false
    )
    .is_err());
}

#[test]
fn filtered_out_unrelated_facet_conversion_error_still_refuses() {
    let (_, mut input, mut definition, _) = support::fixture("legacy-all-operators");
    let config = definition.definition.table.pivot.as_mut().unwrap();
    config.measures.as_mut().unwrap().truncate(1); // Sum: otherwise safe for fast identity calculation.
    input.rows[0].values.insert(
        "team".into(),
        WireValue::Record(vec![("toString".into(), WireValue::Null)]),
    );
    definition.definition.table.column_filters = Some(vec![SourceFilter {
        id: "revenue".into(),
        value: WireValue::Record(vec![(
            "min".into(),
            WireValue::F64(WireNumber::Finite(100000.)),
        )]),
    }]);
    let revision = Revision {
        widget_id: "test".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    assert!(prepare(
        &input,
        &definition,
        &SelectionSpec::None,
        &revision,
        &support::Host,
        false
    )
    .is_err());
}

#[test]
fn empty_filtered_result_keeps_selected_source_group_identities() {
    let (_, input, mut definition, _) = support::fixture("legacy-all-operators");
    let config = definition.definition.table.pivot.as_mut().unwrap();
    config.grouping = vec!["region".into()];
    config.measures.as_mut().unwrap().truncate(1);
    let revision = Revision {
        widget_id: "test".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    let all = prepare(
        &input,
        &definition,
        &SelectionSpec::None,
        &revision,
        &support::Host,
        true,
    )
    .unwrap();
    let id = all.identity_ids.iter().next().unwrap().clone();
    definition.definition.table.column_filters = Some(vec![SourceFilter {
        id: "revenue".into(),
        value: WireValue::Record(vec![(
            "min".into(),
            WireValue::F64(WireNumber::Finite(100000.)),
        )]),
    }]);
    for selection in [
        SelectionSpec::Explicit {
            ids: vec![id.clone()],
        },
        SelectionSpec::AllMatching {
            excluded_ids: vec![id.clone()],
        },
    ] {
        let mut view = prepare(
            &input,
            &definition,
            &selection,
            &revision,
            &support::Host,
            false,
        )
        .unwrap();
        assert!(view.rows.is_empty());
        assert_eq!(view.identity_ids, all.identity_ids);
        selection::reconcile(&mut view, true, None, &[]);
        assert_eq!(
            serde_json::to_value(&view.selection).unwrap(),
            serde_json::to_value(&selection).unwrap()
        );
    }
}

#[test]
fn nested_filtered_views_preserve_descendant_order_for_selection_toggles() {
    let (_, mut input, mut definition, _) = support::fixture("legacy-all-operators");
    let mut row = input.rows[0].clone();
    row.values
        .insert("region".into(), WireValue::String("R".into()));
    input.rows = [("a", "A", 1.), ("z", "Z", 100.)]
        .into_iter()
        .map(|(id, team, revenue)| {
            let mut r = row.clone();
            r.id = id.into();
            r.values
                .insert("team".into(), WireValue::String(team.into()));
            r.values.insert(
                "revenue".into(),
                WireValue::F64(WireNumber::Finite(revenue)),
            );
            r
        })
        .collect();
    let config = definition.definition.table.pivot.as_mut().unwrap();
    config.grouping = vec!["region".into(), "team".into()];
    config.measures.as_mut().unwrap().truncate(1);
    definition.definition.table.sorting = Some(vec![Sort {
        id: "sum".into(),
        desc: true,
    }]);
    let revision = Revision {
        widget_id: "test".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    let all = prepare(
        &input,
        &definition,
        &SelectionSpec::None,
        &revision,
        &support::Host,
        true,
    )
    .unwrap();
    definition.definition.table.column_filters = Some(vec![SourceFilter {
        id: "revenue".into(),
        value: WireValue::Record(vec![(
            "min".into(),
            WireValue::F64(WireNumber::Finite(100000.)),
        )]),
    }]);
    let filtered = prepare(
        &input,
        &definition,
        &SelectionSpec::None,
        &revision,
        &support::Host,
        false,
    )
    .unwrap();
    assert_eq!(filtered.hierarchy, all.hierarchy);
}

struct IdentityAllocationCounter;
thread_local! {
    static COUNT_IDENTITY_ALLOCATIONS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static IDENTITY_ALLOCATIONS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
unsafe impl std::alloc::GlobalAlloc for IdentityAllocationCounter {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        let _ = COUNT_IDENTITY_ALLOCATIONS.try_with(|enabled| {
            if enabled.get() {
                IDENTITY_ALLOCATIONS.with(|n| n.set(n.get() + 1));
            }
        });
        unsafe { std::alloc::System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
}
#[global_allocator]
static IDENTITY_ALLOCATOR: IdentityAllocationCounter = IdentityAllocationCounter;
fn identity_allocations(input: &SourceDataset, base: &PivotInput) -> (IdentityUniverse, usize) {
    IDENTITY_ALLOCATIONS.with(|n| n.set(0));
    COUNT_IDENTITY_ALLOCATIONS.with(|enabled| enabled.set(true));
    let result = identity_universe(input, base, "test");
    COUNT_IDENTITY_ALLOCATIONS.with(|enabled| enabled.set(false));
    (result.unwrap(), IDENTITY_ALLOCATIONS.with(|n| n.get()))
}
#[test]
fn repeated_string_group_identity_allocations_do_not_grow_with_rows() {
    let (_, mut input, definition, _) = support::fixture("typed-blanks");
    let mut config = definition.definition.table.pivot.unwrap();
    config.grouping = vec!["dimension".into()];
    config.split.clear();
    input.rows.truncate(1);
    input.rows[0]
        .values
        .insert("dimension".into(), WireValue::String("repeat".into()));
    let base = PivotInput {
        rows: vec![],
        columns: input
            .columns
            .iter()
            .map(|c| PivotColumn::source(&c.id, &c.label))
            .collect(),
        kinds: BTreeMap::new(),
        order: vec![],
        config,
        sorting: vec![],
        aggregate_only: false,
        category_metadata: BTreeMap::new(),
    };
    let (one, single) = identity_allocations(&input, &base);
    input.rows = (0..1000)
        .map(|i| {
            let mut row = input.rows[0].clone();
            row.id = format!("r{i}");
            row
        })
        .collect();
    let (many, repeated) = identity_allocations(&input, &base);
    assert_eq!(one, many);
    eprintln!("identity allocations: single={single}, repeated={repeated}");
    assert!(
        repeated <= single + 16,
        "repeating one group allocated per row: single={single}, repeated={repeated}"
    );
}

#[test]
fn identity_string_cache_overflow_keeps_every_group() {
    let (_, mut input, definition, _) = support::fixture("typed-blanks");
    let mut config = definition.definition.table.pivot.unwrap();
    config.grouping = vec!["dimension".into()];
    config.split.clear();
    let original = input.rows[0].clone();
    input.rows = (0..300)
        .flat_map(|i| (0..2).map(move |j| (i, j)))
        .map(|(i, j)| {
            let mut row = original.clone();
            row.id = format!("r{i}-{j}");
            row.values
                .insert("dimension".into(), WireValue::String(format!("group{i}")));
            row
        })
        .collect();
    let base = PivotInput {
        rows: vec![],
        columns: input
            .columns
            .iter()
            .map(|c| PivotColumn::source(&c.id, &c.label))
            .collect(),
        kinds: BTreeMap::new(),
        order: vec![],
        config,
        sorting: vec![],
        aggregate_only: false,
        category_metadata: BTreeMap::new(),
    };
    let (ids, hierarchy) = identity_universe(&input, &base, "test").unwrap();
    assert_eq!(ids.len(), 300);
    assert_eq!(hierarchy.len(), 300);
    assert!(hierarchy.values().all(Vec::is_empty));
}
