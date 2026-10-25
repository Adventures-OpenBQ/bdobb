// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{contract::*, ordering::*, pivot::*};
use std::{
    cmp::Ordering,
    collections::BTreeMap,
    io::Write,
    process::{Command, Stdio},
};
mod support;
use support::compare_values;
// Existing success expectations unwrap the fallible public aggregate API.
fn aggregate(
    op: Aggregation,
    rows: &[ValueRecord],
    field: &str,
    date: Option<&str>,
    order: &dyn ValueOrder,
) -> WireValue {
    pivot_core::pivot::aggregate(op, rows, field, date, order).unwrap()
}
fn s(x: &str) -> WireValue {
    WireValue::String(x.into())
}
fn n(x: f64) -> WireValue {
    WireValue::F64(WireNumber::Finite(x))
}
fn row(entries: Vec<(&str, WireValue)>) -> ValueRecord {
    entries.into_iter().map(|(k, v)| (k.into(), v)).collect()
}
fn config(grouping: Vec<&str>, split: Vec<&str>) -> PivotConfig {
    PivotConfig {
        enabled: true,
        grouping: grouping.into_iter().map(str::to_owned).collect(),
        split: split.into_iter().map(str::to_owned).collect(),
        expanded: None,
        key_encoding: None,
        legacy_expanded: None,
        measures: None,
        aggregation_fns: None,
        buckets: None,
    }
}
fn input(rows: Vec<ValueRecord>, fields: Vec<&str>, config: PivotConfig) -> PivotInput {
    PivotInput {
        rows,
        columns: fields.iter().map(|f| PivotColumn::source(f, f)).collect(),
        kinds: BTreeMap::new(),
        order: fields.into_iter().map(str::to_owned).collect(),
        config,
        sorting: vec![],
        aggregate_only: false,
        category_metadata: BTreeMap::new(),
    }
}
// Native tests negotiate with the actual baseline Intl.Collator. No bytewise text fallback.
struct LocaleOrder;
impl ValueOrder for LocaleOrder {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
        Ok(compare_values(a, b, &|a, b| {
            let mut child=Command::new("node").args(["-e","let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const [a,b]=JSON.parse(s);console.log(Math.sign(new Intl.Collator('en-US',{sensitivity:'base',numeric:true}).compare(a,b)))})"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(serde_json::to_string(&(a, b)).unwrap().as_bytes())
                .unwrap();
            let result = child.wait_with_output().unwrap();
            assert!(result.status.success());
            String::from_utf8(result.stdout)
                .unwrap()
                .trim()
                .parse::<i32>()
                .unwrap()
                .cmp(&0)
        }))
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        let script = r#"let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{
        const decode=w=>{switch(w.tag){case'missing':return undefined;case'null':return null;case'f64':return typeof w.value==='number'?w.value:w.value==='-0'?-0:Number(w.value);case'bigint-string':return BigInt(w.value);case'array':return w.value.map(decode);case'record':return Object.fromEntries(w.value.map(([k,v])=>[k,decode(v)]));default:return w.value}};
        const [wire,descending]=JSON.parse(s),values=wire.map(row=>row.map(decode));
        const collator=new Intl.Collator('en-US',{sensitivity:'base',numeric:true});const missing=x=>x===null||x===undefined||x==='';
        const compare=(a,b)=>{const am=missing(a),bm=missing(b);if(am||bm)return am===bm?0:am?1:-1;if(typeof a==='number'&&typeof b==='number')return a-b;return collator.compare(String(a),String(b))};
        const indexes=values.map((_,i)=>i).sort((a,b)=>{for(let key=0;key<descending.length;key++){const left=values[a][key],right=values[b][key];const raw=compare(left,right),c=descending[key]&&!missing(left)&&!missing(right)?-raw:raw;if(c!==0)return c}return 0});console.log(JSON.stringify(indexes));
      })"#;
        let mut child = Command::new("node")
            .args(["-e", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(
                serde_json::to_string(&(values, descending))
                    .unwrap()
                    .as_bytes(),
            )
            .unwrap();
        let result = child.wait_with_output().unwrap();
        assert!(result.status.success());
        Ok(serde_json::from_slice(&result.stdout).unwrap())
    }
}
#[test]
fn aggregation_blanks_dates_and_distinct_normalization() {
    let rows = vec![
        row(vec![("v", n(20.)), ("d", s("2025-02-28"))]),
        row(vec![("v", n(10.)), ("d", s("2025-01-31"))]),
        row(vec![("v", WireValue::Null), ("d", s("2025-03-31"))]),
        row(vec![("v", n(12.)), ("d", s("2025-01-31"))]),
    ];
    for (op, want) in [
        (Aggregation::Sum, n(42.)),
        (Aggregation::Min, n(10.)),
        (Aggregation::Max, n(20.)),
        (Aggregation::Mean, n(14.)),
        (Aggregation::Median, n(12.)),
        (Aggregation::Count, s("3")),
        (Aggregation::UniqueCount, s("3")),
        (Aggregation::First, n(10.)),
        (Aggregation::Last, n(20.)),
    ] {
        assert_eq!(aggregate(op, &rows, "v", Some("d"), &LocaleOrder), want);
    }
    assert_eq!(
        aggregate(Aggregation::Last, &rows, "v", None, &LocaleOrder),
        WireValue::Missing
    );
    assert_eq!(
        aggregate(
            Aggregation::UniqueCount,
            &[
                row(vec![("v", n(1.))]),
                row(vec![("v", s("1"))]),
                row(vec![("v", WireValue::BigIntString("1".into()))])
            ],
            "v",
            None,
            &LocaleOrder
        ),
        s("1")
    );
    for op in [
        Aggregation::Sum,
        Aggregation::Mean,
        Aggregation::Median,
        Aggregation::Min,
        Aggregation::Max,
        Aggregation::First,
        Aggregation::Last,
    ] {
        assert_eq!(
            aggregate(op, &[], "v", Some("d"), &LocaleOrder),
            WireValue::Missing
        );
    }
    for op in [Aggregation::Count, Aggregation::UniqueCount] {
        assert_eq!(aggregate(op, &[], "v", None, &LocaleOrder), s("0"));
    }
}
#[test]
fn typed_paths_stable_ties_folds_leaf_sort_and_missing_last() {
    let mut i = input(
        vec![
            row(vec![("g", s("é")), ("v", n(1.))]),
            row(vec![("g", s("E")), ("v", n(2.))]),
            row(vec![("g", WireValue::Null)]),
            row(vec![("g", s("é")), ("v", n(3.))]),
        ],
        vec!["g", "v"],
        config(vec!["g"], vec![]),
    );
    i.config.aggregation_fns = Some(BTreeMap::from([("v".into(), Aggregation::Sum)]));
    i.config.key_encoding = Some(KeyEncoding::TypedV1);
    i.config.expanded = Some(Expanded::Paths(BTreeMap::from([(
        "[\"string\",\"é\"]".into(),
        false,
    )])));
    i.sorting = vec![Sort {
        id: "v".into(),
        desc: true,
    }];
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(
        p.rows
            .iter()
            .map(|r| r.get(LABEL_FIELD).cloned())
            .collect::<Vec<_>>(),
        vec![Some(s("é")), Some(s("E")), None, Some(s("(blank)")), None]
    );
    assert!(
        matches!(&p.meta[0],PivotRowMeta::Group{path,open:false,count:2,..} if path=="[\"string\",\"é\"]")
    );
    assert_eq!(
        pivot_value_key(&s("x\u{1f}y")),
        "[\"string\",\"x\\u001fy\"]"
    );
    assert_eq!(pivot_value_key(&n(-0.)), "[\"number\",0]");
    i.config.expanded = None;
    i.sorting = vec![];
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(p.rows[0][LABEL_FIELD], s("é"));
    assert_eq!(p.rows[3][LABEL_FIELD], s("E"));
}
#[test]
fn date_buckets_completeness_and_split_metadata() {
    let mut i = input(
        vec![
            row(vec![("d", s("2024-01-31")), ("v", n(1.))]),
            row(vec![("d", s("2024-02-29")), ("v", n(2.))]),
            row(vec![("d", s("2024-04-30")), ("v", n(3.))]),
            row(vec![("d", s("2024-05-31")), ("v", n(4.))]),
        ],
        vec!["d", "v"],
        config(vec!["d"], vec![]),
    );
    i.kinds.insert("d".into(), FieldKind::Date);
    i.config.buckets = Some(BTreeMap::from([("d".into(), Bucket::Quarter)]));
    i.config.aggregation_fns = Some(BTreeMap::from([("v".into(), Aggregation::Sum)]));
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(p.rows[0][LABEL_FIELD], s("2024 Q1"));
    assert!(matches!(
        &p.meta[0],
        PivotRowMeta::Group {
            incomplete: Some(Incomplete {
                have: 2,
                expected: 3
            }),
            ..
        }
    ));
    i.config.grouping.clear();
    i.config.split = vec!["d".into()];
    i.columns[1].properties = row(vec![
        ("pinned", s("left")),
        ("cellClick", s("click")),
        ("flash", WireValue::Bool(true)),
        ("rangeBar", s("range")),
        ("editable", WireValue::Bool(true)),
    ]);
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(p.columns[1].field, "[\"string\",\"2024-Q1\"]\u{1f}v");
    assert_eq!(p.columns[1].group_path, vec!["2024 Q1 (2 of 3)"]);
    assert_eq!(
        p.columns[1].properties.get("pinned"),
        Some(&WireValue::Missing)
    );
    assert_eq!(p.columns[1].properties["flash"], WireValue::Bool(true));
    assert_eq!(p.columns[1].properties["editable"], WireValue::Bool(false));
    for (date, bucket, want) in [
        ("2021-01-01", Bucket::Week, "2020-W53"),
        ("2024-03-31T16:00:00-04:00", Bucket::Quarter, "2024-Q1"),
        ("2024-03-31", Bucket::Month, "2024-03"),
        ("2024-03-31", Bucket::Year, "2024"),
    ] {
        assert_eq!(bucket_key(date, bucket).as_deref(), Some(want));
    }
}
#[test]
fn accepts_500_columns_refuses_501_and_pivot_off() {
    let mut i = input(
        vec![row(vec![("g", s("A"))])],
        vec!["g", "v"],
        config(vec!["g"], vec![]),
    );
    i.config.measures = Some(
        (0..499)
            .map(|x| Measure {
                id: format!("m{x}"),
                source_field_id: "v".into(),
                aggregation: Some(Aggregation::Count),
                custom_label: None,
            })
            .collect(),
    );
    assert_eq!(pivot(&i, &LocaleOrder).unwrap().unwrap().columns.len(), 500);
    i.config.measures.as_mut().unwrap().push(Measure {
        id: "overflow".into(),
        source_field_id: "v".into(),
        aggregation: None,
        custom_label: None,
    });
    assert_eq!(
        pivot(&i, &LocaleOrder).unwrap_err().code,
        "pivot-column-limit"
    );
    i.config.enabled = false;
    assert!(pivot(&i, &LocaleOrder).unwrap().is_none());
    i.config.enabled = true;
    i.config.grouping.clear();
    i.config.measures = Some(vec![]);
    assert!(pivot(&i, &LocaleOrder).unwrap().is_none());
    i.aggregate_only = true;
    assert_eq!(
        pivot(&i, &LocaleOrder).unwrap().unwrap().rows[0][LABEL_FIELD],
        s("Total")
    );
}
fn get<'a>(v: &'a WireValue, key: &str) -> &'a WireValue {
    if let WireValue::Record(xs) = v {
        xs.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
            .unwrap_or(&WireValue::Missing)
    } else {
        panic!("not record")
    }
}
fn array(v: &WireValue) -> &[WireValue] {
    if let WireValue::Array(xs) = v {
        xs
    } else {
        panic!("not array")
    }
}
fn string(v: &WireValue) -> &str {
    if let WireValue::String(x) = v {
        x
    } else {
        panic!("not string")
    }
}
fn record(v: &WireValue) -> ValueRecord {
    if let WireValue::Record(xs) = v {
        xs.iter().cloned().collect()
    } else {
        panic!("not record")
    }
}
// Test-only structural adapter: tagged cells remain WireValue without primitive coercion.
fn plain(v: &WireValue) -> serde_json::Value {
    match v {
        WireValue::Record(xs) => xs.iter().map(|(k, v)| (k.clone(), plain(v))).collect(),
        WireValue::Array(xs) => xs.iter().map(plain).collect(),
        WireValue::String(x) => x.clone().into(),
        WireValue::Bool(x) => (*x).into(),
        WireValue::F64(WireNumber::Finite(x)) => serde_json::json!(x),
        WireValue::Missing | WireValue::Null => serde_json::Value::Null,
        _ => panic!("special scalar only allowed in opaque value positions"),
    }
}
#[test]
fn frozen_legacy_oracle_projection() {
    for name in [
        "legacy-all-operators",
        "legacy-saved-bucket",
        "typed-blanks",
    ] {
        let root: WireValue = serde_json::from_str(
            &std::fs::read_to_string(format!("../../src/test/fixtures/rust-pivot/{name}.json"))
                .unwrap(),
        )
        .unwrap();
        let case = get(&root, "case");
        let ds = get(case, "dataset");
        let definition = get(case, "definition");
        let cfg: PivotConfig =
            serde_json::from_value(plain(get(get(definition, "table"), "pivot"))).unwrap();
        let fields = array(get(ds, "columns"))
            .iter()
            .map(|c| string(get(c, "id")))
            .collect::<Vec<_>>();
        let mut i = input(
            array(get(ds, "rows"))
                .iter()
                .map(|r| record(get(r, "values")))
                .collect(),
            fields,
            cfg,
        );
        i.columns = array(get(ds, "columns"))
            .iter()
            .map(|c| PivotColumn::source(string(get(c, "id")), string(get(c, "label"))))
            .collect();
        for c in array(get(ds, "columns")) {
            let kind = match get(c, "dtype") {
                WireValue::String(x) if x == "date" => FieldKind::Date,
                WireValue::String(x) if x == "number" => FieldKind::Number,
                _ => FieldKind::Text,
            };
            i.kinds.insert(string(get(c, "id")).into(), kind);
        }
        let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
        let chart = get(get(&root, "result"), "chart");
        let actual = p
            .rows
            .iter()
            .zip(&p.meta)
            .filter(|(_, m)| !matches!(m, PivotRowMeta::Leaf { .. }))
            .map(|(r, _)| r.clone())
            .collect::<Vec<_>>();
        let expected = array(get(chart, "rows"))
            .iter()
            .map(|r| {
                let mut r = record(get(r, "values"));
                for key in ["count", "uniqueCount"] {
                    if let Some(WireValue::F64(WireNumber::Finite(v))) = r.get(key) {
                        r.insert(key.into(), s(&v.to_string()));
                    }
                }
                r
            })
            .collect::<Vec<_>>();
        assert_eq!(actual, expected, "{name} cells");
        let expected_columns = array(get(chart, "columns"));
        assert_eq!(
            p.columns.len(),
            expected_columns.len(),
            "{name} column count"
        );
        for (col, want) in p.columns.iter().zip(expected_columns) {
            assert_eq!(col.field, string(get(want, "id")), "{name} IDs");
            assert_eq!(col.header, string(get(want, "label")), "{name} labels");
            if let WireValue::Array(path) = get(want, "splitPath") {
                assert_eq!(
                    col.split_keys,
                    path.iter()
                        .map(|member| string(get(member, "memberKey")).to_owned())
                        .collect::<Vec<_>>(),
                    "{name} split keys"
                );
            }
        }
        for (meta, want) in p
            .meta
            .iter()
            .filter(|m| !matches!(m, PivotRowMeta::Leaf { .. }))
            .zip(array(get(chart, "rows")))
        {
            if let PivotRowMeta::Group { path, .. } = meta {
                assert_eq!(
                    *path,
                    array(get(want, "groupPath"))
                        .iter()
                        .map(|m| string(get(m, "memberKey")))
                        .collect::<Vec<_>>()
                        .join("\u{1f}"),
                    "{name} group path"
                );
            }
        }
    }
}
#[test]
fn number_identity_uses_javascript_exponent_thresholds() {
    for (value, want) in [
        (1., "[\"number\",1]"),
        (1e20, "[\"number\",100000000000000000000]"),
        (1e21, "[\"number\",1e+21]"),
        (1e-6, "[\"number\",0.000001]"),
        (1e-7, "[\"number\",1e-7]"),
        (9007199254740992., "[\"number\",9007199254740992]"),
    ] {
        assert_eq!(pivot_value_key(&n(value)), want);
    }
    let rows = vec![
        row(vec![("v", n(f64::INFINITY))]),
        row(vec![("v", s("9"))]),
        row(vec![("v", n(3.))]),
        row(vec![("v", WireValue::BigIntString("4".into()))]),
    ];
    assert_eq!(
        aggregate(Aggregation::Sum, &rows, "v", None, &LocaleOrder),
        n(3.)
    );
}
#[test]
fn nested_axes_category_sort_unset_measures_and_object_display() {
    let mut i = input(
        vec![
            row(vec![("g", s("A")), ("h", s("item10")), ("v", n(3.))]),
            row(vec![("g", s("A")), ("h", s("item2")), ("v", n(2.))]),
            row(vec![("g", s("B")), ("h", s("item2")), ("v", n(1.))]),
        ],
        vec!["g", "h", "v"],
        config(vec!["g", "g", "absent"], vec!["g", "h", "h"]),
    );
    i.config.measures = Some(vec![
        Measure {
            id: "g".into(),
            source_field_id: "v".into(),
            aggregation: Some(Aggregation::Sum),
            custom_label: Some("Custom".into()),
        },
        Measure {
            id: "unset".into(),
            source_field_id: "v".into(),
            aggregation: None,
            custom_label: None,
        },
        Measure {
            id: "again".into(),
            source_field_id: "v".into(),
            aggregation: Some(Aggregation::Sum),
            custom_label: None,
        },
        Measure {
            id: "duplicate".into(),
            source_field_id: "v".into(),
            aggregation: Some(Aggregation::Sum),
            custom_label: None,
        },
    ]);
    i.sorting = vec![Sort {
        id: "g".into(),
        desc: true,
    }];
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(p.rows.len(), 2);
    assert_eq!(p.rows[0][LABEL_FIELD], s("B"));
    assert_eq!(p.columns[1].group_path, vec!["item2"]);
    assert_eq!(p.columns[1].header, "Custom");
    assert_eq!(p.columns[3].header, "v — Total");
    assert_eq!(p.columns[4].header, "v — Total (2)");
    assert!(!p.rows[0].contains_key("[\"string\",\"item10\"]\u{1f}g"));
    assert!(!p.rows[0].contains_key("[\"string\",\"item2\"]\u{1f}unset"));
    i.config.split.clear();
    i.config.grouping = vec!["g".into(), "h".into()];
    i.sorting = vec![];
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert!(
        matches!(&p.meta[1],PivotRowMeta::Group{depth:1,path,..} if path=="[\"string\",\"A\"]\u{1f}[\"string\",\"item2\"]")
    );
    assert!(matches!(
        &p.meta[2],
        PivotRowMeta::Leaf {
            source_index: Some(1),
            ..
        }
    ));
    let mut object = input(
        vec![row(vec![(
            "g",
            WireValue::Record(vec![
                ("display".into(), s("chosen")),
                ("value".into(), s("fallback")),
            ]),
        )])],
        vec!["g"],
        config(vec!["g"], vec![]),
    );
    object.columns[0].properties.insert(
        "hoverCard".into(),
        WireValue::Record(vec![("cellField".into(), s("display"))]),
    );
    assert_eq!(
        pivot(&object, &LocaleOrder).unwrap().unwrap().rows[0][LABEL_FIELD],
        s("chosen")
    );
    object.columns[0].properties.clear();
    assert_eq!(
        pivot(&object, &LocaleOrder).unwrap().unwrap().rows[0][LABEL_FIELD],
        s("fallback")
    );
}
#[test]
fn split_column_limit_empty_totals_and_date_tie_last() {
    let mut i = input(
        vec![
            row(vec![("s", s("X")), ("v", n(1.))]),
            row(vec![("s", s("Y")), ("v", n(2.))]),
        ],
        vec!["s", "v"],
        config(vec![], vec!["s"]),
    );
    i.config.measures = Some(
        (0..250)
            .map(|x| Measure {
                id: format!("m{x}"),
                source_field_id: "v".into(),
                aggregation: Some(Aggregation::Sum),
                custom_label: None,
            })
            .collect(),
    );
    assert_eq!(pivot(&i,&LocaleOrder).unwrap_err().message,"Column Groups on s would make 501 columns (the limit is 500). Pick a coarser bucket, or move a field to Row Groups.");
    i.config.measures.as_mut().unwrap().pop();
    assert_eq!(pivot(&i, &LocaleOrder).unwrap().unwrap().columns.len(), 499);
    i.rows.clear();
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(p.columns.len(), 1);
    assert_eq!(p.rows[0], row(vec![(LABEL_FIELD, s("Total"))]));
    assert!(matches!(p.meta[0], PivotRowMeta::Total { count: 0, .. }));
    let rows = vec![
        row(vec![("v", n(10.)), ("d", s("2024-01-01"))]),
        row(vec![("v", n(12.)), ("d", s("2024-01-01"))]),
        row(vec![("v", n(14.)), ("d", WireValue::Null)]),
    ];
    assert_eq!(
        aggregate(Aggregation::Last, &rows, "v", Some("d"), &LocaleOrder),
        n(12.)
    );
}
#[test]
fn numeric_large_axis_sort_and_nonfinite_ties() {
    let mut i = input(
        (0..128)
            .rev()
            .map(|x| row(vec![("g", n(x as f64)), ("v", n(x as f64))]))
            .collect(),
        vec!["g", "v"],
        config(vec!["g"], vec![]),
    );
    i.config.aggregation_fns = Some(BTreeMap::from([("v".into(), Aggregation::Sum)]));
    i.config.key_encoding = Some(KeyEncoding::TypedV1);
    i.config.expanded = Some(Expanded::Paths(
        (0..128)
            .map(|x| (format!("[\"number\",{x}]"), false))
            .collect(),
    ));
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(p.rows.len(), 128);
    for (x, r) in p.rows.iter().enumerate() {
        assert_eq!(r["v"], n(x as f64));
    }
    let values = vec![
        row(vec![("v", n(3.))]),
        row(vec![(
            "v",
            WireValue::F64(WireNumber::Special(SpecialNumber::Nan)),
        )]),
        row(vec![("v", n(1.))]),
    ];
    assert_eq!(
        aggregate(Aggregation::Min, &values, "v", None, &LocaleOrder),
        n(1.)
    );
    assert_eq!(
        aggregate(Aggregation::Max, &values, "v", None, &LocaleOrder),
        n(3.)
    );
    assert_eq!(
        LocaleOrder.compare(&n(f64::NAN), &n(1.)).unwrap(),
        Ordering::Equal
    );
}
#[test]
fn finite_number_keys_match_javascript_shortest_decimal() {
    let mut values = vec![
        1.2345678901234567,
        1000000000000000128.,
        1.0000000000000001e21,
        1.2345678901234568e-7,
        f64::MAX,
        f64::MIN_POSITIVE,
        f64::from_bits(1),
    ];
    let mut bits = 0x123456789abcdef0u64;
    for _ in 0..128 {
        bits = bits.wrapping_mul(6364136223846793005).wrapping_add(1);
        let x = f64::from_bits(bits);
        if x.is_finite() {
            values.push(x);
        }
    }
    let strings = values.iter().map(|x| format!("{x:e}")).collect::<Vec<_>>();
    let mut node=Command::new("node").args(["-e","let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(x=>JSON.stringify(['number',Number(x)])))))"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    node.stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&strings).unwrap().as_bytes())
        .unwrap();
    let output = node.wait_with_output().unwrap();
    assert!(output.status.success());
    let expected: Vec<String> = serde_json::from_slice(&output.stdout).unwrap();
    for (x, want) in values.iter().zip(expected) {
        assert_eq!(pivot_value_key(&n(*x)), want, "{x:e}");
    }
}
#[test]
fn split_axis_exact_500_boundary() {
    let mut i = input(
        (0..499)
            .map(|x| row(vec![("s", n(x as f64)), ("v", n(1.))]))
            .collect(),
        vec!["s", "v"],
        config(vec![], vec!["s"]),
    );
    i.config.aggregation_fns = Some(BTreeMap::from([("v".into(), Aggregation::Sum)]));
    assert_eq!(pivot(&i, &LocaleOrder).unwrap().unwrap().columns.len(), 500);
    i.rows.push(row(vec![("s", n(499.)), ("v", n(1.))]));
    assert_eq!(
        pivot(&i, &LocaleOrder).unwrap_err().code,
        "pivot-column-limit"
    );
}
#[test]
fn hover_display_retains_primitive_cells_and_reads_array_own_indices() {
    let mut i = input(
        vec![
            row(vec![("g", s("scalar"))]),
            row(vec![("g", WireValue::Array(vec![s("array-display")]))]),
        ],
        vec!["g"],
        config(vec!["g"], vec![]),
    );
    i.columns[0].properties.insert(
        "hoverCard".into(),
        WireValue::Record(vec![("cellField".into(), s("0"))]),
    );
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(
        p.rows
            .iter()
            .filter_map(|r| r.get(LABEL_FIELD))
            .cloned()
            .collect::<Vec<_>>(),
        vec![s("array-display"), s("scalar")]
    );
}
#[test]
fn cached_order_avoids_repeated_host_crossings_without_changing_ties() {
    struct CountingOrder(std::cell::Cell<usize>);
    impl ValueOrder for CountingOrder {
        fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
            self.0.set(self.0.get() + 1);
            LocaleOrder.compare(a, b)
        }
    }
    let host = CountingOrder(std::cell::Cell::new(0));
    let cache = CachedOrder::new(&host, 2);
    assert_eq!(
        cache.compare(&s("item2"), &s("item10")).unwrap(),
        Ordering::Less
    );
    assert_eq!(
        cache.compare(&s("item2"), &s("item10")).unwrap(),
        Ordering::Less
    );
    assert_eq!(host.0.get(), 1);
    assert_eq!(
        cache.compare(&s("Éclair"), &s("eclair")).unwrap(),
        Ordering::Equal
    );
    assert_eq!(
        cache.compare(&s("Éclair"), &s("eclair")).unwrap(),
        Ordering::Equal
    );
    assert_eq!(host.0.get(), 2);
    assert_eq!(
        cache.compare(&n(f64::NAN), &n(1.)).unwrap(),
        Ordering::Equal
    );
    assert!(cache.cache_size() <= 2);
}
#[test]
fn decimal_midpoint_preserves_member_identity_and_distinct_count() {
    let x = f64::from_bits(0x3e60000000000000);
    assert_eq!(number_string(x), "2.9802322387695312e-8");
    assert_eq!(pivot_value_key(&n(x)), "[\"number\",2.9802322387695312e-8]");
    let rows = vec![
        row(vec![("v", n(x))]),
        row(vec![("v", s("2.9802322387695312e-8"))]),
    ];
    assert_eq!(
        aggregate(Aggregation::UniqueCount, &rows, "v", None, &LocaleOrder),
        s("1")
    );
}
#[test]
fn unordered_primary_stops_secondary_leaf_sort() {
    for primary in [
        WireValue::F64(WireNumber::Special(SpecialNumber::Nan)),
        WireValue::F64(WireNumber::Special(SpecialNumber::PositiveInfinity)),
    ] {
        let second = if primary == WireValue::F64(WireNumber::Special(SpecialNumber::Nan)) {
            n(1.)
        } else {
            primary.clone()
        };
        let mut i = input(
            vec![
                row(vec![("g", s("A")), ("p", primary), ("secondary", n(2.))]),
                row(vec![("g", s("A")), ("p", second), ("secondary", n(1.))]),
            ],
            vec!["g", "p", "secondary"],
            config(vec!["g"], vec![]),
        );
        i.sorting = vec![
            Sort {
                id: "p".into(),
                desc: false,
            },
            Sort {
                id: "secondary".into(),
                desc: false,
            },
        ];
        let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
        assert_eq!(p.rows[1]["secondary"], n(2.));
        assert_eq!(p.rows[2]["secondary"], n(1.));
    }
}
#[test]
fn non_total_64_member_axis_matches_current_host_permutation() {
    let values = (32..=62)
        .rev()
        .map(|x| n(x as f64))
        .chain([WireValue::F64(WireNumber::Special(SpecialNumber::Nan))])
        .chain((0..=31).rev().map(|x| n(x as f64)))
        .collect::<Vec<_>>();
    let mut i = input(
        values
            .into_iter()
            .enumerate()
            .map(|(ordinal, g)| row(vec![("g", g), ("ordinal", n(ordinal as f64))]))
            .collect(),
        vec!["g", "ordinal"],
        config(vec!["g"], vec![]),
    );
    i.config.aggregation_fns = Some(BTreeMap::from([("ordinal".into(), Aggregation::First)]));
    i.kinds.insert("ordinal".into(), FieldKind::Date);
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    let expected = (32..=62)
        .map(|x| x.to_string())
        .chain(["NaN".into()])
        .chain((0..=31).map(|x| x.to_string()))
        .collect::<Vec<_>>();
    let actual = p
        .rows
        .iter()
        .filter_map(|r| r.get(LABEL_FIELD))
        .map(value_string)
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
}
#[test]
fn host_compatibility_refusal_and_malformed_permutations_are_explicit() {
    struct NoHost;
    impl ValueOrder for NoHost {
        fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
            LocaleOrder.compare(a, b)
        }
    }
    let values = vec![
        vec![WireValue::F64(WireNumber::Special(SpecialNumber::Nan))],
        vec![n(1.)],
    ];
    let mut items = vec![0, 1];
    assert_eq!(
        sort_by_keys(&mut items, &values, &[false], &NoHost)
            .unwrap_err()
            .code,
        "ordering-compatibility-unavailable"
    );
    assert_eq!(items, vec![0, 1]);
    struct Broken(Vec<usize>);
    impl ValueOrder for Broken {
        fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
            LocaleOrder.compare(a, b)
        }
        fn sort_permutation(
            &self,
            _v: &[Vec<WireValue>],
            _d: &[bool],
        ) -> Result<Vec<usize>, Diagnostic> {
            Ok(self.0.clone())
        }
    }
    for permutation in [vec![0, 0], vec![0, 2], vec![0], vec![0, 1, 2]] {
        assert_eq!(
            sort_by_keys(&mut items, &values, &[false], &Broken(permutation))
                .unwrap_err()
                .code,
            "invalid-order-permutation"
        );
        assert_eq!(items, vec![0, 1]);
    }
    let rows = vec![
        row(vec![("v", n(10.)), ("d", values[0][0].clone())]),
        row(vec![("v", n(20.)), ("d", n(1.))]),
    ];
    assert_eq!(
        pivot_core::pivot::aggregate(Aggregation::First, &rows, "v", Some("d"), &NoHost)
            .unwrap_err()
            .code,
        "ordering-compatibility-unavailable"
    );
    let i = input(rows, vec!["d", "v"], config(vec!["d"], vec![]));
    assert_eq!(
        pivot(&i, &NoHost).unwrap_err().code,
        "ordering-compatibility-unavailable"
    );
}
#[test]
fn conservative_domains_use_one_host_batch_and_total_keys_stay_local() {
    struct Host {
        compare: std::cell::Cell<usize>,
        sort: std::cell::Cell<usize>,
    }
    impl ValueOrder for Host {
        fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
            self.compare.set(self.compare.get() + 1);
            LocaleOrder.compare(a, b)
        }
        fn sort_permutation(
            &self,
            v: &[Vec<WireValue>],
            d: &[bool],
        ) -> Result<Vec<usize>, Diagnostic> {
            self.sort.set(self.sort.get() + 1);
            LocaleOrder.sort_permutation(v, d)
        }
    }
    for values in [
        vec![vec![n(-10.)], vec![s("-3")], vec![n(-2.)]],
        vec![
            vec![WireValue::Array(vec![n(2.)])],
            vec![WireValue::Array(vec![n(1.)])],
        ],
        vec![
            vec![WireValue::Record(vec![])],
            vec![WireValue::Record(vec![("v".into(), n(1.))])],
        ],
        vec![
            vec![WireValue::F64(WireNumber::Special(
                SpecialNumber::PositiveInfinity,
            ))],
            vec![n(1.)],
        ],
    ] {
        let host = Host {
            compare: std::cell::Cell::new(0),
            sort: std::cell::Cell::new(0),
        };
        let want = LocaleOrder.sort_permutation(&values, &[false]).unwrap();
        let mut items = (0..values.len()).collect::<Vec<_>>();
        sort_by_keys(&mut items, &values, &[false], &host).unwrap();
        assert_eq!(items, want);
        assert_eq!(host.sort.get(), 1);
        assert_eq!(host.compare.get(), 0);
    }
    let host = Host {
        compare: std::cell::Cell::new(0),
        sort: std::cell::Cell::new(0),
    };
    let mut items = vec![0, 1];
    sort_by_keys(
        &mut items,
        &[vec![n(1.), n(2.)], vec![n(1.), n(1.)]],
        &[false, false],
        &host,
    )
    .unwrap();
    assert_eq!(items, vec![1, 0]);
    assert_eq!(host.sort.get(), 0);
    assert_eq!(
        host.compare_raw(
            &WireValue::F64(WireNumber::Special(SpecialNumber::Nan)),
            &n(1.)
        )
        .unwrap(),
        Comparison::Unordered
    );
    assert_eq!(
        compare_sorted_raw(&n(f64::INFINITY), &n(f64::INFINITY), true, &host).unwrap(),
        Comparison::Unordered
    );
}
#[test]
fn overflow_group_multisort_and_non_total_first_last_use_host_order() {
    let mut i = input(
        vec![
            row(vec![
                ("g", s("A")),
                ("p", n(f64::MAX)),
                ("secondary", n(2.)),
            ]),
            row(vec![("g", s("A")), ("p", n(f64::MAX))]),
            row(vec![
                ("g", s("B")),
                ("p", n(f64::MAX)),
                ("secondary", n(1.)),
            ]),
            row(vec![("g", s("B")), ("p", n(f64::MAX))]),
        ],
        vec!["g", "p", "secondary"],
        config(vec!["g"], vec![]),
    );
    i.config.aggregation_fns = Some(BTreeMap::from([
        ("p".into(), Aggregation::Sum),
        ("secondary".into(), Aggregation::Sum),
    ]));
    i.sorting = vec![
        Sort {
            id: "p".into(),
            desc: false,
        },
        Sort {
            id: "secondary".into(),
            desc: false,
        },
    ];
    let p = pivot(&i, &LocaleOrder).unwrap().unwrap();
    assert_eq!(
        p.rows
            .iter()
            .filter_map(|r| r.get(LABEL_FIELD))
            .cloned()
            .collect::<Vec<_>>(),
        vec![s("A"), s("B")]
    );
    let dates = (32..=62)
        .rev()
        .map(|x| n(x as f64))
        .chain([WireValue::F64(WireNumber::Special(SpecialNumber::Nan))])
        .chain((0..=31).rev().map(|x| n(x as f64)))
        .collect::<Vec<_>>();
    let keys = dates
        .iter()
        .map(|date| vec![date.clone()])
        .collect::<Vec<_>>();
    let permutation = LocaleOrder.sort_permutation(&keys, &[false]).unwrap();
    let rows = dates
        .into_iter()
        .enumerate()
        .map(|(ordinal, date)| row(vec![("d", date), ("v", n(ordinal as f64))]))
        .collect::<Vec<_>>();
    assert_eq!(
        aggregate(Aggregation::First, &rows, "v", Some("d"), &LocaleOrder),
        n(permutation[0] as f64)
    );
    assert_eq!(
        aggregate(Aggregation::Last, &rows, "v", Some("d"), &LocaleOrder),
        n(*permutation.last().unwrap() as f64)
    );
}

#[test]
fn opaque_string_coercion_refuses_only_when_consumed() {
    let bad = WireValue::Record(vec![("toString".into(), s("bad"))]);
    for value in [bad.clone(), WireValue::Array(vec![bad])] {
        let rows = vec![row(vec![("value", value)])];
        assert!(pivot_core::pivot::aggregate(
            Aggregation::UniqueCount,
            &rows,
            "value",
            None,
            &LocaleOrder
        )
        .is_err());
        assert_eq!(
            pivot_core::pivot::aggregate(Aggregation::Count, &rows, "value", None, &LocaleOrder)
                .unwrap(),
            s("1")
        );
    }
}
