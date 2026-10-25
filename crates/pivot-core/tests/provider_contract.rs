// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{contract::*, provider_contract::preflight, session::*};
use support::*;
fn capabilities() -> CapabilityDeclaration {
    CapabilityDeclaration {
        protocol_versions: vec![1],
        definition_versions: vec![1, 2],
        aggregations: vec![
            Aggregation::Sum,
            Aggregation::Min,
            Aggregation::Max,
            Aggregation::Mean,
            Aggregation::Median,
            Aggregation::Count,
            Aggregation::UniqueCount,
            Aggregation::First,
            Aggregation::Last,
        ],
        formula_functions: vec![],
        fiscal: false,
        inspection: true,
        selection: false,
        identity_witness: true,
        remote_acquisition: false,
    }
}
#[test]
fn unsupported_function_fiscal_version_and_selection_refuse_before_apply() {
    for name in ["ratio-source-scope", "mixed-fiscal-calendars"] {
        let (_, _, def, _) = fixture(name);
        assert_eq!(
            preflight(&capabilities(), &def, &SelectionSpec::None)
                .unwrap_err()
                .code,
            "UNSUPPORTED_CAPABILITY"
        );
    }
    let (_, _, mut def, _) = fixture("ratio-source-scope");
    def.definition
        .analytical
        .as_mut()
        .unwrap()
        .table_mut()
        .unwrap()
        .schema_version = 99;
    assert!(preflight(&capabilities(), &def, &SelectionSpec::None).is_err());
    let (_, _, legacy, _) = fixture("legacy-all-operators");
    let mut no_aggregations = capabilities();
    no_aggregations.aggregations.clear();
    assert!(preflight(&no_aggregations, &legacy, &SelectionSpec::None).is_err());
    let (_, _, def, _) = fixture("raw");
    assert!(preflight(
        &capabilities(),
        &def,
        &SelectionSpec::AllMatching {
            excluded_ids: vec![]
        }
    )
    .is_err());
    assert!(preflight(&capabilities(), &def, &SelectionSpec::None).is_ok());
}
#[test]
fn complete_scope_schema_totals_and_reversed_windows_match_frozen_baseline() {
    let (root, input, def, runtime) = fixture("analytical-source-split");
    let revision = Revision {
        widget_id: "oracle".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    let mut session = Session::new("en-US".into(), ResourceLimits::default());
    session.register(input, 1).unwrap();
    let mut call = |operation| {
        session
            .dispatch(
                CoreRequest {
                    request_id: "q".into(),
                    revision: revision.clone(),
                    operation,
                },
                &Host,
            )
            .result
    };
    let Response::ViewReady(ready) = call(Operation::ApplyModel {
        definition: def,
        selection: SelectionSpec::None,
        reconcile_missing: false,
        previous_selection_namespace: None,
        proven_absent_ids: vec![],
        runtime_params: runtime,
    }) else {
        panic!("ready")
    };
    assert_eq!(ready.columns.len(), 4); // Group and all three split members, including unloaded B/team 2.
    assert!(matches!(
        ready.top_level_count,
        ResultCount::Exact { value: 2 }
    ));
    let want = get(&root, "result");
    fn decoded(value: serde_json::Value) -> serde_json::Value {
        if let Ok(wire) = serde_json::from_value::<WireValue>(value.clone()) {
            return plain(&wire);
        }
        match value {
            serde_json::Value::Array(a) => {
                serde_json::Value::Array(a.into_iter().map(decoded).collect())
            }
            serde_json::Value::Object(o) => {
                serde_json::Value::Object(o.into_iter().map(|(k, v)| (k, decoded(v))).collect())
            }
            v => v,
        }
    }
    assert_eq!(
        decoded(serde_json::to_value(&ready.columns).unwrap()),
        plain(get(get(want, "ready"), "columns"))
    );
    for size in [1u32, 2, 50] {
        let delivery = arr(get(want, "deliveries"))
            .iter()
            .find(|d| plain(get(d, "size")) == serde_json::json!(size))
            .unwrap();
        for block in arr(get(delivery, "blocks")) {
            let request:RowRequest=serde_json::from_value(serde_json::json!({"groupPath":plain(get(block,"groupPath")),"offset":plain(get(block,"offset")),"limit":size})).unwrap();
            let Response::Rows(rows) = call(Operation::Rows(request)) else {
                panic!("rows")
            };
            let expected = arr(get(block, "rows"));
            assert_eq!(rows.rows.len(), expected.len());
            for (row, want) in rows.rows.iter().zip(expected) {
                assert_eq!(row.id, text(get(want, "id")));
                assert_values(&row.values, get(want, "values"), "provider row");
            }
            assert_eq!(
                serde_json::to_value(rows.sibling_count).unwrap(),
                serde_json::json!({"kind":"exact","value":plain(get(block,"siblingCount"))})
            );
        }
        let Response::Totals(totals) = call(Operation::Totals) else {
            panic!("totals")
        };
        assert_values(
            &totals.values,
            get(get(want, "totals"), "values"),
            "complete source totals",
        );
    }
}
#[test]
fn unavailable_counts_are_explicit_and_never_exact_zero() {
    for count in [
        ResultCount::Unknown,
        ResultCount::SnapshotExpired,
        ResultCount::Estimated { value: 5 },
    ] {
        let wire = serde_json::to_value(count).unwrap();
        assert_ne!(wire, serde_json::json!({"kind":"exact","value":0}));
        let restored: ResultCount = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(restored).unwrap(), wire);
    }
}
#[test]
fn statement_needs_sum_but_not_unused_last_aggregation() {
    let (_, _, definition, _) = fixture("statement-income-wide");
    let mut declared = capabilities();
    declared.fiscal = true;
    declared.aggregations = vec![Aggregation::Sum];
    assert!(preflight(&declared, &definition, &SelectionSpec::None).is_ok());
}
