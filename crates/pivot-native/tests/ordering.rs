// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{
    contract::*,
    ordering::{Comparison, ValueOrder},
};
use pivot_native::NativeOrder;
use std::cmp::Ordering::*;
fn s(v: &str) -> WireValue {
    WireValue::String(v.into())
}
fn n(v: f64) -> WireValue {
    WireValue::F64(WireNumber::Finite(v))
}
fn node_oracle(script: &str, args: &serde_json::Value) -> serde_json::Value {
    static BASELINE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    BASELINE.get_or_init(|| {
        let out = std::process::Command::new("node")
            .args(["-p", "JSON.stringify(process.versions)"])
            .output()
            .unwrap();
        assert!(out.status.success(), "Node baseline version probe failed");
        let versions: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        // Node and ICU decide collation and number ordering. V8's build suffix differs between
        // distributions of the same Node (Homebrew node.35, the official Linux build node.34), so it is not pinned.
        for (key, want) in [("node", "26.10.0"), ("icu", "78.3")] {
            assert_eq!(
                versions[key].as_str(),
                Some(want),
                "Oracle {key} changed; review native compatibility before requalifying"
            );
        }
    });
    let out = std::process::Command::new("node")
        .arg("-e")
        .arg(script)
        .arg(args.to_string())
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}
#[test]
fn unicode_extensions_match_only_intl_relevant_options() {
    let locales = [
        "en-US-u-ka-shifted",
        "en-US-u-ks-level1",
        "en-US-u-kc-true",
        "en-US-u-kb-true",
        "en-US-u-kk-false",
        "en-US-u-kr-digit-latn",
        "en-US-u-kv-space",
        "en-US-u-va-posix",
        "en-US-u-co-emoji",
        "de-DE-u-co-phonebk",
        "zh-u-co-stroke",
        "en-u-co-search",
        "en-u-co-standard",
        "en-u-co-foobar",
        "en-u-kf-upper",
        "en-u-kf-lower",
        "en-u-kf-false",
        "en-u-kf-foobar",
        "da-u-kf-no",
        "da-u-kf-false",
        "en-u-kn",
        "en-u-kn-true",
        "en-u-kn-false",
        "en-u-kn-foobar",
        "en-u-kn-yes",
        "en-u-kn-no",
        "de-u-co-phonebk-ka-shifted-kf-upper-kn-false-ks-level1",
    ];
    let pairs = [
        ("a-b", "ab"),
        ("e", "é"),
        ("a", "A"),
        ("item2", "item10"),
        ("ä", "ae"),
        ("😀", "a"),
        ("阿", "八"),
    ];
    let expected = node_oracle(
        r#"const [locales,pairs]=JSON.parse(process.argv[1]);console.log(JSON.stringify(locales.map(locale=>{const pivot=new Intl.Collator(locale,{sensitivity:'base',numeric:true}),recipe=new Intl.Collator(locale);return pairs.map(([a,b])=>[Math.sign(pivot.compare(a,b)),Math.sign(recipe.compare(a,b))]);})));"#,
        &serde_json::json!([locales, pairs]),
    );
    for (i, locale) in locales.iter().enumerate() {
        let order = NativeOrder::new(locale).unwrap();
        for (j, (a, b)) in pairs.iter().enumerate() {
            for (mode, got) in [
                order.compare(&s(a), &s(b)).unwrap(),
                order.compare_recipe(a, b).unwrap(),
            ]
            .into_iter()
            .enumerate()
            {
                assert_eq!(
                    got,
                    expected[i][j][mode].as_i64().unwrap().cmp(&0),
                    "{locale} {a}/{b} mode {mode}"
                );
            }
        }
    }
}
#[test]
fn valid_private_use_tags_span_old_icu_buffer_capacity() {
    let mut tags = vec![];
    for count in 15..=20 {
        for last in 1..=8 {
            let mut parts = vec!["aaaaaaaa"; count];
            parts[count - 1] = &"aaaaaaaa"[..last];
            tags.push(format!("en-x-{}", parts.join("-")));
        }
    }
    tags.push(format!("en-x-{}", vec!["aaaaaaaa"; 200].join("-")));
    let supported=node_oracle("console.log(JSON.stringify(JSON.parse(process.argv[1]).map(tag=>Intl.Collator.supportedLocalesOf([tag]).length===1)));",&serde_json::json!(tags));
    for (i, tag) in tags.iter().enumerate() {
        assert_eq!(supported[i].as_bool(), Some(true));
        let order = NativeOrder::new(tag).unwrap_or_else(|e| panic!("{} bytes: {e:?}", tag.len()));
        assert_eq!(order.compare(&s("item2"), &s("item10")).unwrap(), Less);
    }
}
#[test]
fn pivot_base_numeric_and_recipe_default_are_independent() {
    let order = NativeOrder::new("en-US").unwrap();
    assert_eq!(order.compare(&s("item2"), &s("item10")).unwrap(), Less);
    assert_eq!(order.compare(&s("Éclair"), &s("eclair")).unwrap(), Equal);
    for (a, b, want) in [
        ("item2", "item10", Greater),
        ("e", "é", Less),
        ("a", "A", Less),
    ] {
        assert_eq!(order.compare_recipe(a, b).unwrap(), want);
    }
}
#[test]
fn negotiated_locales_match_distinct_language_tailoring() {
    for (locale, a, b, want) in [
        ("sv-SE", "ä", "z", Greater),
        ("de-DE", "ä", "z", Less),
        ("tr-TR", "I", "ı", Equal),
        ("fr-FR", "É", "e", Equal),
    ] {
        assert_eq!(
            NativeOrder::new(locale)
                .unwrap()
                .compare(&s(a), &s(b))
                .unwrap(),
            want
        );
    }
    for locale in ["", "zz-ZZ", "not_a_locale", "invalid-baseline-locale"] {
        assert!(NativeOrder::new(locale).is_err(), "{locale}");
    }
}
#[test]
fn missing_last_descending_ties_and_unordered_stop_later_keys() {
    let order = NativeOrder::new("en-US").unwrap();
    let rows = vec![
        vec![WireValue::Missing],
        vec![s("a")],
        vec![WireValue::Null],
        vec![s("A")],
        vec![s("")],
        vec![s("z")],
    ];
    assert_eq!(
        order.sort_permutation(&rows, &[true]).unwrap(),
        [5, 1, 3, 0, 2, 4]
    );
    for special in [SpecialNumber::Nan, SpecialNumber::PositiveInfinity] {
        let a = WireValue::F64(WireNumber::Special(special));
        let b = if special == SpecialNumber::Nan {
            n(1.)
        } else {
            a.clone()
        };
        assert_eq!(order.compare_raw(&a, &b).unwrap(), Comparison::Unordered);
        assert_eq!(order.compare(&a, &b).unwrap(), Equal);
        assert_eq!(
            order
                .sort_permutation(&[vec![a, n(2.)], vec![b, n(1.)]], &[false, false])
                .unwrap(),
            [0, 1]
        );
    }
    assert!(order.sort_permutation(&[vec![n(1.)]], &[]).is_err());
}
// A bytewise replacement, ordinary Rust sort, or NaN-as-zero multikey fallthrough
// changes these complete permutations. Expected values come from Node's actual Array.sort.
#[test]
fn complete_mixed_and_nonfinite_permutations_match_node_at_merge_boundaries() {
    let order = NativeOrder::new("en-US").unwrap();
    let script = r#"const [rows,desc]=JSON.parse(process.argv[1]);const d=w=>w.tag==='missing'?undefined:w.tag==='null'?null:w.tag==='f64'?typeof w.value==='number'?w.value:w.value==='-0'?-0:Number(w.value):w.tag==='array'?w.value.map(d):w.tag==='record'?Object.fromEntries(w.value.map(([k,v])=>[k,d(v)])):w.tag==='bigint-string'?BigInt(w.value):w.value;const v=rows.map(r=>r.map(d)),c=new Intl.Collator('en-US',{sensitivity:'base',numeric:true}),m=x=>x==null||x==='';console.log(JSON.stringify(v.map((_,i)=>i).sort((a,b)=>{for(let k=0;k<desc.length;k++){let x=v[a][k],y=v[b][k],z=m(x)||m(y)?m(x)===m(y)?0:m(x)?1:-1:typeof x==='number'&&typeof y==='number'?x-y:c.compare(String(x),String(y));if(desc[k]&&!m(x)&&!m(y))z=-z;if(z!==0)return z;}return 0;})));"#;
    let choices = vec![
        n(-10.),
        s("-3"),
        n(-2.),
        s("-20"),
        WireValue::Bool(false),
        WireValue::F64(WireNumber::Special(SpecialNumber::Nan)),
        WireValue::F64(WireNumber::Special(SpecialNumber::PositiveInfinity)),
        WireValue::Missing,
        s("Éclair"),
        s("eclair"),
        s("item10"),
        s("item2"),
        WireValue::Array(vec![n(1.), WireValue::Null, n(2.)]),
        WireValue::Record(vec![]),
    ];
    for len in [0, 1, 2, 5, 31, 32, 63, 64, 65, 127, 128, 129, 257, 1024] {
        for seed in 0..8 {
            let mut state = seed + 1_u64;
            let rows: Vec<_> = (0..len)
                .map(|i| {
                    state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                    vec![
                        choices[(state >> 32) as usize % choices.len()].clone(),
                        n((i % 11) as f64),
                    ]
                })
                .collect();
            let desc = [seed % 2 == 0, seed % 3 == 0];
            let want: Vec<usize> =
                serde_json::from_value(node_oracle(script, &serde_json::json!([rows, desc])))
                    .unwrap();
            assert_eq!(
                order.sort_permutation(&rows, &desc).unwrap(),
                want,
                "len {len} seed {seed}"
            );
        }
    }
}
