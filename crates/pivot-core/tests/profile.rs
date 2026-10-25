// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod support;
use pivot_core::{contract::*, session::*};
use std::collections::BTreeMap;
use support::*;
fn call(s: &mut Session, operation: Operation) -> CoreResponse {
    let revision = Revision {
        widget_id: "oracle".into(),
        input: 1,
        model: 1,
        output: 1,
    };
    s.dispatch(
        CoreRequest {
            request_id: "profile".into(),
            revision,
            operation,
        },
        &PlainOrder,
    )
}
fn session(input: SourceDataset) -> Session {
    let mut s = Session::new("en-US".into(), ResourceLimits::default());
    s.register(input, 1).unwrap();
    s
}
fn op(
    d: &ValidatedDefinition,
    scope: ProfileScope,
    offset: u64,
    limit: u32,
    fields: Option<&[&str]>,
) -> Operation {
    Operation::ColumnProfile {
        definition: d.clone(),
        scope,
        offset,
        limit,
        fields: fields.map(|f| f.iter().map(|id| id.to_string()).collect()),
    }
}
fn page(s: &mut Session, o: Operation) -> ColumnProfileResult {
    match call(s, o).result {
        Response::ColumnProfile(p) => p,
        other => panic!("{other:?}"),
    }
}
fn refused(s: &mut Session, o: Operation) -> String {
    match call(s, o).result {
        Response::Error(d) => d.code,
        other => panic!("{other:?}"),
    }
}
fn field<'a>(p: &'a ColumnProfileResult, id: &str) -> &'a ColumnProfile {
    p.fields.iter().find(|f| f.id == id).unwrap()
}
fn ids(p: &ColumnProfileResult) -> Vec<&str> {
    p.fields.iter().map(|f| f.id.as_str()).collect()
}
fn n(x: f64) -> WireValue {
    WireValue::F64(WireNumber::Finite(x))
}
fn st(x: &str) -> WireValue {
    WireValue::String(x.into())
}
fn row(id: &str, values: Vec<(&str, WireValue)>) -> DatasetRow {
    DatasetRow {
        id: id.into(),
        values: values.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        group_path: None,
        cell_errors: None,
        cell_formats: None,
    }
}
fn revenue_at_most(d: &mut ValidatedDefinition, max: f64) {
    d.definition.table.column_filters = Some(vec![SourceFilter {
        id: "revenue".into(),
        value: WireValue::Record(vec![("max".into(), n(max))]),
    }]);
}
// The fixture: r0 A 10 "0" 2026-01-01, r1 A 20 "1" 2026-01-02, r2 B 90 "2" 2026-01-03.
#[test]
fn input_scope_profiles_every_source_column_exactly() {
    let (_, input, d, _) = fixture("runtime-authoring-linked");
    let mut s = session(input);
    let r = call(&mut s, op(&d, ProfileScope::Input, 0, 100, None));
    assert_eq!(
        serde_json::to_value(&r.completeness).unwrap()["kind"],
        "complete"
    );
    assert!(r.diagnostics.is_empty());
    let Response::ColumnProfile(p) = r.result else {
        panic!("{:?}", r.result)
    };
    // sourceDouble is a source formula: computed columns are never listed.
    assert_eq!(ids(&p), ["revenue", "region", "team", "date"]);
    assert_eq!(
        (
            p.rows_profiled,
            p.total,
            p.next_offset,
            p.filters_active,
            p.filtered_rows
        ),
        (3, 4, None, Some(false), Some(3))
    );
    let revenue = field(&p, "revenue");
    assert_eq!(
        (
            revenue.kind.as_str(),
            revenue.count,
            revenue.missing,
            revenue.distinct,
            revenue.distinct_capped,
            revenue.cell_errors
        ),
        ("number", 3, 0, 3, false, 0)
    );
    assert_eq!(
        (revenue.min.clone(), revenue.max.clone()),
        (Some(n(10.)), Some(n(90.)))
    );
    assert_eq!(revenue.samples, vec![n(10.), n(20.), n(90.)]);
    assert_eq!(revenue.periodicity, None);
    let region = field(&p, "region");
    assert_eq!(
        (
            region.kind.as_str(),
            region.distinct,
            region.samples.clone(),
            region.min.clone()
        ),
        ("text", 2, vec![st("A"), st("B")], None)
    );
    let date = field(&p, "date");
    assert_eq!(
        (
            date.min.clone(),
            date.max.clone(),
            date.periodicity.as_deref()
        ),
        (
            Some(st("2026-01-01")),
            Some(st("2026-01-03")),
            Some("daily")
        )
    );
    let wire = serde_json::to_value(&p).unwrap();
    assert_eq!(wire["fields"][0]["type"], "number");
    assert_eq!(wire["rowsProfiled"], 3);
    assert!(wire["fields"][1].get("min").is_none());
}
#[test]
fn filtered_scope_never_shows_an_excluded_record() {
    let (_, input, mut d, _) = fixture("runtime-authoring-linked");
    revenue_at_most(&mut d, 20.);
    let mut s = session(input);
    let p = page(&mut s, op(&d, ProfileScope::Filtered, 0, 100, None));
    assert_eq!(
        (p.rows_profiled, p.filters_active, p.filtered_rows),
        (2, None, None)
    );
    let region = field(&p, "region");
    assert_eq!(
        (region.count, region.distinct, region.samples.clone()),
        (2, 1, vec![st("A")])
    );
    let revenue = field(&p, "revenue");
    assert_eq!(
        (revenue.max.clone(), revenue.samples.clone()),
        (Some(n(20.)), vec![n(10.), n(20.)])
    );
    assert_eq!(field(&p, "date").max, Some(st("2026-01-02")));
    let wire = serde_json::to_string(&p).unwrap();
    assert!(
        !wire.contains("\"B\"") && !wire.contains("2026-01-03") && !wire.contains("90"),
        "{wire}"
    );
    let all = page(&mut s, op(&d, ProfileScope::Input, 0, 100, None));
    assert_eq!(
        (all.rows_profiled, all.filters_active, all.filtered_rows),
        (3, Some(true), Some(2))
    );
}
#[test]
fn a_table_without_a_model_profiles_its_source_rows() {
    let (_, input, mut d, _) = fixture("runtime-authoring-linked");
    d.definition.analytical = None;
    d.analytical_recipe_source = None;
    revenue_at_most(&mut d, 20.);
    let mut s = session(input);
    let p = page(
        &mut s,
        op(&d, ProfileScope::Filtered, 0, 100, Some(&["region"])),
    );
    assert_eq!(
        (p.rows_profiled, p.fields[0].samples.clone()),
        (2, vec![st("A")])
    );
    let all = page(&mut s, op(&d, ProfileScope::Input, 0, 100, None));
    assert_eq!(
        (all.rows_profiled, all.filtered_rows, all.filters_active),
        (3, Some(2), Some(true))
    );
}
#[test]
fn pages_fields_and_honours_an_explicit_field_list() {
    let (_, input, d, _) = fixture("runtime-authoring-linked");
    let mut s = session(input);
    let first = page(&mut s, op(&d, ProfileScope::Input, 0, 2, None));
    assert_eq!(
        (ids(&first), first.next_offset),
        (vec!["revenue", "region"], Some(2))
    );
    let last = page(&mut s, op(&d, ProfileScope::Input, 2, 2, None));
    assert_eq!((ids(&last), last.next_offset), (vec!["team", "date"], None));
    let picked = page(
        &mut s,
        op(&d, ProfileScope::Input, 0, 100, Some(&["date", "revenue"])),
    );
    assert_eq!((ids(&picked), picked.total), (vec!["date", "revenue"], 2));
    let past = page(&mut s, op(&d, ProfileScope::Input, 9, 100, None));
    assert_eq!((past.fields.len(), past.next_offset), (0, None));
}
#[test]
fn distinct_is_exact_to_one_thousand_then_capped() {
    let (_, mut input, d, _) = fixture("runtime-authoring-linked");
    distinct_regions(&mut input.rows, 1000);
    let mut s = session(input.clone());
    let exact = page(&mut s, op(&d, ProfileScope::Input, 0, 1, Some(&["region"])));
    assert_eq!(
        (exact.fields[0].distinct, exact.fields[0].distinct_capped),
        (1000, false)
    );
    distinct_regions(&mut input.rows, 1001);
    let mut s = session(input);
    let capped = page(&mut s, op(&d, ProfileScope::Input, 0, 1, Some(&["region"])));
    let region = &capped.fields[0];
    assert_eq!(
        (region.distinct, region.distinct_capped, region.count),
        (1000, true, 1001)
    );
    assert_eq!(
        region.samples,
        ["R0", "R1", "R2", "R3", "R4"].map(st).to_vec()
    );
}
#[test]
fn messy_cells_are_counted_but_never_sampled_or_ranged() {
    let (_, mut input, mut d, _) = fixture("runtime-authoring-linked");
    d.definition.analytical = None;
    d.analytical_recipe_source = None;
    let nan = WireValue::F64(WireNumber::Special(SpecialNumber::Nan));
    let mut first = row(
        "a",
        vec![
            ("revenue", n(10.)),
            ("region", st(&"€".repeat(50))),
            ("team", st("x")),
            ("date", st("2026-01-01")),
        ],
    );
    first.cell_errors = Some(BTreeMap::from([(
        "revenue".to_string(),
        serde_json::from_value(serde_json::json!({"code":"parse","message":"not a number"}))
            .unwrap(),
    )]));
    input.rows = vec![
        first,
        row(
            "a",
            vec![
                ("revenue", n(999.)),
                ("region", st("dup")),
                ("team", st("x")),
                ("date", st("2026-01-01")),
            ],
        ),
        row(
            "b",
            vec![
                ("revenue", nan),
                ("region", st("")),
                ("date", st("2026-02-01")),
            ],
        ),
        row(
            "c",
            vec![
                ("revenue", WireValue::Null),
                ("region", WireValue::Bool(true)),
                ("team", st("x")),
                ("date", st("2026-03-01")),
            ],
        ),
        row(
            "d",
            vec![
                ("revenue", n(-5.)),
                ("region", st("A")),
                ("team", st("x")),
                ("date", st("2026-04-01")),
            ],
        ),
    ];
    let mut s = session(input);
    let p = page(&mut s, op(&d, ProfileScope::Input, 0, 100, None));
    assert_eq!(p.rows_profiled, 4); // the second "a" is a duplicate id
    let revenue = field(&p, "revenue");
    assert_eq!(
        (
            revenue.count,
            revenue.missing,
            revenue.distinct,
            revenue.cell_errors
        ),
        (3, 1, 3, 1)
    );
    assert_eq!(
        (revenue.min.clone(), revenue.max.clone()),
        (Some(n(-5.)), Some(n(10.)))
    );
    assert_eq!(revenue.samples, vec![n(10.), n(-5.)]); // NaN is present but never a sample
    let region = field(&p, "region");
    assert_eq!((region.count, region.missing), (3, 1));
    assert_eq!(
        region.samples,
        vec![st(&"€".repeat(40)), WireValue::Bool(true), st("A")]
    );
    assert_eq!((field(&p, "team").count, field(&p, "team").missing), (3, 1));
    assert_eq!(field(&p, "date").periodicity.as_deref(), Some("monthly"));
}
#[test]
fn refuses_bad_pages_and_unknown_duplicate_or_computed_fields() {
    let (_, input, d, _) = fixture("runtime-authoring-linked");
    let mut s = session(input);
    let many: Vec<String> = (0..101).map(|i| format!("f{i}")).collect();
    let many: Vec<&str> = many.iter().map(String::as_str).collect();
    for bad in [
        op(&d, ProfileScope::Input, 0, 0, None),
        op(&d, ProfileScope::Input, 0, 101, None),
        op(&d, ProfileScope::Input, 0, 100, Some(&["nope"])),
        op(&d, ProfileScope::Input, 0, 100, Some(&["date", "date"])),
        op(&d, ProfileScope::Input, 0, 100, Some(&["sourceDouble"])),
        op(&d, ProfileScope::Input, 0, 100, Some(&many)),
        op(&d, ProfileScope::Input, 9007199254740992, 100, None),
    ] {
        assert_eq!(refused(&mut s, bad), "INVALID_REQUEST");
    }
}
