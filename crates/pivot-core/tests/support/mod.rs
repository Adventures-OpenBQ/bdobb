// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#![allow(dead_code)]
use pivot_core::contract::*;
use pivot_core::ordering as o;
use serde_json::{json, Value};
pub fn get<'a>(v: &'a WireValue, k: &str) -> &'a WireValue {
    if let WireValue::Record(v) = v {
        v.iter()
            .find(|(s, _)| s == k)
            .map(|(_, v)| v)
            .unwrap_or(&WireValue::Missing)
    } else {
        &WireValue::Missing
    }
}
pub fn arr(v: &WireValue) -> &[WireValue] {
    if let WireValue::Array(a) = v {
        a
    } else {
        &[]
    }
}
pub fn text(v: &WireValue) -> &str {
    if let WireValue::String(s) = v {
        s
    } else {
        ""
    }
}
pub fn plain(v: &WireValue) -> Value {
    match v {
        WireValue::Missing | WireValue::Null => Value::Null,
        WireValue::Bool(b) => json!(b),
        WireValue::String(s) => json!(s),
        WireValue::F64(WireNumber::Finite(n)) => {
            if n.fract() == 0. && n.abs() < 9007199254740992. {
                json!(*n as i64)
            } else {
                json!(n)
            }
        }
        WireValue::Array(a) => Value::Array(a.iter().map(plain).collect()),
        WireValue::Record(r) => Value::Object(
            r.iter()
                .filter(|(_, v)| !matches!(v, WireValue::Missing))
                .map(|(k, v)| (k.clone(), plain(v)))
                .collect(),
        ),
        _ => Value::Null,
    }
}
pub fn fixture(name: &str) -> (WireValue, SourceDataset, ValidatedDefinition, RuntimeParams) {
    let root: WireValue = serde_json::from_str(
        &std::fs::read_to_string(format!("../../src/test/fixtures/rust-pivot/{name}.json"))
            .unwrap(),
    )
    .unwrap();
    let c = get(&root, "case");
    let ds = get(c, "dataset");
    let mut p = plain(ds);
    p["rows"] = json!(arr(get(ds, "rows"))
        .iter()
        .map(|r| {
            let mut row = plain(r);
            if let WireValue::Record(values) = get(r, "values") {
                row["values"] =
                    serde_json::to_value(values.iter().cloned().collect::<ValueRecord>()).unwrap();
            }
            row
        })
        .collect::<Vec<_>>());
    // Dataset metadata remains tagged; typed fields are decoded only at their own boundary.
    for (container, key) in [
        ("provenance", "metadata"),
        ("provenance", "parameters"),
        ("provenance", "receipt"),
    ] {
        if let WireValue::Record(r) = get(get(ds, container), key) {
            p[container][key] =
                serde_json::to_value(r.iter().cloned().collect::<ValueRecord>()).unwrap();
        }
    }
    for (column, raw) in p["columns"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip(arr(get(ds, "columns")))
    {
        if let WireValue::Record(r) = get(raw, "metadata") {
            column["metadata"] =
                serde_json::to_value(r.iter().cloned().collect::<ValueRecord>()).unwrap();
        }
    }
    let source = serde_json::from_value(p).unwrap();
    let raw = get(c, "definition");
    let analytical = get(raw, "analytical");
    let mut def = plain(raw);
    if let WireValue::Array(filters) = get(get(raw, "table"), "columnFilters") {
        def["table"]["columnFilters"] = json!(filters
            .iter()
            .map(|f| json!({"id":text(get(f,"id")),"value":get(f,"value")}))
            .collect::<Vec<_>>());
    }
    let definition = ValidatedDefinition {
        locale: text(get(c, "locale")).to_string(),
        analytical_recipe_source: (!matches!(analytical, WireValue::Missing))
            .then(|| analytical.clone()),
        definition: serde_json::from_value(def).unwrap(),
    };
    let runtime = if matches!(get(c, "runtimeParams"), WireValue::Record(_)) {
        serde_json::from_value(plain(get(c, "runtimeParams"))).unwrap()
    } else {
        RuntimeParams::new()
    };
    (root, source, definition, runtime)
}
pub struct Host;
fn reference() -> &'static std::path::Path {
    static PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    PATH.get_or_init(|| {
        let path =
            std::env::temp_dir().join(format!("task6-pivot-reference-{}.cjs", std::process::id()));
        let out = std::process::Command::new("../../node_modules/.bin/esbuild")
            .arg("../../src/lib/pivotTable.ts")
            .args(["--bundle", "--platform=node", "--format=cjs"])
            .arg(format!("--outfile={}", path.display()))
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        path
    })
    .as_path()
}
fn node(script: &str, args: Value) -> Value {
    let out = std::process::Command::new("node")
        .arg("-e")
        .arg(script)
        .arg(serde_json::to_string(&args).unwrap())
        .arg(reference())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}
const DECODE: &str = r#"const decode=w=>{switch(w.tag){case'missing':return undefined;case'null':return null;case'f64':return typeof w.value==='number'?w.value:w.value==='-0'?-0:Number(w.value);case'bigint-string':return BigInt(w.value);case'array':return w.value.map(decode);case'record':return Object.fromEntries(w.value.map(([k,v])=>[k,decode(v)]));default:return w.value}};"#;
impl pivot_core::ordering::ValueOrder for Host {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        let key = serde_json::to_string(&(a, b)).unwrap();
        static CACHE: std::sync::OnceLock<
            std::sync::Mutex<std::collections::BTreeMap<String, std::cmp::Ordering>>,
        > = std::sync::OnceLock::new();
        let cache = CACHE.get_or_init(Default::default);
        if let Some(v) = cache.lock().unwrap().get(&key) {
            return Ok(*v);
        }
        let script=format!("{} const [a,b]=JSON.parse(process.argv[1]);console.log(Math.sign(require(process.argv[2]).compareSorted(decode(a),decode(b),false)));",DECODE);
        let sign = node(&script, json!([a, b])).as_i64().unwrap();
        let value = sign.cmp(&0);
        cache.lock().unwrap().insert(key, value);
        Ok(value)
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<std::cmp::Ordering, Diagnostic> {
        Ok(node("const [a,b]=JSON.parse(process.argv[1]);console.log(Math.sign(a.localeCompare(b,'en-US')));",json!([a,b])).as_i64().unwrap().cmp(&0))
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        let script=format!("{} const [wire,desc]=JSON.parse(process.argv[1]),values=wire.map(r=>r.map(decode)),compare=require(process.argv[2]).compareSorted; console.log(JSON.stringify(values.map((_,i)=>i).sort((a,b)=>{{for(let k=0;k<desc.length;k++){{const c=compare(values[a][k],values[b][k],desc[k]);if(c!==0)return c;}}return 0;}})));",DECODE);
        Ok(serde_json::from_value(node(&script, json!([values, descending]))).unwrap())
    }
}
pub fn untag(v: Value) -> Value {
    match v {
        Value::Object(o) if o.contains_key("tag") => {
            plain(&serde_json::from_value(Value::Object(o)).unwrap())
        }
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, untag(v))).collect()),
        Value::Array(a) => Value::Array(a.into_iter().map(untag).collect()),
        v => v,
    }
}
pub fn assert_descriptors(
    view: &pivot_core::analytical::CalculatedView,
    root: &WireValue,
    name: &str,
) {
    let ready = get(get(root, "result"), "ready");
    assert_eq!(
        serde_json::to_value(&view.diagnostics).unwrap(),
        plain(get(ready, "diagnostics")),
        "{name} diagnostics"
    );
    let expected_count = plain(get(ready, "topLevelCount"));
    if let serde_json::Value::Number(count) = expected_count {
        assert!(
            matches!(view.top_level_count,ResultCount::Exact{value}if Some(value)==count.as_u64()),
            "{name} topLevelCount"
        );
    }
    assert_eq!(
        untag(serde_json::to_value(&view.columns).unwrap()),
        plain(get(ready, "columns")),
        "{name} columns"
    );
    assert_eq!(
        serde_json::to_value(&view.completeness).unwrap(),
        plain(get(ready, "completeness")),
        "{name} completeness"
    );
    for (actual, expected) in view
        .eligible_rows
        .iter()
        .zip(arr(get(get(get(root, "result"), "chart"), "rows")))
    {
        if !matches!(get(expected, "groupPath"), WireValue::Missing) {
            assert_eq!(
                untag(serde_json::to_value(&actual.group_path).unwrap()),
                plain(get(expected, "groupPath")),
                "{name} groupPath"
            );
        }
        assert_eq!(
            serde_json::to_value(&actual.cell_errors).unwrap(),
            plain(get(expected, "cellErrors")),
            "{name} cellErrors"
        );
        assert_eq!(
            serde_json::to_value(&actual.cell_formats).unwrap(),
            plain(get(expected, "cellFormats")),
            "{name} cellFormats"
        );
    }
}
pub fn assert_values(actual: &ValueRecord, expected: &WireValue, name: &str) {
    if let WireValue::Record(expected) = expected {
        let expected: ValueRecord = expected.iter().cloned().collect();
        assert_eq!(
            actual.keys().collect::<Vec<_>>(),
            expected.keys().collect::<Vec<_>>(),
            "{name}"
        );
        for (k, want) in &expected {
            let got = &actual[k];
            match (got, want) {
                (WireValue::F64(WireNumber::Finite(a)), WireValue::F64(WireNumber::Finite(b)))
                    if ["margin", "ratio", "mean", "avg"]
                        .iter()
                        .any(|id| k.to_lowercase().contains(id)) =>
                {
                    assert!(
                        (a - b).abs() <= 1e-12_f64.max(1e-12 * a.abs().max(b.abs())),
                        "{name} {k}: {a} vs {b}"
                    )
                }
                _ => assert_eq!(got, want, "{name} {k}"),
            }
        }
    } else {
        panic!("expected values {name}")
    }
}
pub fn tag(v: &Value) -> WireValue {
    match v {
        Value::Null => WireValue::Null,
        Value::Bool(b) => WireValue::Bool(*b),
        Value::Number(n) => WireValue::F64(WireNumber::Finite(n.as_f64().unwrap())),
        Value::String(s) => WireValue::String(s.clone()),
        Value::Array(a) => WireValue::Array(a.iter().map(tag).collect()),
        Value::Object(o) => WireValue::Record(o.iter().map(|(k, v)| (k.clone(), tag(v))).collect()),
    }
}
pub fn refresh_recipe(d: &mut ValidatedDefinition) {
    d.analytical_recipe_source = Some(tag(&serde_json::to_value(
        d.definition.analytical.as_ref().unwrap(),
    )
    .unwrap()));
}
/// Plain ordinal ordering for scaling tests (no node round trips).
pub struct PlainOrder;
impl pivot_core::ordering::ValueOrder for PlainOrder {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        Ok(compare_values(a, b, &|a, b| a.cmp(b)))
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<std::cmp::Ordering, Diagnostic> {
        Ok(a.cmp(b))
    }
}
/// Rows of `fixture`'s first row, one per distinct `region` R0..Rn.
pub fn distinct_regions(rows: &mut Vec<DatasetRow>, n: usize) {
    let seed = rows[0].clone();
    *rows = (0..n)
        .map(|i| {
            let mut r = seed.clone();
            r.id = format!("r{i}");
            r.values
                .insert("region".into(), WireValue::String(format!("R{i}")));
            r
        })
        .collect();
}
/// Fails when 4x the input takes 9x the time: linear work is ~4x, quadratic ~16x.
/// The fastest of five runs per size keeps a loaded host from deciding the ratio.
// ponytail: wall-clock ratio, not an operation count; a host whose load swings
// more than ~2x between the two sizes can still flake it. Count work if it does.
pub fn assert_linear(what: &str, n: usize, mut run: impl FnMut(usize) -> std::time::Duration) {
    let mut fastest = |n| (0..5).map(|_| run(n)).min().unwrap();
    let (small, large) = (fastest(n), fastest(4 * n));
    assert!(
        large < small * 9,
        "{what}: {n}: {small:?}, {}: {large:?}",
        4 * n
    );
}
/// The TS compareValues reference: adapters provide locale text comparison;
/// numeric subtraction intentionally leaves NaN ties.
pub fn compare_values(
    a: &WireValue,
    b: &WireValue,
    text: &dyn Fn(&str, &str) -> std::cmp::Ordering,
) -> std::cmp::Ordering {
    let (am, bm) = (o::missing(a), o::missing(b));
    if am || bm {
        return am.cmp(&bm);
    }
    if let (Some(a), Some(b)) = (o::number(a), o::number(b)) {
        return (a - b)
            .partial_cmp(&0.)
            .unwrap_or(std::cmp::Ordering::Equal);
    }
    text(&o::value_string(a), &o::value_string(b))
}
